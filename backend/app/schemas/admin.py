"""Wire contract for the admin endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    user: str = ""
    password: str = ""


class LoginResponse(BaseModel):
    """Kept to exactly `{ok, user}`: the console reads its role from /session."""

    ok: bool = True
    user: str


class SessionResponse(BaseModel):
    model_config = {"populate_by_name": True}

    ok: bool = True
    user: str
    role: str = "analyst"
    permissions: list[str] = Field(default_factory=list)


class PasswordChangeRequest(BaseModel):
    model_config = {"populate_by_name": True}

    current_password: str = Field(default="", alias="currentPassword")
    new_password: str = Field(default="", alias="newPassword")


class AuditEntry(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    at: str
    actor: str
    role: str = ""
    action: str
    target_type: str = Field(default="", alias="targetType")
    target_id: str = Field(default="", alias="targetId")
    summary: str = ""
    detail: dict[str, Any] = Field(default_factory=dict)
    ip_hash: str = Field(default="", alias="ipHash")


class AuditResponse(BaseModel):
    ok: bool = True
    items: list[AuditEntry]
    total: int
    page: int = 1
    size: int = 50


class SyncRequest(BaseModel):
    trigger: str = "manual"


class SyncResult(BaseModel):
    model_config = {"populate_by_name": True}

    status: str
    seed_inserted: int | None = Field(default=None, alias="seedInserted")
    raw_count: int = Field(default=0, alias="rawCount")
    created_count: int = Field(default=0, alias="createdCount")
    merged_count: int = Field(default=0, alias="mergedCount")
    reviewed_count: int | None = Field(default=None, alias="reviewedCount")
    admitted_count: int | None = Field(default=None, alias="admittedCount")
    excluded_count: int | None = Field(default=None, alias="excludedCount")
    held_count: int | None = Field(default=None, alias="heldCount")
    panel_configured: bool | None = Field(default=None, alias="panelConfigured")
    failed_sources: list[str] = Field(default_factory=list, alias="failedSources")
    notes: str | None = None


class SyncResponse(BaseModel):
    model_config = {"populate_by_name": True}

    ok: bool = True
    triggered: bool = True
    status: str = "running"
    run_id: str | None = Field(default=None, alias="runId")
    result: SyncResult | None = None


class HoldItem(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    slug: str | None = None
    title: str
    category: str
    sort_date: str = Field(alias="sortDate")
    source_count: int = Field(alias="sourceCount")
    score: int | None = None
    decision: str | None = None
    votes: list[dict[str, Any]] = Field(default_factory=list)
    notes: str | None = None


class HoldsResponse(BaseModel):
    ok: bool = True
    items: list[HoldItem]
    total: int


def admin_run_record(row: Any) -> dict[str, Any]:
    """`run_record` plus the counters the console needs.

    The public `run_record` stays byte-identical; the extra keys exist only on
    `/api/v1/admin/*`, where `test_api_contract.py` never looks.
    """
    from app.schemas.event import run_record

    payload = run_record(row)
    payload.update(
        {
            "reviewedCount": int(getattr(row, "reviewed_count", 0) or 0),
            "admittedCount": int(getattr(row, "admitted_count", 0) or 0),
            "excludedCount": int(getattr(row, "excluded_count", 0) or 0),
            "heldCount": int(getattr(row, "held_count", 0) or 0),
            "panelConfigured": bool(getattr(row, "panel_configured", False)),
            "durationMs": int(getattr(row, "duration_ms", 0) or 0),
            "detail": row.detail if isinstance(getattr(row, "detail", None), dict) else {},
        }
    )
    return payload


def timestamp(value: Any) -> str | None:
    """Naive SQLite datetimes are UTC; say so instead of letting JS guess."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def api_key_record(row: Any, *, requests: int = 0, errors: int = 0) -> dict[str, Any]:
    """One open-API credential. Never includes the digest, let alone the key."""
    return {
        "id": str(row.id),
        "name": row.name or "",
        "prefix": row.prefix or "",
        "active": bool(row.active),
        "scopes": list(row.scopes) if isinstance(row.scopes, list) else [],
        "monthlyQuota": int(row.monthly_quota or 0),
        "monthRequests": int(requests),
        "monthErrors": int(errors),
        "createdBy": row.created_by or "",
        "createdAt": timestamp(row.created_at),
        "lastUsedAt": timestamp(row.last_used_at),
        "revokedAt": timestamp(row.revoked_at),
    }


def application_record(row: Any) -> dict[str, Any]:
    """One application. `purpose` is free text written by a stranger: the page
    renders it as text, never as markup.

    `keyId` points at the credential an approval minted, so the queue can link
    to the key that a decision produced without a second lookup.
    """
    return {
        "id": str(row.id),
        "email": row.email or "",
        "name": row.name or "",
        "purpose": row.purpose or "",
        "siteUrl": row.site_url or "",
        "status": row.status or "pending",
        "note": row.note or "",
        "monthlyQuota": int(row.monthly_quota or 0),
        "keyId": str(row.key_id) if row.key_id else None,
        "createdAt": timestamp(row.created_at),
        "decidedAt": timestamp(row.decided_at),
        "decidedBy": row.decided_by or "",
    }


def partner_record(row: Any, *, clicks: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name or "",
        "kind": row.kind or "",
        "status": row.status or "",
        "code": row.code or None,
        "targetUrl": row.target_url or None,
        "contact": row.contact or "",
        "termsNote": row.terms_note or "",
        "startsOn": row.starts_on or None,
        "endsOn": row.ends_on or None,
        # `clicks` is the window the caller asked for, not a lifetime total:
        # the page has a range picker and a number with no window is not a metric.
        "clicks": int(clicks),
    }


def admin_user_record(row: Any) -> dict[str, Any]:
    """A console account. The password hash never leaves `repo_admin`."""
    return {
        "id": str(row.id),
        "username": row.username,
        "role": row.role or "analyst",
        "active": bool(row.active),
        "createdAt": timestamp(row.created_at),
        "lastLoginAt": timestamp(row.last_login_at),
        "failedAttempts": int(row.failed_attempts or 0),
        "lockedUntil": timestamp(row.locked_until),
    }


def event_admin_record(row: Any) -> dict[str, Any]:
    """One row of the console's content table: everything a decision needs."""
    from app.schemas.event import iso

    return {
        "id": str(row.id),
        "slug": row.slug or None,
        "title": row.title,
        "titleEn": row.title_en or None,
        "summary": row.summary or "",
        "category": row.category,
        "sortDate": row.sort_date,
        "year": int(row.year or 0),
        "importance": int(row.importance or 0),
        "confidence": row.confidence,
        "sourceCount": int(row.source_count or 0),
        "origin": row.origin,
        "editorialStatus": row.editorial_status or None,
        "opsNote": row.ops_note or None,
        "fingerprint": row.fingerprint,
        "firstSeenAt": iso(row.first_seen_at),
        "updatedAt": iso(row.updated_at),
    }
