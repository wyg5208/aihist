"""Incremental ingestion of reverse-proxy access logs into `crawl_hits`.

The design constraint is that this runs from cron every hour and must be boring:

* it never raises — a missing file, an unreadable path or a rotated log prints one
  line and exits 0, because a failing cron job teaches an operator to ignore cron;
* it remembers its byte offset in `log_ingest_state`, so a pass costs one read of
  the new bytes rather than a re-scan of a year of logs;
* it writes only document requests. Everything a page needs in order to render is
  filtered out first, so "page reads" cannot be inflated by sub-resources after
  the fact.

Rotation is detected by the only signal available: a file shorter than the offset
we stored. That resets the offset instead of seeking past the end of a new file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.logs import LOG_FORMATS, bucket_day, is_document_request, parse_line
from app.analytics.ua import classify_ua, detect_crawler
from app.db.models import CrawlHit, LogIngestState, utc_now

# One pass never reads more than this many lines: a first run against a year of
# logs should finish inside a cron window and continue on the next tick.
DEFAULT_LINE_LIMIT = 20_000


@dataclass(slots=True)
class IngestReport:
    """What one pass did, printed verbatim by the CLI and asserted by the tests."""

    path: str
    fmt: str = "auto"
    dry_run: bool = False
    scanned: int = 0
    documents: int = 0
    ai: int = 0
    bots: int = 0
    truncated: bool = False
    start_offset: int = 0
    end_offset: int = 0
    skipped: str = ""
    by_bot: dict[str, int] = field(default_factory=dict)


def _read_new_lines(handle, offset: int, limit: int) -> tuple[list[bytes], int]:
    """Complete lines from `offset`, plus the byte count actually consumed.

    An unterminated tail is left alone: the server may be mid-write, and consuming
    half a line would lose that request permanently.
    """
    handle.seek(offset)
    raw = handle.read()
    lines: list[bytes] = []
    consumed = 0
    for chunk in raw.splitlines(keepends=True):
        if not chunk.endswith(b"\n"):
            break
        if len(lines) >= limit:
            return lines, consumed
        lines.append(chunk)
        consumed += len(chunk)
    return lines, consumed


def _hit(line) -> CrawlHit:
    """A parsed line becomes a row; the day comes from the line, not from today.

    Using the ingest clock would put last week's log file into today's bucket, and
    that mistake is invisible until someone compares the chart against the log.
    """
    family, _device = classify_ua(line.user_agent)
    bot_name, is_ai = detect_crawler(line.user_agent)
    at = line.at if line.at.tzinfo else line.at.replace(tzinfo=timezone.utc)
    return CrawlHit(
        at=at,
        day=bucket_day(at),
        path=line.path,
        status=line.status,
        ua_family=family,
        bot_name=bot_name,
        is_ai=is_ai,
        bytes=line.size,
    )


async def ingest_access_log(
    session: AsyncSession,
    *,
    path: str,
    fmt: str = "auto",
    dry_run: bool = False,
    limit: int = DEFAULT_LINE_LIMIT,
) -> IngestReport:
    """Consume whatever is new in `path`. Returns a report; never raises."""
    report = IngestReport(path=path or "", fmt=fmt if fmt in LOG_FORMATS else "auto", dry_run=dry_run)
    if not path:
        report.skipped = "no access log configured (ANALYTICS_LOG_PATH is empty)"
        return report
    target = Path(path)
    if not target.is_file():
        report.skipped = f"no access log at {path}"
        return report

    try:
        state = await session.get(LogIngestState, path)
        offset = int(state.offset) if state is not None else 0
        size = target.stat().st_size
        if size < offset:
            # Rotated: the new file is shorter, so the stored offset points into
            # the middle of nothing. Restart from zero.
            offset = 0
        report.start_offset = offset

        with target.open("rb") as handle:
            raw_lines, consumed = _read_new_lines(handle, offset, limit)

        now = utc_now()
        pending: list[CrawlHit] = []
        for raw in raw_lines:
            report.scanned += 1
            line = parse_line(raw.decode("utf-8", "replace"), report.fmt)
            if line is None or not is_document_request(line.path):
                continue
            report.documents += 1
            hit = _hit(line)
            if hit.bot_name:
                report.bots += 1
                report.by_bot[hit.bot_name] = report.by_bot.get(hit.bot_name, 0) + 1
            if hit.is_ai:
                report.ai += 1
            pending.append(hit)

        report.truncated = len(raw_lines) >= limit and consumed < size - offset
        report.end_offset = offset + consumed

        if dry_run:
            return report

        if pending:
            session.add_all(pending)
        if state is None:
            session.add(LogIngestState(path=path, offset=report.end_offset, updated_at=now))
        else:
            state.offset = report.end_offset
            state.updated_at = now
        await session.commit()
        return report
    except Exception as error:  # noqa: BLE001 - cron must never fail
        await session.rollback()
        report.skipped = f"{type(error).__name__}: {error}"
        return report


__all__ = ["DEFAULT_LINE_LIMIT", "IngestReport", "ingest_access_log"]
