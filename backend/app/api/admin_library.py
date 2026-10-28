"""Collection library endpoints: what we fetched, what happened to it, and why.

Read-only by design. A decision taken here would have to duplicate the
`audit_log` vocabulary that `#/content` already owns, so the library links out to
the event instead. Only `require_permission("read")` is used — an analyst can
audit a rejection without being able to change it.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import repo_library, repo_ops
from app.deps import AdminPrincipal, get_session, require_permission
from app.ingest import reasons
from app.schemas.library import (
    event_record,
    library_item_record,
    reason_option,
    review_record,
    verdict_record,
)

router = APIRouter()


@router.get("/library")
async def list_library(
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    stage: str | None = Query(default=None),
    reason: str | None = Query(default=None),
    sourceKey: str | None = Query(default=None),
    family: str | None = Query(default=None),
    runId: str | None = Query(default=None),
    days: int = Query(default=7, ge=1, le=365),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=100),
    sort: str = Query(default="recent"),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    rows, total = await repo_library.search_items(
        session,
        q=q,
        status=status,
        stage=stage,
        reason=reason,
        source_key=sourceKey,
        family=family,
        run_id=runId,
        days=days,
        page=page,
        size=size,
        sort=sort,
    )
    links = await repo_library.link_events(
        session, [str(row.event_fingerprint or "") for row in rows]
    )
    return {
        "ok": True,
        "items": [
            library_item_record(row, links.get(str(row.event_fingerprint or "")))
            for row in rows
        ],
        "total": total,
        "page": page,
        "size": size,
        "summary": await repo_library.summary(session, days=days),
    }


@router.get("/library/summary")
async def library_summary(
    days: int = Query(default=7, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return {"ok": True, "summary": await repo_library.summary(session, days=days)}


@router.get("/library/funnel")
async def library_funnel(
    days: int = Query(default=7, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Two views of the same funnel.

    `latest` is the last run's own numbers, straight out of
    `sync_runs.detail.funnel` — exact, and the only place the transient stages
    (fetch → parse) survive. `stages`/`verdicts` are the trailing window, which
    is what the ledger table can still answer because dropped rows are pruned.
    """
    runs = await repo_ops.run_feed(session, limit=1)
    latest = runs[0] if runs else None
    detail = latest.detail if latest is not None and isinstance(latest.detail, dict) else {}
    verdict_counts = await repo_library.reason_codes(session, days=days)
    return {
        "ok": True,
        "days": days,
        "latest": {
            "runId": str(latest.id) if latest is not None else None,
            "startedAt": latest.started_at.isoformat() if latest is not None else None,
            "funnel": detail.get("funnel") or {},
            "verdicts": detail.get("verdicts") or {},
        },
        "stages": await repo_library.stage_counts(session, days=days),
        "verdicts": [reason_option(row["code"], row["count"]) for row in verdict_counts],
        "bySource": await repo_library.source_breakdown(session, days=days),
    }


@router.get("/library/reasons")
async def library_reasons(
    days: int = Query(default=30, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    rows = await repo_library.reason_codes(session, days=days)
    return {
        "ok": True,
        "items": [reason_option(row["code"], row["count"]) for row in rows],
        "vocabulary": [
            {"code": code, "label": reasons.label_of(code), "stage": reasons.stage_of(code)}
            for code in reasons.all_codes()
        ],
    }


@router.get("/library/{item_id}")
async def library_item(
    item_id: str,
    principal: AdminPrincipal = Depends(require_permission("read")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        parsed = uuid.UUID(item_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail="invalid_item_id") from None
    payload = await repo_library.item_detail(session, parsed)
    if payload is None:
        raise HTTPException(status_code=404, detail="item_not_found")
    item = payload["item"]
    event = payload["event"]
    link = (
        {"id": str(event.id), "slug": event.slug, "title": event.title}
        if event is not None
        else None
    )
    return {
        "ok": True,
        "item": library_item_record(item, link),
        "verdicts": [verdict_record(row) for row in payload["verdicts"]],
        "review": review_record(payload["review"]),
        "event": event_record(event),
    }
