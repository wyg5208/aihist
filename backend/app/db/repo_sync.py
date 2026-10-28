"""Lease, run bookkeeping and sync state.

The previous deployment relied on PostgREST's compare-and-set filter to keep
two runs from overlapping. Here the same guard is an `UPDATE … WHERE
lease_token = <observed>`, which is a single statement and therefore atomic.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import STATE_ID, SyncRun, SyncState

LEASE_TTL_MS = 150_000

RUN_COLUMNS = (
    "id",
    "trigger",
    "status",
    "started_at",
    "finished_at",
    "raw_count",
    "created_count",
    "merged_count",
    "failed_sources",
    "notes",
)

STALE_RUN_MINUTES = 10


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def lease_is_held(state: SyncState | None, now_ms: int) -> bool:
    if state is None or not state.lease_token or not state.lease_expires_at:
        return False
    expires = state.lease_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return int(expires.timestamp() * 1000) > now_ms


async def read_state(session: AsyncSession) -> SyncState | None:
    result = await session.execute(select(SyncState).where(SyncState.id == STATE_ID))
    return result.scalar_one_or_none()


async def acquire_lease(
    session: AsyncSession,
    state: SyncState | None,
    *,
    run_id: uuid.UUID,
    token: str,
    now: datetime,
    trigger: str,
) -> dict[str, Any]:
    expires_at = now + timedelta(milliseconds=LEASE_TTL_MS)
    common = {
        "lease_token": token,
        "lease_expires_at": expires_at,
        "run_id": run_id,
        "last_attempt_at": now,
        "last_status": "running",
        "updated_at": now,
    }

    if state is None:
        session.add(SyncState(id=STATE_ID, seed_version=None, **common))
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            return {"ok": False, "busy": True}
        return {"ok": True, "busy": False, "expiresAt": expires_at}

    statement = update(SyncState).where(SyncState.id == STATE_ID)
    if state.lease_token is None:
        statement = statement.where(SyncState.lease_token.is_(None))
    else:
        statement = statement.where(SyncState.lease_token == state.lease_token)
    result = await session.execute(statement.values(**common))
    await session.commit()
    return {"ok": bool(result.rowcount), "busy": not result.rowcount, "expiresAt": expires_at}


async def heartbeat(session: AsyncSession, token: str, run_id: uuid.UUID) -> bool:
    expires_at = utc_now() + timedelta(milliseconds=LEASE_TTL_MS)
    result = await session.execute(
        update(SyncState)
        .where(
            SyncState.id == STATE_ID,
            SyncState.lease_token == token,
            SyncState.run_id == run_id,
        )
        .values(lease_expires_at=expires_at, updated_at=utc_now())
    )
    await session.commit()
    return bool(result.rowcount)


async def release_lease(
    session: AsyncSession,
    token: str,
    run_id: uuid.UUID,
    *,
    status: str,
    seed_version: str | None = None,
) -> None:
    now = utc_now()
    values: dict[str, Any] = {
        "lease_token": None,
        "lease_expires_at": None,
        "last_status": status,
        "updated_at": now,
    }
    if seed_version:
        values["seed_version"] = seed_version
    if status in ("succeeded", "partial"):
        values["last_success_at"] = now
    await session.execute(
        update(SyncState)
        .where(
            SyncState.id == STATE_ID,
            SyncState.lease_token == token,
            SyncState.run_id == run_id,
        )
        .values(**values)
    )
    await session.commit()


async def update_seed_version(
    session: AsyncSession, token: str, run_id: uuid.UUID, version: str
) -> None:
    await session.execute(
        update(SyncState)
        .where(
            SyncState.id == STATE_ID,
            SyncState.lease_token == token,
            SyncState.run_id == run_id,
        )
        .values(seed_version=version, updated_at=utc_now())
    )
    await session.commit()


async def start_run(
    session: AsyncSession, *, run_id: uuid.UUID, trigger: str, now: datetime
) -> None:
    session.add(
        SyncRun(
            id=run_id,
            trigger=trigger,
            status="running",
            started_at=now,
            finished_at=None,
            raw_count=0,
            created_count=0,
            merged_count=0,
            failed_sources=[],
            notes=None,
        )
    )
    await session.commit()


async def finish_run(
    session: AsyncSession, run_id: uuid.UUID, result: dict[str, Any]
) -> None:
    """Close a run row.

    Every new column reads through `.get()`: this function is also called by the
    failure path and by test stubs that predate the console's counters, and a
    missing key must cost a zero, not a `KeyError` on the way to recording a
    failed run.
    """
    await session.execute(
        update(SyncRun)
        .where(SyncRun.id == run_id)
        .values(
            status=result["status"],
            finished_at=utc_now(),
            raw_count=result.get("rawCount", 0),
            created_count=result.get("createdCount", 0),
            merged_count=result.get("mergedCount", 0),
            failed_sources=result.get("failedSources", []),
            notes=result.get("notes") or None,
            reviewed_count=result.get("reviewedCount", 0),
            admitted_count=result.get("admittedCount", 0),
            excluded_count=result.get("excludedCount", 0),
            held_count=result.get("heldCount", 0),
            panel_configured=bool(result.get("panelConfigured", False)),
            duration_ms=result.get("durationMs", 0),
            detail=result.get("detail") or {},
        )
    )
    await session.commit()


async def recent_runs(session: AsyncSession, limit: int = 5) -> list[SyncRun]:
    result = await session.execute(
        select(SyncRun).order_by(SyncRun.started_at.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def count_runs(session: AsyncSession, trigger: str) -> int:
    """How many runs of this trigger have finished starting.

    The archive uses it as a clock: one backfill advances its year by one. A
    counter of rows beats a stored field because it needs no migration, and a
    failed run still counts at its turn — it is a retry of the same year, not a
    reason to skip it.
    """
    result = await session.execute(
        select(func.count()).select_from(SyncRun).where(SyncRun.trigger == trigger)
    )
    return int(result.scalar_one())


async def recover_stale_runs(session: AsyncSession, minutes: int = STALE_RUN_MINUTES) -> int:
    """Mark orphaned `running` rows as failed after a restart.

    `asyncio.create_task` dies with the process, and the lease TTL alone would
    leave the row claiming to be in flight forever.
    """
    cutoff = utc_now() - timedelta(minutes=minutes)
    result = await session.execute(
        update(SyncRun)
        .where(SyncRun.status == "running", SyncRun.started_at < cutoff)
        .values(status="failed", finished_at=utc_now(), notes="interrupted")
    )
    await session.commit()
    return result.rowcount or 0
