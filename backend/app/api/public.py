"""Public read-only endpoints.

Everything here is cacheable and side-effect free; collection is triggered from
cron or the admin console, never by a page view.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import repo_events, repo_sync
from app.deps import get_session, judge_env
from app.editorial.panel import public_panel_info
from app.editorial.standard import STANDARD
from app.ingest.normalize import CATEGORY_KEYS
from app.schemas.event import (
    event_detail,
    run_record,
    timeline_item,
)
from app.config import get_settings

router = APIRouter()

CONFIDENCE_KEYS = frozenset({"verified", "likely", "single"})
# `stale` answers exactly one question — has the scheduler stopped producing
# successes — so it is measured against the real cadence, not against a generic
# "recently". Collection runs once a day at 01:05
# (deploy/windows/register-tasks.ps1, deploy/cron.d/aihist); a six-hour window
# made a perfectly healthy site report stale=true for eighteen hours of every
# day. Twenty-six hours is the daily gap plus two hours of grace: a run that
# lands late does not flip the flag, a missed day does.
STALE_AFTER_HOURS = 26
MAX_LIMIT = 1200


def _as_int(value: str | None, minimum: int, maximum: int) -> int | None:
    if value is None:
        return None
    if not value.isdigit() or (len(value) > 1 and value[0] == "0"):
        return None
    parsed = int(value)
    if parsed < minimum or parsed > maximum:
        return None
    return parsed


def _is_stale(state: repo_sync.SyncState | None) -> bool:
    if state is None or state.last_success_at is None:
        return True
    stamp = state.last_success_at
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - stamp).total_seconds() >= STALE_AFTER_HOURS * 3600


def _sync_summary(state: repo_sync.SyncState | None) -> dict:
    from app.schemas.event import iso

    return {
        "lastSuccessAt": iso(state.last_success_at) if state else None,
        "lastAttemptAt": iso(state.last_attempt_at) if state else None,
        "lastStatus": (state.last_status if state else None) or None,
        "running": repo_sync.lease_is_held(state, int(time.time() * 1000)),
        "stale": _is_stale(state),
        "seedVersion": (state.seed_version if state else None) or None,
    }


@router.get("/timeline")
async def timeline(
    limit: str | None = Query(default=None),
    category: str | None = Query(default=None),
    confidence: str | None = Query(default=None),
    year: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    resolved_limit = 600 if limit is None else _as_int(limit, 1, MAX_LIMIT)
    if resolved_limit is None:
        raise HTTPException(status_code=400, detail="invalid_limit")
    if category and category not in CATEGORY_KEYS:
        raise HTTPException(status_code=400, detail="invalid_category")
    if confidence and confidence not in CONFIDENCE_KEYS:
        raise HTTPException(status_code=400, detail="invalid_confidence")
    resolved_year = None if year is None else _as_int(year, 1900, 2100)
    if year is not None and resolved_year is None:
        raise HTTPException(status_code=400, detail="invalid_year")

    state = await repo_sync.read_state(session)
    result = await repo_events.query_timeline(
        session,
        category=category,
        confidence=confidence,
        year=resolved_year,
        limit=resolved_limit,
    )
    items = [timeline_item(row) for row in result["items"]]
    return {
        "ok": True,
        "items": items,
        "total": result["total"],
        "truncated": result["total"] > len(items),
        "sync": _sync_summary(state),
    }


@router.get("/events")
async def event_by_id(
    id: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        event_id = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_id") from None
    row = await repo_events.read_event(session, event_id)
    if row is None or row.editorial_status in ("excluded", "hold"):
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True, "event": event_detail(row)}


@router.get("/events/{slug}")
async def event_by_slug(slug: str, session: AsyncSession = Depends(get_session)) -> dict:
    from app.domain.slug import is_slug

    if not is_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    row = await repo_events.read_event_by_slug(session, slug)
    if row is None or row.editorial_status in ("excluded", "hold"):
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True, "event": event_detail(row)}


@router.get("/status")
async def status(session: AsyncSession = Depends(get_session)) -> dict:
    state = await repo_sync.read_state(session)
    runs = await repo_sync.recent_runs(session, 5)
    total = await repo_events.count_events(session)
    summary = _sync_summary(state)
    summary["eventCount"] = total
    return {
        "ok": True,
        "sync": summary,
        "panel": public_panel_info(judge_env(get_settings())),
        "runs": [run_record(row) for row in runs],
    }


@router.get("/standard")
async def standard() -> dict:
    return {"ok": True, "standard": STANDARD}
