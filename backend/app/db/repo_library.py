"""Read side of the collection ledger.

The library page is read-only by design: decisions stay on `#/content`, where
every action already writes to `audit_log`. So this module has no writes except
the retention prune, and every query is bounded — the console can be open while
a collection run is writing, and SQLite will hand out `database is locked` if a
read decides to scan a year of rows.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CollectVerdict, Event, RawItem, ReviewDecision


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _cutoff(days: int) -> datetime:
    return utc_now() - timedelta(days=max(days, 1))


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; everything here compares in UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


SORTS: dict[str, tuple[Any, ...]] = {
    "recent": (RawItem.last_seen_at.desc(),),
    "oldest": (RawItem.last_seen_at.asc(),),
    "published": (RawItem.published_at.desc().nullslast(),),
    "score": (RawItem.score.desc(), RawItem.last_seen_at.desc()),
    "title": (RawItem.title.asc(),),
}

STATUSES = ("pending", "admitted", "excluded", "held", "dropped")


def _filters(
    *,
    q: str | None,
    status: str | None,
    stage: str | None,
    reason: str | None,
    source_key: str | None,
    family: str | None,
    run_id: str | None,
    days: int,
) -> list[Any]:
    conditions: list[Any] = [RawItem.last_seen_at >= _cutoff(days)]
    if status and status in STATUSES:
        conditions.append(RawItem.status == status)
    if stage:
        conditions.append(RawItem.stage == stage)
    if reason:
        # A prefix match keeps `rule:` useful: one click shows every hard-rule
        # rejection without enumerating nine codes in the query string.
        conditions.append(RawItem.reason_code.startswith(reason))
    if source_key:
        conditions.append(RawItem.source_key == source_key)
    if family:
        conditions.append(RawItem.source_family == family)
    if run_id:
        try:
            conditions.append(RawItem.run_id == uuid.UUID(run_id))
        except (ValueError, AttributeError, TypeError):
            # A malformed id must not silently widen the result set.
            conditions.append(RawItem.id.is_(None))
    if q:
        pattern = f"%{q.strip()}%"
        conditions.append(
            or_(
                RawItem.title.ilike(pattern),
                RawItem.url.ilike(pattern),
                RawItem.reason_text.ilike(pattern),
                RawItem.source_name.ilike(pattern),
            )
        )
    return conditions


async def search_items(
    session: AsyncSession,
    *,
    q: str | None = None,
    status: str | None = None,
    stage: str | None = None,
    reason: str | None = None,
    source_key: str | None = None,
    family: str | None = None,
    run_id: str | None = None,
    days: int = 7,
    page: int = 1,
    size: int = 50,
    sort: str = "recent",
) -> tuple[list[RawItem], int]:
    conditions = _filters(
        q=q,
        status=status,
        stage=stage,
        reason=reason,
        source_key=source_key,
        family=family,
        run_id=run_id,
        days=days,
    )
    statement: Select[Any] = select(RawItem).where(and_(*conditions))
    total = int(
        (
            await session.execute(select(func.count()).select_from(statement.subquery()))
        ).scalar_one()
    )
    rows = await session.execute(
        statement.order_by(*SORTS.get(sort, SORTS["recent"]))
        .offset(max(page - 1, 0) * size)
        .limit(max(min(size, 100), 1))
    )
    return list(rows.scalars().all()), total


async def summary(session: AsyncSession, *, days: int = 7) -> dict[str, Any]:
    """KPI tiles plus the four breakdowns the filter bar offers."""
    cutoff = _cutoff(days)
    window = RawItem.last_seen_at >= cutoff

    async def grouped(column: Any) -> list[tuple[Any, int]]:
        rows = await session.execute(
            select(column, func.count()).where(window).group_by(column)
        )
        return [(key, int(count)) for key, count in rows.all()]

    by_status = {key: count for key, count in await grouped(RawItem.status) if key}
    by_stage = {key: count for key, count in await grouped(RawItem.stage) if key}
    by_reason = {
        key: count for key, count in await grouped(RawItem.reason_code) if key
    }
    by_source = {key: count for key, count in await grouped(RawItem.source_key) if key}
    return {
        "days": days,
        "total": sum(by_status.values()),
        "byStatus": by_status,
        "byStage": by_stage,
        "byReason": dict(sorted(by_reason.items(), key=lambda kv: (-kv[1], kv[0]))),
        "bySource": dict(sorted(by_source.items(), key=lambda kv: (-kv[1], kv[0]))),
    }


async def item_detail(session: AsyncSession, item_id: uuid.UUID) -> dict[str, Any] | None:
    """One item, its trail, the panel verdict that decided it, and the event."""
    item = (
        await session.execute(select(RawItem).where(RawItem.id == item_id))
    ).scalar_one_or_none()
    if item is None:
        return None

    verdicts = await session.execute(
        select(CollectVerdict)
        .where(CollectVerdict.item_fingerprint == item.fingerprint)
        .order_by(CollectVerdict.at.asc())
    )
    review = None
    event = None
    if item.event_fingerprint:
        review = (
            await session.execute(
                select(ReviewDecision).where(ReviewDecision.id == item.event_fingerprint)
            )
        ).scalar_one_or_none()
    if item.event_id:
        event = (
            await session.execute(select(Event).where(Event.id == item.event_id))
        ).scalar_one_or_none()
    return {
        "item": item,
        "verdicts": list(verdicts.scalars().all()),
        "review": review,
        "event": event,
    }


async def link_events(session: AsyncSession, fingerprints: list[str]) -> dict[str, Any]:
    """Map cluster fingerprints to the stored events they became.

    The raw row cannot carry the event id at collection time — the event does not
    exist yet — so the library resolves it on read instead of writing a second
    time after insertion.
    """
    wanted = [value for value in dict.fromkeys(fingerprints) if value]
    if not wanted:
        return {}
    rows = await session.execute(
        select(Event.id, Event.slug, Event.title, Event.fingerprint, Event.editorial_status)
        .where(Event.fingerprint.in_(wanted))
    )
    return {
        fingerprint: {
            "id": str(event_id),
            "slug": slug,
            "title": title,
            "editorialStatus": status,
        }
        for event_id, slug, title, fingerprint, status in rows.all()
    }


async def reason_codes(session: AsyncSession, *, days: int = 30) -> list[dict[str, Any]]:
    """Codes that actually occur in the window, with counts.

    The console renders the filter dropdown from this instead of a hard-coded
    list, so a reason added to the pipeline shows up without a frontend release.
    """
    rows = await session.execute(
        select(RawItem.reason_code, func.count())
        .where(RawItem.last_seen_at >= _cutoff(days), RawItem.reason_code != "")
        .group_by(RawItem.reason_code)
    )
    return [
        {"code": code, "count": int(count)}
        for code, count in sorted(rows.all(), key=lambda row: (-row[1], row[0]))
    ]


async def source_breakdown(session: AsyncSession, *, days: int = 7) -> list[dict[str, Any]]:
    """Per-source ledger shape, so a source that never admits anything shows up.

    This is the only place the console can see a feed that fetches fine and is
    then dropped by the rules every single time; the health matrix cannot.
    """
    rows = await session.execute(
        select(
            RawItem.source_key,
            RawItem.source_name,
            RawItem.source_family,
            RawItem.status,
            func.count(),
        )
        .where(RawItem.last_seen_at >= _cutoff(days))
        .group_by(
            RawItem.source_key, RawItem.source_name, RawItem.source_family, RawItem.status
        )
    )
    buckets: dict[str, dict[str, Any]] = {}
    for key, name, family, status, count in rows.all():
        bucket = buckets.setdefault(
            str(key or ""),
            {
                "key": str(key or ""),
                "name": str(name or ""),
                "family": str(family or ""),
                "admitted": 0,
                "excluded": 0,
                "held": 0,
                "dropped": 0,
                "pending": 0,
                "total": 0,
            },
        )
        if status in bucket:
            bucket[status] += int(count)
        bucket["total"] += int(count)
    return sorted(buckets.values(), key=lambda row: (-row["total"], row["key"]))


async def stage_counts(session: AsyncSession, *, days: int = 7) -> list[dict[str, Any]]:
    rows = await session.execute(
        select(RawItem.stage, RawItem.status, func.count())
        .where(RawItem.last_seen_at >= _cutoff(days))
        .group_by(RawItem.stage, RawItem.status)
    )
    buckets: dict[str, dict[str, int]] = {}
    for stage, status, count in rows.all():
        bucket = buckets.setdefault(str(stage or ""), {"admitted": 0, "excluded": 0, "held": 0, "dropped": 0, "pending": 0})
        if status in bucket:
            bucket[status] += int(count)
    return [{"stage": stage, **counts} for stage, counts in buckets.items()]


async def prune_verdicts(
    session: AsyncSession, *, days: int, dry_run: bool = False, batch_size: int = 5000
) -> int:
    """Delete old trail rows and old *dropped* items.

    `admitted` / `excluded` / `held` rows are never pruned: they are the audit
    evidence behind a published entry, and "why did we run this story" has to
    stay answerable. Dropped rows are cheap to regenerate by re-collecting.
    """
    cutoff = utc_now() - timedelta(days=max(days, 1))
    deleted = 0

    if dry_run:
        stale = await session.execute(
            select(func.count()).select_from(CollectVerdict).where(CollectVerdict.at < cutoff)
        )
        stale_items = await session.execute(
            select(func.count())
            .select_from(RawItem)
            .where(RawItem.last_seen_at < cutoff, RawItem.status == "dropped")
        )
        return int(stale.scalar_one()) + int(stale_items.scalar_one())

    # One statement per batch keeps SQLite from holding a write lock for the
    # whole prune; the ids are selected first because SQLite has no `LIMIT` on
    # `DELETE`.
    while True:
        ids = (
            await session.execute(
                select(CollectVerdict.id).where(CollectVerdict.at < cutoff).limit(batch_size)
            )
        ).scalars().all()
        if not ids:
            break
        await session.execute(delete(CollectVerdict).where(CollectVerdict.id.in_(ids)))
        await session.commit()
        deleted += len(ids)

    while True:
        ids = (
            await session.execute(
                select(RawItem.id)
                .where(RawItem.last_seen_at < cutoff, RawItem.status == "dropped")
                .limit(batch_size)
            )
        ).scalars().all()
        if not ids:
            break
        await session.execute(delete(RawItem).where(RawItem.id.in_(ids)))
        await session.commit()
        deleted += len(ids)

    return deleted
