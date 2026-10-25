"""Console read surface and the content decision actions.

Mounted under the same `/api/v1/admin` prefix as `admin.py`. The split is not
cosmetic: `admin.py` keeps `/sync` and the module-level `run_sync` name because
the existing suite monkeypatches it, and this module holds everything the new
console added.

Every number here comes from `repo_ops`; no route computes its own metric. That
is the only way "PV means this" stays true across six pages.

There is no DELETE anywhere. Retiring an entry is `exclude`, which sets
`editorial_status` and drops the row out of the public API immediately, while
leaving the record intact for the audit trail.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import Settings, get_settings
from app.db import repo_admin, repo_events, repo_ops
from app.db.models import ReviewDecision, utc_now
from app.deps import AdminPrincipal, client_ip, get_session, judge_env, require_permission
from app.editorial.panel import public_panel_info
from app.schemas.admin import event_admin_record

router = APIRouter()

DecisionAction = Literal["admit", "exclude", "hold", "re-review", "importance", "note"]

# `action` → the `editorial_status` it implies. `re-review` and `importance` are
# handled separately because they touch other columns.
STATUS_FOR_ACTION = {"admit": "admitted", "exclude": "excluded", "hold": "hold"}


class DecisionRequest(BaseModel):
    action: DecisionAction
    reason: str = ""
    importance: int | None = Field(default=None, ge=0, le=100)


def _page(page: int, size: int) -> tuple[int, int]:
    return max(page, 1), min(max(size, 1), 200)


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


@router.get("/overview")
async def overview(
    days: int = Query(default=7, ge=1, le=90),
    principal: AdminPrincipal = Depends(require_permission("read")),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    panel = public_panel_info(judge_env(settings))
    payload = await repo_ops.overview(
        session,
        days=days,
        panel_configured=bool(panel.get("configured")),
        analytics_log_configured=bool(settings.analytics_log_path),
    )
    payload["ok"] = True
    payload["panel"] = panel
    payload["viewer"] = {
        "user": principal.username,
        "role": principal.role,
        "permissions": principal.permissions,
    }
    return payload


# ---------------------------------------------------------------------------
# Runs and sources
# ---------------------------------------------------------------------------


@router.get("/runs/feed")
async def runs_feed(
    limit: int = Query(default=30, ge=1, le=200),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Enriched run list.

    `/runs` deliberately keeps its original ten keys (an existing test pins the
    exact set, and the old console still reads it); this is the console's own
    feed with the counters and the per-source breakdown.
    """
    from app.schemas.admin import admin_run_record

    rows = await repo_ops.run_feed(session, limit=limit)
    return {"ok": True, "runs": [admin_run_record(row) for row in rows]}


