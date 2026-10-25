"""Console side of the commercial modules: API keys and the partner ledger.

Both are `manage` — they are commercial facts, not editorial ones, and an
`editor` who can admit an entry has no business minting a credential or pricing
a sponsorship.

Two UI-driven decisions live here rather than in the pages:

* `POST /keys` is the only response that ever contains a plaintext key. The page
  shows it once, in a copy-once box, and there is no endpoint that can bring it
  back. Losing it means revoking it and minting another — which is the correct
  cost, because a recoverable key is a key stored somewhere it should not be.
* nothing here is ever deleted. A revoked key and an ended partner stay as rows,
  because "who had access in March" is a question the audit trail must answer.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import Settings, get_settings
from app.db import repo_commercial, repo_ops
from app.db.models import utc_now
from app.deps import AdminPrincipal, client_ip, get_session, require_permission
from app.schemas.admin import api_key_record, partner_record

router = APIRouter()

MAX_QUOTA = 10_000_000


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------


class KeyRequest(BaseModel):
    model_config = {"populate_by_name": True}

    name: str = ""
    monthly_quota: int = Field(default=1000, alias="monthlyQuota", ge=0, le=MAX_QUOTA)
    scopes: list[str] = Field(default_factory=lambda: ["read"])


@router.get("/keys")
async def list_keys(
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    usage = await repo_ops.key_usage(session)
    return {"ok": True, **usage}


@router.get("/keys/usage")
async def key_usage_series(
    days: int = Query(default=30, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return {"ok": True, "days": days, "series": await repo_ops.key_usage_series(session, days=days)}


@router.post("/keys")
async def create_key(
    payload: KeyRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name_required")

    scopes = [scope for scope in (payload.scopes or []) if scope]
    unknown = [scope for scope in scopes if scope not in repo_commercial.SCOPES]
    if unknown or not scopes:
        raise HTTPException(status_code=400, detail="invalid_scope")

    row, plaintext = await repo_commercial.create_key(
        session,
        name=name,
        scopes=scopes,
        monthly_quota=payload.monthly_quota,
        created_by=principal.username,
    )
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="key.create",
        target_type="api_key",
        target_id=str(row.id),
        summary=f"issued key {row.prefix}… ({name})",
        detail={"name": name, "prefix": row.prefix, "quota": row.monthly_quota, "scopes": scopes},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    # The one and only time `plaintext` leaves this process.
    return {"ok": True, "key": api_key_record(row), "plaintext": plaintext}


@router.post("/keys/{key_id}/revoke")
async def revoke_key(
    key_id: str,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        parsed = uuid.UUID(key_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="invalid_key_id") from None
    row = await repo_commercial.find_key(session, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="key_not_found")

    already = row.revoked_at is not None
    await repo_commercial.revoke_key(session, row, now=utc_now())
    if not already:
        await audit.record(
            session,
            actor=principal.username,
            role=principal.role,
            action="key.revoke",
            target_type="api_key",
            target_id=str(row.id),
            summary=f"revoked key {row.prefix}… ({row.name})",
            detail={"name": row.name, "prefix": row.prefix},
            settings=settings,
            ip=client_ip(request),
        )
    await session.commit()

    requests, errors = await repo_commercial.month_totals(session, row.id)
    return {"ok": True, "key": api_key_record(row, requests=requests, errors=errors)}


# ---------------------------------------------------------------------------
# Partners
# ---------------------------------------------------------------------------


class PartnerWrite(BaseModel):
    """One model for create and patch; `exclude_unset` is what distinguishes them."""

    model_config = {"populate_by_name": True}

    name: str | None = None
    kind: str | None = None
    status: str | None = None
    code: str | None = None
    target_url: str | None = Field(default=None, alias="targetUrl")
    contact: str | None = None
    terms_note: str | None = Field(default=None, alias="termsNote")
    starts_on: str | None = Field(default=None, alias="startsOn")
    ends_on: str | None = Field(default=None, alias="endsOn")


def _check_vocabulary(fields: dict[str, Any]) -> None:
    kind = fields.get("kind")
    if kind is not None and kind not in repo_commercial.PARTNER_KINDS:
        raise HTTPException(status_code=400, detail="invalid_kind")
    status = fields.get("status")
    if status is not None and status not in repo_commercial.PARTNER_STATUSES:
        raise HTTPException(status_code=400, detail="invalid_status")
    target = fields.get("target_url")
    if target and not repo_commercial.normalize_target(target):
        raise HTTPException(status_code=400, detail="invalid_target_url")


def _optional_date(fields: dict[str, Any], key: str) -> None:
    value = fields.get(key)
    if value in (None, ""):
        return
    # Stored as `YYYY-MM-DD` text and compared lexically, so a malformed value
    # would silently sort into the wrong place rather than fail.
    try:
        from datetime import datetime

        datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"invalid_{key}") from None


@router.get("/partners/stats")
async def partner_stats(
    days: int = Query(default=30, ge=1, le=365),
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    payload = await repo_ops.partner_stats(session, days=days)
    return {"ok": True, **payload}


@router.post("/partners")
async def create_partner(
    payload: PartnerWrite,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name_required")
    code = repo_commercial.normalize_code(payload.code or "")
    if not repo_commercial.looks_like_code(code):
        raise HTTPException(status_code=400, detail="invalid_code")
    if await repo_commercial.find_partner_by_code(session, code) is not None:
        raise HTTPException(status_code=409, detail="code_taken")

    fields = payload.model_dump(exclude_unset=True)
    _check_vocabulary(fields)
    _optional_date(fields, "starts_on")
    _optional_date(fields, "ends_on")

    row = await repo_commercial.create_partner(
        session,
        name=name,
        code=code,
        kind=payload.kind or "sponsor",
        status=payload.status or "prospect",
        target_url=payload.target_url or "",
        contact=payload.contact or "",
        terms_note=payload.terms_note or "",
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
    )
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="partner.create",
        target_type="partner",
        target_id=str(row.id),
        summary=f"added partner {name} ({row.code})",
        detail={"name": name, "code": row.code, "status": row.status, "kind": row.kind},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True, "partner": partner_record(row)}


@router.patch("/partners/{partner_id}")
async def update_partner(
    partner_id: str,
    payload: PartnerWrite,
    request: Request,
    principal: AdminPrincipal = Depends(require_permission("manage", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        parsed = uuid.UUID(partner_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="invalid_partner_id") from None
    row = await repo_commercial.find_partner(session, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="partner_not_found")

    # `exclude_unset` is the whole contract of a PATCH: sending `termsNote: null`
    # clears it, omitting the key leaves it alone.
    fields = payload.model_dump(exclude_unset=True, by_alias=False)
    if not fields:
        raise HTTPException(status_code=400, detail="nothing_to_update")
    if "name" in fields and not (fields["name"] or "").strip():
        raise HTTPException(status_code=400, detail="name_required")
    if "code" in fields:
        code = repo_commercial.normalize_code(fields["code"] or "")
        if not repo_commercial.looks_like_code(code):
            raise HTTPException(status_code=400, detail="invalid_code")
        clash = await repo_commercial.find_partner_by_code(session, code)
        if clash is not None and clash.id != row.id:
            raise HTTPException(status_code=409, detail="code_taken")
        fields["code"] = code
    _check_vocabulary(fields)
    _optional_date(fields, "starts_on")
    _optional_date(fields, "ends_on")

    await repo_commercial.update_partner(session, row, now=utc_now(), **fields)
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="partner.update",
        target_type="partner",
        target_id=str(row.id),
        summary=f"updated partner {row.name} ({row.code})",
        detail={"fields": sorted(fields), "status": row.status, "code": row.code},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True, "partner": partner_record(row)}


__all__ = ["router"]
