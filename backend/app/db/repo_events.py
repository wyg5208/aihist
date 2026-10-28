"""Event, raw item and review-decision access.

Upserts use `ON CONFLICT DO NOTHING` on purpose: every writer is idempotent by
fingerprint, so a retried sync cannot duplicate a row.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CollectVerdict, Event, RawItem, ReviewDecision


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def observable(statement: Select[Any]) -> Select[Any]:
    """Legacy rows (null) predate the editorial gate and stay visible."""
    return statement.where(
        or_(Event.editorial_status.is_(None), Event.editorial_status == "admitted")
    )


def _dialect_name(session: AsyncSession) -> str:
    bind = session.get_bind()
    return bind.dialect.name if bind is not None else "postgresql"


def _insert_ignore(session: AsyncSession, model: Any, rows: Sequence[dict[str, Any]]):
    if not rows:
        return None
    if _dialect_name(session) == "sqlite":
        return sqlite_insert(model).values(list(rows)).on_conflict_do_nothing()
    return pg_insert(model).values(list(rows)).on_conflict_do_nothing()


async def count_events(session: AsyncSession) -> int:
    statement = observable(select(func.count()).select_from(Event))
    return int((await session.execute(statement)).scalar_one())


async def insert_events(session: AsyncSession, rows: Sequence[dict[str, Any]]) -> int:
    if not rows:
        return 0
    result = await session.execute(_insert_ignore(session, Event, rows))
    await session.commit()
    return max(result.rowcount or 0, 0)


async def insert_raw_items(session: AsyncSession, rows: Sequence[dict[str, Any]]) -> int:
    if not rows:
        return 0
    await session.execute(_insert_ignore(session, RawItem, rows))
    await session.commit()
    return len(rows)


async def upsert_collected(
    session: AsyncSession, rows: Sequence[dict[str, Any]], *, bump_seen: bool = True
) -> int:
    """Write the *current* disposition of collected items, one row per fingerprint.

    Unlike `insert_raw_items`, a second sighting does not no-op: the row keeps
    `first_seen_at`, bumps `seen_count`, and takes the new status/stage/reason.
    The trail of *how* it got there lives in `collect_verdicts` instead, which is
    why this can stay a plain upsert.

    Every row must carry the same keys; callers build them from one helper so
    that stays true.
    """
    if not rows:
        return 0
    payload = list(rows)
    mutable = {
        key: payload[0][key]
        for key in (
            "source_key",
            "run_id",
            "status",
            "stage",
            "reason_code",
            "reason_text",
            "score",
            "event_id",
            "event_fingerprint",
            "last_seen_at",
            "decided_at",
        )
        if key in payload[0]
    }
    updates: dict[str, Any]
    if _dialect_name(session) == "sqlite":
        statement = sqlite_insert(RawItem).values(payload)
    else:
        statement = pg_insert(RawItem).values(payload)
    excluded = statement.excluded
    updates = {key: getattr(excluded, key) for key in mutable}
    # A second *run* is evidence of persistence, not a new row. The pipeline
    # writes the same rows twice per run (intake, then verdicts), so the second
    # flush passes `bump_seen=False` — otherwise one run would count as two
    # sightings of every item.
    if bump_seen:
        updates["seen_count"] = RawItem.seen_count + 1
    statement = statement.on_conflict_do_update(
        index_elements=[RawItem.fingerprint], set_=updates
    )
    await session.execute(statement)
    await session.commit()
    return len(payload)


async def insert_verdicts(session: AsyncSession, rows: Sequence[dict[str, Any]]) -> int:
    """Append decision-trail rows. Insert-only by design: no update, no delete."""
    if not rows:
        return 0
    await session.execute(_insert_ignore(session, CollectVerdict, rows))
    await session.commit()
    return len(rows)


async def read_collected(session: AsyncSession, fingerprint: str) -> RawItem | None:
    result = await session.execute(
        select(RawItem).where(RawItem.fingerprint == fingerprint)
    )
    return result.scalar_one_or_none()


async def update_events(
    session: AsyncSession, patches: Iterable[dict[str, Any]]
) -> int:
    changed = 0
    for entry in patches:
        result = await session.execute(
            update(Event).where(Event.id == entry["id"]).values(**entry["patch"])
        )
        changed += 1 if result.rowcount else 0
    await session.commit()
    return changed


async def load_recent_events(
    session: AsyncSession, min_year: int, limit: int = 600
) -> list[Event]:
    result = await session.execute(
        select(Event)
        .where(Event.year >= min_year)
        .order_by(Event.sort_date.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def load_audit_events(session: AsyncSession, limit: int = 120) -> list[Event]:
    """Legacy auto rows without a verdict, plus held rows worth a retry."""
    result = await session.execute(
        select(Event)
        .where(
            Event.origin == "auto",
            or_(Event.editorial_status.is_(None), Event.editorial_status == "hold"),
        )
        .order_by(Event.sort_date.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def load_slugless_events(session: AsyncSession, limit: int = 60) -> list[Event]:
    result = await session.execute(
        select(Event).where(Event.slug.is_(None)).limit(limit)
    )
    return list(result.scalars().all())


async def load_review_decisions(
    session: AsyncSession, fingerprints: Sequence[str]
) -> dict[str, ReviewDecision]:
    ids = list(dict.fromkeys(value for value in fingerprints if value))
    if not ids:
        return {}
    found: dict[str, ReviewDecision] = {}
    chunk = 200
    for index in range(0, len(ids), chunk):
        result = await session.execute(
            select(ReviewDecision).where(ReviewDecision.id.in_(ids[index : index + chunk]))
        )
        for row in result.scalars().all():
            found[row.id] = row
    return found


async def upsert_review_decisions(
    session: AsyncSession, rows: Sequence[dict[str, Any]]
) -> int:
    if not rows:
        return 0
    if _dialect_name(session) == "sqlite":
        statement = sqlite_insert(ReviewDecision).values(list(rows))
        statement = statement.on_conflict_do_update(
            index_elements=[ReviewDecision.id],
            set_={key: statement.excluded[key] for key in rows[0] if key != "id"},
        )
    else:
        statement = pg_insert(ReviewDecision).values(list(rows))
        statement = statement.on_conflict_do_update(
            index_elements=[ReviewDecision.id],
            set_={key: statement.excluded[key] for key in rows[0] if key != "id"},
        )
    await session.execute(statement)
    await session.commit()
    return len(rows)


def _entered_between(statement: Select[Any], since: datetime, until: datetime) -> Select[Any]:
    """Restrict to *this week's news*, behind the editorial gate.

    Two windows, not one. `first_seen_at` alone answers "new to the archive",
    which on a freshly seeded archive is everything ever written: the first
    digest would claim "159 entries this week" while listing milestones from
    decades ago. The reader's question is what happened this week, so the
    entry's own `sort_date` has to land inside the same window too — a piece
    published a month ago and admitted today is a good archive entry and bad
    news.
    """
    return observable(statement).where(
        Event.first_seen_at >= since,
        Event.first_seen_at < until,
        Event.sort_date >= since.date().isoformat(),
    )


async def count_new_events(
    session: AsyncSession, *, since: datetime, until: datetime
) -> int:
    statement = _entered_between(select(func.count()).select_from(Event), since, until)
    return int((await session.execute(statement)).scalar_one())


async def load_new_events(
    session: AsyncSession, *, since: datetime, until: datetime, limit: int = 12
) -> list[Event]:
    """Entries that are this week's news, best first.

    `first_seen_at` is the only honest "new": `updated_at` moves whenever a
    merge touches a row, so a digest ordered by it would keep re-mailing last
    year's entries. The gate in `_entered_between` adds the second window — the
    entry itself has to be recent — and applies the editorial gate here rather
    than leaving it to the caller, so an issue can never carry a held or
    excluded row.
    """
    result = await session.execute(
        _entered_between(select(Event), since, until)
        .order_by(Event.sort_date.desc(), Event.importance.desc(), Event.id)
        .limit(limit)
    )
    return list(result.scalars().all())


async def read_event(session: AsyncSession, event_id: uuid.UUID) -> Event | None:
    result = await session.execute(select(Event).where(Event.id == event_id))
    return result.scalar_one_or_none()


async def read_event_by_slug(session: AsyncSession, slug: str) -> Event | None:
    result = await session.execute(select(Event).where(Event.slug == slug))
    return result.scalar_one_or_none()


async def query_timeline(
    session: AsyncSession,
    *,
    category: str | None = None,
    confidence: str | None = None,
    year: int | None = None,
    limit: int = 600,
) -> dict[str, Any]:
    conditions = []
    if category:
        conditions.append(Event.category == category)
    if confidence:
        conditions.append(Event.confidence == confidence)
    if year is not None:
        conditions.append(Event.year == year)

    total_statement = observable(select(func.count()).select_from(Event))
    items_statement = observable(select(Event))
    for condition in conditions:
        total_statement = total_statement.where(condition)
        items_statement = items_statement.where(condition)

    total = int((await session.execute(total_statement)).scalar_one())
    items = await session.execute(
        items_statement.order_by(Event.sort_date.desc(), Event.importance.desc()).limit(limit)
    )
    return {"items": list(items.scalars().all()), "total": total}


async def list_holds(session: AsyncSession, limit: int = 50) -> list[Event]:
    result = await session.execute(
        select(Event)
        .where(Event.editorial_status == "hold")
        .order_by(Event.sort_date.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
