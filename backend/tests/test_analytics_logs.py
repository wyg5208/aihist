"""The two cron jobs: access-log ingestion and retention pruning.

Both are pinned by fixed sample lines rather than by a live proxy, because the
failure they guard against is silent: a regex that stops matching after a proxy
upgrade produces an empty chart, not an error, and a retention job that deletes
the wrong table is only noticed once the archive is gone.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.analytics import local_day
from app.analytics.ingest import ingest_access_log
from app.analytics.logs import (
    bucket_day,
    is_document_request,
    parse_caddy_json,
    parse_line,
    parse_nginx_combined,
)
from app.analytics.retention import (
    AUDIT_DAYS,
    CRAWL_HIT_DAYS,
    PAGE_VIEW_DAYS,
    USAGE_DAYS,
    prune,
    windows,
)
from app.db.models import ApiKeyUsage, AuditLog, CrawlHit, LogIngestState, PageView, Subscriber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import ROOT  # noqa: E402

ACCESS = ROOT / "dev" / "fixtures" / "access"
NGINX_SAMPLE = ACCESS / "nginx.log"
CADDY_SAMPLE = ACCESS / "caddy.log"

# Both samples were recorded on the same UTC+8 calendar day, which is the day
# every row must be bucketed under.
SAMPLE_DAY = "2026-10-25"


# ---------------------------------------------------------------------------
# Parsing: one line in, one request out (or None).
# ---------------------------------------------------------------------------


def test_nginx_sample_keeps_only_document_requests() -> None:
    lines = NGINX_SAMPLE.read_text(encoding="utf-8").splitlines()
    parsed = [parse_nginx_combined(line) for line in lines]
    documents = [line for line in parsed if line is not None and is_document_request(line.path)]

    assert [line.path for line in documents] == [
        "/e/gpt-5.html",
        "/e/gpt-5.html",
        "/e/claude-4.html",
        "/",
    ]
    assert {bucket_day(line.at) for line in documents} == {SAMPLE_DAY}


def test_nginx_sample_drops_the_two_non_requests() -> None:
    """`"-"` (an unparsable request) and prose must not become rows."""
    lines = NGINX_SAMPLE.read_text(encoding="utf-8").splitlines()
    parsed = [parse_nginx_combined(line) for line in lines]

    assert [index for index, line in enumerate(parsed) if line is None] == [7, 9]


def test_nginx_sample_ignores_assets_and_endpoints() -> None:
    """The beacon, the bundle and robots.txt are all requests, none are reads."""
    lines = NGINX_SAMPLE.read_text(encoding="utf-8").splitlines()
    paths = [line.path for line in (parse_nginx_combined(text) for text in lines) if line]

    assert "/api/v1/track" in paths
    assert "/assets/main-BqAyriFF.js" in paths
    assert "/robots.txt" in paths


def test_caddy_sample_keeps_only_document_requests() -> None:
    lines = CADDY_SAMPLE.read_text(encoding="utf-8").splitlines()
    parsed = [parse_caddy_json(line) for line in lines]

    # The last entry is a transport error, not an access record.
    assert parsed[3] is None
    documents = [line for line in parsed if line is not None and is_document_request(line.path)]
    assert [line.path for line in documents] == ["/e/claude-4.html", "/"]

    first = documents[0]
    assert first.status == 200
    assert first.size == 21044
    assert "PerplexityBot" in first.user_agent
    assert bucket_day(first.at) == SAMPLE_DAY


def test_parse_line_sniffs_the_format() -> None:
    caddy = CADDY_SAMPLE.read_text(encoding="utf-8").splitlines()[0]
    nginx = NGINX_SAMPLE.read_text(encoding="utf-8").splitlines()[0]

    assert parse_line(caddy).path == "/e/claude-4.html"
    assert parse_line(nginx).path == "/e/gpt-5.html"
    # An explicit format never guesses: a JSON line is not nginx.
    assert parse_line(caddy, "nginx") is None
    assert parse_line(caddy, "caddy") is not None


def test_absolute_form_target_is_reduced_to_a_path() -> None:
    """A proxy may log `GET https://host/x`; only the path is a page identity."""
    line = (
        '198.51.100.7 - - [25/Oct/2026:03:00:00 +0800] "GET https://aihist.net/e/gemini-3.html HTTP/1.1" '
        '200 123 "-" "curl/8.5.0"'
    )
    parsed = parse_nginx_combined(line)

    assert parsed is not None
    assert parsed.path == "/e/gemini-3.html"


@pytest.mark.parametrize(
    "path",
    ["/", "/e/gpt-5.html", "/about", "/e/gpt-5.html?ref=x"],
)
def test_document_requests(path: str) -> None:
    assert is_document_request(path) is True


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/track",
        "/assets/main-BqAyriFF.js",
        "/robots.txt",
        "/sitemap.xml",
        "/go/acme",
        "/admin",
        "/admin/settings",
        "/e/index.html.map",
        "https://aihist.net/",
        "",
    ],
)
def test_non_document_requests(path: str) -> None:
    assert is_document_request(path) is False


def test_bucket_day_follows_utc8_not_utc() -> None:
    """The dashboard's day boundary is 08:00 UTC, and it must be exact."""
    assert bucket_day(datetime(2026, 10, 24, 17, 30, tzinfo=timezone.utc)) == "2026-10-25"
    assert bucket_day(datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)) == "2026-10-24"