@router.get("/runs/{run_id}")
async def run_detail(
    run_id: str,
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.schemas.admin import admin_run_record

    try:
        parsed = uuid.UUID(run_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="invalid_run_id") from None
    row = await repo_ops.run_detail(session, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="run_not_found")
    return {"ok": True, "run": admin_run_record(row)}


@router.get("/sources")
async def sources(
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    items = await repo_ops.source_health(session)
    return {"ok": True, "items": items, "total": len(items)}


@router.get("/judges")
async def judges(
    days: int = Query(default=30, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return {"ok": True, "days": days, "items": await repo_ops.judge_stats(session, days=days)}


# ---------------------------------------------------------------------------
# Traffic
# ---------------------------------------------------------------------------


@router.get("/traffic")
async def traffic(
    days: int = Query(default=30, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("read")),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    series = await repo_ops.traffic_series(session, days=days)
    return {
        "ok": True,
        "days": days,
        "beacon": {
            "enabled": bool(settings.analytics_enabled),
            "series": series,
            "breakdown": await repo_ops.traffic_breakdown(session, days=days),
            "topPaths": await repo_ops.top_paths(session, days=days),
        },
        "crawl": {
            "configured": bool(settings.analytics_log_path),
            "logPath": settings.analytics_log_path,
            **await repo_ops.crawl_summary(session, days=days),
        },
        # The two vocabularies are surfaced separately on purpose: summing them
        # would double count a crawler that also renders the SPA.
        "note": "页面浏览（埋点）与抓取（服务端日志）分开统计，不可相加",
    }


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------


@router.get("/events")
async def list_events(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    confidence: str | None = Query(default=None),
    status: str | None = Query(default=None),
    origin: str | None = Query(default=None),
    year: int | None = Query(default=None),
    missing: str | None = Query(default=None),
    sort: str = Query(default="recent"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=25, ge=1, le=200),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    resolved_page, resolved_size = _page(page, size)
    rows, total = await repo_ops.search_events(
        session,
        q=q,
        category=category,
        confidence=confidence,
        status=status,
        origin=origin,
        year=year,
        missing=missing,
        sort=sort,
        page=resolved_page,
        size=resolved_size,
    )
    return {
        "ok": True,
        "items": [event_admin_record(row) for row in rows],
        "total": total,
        "page": resolved_page,
        "size": resolved_size,
    }


@router.get("/events/{event_id}")
async def read_event(
    event_id: str,
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await _load_event(session, event_id)
    history, _ = await repo_admin.query_audit(
        session, target_type="event", target_id=str(row.id), size=50
    )
    payload = event_admin_record(row)
    payload.update(
        {
            "sources": list(row.sources) if isinstance(row.sources, list) else [],
            "meta": row.meta if isinstance(row.meta, dict) else {},
            "editorialReview": row.editorial_review
            if isinstance(row.editorial_review, dict)
            else None,
            "audit": [
                {
                    "at": entry.at.isoformat() if entry.at else "",
                    "actor": entry.actor,
                    "role": entry.role,
                    "action": entry.action,
                    "summary": entry.summary,
                    "detail": entry.detail or {},
                }
                for entry in history
            ],
        }
    )
    return {"ok": True, "event": payload}


async def _load_event(session: AsyncSession, event_id: str):
    try:
        parsed = uuid.UUID(event_id)
    except (ValueError, AttributeError):
        # A slug is a legitimate handle too: the console links both ways.
        row = await repo_events.read_event_by_slug(session, event_id)
        if row is None:
            raise HTTPException(status_code=404, detail="event_not_found") from None
        return row
    row = await repo_events.read_event(session, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="event_not_found")
    return row


@router.post("/events/{event_id}/decision")
async def decide_event(
    event_id: str,
    payload: DecisionRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("decide", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await _load_event(session, event_id)
    before = row.editorial_status
    moment = utc_now()
    reason = (payload.reason or "").strip()
    action = payload.action

    if action in STATUS_FOR_ACTION:
        target = STATUS_FOR_ACTION[action]
        row.editorial_status = target
        review = dict(row.editorial_review) if isinstance(row.editorial_review, dict) else {}
        review.update(
            {
                "source": "manual",
                "decision": target,
                "at": moment.isoformat(),
                "reason": reason,
            }
        )
        row.editorial_review = review
        summary = f"{action}: {before or 'legacy'} -> {target}"
    elif action == "re-review":
        # Drop the stored ballot so the next sync re-judges this fingerprint
        # instead of replaying the verdict that put it on hold.
        row.editorial_status = "hold"
        review = dict(row.editorial_review) if isinstance(row.editorial_review, dict) else {}
        review.update(
            {"source": "manual", "decision": "hold", "at": moment.isoformat(), "reason": reason}
        )
        row.editorial_review = review
        await session.execute(delete(ReviewDecision).where(ReviewDecision.id == row.fingerprint))
        summary = f"re-review queued (was {before or 'legacy'})"
    elif action == "importance":
        if payload.importance is None:
            raise HTTPException(status_code=400, detail="importance_required")
        previous = int(row.importance or 0)
        row.importance = payload.importance
        summary = f"importance {previous} -> {payload.importance}"
    else:  # note
        if not reason:
            raise HTTPException(status_code=400, detail="note_required")
        row.ops_note = reason[:2000]
        summary = "ops note updated"

    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action=f"event.{action}",
        target_type="event",
        target_id=str(row.id),
        summary=summary,
        detail={
            "from": before,
            "to": row.editorial_status,
            "note": reason,
            "importance": row.importance,
            "fingerprint": row.fingerprint,
        },
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True, "event": event_admin_record(row), "action": action}
