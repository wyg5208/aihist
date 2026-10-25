"""Console surface for the mailing list.

Three routes, all `manage`: read the list, move one row's status, and hand the
whole thing back as CSV. There is no compose endpoint and no send button,
because this application does not send email (see `api/growth.py` and the
Settings page). What it does instead is produce a clean, consented, exportable
list for whatever mail tool the operator actually uses.

The export is audited even though it is a GET: it is the one read on this
console that moves personal data out of the database.
"""

from __future__ import annotations

import csv
import io
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import Settings, get_settings
from app.db import repo_growth
from app.deps import (
    AdminPrincipal,
    client_ip,
    get_session,
    get_session_factory,
    require_permission,
)

router = APIRouter()

CSV_COLUMNS = (
    "email",
    "status",
    "source_path",
    "source_channel",
    "consented_at",
    "created_at",
    "confirmed_at",
    "unsubscribed_at",
)


class SubscriberStatusRequest(BaseModel):
    status: str = ""
    # The console requires a reason before it will submit; it lands in the audit
    # detail so a suppression can be explained six months later.
    note: str = ""


def _csv_line(row: Any) -> list[str]:
    return [
        row.email,
        row.status,
        row.source_path or "",
        row.source_channel or "",
        row.consented_at.isoformat() if row.consented_at else "",
        row.created_at.isoformat() if row.created_at else "",
        row.confirmed_at.isoformat() if row.confirmed_at else "",
        row.unsubscribed_at.isoformat() if row.unsubscribed_at else "",
    ]


def _drain(buffer: io.StringIO) -> str:
    """Read what the writer just produced and reset it, so nothing grows."""
    text = buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)
    return text


@router.get("/subscribers")
async def list_subscribers(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    rows, total = await repo_growth.list_subscribers(
        session, status=status, q=q, page=page, size=size
    )
    return {
        "ok": True,
        "items": [repo_growth.subscriber_record(row) for row in rows],
        "total": total,
        "page": page,
        "size": size,
        # The status tabs need their counts; sending them with the page keeps
        # the console from firing a second query for the same table.
        "counts": await repo_growth.count_by_status(session),
    }


@router.post("/subscribers/{subscriber_id}/status")
async def set_subscriber_status(
    subscriber_id: str,
    payload: SubscriberStatusRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    status = (payload.status or "").strip()
    if status not in repo_growth.SUBSCRIBER_STATUSES:
        raise HTTPException(status_code=400, detail="invalid_status")

    row = await repo_growth.find_by_id(session, subscriber_id)
    if row is None:
        raise HTTPException(status_code=404, detail="subscriber_not_found")

    before = row.status
    if before != status:
        await repo_growth.set_status(session, row, status)
        await audit.record(
            session,
            actor=principal.username,
            role=principal.role,
            action="subscriber.status",
            target_type="subscriber",
            target_id=str(row.id),
            summary=f"{before} -> {status}",
            detail={
                "from": before,
                "to": status,
                "email": row.email,
                "note": (payload.note or "").strip()[:400],
            },
            settings=settings,
            ip=client_ip(request),
        )
        await session.commit()
    return {"ok": True, "subscriber": repo_growth.subscriber_record(row)}


@router.get("/subscribers/export.csv")
async def export_subscribers(
    status: str | None = Query(default=None),
    principal: AdminPrincipal = Depends(require_permission("manage")),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
    factory: Any = Depends(get_session_factory),
) -> StreamingResponse:
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="subscribers.export",
        target_type="subscriber",
        summary=f"export status={status or 'all'}",
        detail={"status": status or "all"},
        settings=settings,
    )
    await session.commit()

    async def rows() -> AsyncIterator[str]:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(CSV_COLUMNS)
        # The BOM is for Excel on Windows, which otherwise reads UTF-8 as the
        # system code page and mangles any Chinese source path.
        yield "\ufeff" + _drain(buffer)
        # A fresh session: this generator outlives the request dependency, and
        # reusing the route's session here would hand a closed object to SQLAlchemy.
        async with factory() as own:
            async for batch in repo_growth.export_rows(own, status=status):
                for row in batch:
                    writer.writerow(_csv_line(row))
                yield _drain(buffer)

    return StreamingResponse(
        rows(),
        media_type="text/csv; charset=utf-8",
        headers={
            "content-disposition": 'attachment; filename="subscribers.csv"',
            "cache-control": "no-store",
        },
    )


__all__ = ["router"]