# ---------------------------------------------------------------------------
# Ingestion: offsets, rotation, and never failing a cron run.
# ---------------------------------------------------------------------------


def _sample(tmp_path: Path, name: str = "nginx.log") -> Path:
    """A private copy: offsets are keyed by path and the sample must stay clean."""
    target = tmp_path / name
    target.write_bytes(NGINX_SAMPLE.read_bytes())
    return target


async def _count(session, model) -> int:
    return int(await session.scalar(select(func.count()).select_from(model)) or 0)


async def test_ingest_writes_document_hits_once(db_factory, tmp_path: Path) -> None:
    log = _sample(tmp_path)
    async with db_factory() as session:
        report = await ingest_access_log(session, path=str(log))

    assert report.skipped == ""
    assert (report.scanned, report.documents) == (10, 4)
    assert (report.bots, report.ai) == (2, 1)
    assert report.by_bot == {"GPTBot": 1, "Bingbot": 1}
    assert report.start_offset == 0
    assert report.end_offset == log.stat().st_size
    assert report.truncated is False

    async with db_factory() as session:
        hits = list(await session.scalars(select(CrawlHit)))

    assert [hit.day for hit in hits] == [SAMPLE_DAY] * 4
    assert sorted(hit.path for hit in hits) == [
        "/",
        "/e/claude-4.html",
        "/e/gpt-5.html",
        "/e/gpt-5.html",
    ]
    ai = [hit for hit in hits if hit.is_ai]
    assert len(ai) == 1
    assert ai[0].bot_name == "GPTBot"
    assert all(hit.ua_family == "bot" for hit in hits if hit.bot_name)


async def test_ingest_is_incremental(db_factory, tmp_path: Path) -> None:
    log = _sample(tmp_path)
    async with db_factory() as session:
        await ingest_access_log(session, path=str(log))
    async with db_factory() as session:
        again = await ingest_access_log(session, path=str(log))

    assert (again.scanned, again.documents) == (0, 0)
    assert again.start_offset == again.end_offset == log.stat().st_size
    async with db_factory() as session:
        assert await _count(session, CrawlHit) == 4


async def test_ingest_picks_up_appended_lines_only(db_factory, tmp_path: Path) -> None:
    log = _sample(tmp_path)
    async with db_factory() as session:
        await ingest_access_log(session, path=str(log))

    with log.open("ab") as handle:
        handle.write(
            b'203.0.113.7 - - [25/Oct/2026:03:20:00 +0800] "GET /e/gemini-3.html HTTP/1.1" '
            b'200 999 "-" "Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0"\n'
        )

    async with db_factory() as session:
        report = await ingest_access_log(session, path=str(log))

    assert (report.scanned, report.documents) == (1, 1)
    async with db_factory() as session:
        assert await _count(session, CrawlHit) == 5


async def test_unterminated_tail_waits_for_the_next_pass(db_factory, tmp_path: Path) -> None:
    """The server may be mid-write; consuming half a line would lose it forever."""
    log = tmp_path / "partial.log"
    first = (
        b'203.0.113.7 - - [25/Oct/2026:03:00:00 +0800] "GET /e/a.html HTTP/1.1" 200 10 "-" "Mozilla/5.0"\n'
    )
    second = (
        b'203.0.113.7 - - [25/Oct/2026:03:01:00 +0800] "GET /e/b.html HTTP/1.1" 200 10 "-" "Mozilla/5.0"'
    )
    log.write_bytes(first + second)

    async with db_factory() as session:
        report = await ingest_access_log(session, path=str(log))

    assert (report.scanned, report.documents) == (1, 1)
    assert report.end_offset == len(first)

    with log.open("ab") as handle:
        handle.write(b"\n")
    async with db_factory() as session:
        report = await ingest_access_log(session, path=str(log))

    assert (report.scanned, report.documents) == (1, 1)
    async with db_factory() as session:
        assert await _count(session, CrawlHit) == 2


