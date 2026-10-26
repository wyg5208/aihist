"""The human half of the open-data programme: the application queue.

This module exists because issuing a key is a judgement, not a form. The public
form (`api/apply.py`) can only ever write a `pending` row; everything that
changes a credential's life happens here, behind `manage`, and every decision
leaves an audit row.

Three orderings are deliberate:

* **The rollback boundary is the key.** `create_key` and `decide_application`
  share one transaction: a crash between them would either mint an orphan
  credential or mark an application approved with nothing to show for it.
* **Mail is after the commit.** The key already exists by the time SMTP is
  touched; `send_api_key` cannot raise, and its result comes back alongside the
  plaintext. A mail server being down is a note on the approval, never a reason
  for one to fail.
* **The plaintext appears once.** Same contract as `POST /keys`: the response to
  an approval is the only place the key is ever readable. If the operator closes
  the drawer before copying it, the recovery path is revoke-and-issue-again, not
  a lookup.

Rejection keeps the row. "This address asked in March and we said no" is a fact
the queue has to be able to answer later, and deleting it would make the next
application from the same address indistinguishable from a first one.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, mailer
from app.config import Settings, get_settings
from app.db import repo_commercial
from app.deps import AdminPrincipal, client_ip, get_session, require_permission
from app.schemas.admin import api_key_record, application_record

router = APIRouter()

MAX_QUOTA = 10_000_000


class Decision(BaseModel):
    """One model for both decisions; approve reads more of it than reject does."""

    model_config = {"populate_by_name": True}

    note: str = ""
    monthly_quota: int | None = Field(default=None, alias="monthlyQuota", ge=0, le=MAX_QUOTA)


def _application_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="invalid_application_id") from None


@router.get("/applications")
async def list_applications(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    # An unknown status is treated as "no filter" rather than a 400: the tabs are
    # driven by `counts`, and a stale bookmark should not look like an error.
    rows, total, counts = await repo_commercial.list_applications(
        session, status=status, page=page, size=size
    )
    return {
        "ok": True,
        "page": page,
        "size": size,
        "total": total,
        "counts": counts,
        "applications": [application_record(row) for row in rows],
    }


@router.post("/applications/{application_id}/approve")
async def approve_application(
    application_id: str,
    payload: Decision,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await repo_commercial.find_application(session, _application_id(application_id))
    if row is None:
        raise HTTPException(status_code=404, detail="application_not_found")
    if row.status != "pending":
        # Checked before minting, so a double-click cannot leave a second key
        # behind a 409.
        raise HTTPException(status_code=409, detail="application_already_decided")

    quota = row.monthly_quota if payload.monthly_quota is None else payload.monthly_quota
    key_name = (row.name or row.email)[:64]

    key, plaintext = await repo_commercial.create_key(
        session,
        name=key_name,
        scopes=["read"],
        monthly_quota=quota,
        created_by=principal.username,
    )
    await repo_commercial.decide_application(
        session,
        row,
        status="approved",
        note=payload.note,
        key_id=key.id,
        monthly_quota=quota,
        decided_by=principal.username,
    )
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="application.approve",
        target_type="api_application",
        target_id=str(row.id),
        summary=f"approved {row.email} → key {key.prefix}…",
        detail={
            "email": row.email,
            "name": row.name,
            "prefix": key.prefix,
            "quota": quota,
            "note": payload.note[:500],
        },
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()

    sent, error = await mailer.send_api_key(
        settings,
        to=row.email,
        name=row.name or row.email,
        plaintext=plaintext,
        monthly_quota=quota,
    )
    return {
        "ok": True,
        "application": application_record(row),
        "key": api_key_record(key),
        # The one and only response that contains this string.
        "plaintext": plaintext,
        "email": {
            "configured": mailer.configured(settings),
            "sent": sent,
            "error": error,
        },
    }


@router.post("/applications/{application_id}/reject")
async def reject_application(
    application_id: str,
    payload: Decision,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await repo_commercial.find_application(session, _application_id(application_id))
    if row is None:
        raise HTTPException(status_code=404, detail="application_not_found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="application_already_decided")

    await repo_commercial.decide_application(
        session,
        row,
        status="rejected",
        note=payload.note,
        decided_by=principal.username,
    )
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="application.reject",
        target_type="api_application",
        target_id=str(row.id),
        summary=f"rejected {row.email}",
        # The note is the whole value of a rejection six months later, so it is
        # copied into the audit detail as well as the row.
        detail={"email": row.email, "name": row.name, "note": payload.note[:500]},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True, "application": application_record(row)}


__all__ = ["router"]
