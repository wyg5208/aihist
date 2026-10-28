"""The weekly mail: what the archive gained in the last seven days, and a way out.

This is the only place the archive speaks *to* a reader, so three rules live
here rather than in the delivery ledger or the CLI:

* **Weekly, and never empty.** The job runs every Monday; a week with no new
  entries is skipped instead of sent as a subject line with nothing under it.
  When it does go out, every entry gets a date, one line of why it matters and
  a link, in that order.
* **One issue a week per address.** `digest_sends` is asked who already received
  something inside the window before anything is composed; an address whose copy
  failed is not in that set and therefore gets another attempt. `--force` is the
  operator's override, not the default.
* **A failed address never stops the run.** The mailer answers per recipient;
  each answer is written down and the loop moves on. The 40th subscriber's
  bounce must not cost the 41st their mail.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app import mailer
from app.config import Settings
from app.db import repo_digest, repo_events
from app.db.models import Event

# A rolling week rather than a calendar week: the job runs Monday morning, and
# the seven days it covers are the seven that just ended. Anchoring to "last
# Monday 00:00" instead would make a mid-week manual run describe a half week.
LOOKBACK_DAYS = 7

# Twelve fits one screen of any mail client. Beyond that the list becomes a
# page to scroll, so the rest is a link rather than a longer mail.
MAX_ITEMS = 12

# One line of "why it matters" per entry: enough to decide whether to click,
# short enough that the source link stays visible without scrolling.
SUMMARY_CHARS = 160

SUBJECT_PREFIX = "[AI 纪年]"

_WHITESPACE = re.compile(r"\s+")

# Chinese prose carries no spaces, so folding a wrapped line must not insert one
# where the source had a newline: "完整的\n数据配比" has to read as 完整的数据配比,
# not "完整的 数据配比". Breaks next to a Latin word or a digit are left alone —
# "GPT-4 的" keeps its space.
_CJK_GAP = re.compile(
    r"(?<=[\u4e00-\u9fff\u3001-\u303f\uff01-\uff60])\s+"
    r"(?=[\u4e00-\u9fff\u3001-\u303f\uff01-\uff60])"
)


@dataclass
class DigestReport:
    """What one run did, in the shape the cron log wants to print.

    `reason` is set exactly when nothing was mailed, and names which of the four
    gates closed: `smtp_not_configured`, `no_new_entries`, `no_recipients`,
    `all_delivered` — plus `dry_run`, which stopped on purpose.
    """

    issue: str
    items: int = 0
    recipients: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    reason: str = ""
    # The body exactly as it would go out, filled only for `--dry-run`.
    sample: str = ""

    def summary(self) -> str:
        parts = [
            f"digest {self.issue}",
            f"items={self.items}",
            f"recipients={self.recipients}",
            f"sent={self.sent}",
            f"failed={self.failed}",
            f"skipped={self.skipped}",
        ]
        if self.reason:
            parts.append(f"reason={self.reason}")
        return " ".join(parts)


def _aware(moment: datetime) -> datetime:
    """SQLite drops the offset on read; every stamp in this application is UTC."""
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment


def brief(summary: str, limit: int = SUMMARY_CHARS) -> str:
    """Collapse whitespace, prefer a sentence end, never cut mid-word silently."""
    text = _CJK_GAP.sub("", _WHITESPACE.sub(" ", (summary or "")).strip())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = max(cut.rfind("。"), cut.rfind("；"), cut.rfind("."), cut.rfind(";"))
    if stop >= limit // 2:
        return cut[: stop + 1]
    return cut.rstrip() + "…"


def event_link(origin: str, slug: str | None) -> str:
    """The SPA opens an entry from `?e=<slug>` (see `src/lib/permalink.ts`)."""
    base = origin.rstrip("/")
    return f"{base}/?e={slug}" if slug else f"{base}/"


def unsubscribe_url(settings: Settings, token: str) -> str:
    """Mirror of `GET /api/v1/unsubscribe` in `api/growth.py`; every mail has one."""
    return f"{settings.site_origin.rstrip('/')}/api/v1/unsubscribe?token={token}"


def render_body(
    *,
    issue: str,
    since: datetime,
    until: datetime,
    total: int,
    items: Sequence[Event],
    site_origin: str,
    unsubscribe: str,
) -> str:
    """Plain text, fixed shape: date, one line, link, then the way out.

    `items` is what fits in one screen (`MAX_ITEMS`); `total` is what the week
    actually gained. The count in the first line is the total, and a list cut
    short says so — otherwise the mail understates the week it is describing.
    """
    origin = site_origin.rstrip("/")
    lines = [
        f"AI 纪年 · 本周新增（{issue}）",
        "",
        f"{since.date().isoformat()} 至 {until.date().isoformat()}，档案里新增 {total} 条。",
        "",
    ]
    for index, item in enumerate(items, start=1):
        lines.append(f"{index}. {item.event_date} · {item.title}")
        summary = brief(item.summary)
        if summary:
            lines.append(f"   {summary}")
        lines.append(f"   {event_link(origin, item.slug)}")
        lines.append("")

    if total > len(items):
        lines.extend(
            [f"这里只列最新的 {len(items)} 条，其余 {total - len(items)} 条在站点上。", ""]
        )

    lines.extend(
        [
            f"完整档案：{origin}/",
            "",
            "——",
            "你订阅的是《AI 纪年》每周简报：每周一发一封，这一周确实没有新增就不发。",
            f"退订：{unsubscribe}",
        ]
    )
    return "\n".join(lines) + "\n"


async def send_weekly(
    session: AsyncSession,
    settings: Settings,
    *,
    now: datetime | None = None,
    dry_run: bool = False,
    force: bool = False,
) -> DigestReport:
    """Compose one issue and mail it to everyone who confirmed.

    The gates are ordered so a skipped week costs one query and leaves no rows
    behind: no mailer, nothing to report, no confirmed address, everyone already
    served inside the window.
    """
    moment = _aware(now or datetime.now(timezone.utc))
    issue = moment.date().isoformat()
    since = moment - timedelta(days=LOOKBACK_DAYS)
    report = DigestReport(issue=issue)

    if not mailer.configured(settings):
        report.reason = "smtp_not_configured"
        return report

    items = await repo_events.load_new_events(
        session, since=since, until=moment, limit=MAX_ITEMS
    )
    if not items:
        report.reason = "no_new_entries"
        return report

    # The list is capped at `MAX_ITEMS`, but the subject and the opening line
    # report the whole week: "新增 12 条" for a week of 30 would be a quiet lie
    # in the one place a reader cannot check it against the page.
    total = await repo_events.count_new_events(session, since=since, until=moment)
    report.items = total

    recipients = await repo_digest.confirmed_recipients(session)
    report.recipients = len(recipients)
    if not recipients:
        report.reason = "no_recipients"
        return report

    delivered = await repo_digest.recent_emails(session, since=since)
    targets = (
        recipients
        if force
        else [row for row in recipients if row.email not in delivered]
    )
    report.skipped = report.recipients - len(targets)
    if not targets:
        report.reason = "all_delivered"
        return report

    subject = f"{SUBJECT_PREFIX} 本周新增 {total} 条"
    messages = [
        (
            row.email,
            subject,
            render_body(
                issue=issue,
                since=since,
                until=moment,
                total=total,
                items=items,
                site_origin=settings.site_origin,
                unsubscribe=unsubscribe_url(settings, row.token),
            ),
        )
        for row in targets
    ]

    if dry_run:
        report.reason = "dry_run"
        report.sample = messages[0][2]
        return report

    # Reserved before the SMTP call, so a run killed mid-list still names who
    # might have received it; the answer overwrites each row right after.
    for row in targets:
        await repo_digest.record(
            session,
            issue=issue,
            email=row.email,
            status="queued",
            subscriber_id=row.id,
            item_count=total,
            now=moment,
        )

    results = await mailer.send_batch(settings, messages)
    for row, (ok, error) in zip(targets, results):
        await repo_digest.record(
            session,
            issue=issue,
            email=row.email,
            status="sent" if ok else "failed",
            subscriber_id=row.id,
            error=error or "",
            item_count=total,
            now=moment,
        )
        if ok:
            report.sent += 1
        else:
            report.failed += 1
    return report


__all__ = [
    "DigestReport",
    "LOOKBACK_DAYS",
    "MAX_ITEMS",
    "brief",
    "event_link",
    "render_body",
    "send_weekly",
    "unsubscribe_url",
]