async def test_a_shorter_file_is_treated_as_rotation(db_factory, tmp_path: Path) -> None:
    log = _sample(tmp_path)
    async with db_factory() as session:
        await ingest_access_log(session, path=str(log))

    log.write_bytes(
        b'203.0.113.7 - - [26/Oct/2026:09:00:00 +0800] "GET /e/new.html HTTP/1.1" 200 10 "-" "Mozilla/5.0"\n'
    )

    async with db_factory() as session:
        report = await ingest_access_log(session, path=str(log))

    assert report.start_offset == 0
    assert report.documents == 1
    async with db_factory() as session:
        assert await _count(session, CrawlHit) == 5


async def test_a_pass_stops_at_the_line_limit(db_factory, tmp_path: Path) -> None:
    """A first run against a year of logs must finish inside a cron window."""
    log = _sample(tmp_path)
    async with db_factory() as session:
        first = await ingest_access_log(session, path=str(log), limit=3)

    assert first.scanned == 3
    assert first.truncated is True

    async with db_factory() as session:
        rest = await ingest_access_log(session, path=str(log))

    assert rest.scanned == 7
    async with db_factory() as session:
        assert await _count(session, CrawlHit) == 4


async def test_dry_run_reports_without_writing(db_factory, tmp_path: Path) -> None:
    log = _sample(tmp_path)
    async with db_factory() as session:
        report = await ingest_access_log(session, path=str(log), dry_run=True)

        assert report.dry_run is True
        assert report.documents == 4
        assert await _count(session, CrawlHit) == 0
        assert await session.get(LogIngestState, str(log)) is None


async def test_missing_or_unset_log_is_skipped_not_raised(db_factory, tmp_path: Path) -> None:
    """A failing cron job teaches an operator to ignore cron."""
    async with db_factory() as session:
        unset = await ingest_access_log(session, path="")
        missing = await ingest_access_log(session, path=str(tmp_path / "absent.log"))

    assert "ANALYTICS_LOG_PATH" in unset.skipped
    assert "no access log at" in missing.skipped
    assert unset.documents == 0
    assert missing.documents == 0


# ---------------------------------------------------------------------------
# Retention: a short, explicit list of tables and windows.
# ---------------------------------------------------------------------------


def _settings(**overrides):
    from app.config import Settings

    values = {
        "database_url": "sqlite+aiosqlite://",
        "session_secret": "test-secret",
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def test_windows_are_capped_by_configuration() -> None:
    assert windows(_settings()) == {
        "page_views": PAGE_VIEW_DAYS,
        "crawl_hits": CRAWL_HIT_DAYS,
        "api_key_usage": USAGE_DAYS,
        "audit_log": AUDIT_DAYS,
    }

    tight = windows(_settings(analytics_retention_days=30))
    assert tight["page_views"] == 30
    assert tight["crawl_hits"] == 30
    # Billing history and the accountability record are not a configuration knob.
    assert tight["api_key_usage"] == USAGE_DAYS
    assert tight["audit_log"] == AUDIT_DAYS


async def test_prune_removes_only_rows_past_their_window(db_factory) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    today = local_day(now)

    async with db_factory() as session:
        session.add_all(
            [
                PageView(day=local_day(now - timedelta(days=PAGE_VIEW_DAYS + 5)), path="/e/old.html"),
                PageView(day=today, path="/e/today.html"),
                CrawlHit(day=local_day(now - timedelta(days=CRAWL_HIT_DAYS + 5)), path="/e/old.html"),
                CrawlHit(day=today, path="/e/today.html"),
                ApiKeyUsage(key_id=uuid.uuid4(), day=local_day(now - timedelta(days=USAGE_DAYS + 5))),
                ApiKeyUsage(key_id=uuid.uuid4(), day=today),
                AuditLog(actor="owner", action="test.old", at=now - timedelta(days=AUDIT_DAYS + 5)),
                AuditLog(actor="owner", action="test.new", at=now),
                Subscriber(email="keep@example.com", token="keep-me"),
            ]
        )
        await session.commit()

    async with db_factory() as session:
        removed = await prune(session, settings=_settings())

    assert removed == {"page_views": 1, "crawl_hits": 1, "api_key_usage": 1, "audit_log": 1}

    async with db_factory() as session:
        assert await _count(session, PageView) == 1
        assert await _count(session, CrawlHit) == 1
        assert await _count(session, ApiKeyUsage) == 1
        assert await _count(session, AuditLog) == 1
        # Nothing outside the analytics list is ever touched.
        assert await _count(session, Subscriber) == 1


async def test_prune_dry_run_counts_without_deleting(db_factory) -> None:
    now = datetime.now(timezone.utc)
    async with db_factory() as session:
        session.add(
            PageView(day=local_day(now - timedelta(days=PAGE_VIEW_DAYS + 1)), path="/e/old.html")
        )
        await session.commit()

    async with db_factory() as session:
        removed = await prune(session, settings=_settings(), dry_run=True)

    assert removed["page_views"] == 1
    async with db_factory() as session:
        assert await _count(session, PageView) == 1
