"""The weekly delete job, with an explicit and deliberately short list of tables.

Retention is the part of analytics that is a legal obligation rather than a
product choice: page views are the only rows in this schema that describe a
reader's behaviour, and keeping them forever would make the privacy note a lie.

Two windows are therefore business constants rather than derived values —
`api_key_usage` (400 days) is billing history and `audit_log` (730 days) is the
accountability record — while the two behaviour tables scale with
`ANALYTICS_RETENTION_DAYS` so a deployment that lowers it actually keeps less.

Nothing outside this list is ever touched: events, sources, sync runs and
subscribers have no retention window, because deleting them would delete the
archive the site is made of.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import local_day
from app.config import Settings
from app.db.models import ApiKeyUsage, AuditLog, CrawlHit, PageView, utc_now

PAGE_VIEW_DAYS = 90
CRAWL_HIT_DAYS = 120
USAGE_DAYS = 400
AUDIT_DAYS = 730


def windows(settings: Settings) -> dict[str, int]:
    """Days kept per table. The analytics pair is capped by configuration."""
    cap = max(1, int(settings.analytics_retention_days or PAGE_VIEW_DAYS))
    return {
        "page_views": min(PAGE_VIEW_DAYS, cap),
        "crawl_hits": min(CRAWL_HIT_DAYS, cap),
        "api_key_usage": USAGE_DAYS,
        "audit_log": AUDIT_DAYS,
    }


async def _purge(session: AsyncSession, model, condition, *, dry_run: bool) -> int:
    if dry_run:
        count = await session.scalar(select(func.count()).select_from(model).where(condition))
        return int(count or 0)
    result = await session.execute(delete(model).where(condition))
    return int(result.rowcount or 0)


async def prune(session: AsyncSession, *, settings: Settings, dry_run: bool = False) -> dict[str, int]:
    """Delete rows past their window. Returns the count removed per table."""
    plan = windows(settings)
    now = utc_now()

    def day_cutoff(days: int) -> str:
        return local_day(now - timedelta(days=days))

    removed = {
        "page_views": await _purge(
            session, PageView, PageView.day < day_cutoff(plan["page_views"]), dry_run=dry_run
        ),
        "crawl_hits": await _purge(
            session, CrawlHit, CrawlHit.day < day_cutoff(plan["crawl_hits"]), dry_run=dry_run
        ),
        "api_key_usage": await _purge(
            session,
            ApiKeyUsage,
            ApiKeyUsage.day < day_cutoff(plan["api_key_usage"]),
            dry_run=dry_run,
        ),
        "audit_log": await _purge(
            session,
            AuditLog,
            AuditLog.at < now - timedelta(days=plan["audit_log"]),
            dry_run=dry_run,
        ),
    }
    if not dry_run:
        await session.commit()
    return removed


__all__ = ["AUDIT_DAYS", "CRAWL_HIT_DAYS", "PAGE_VIEW_DAYS", "USAGE_DAYS", "prune", "windows"]
