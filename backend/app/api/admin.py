"""Admin endpoints: session, password, audit, manual sync, run history, holds.

Collection is never triggered by a page view. The only two entry points are the
cron job and this console.

`run_sync` is imported here, not in `admin_ops.py`, because the existing suite
monkeypatches `app.api.admin.run_sync` to keep a manual sync off the network.
Moving the endpoint would silently turn that stub into a real fetch.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, auth
from app.config import Settings, get_settings
from app.db import repo_admin, repo_events, repo_sync
from app.deps import (
    SESSION_COOKIE,
    AdminPrincipal,
    client_ip,
    get_session,
    get_session_factory,
    issue_session,
    judge_env,
    require_admin,
    require_admin_write,
    require_permission,
)
from app.ingest.pipeline import run_sync
from app.schemas.admin import (
    AuditEntry,
    AuditResponse,
    HoldsResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    SessionResponse,
    SyncResponse,
)
from app.schemas.event import run_record

router = APIRouter()

MANUAL_TRIGGER = "manual"
AUTO_TRIGGER = "auto"
# An `?trigger=auto` call is a no-op when a run already succeeded very recently,
# so a duplicated cron firing does not collect twice. This is a dedupe guard, not
# the freshness signal: it has to stay far below the collection cadence (daily
# 01:05), otherwise the scheduled run skips itself every day. The public `stale`
# flag uses a different, cadence-sized window in app/api/public.py.
DUE_HOURS = 2

# `asyncio.create_task` results are only weakly referenced; keep them alive for
# the lifetime of the process so a long run is not garbage collected midway.
_background: set[asyncio.Task[Any]] = set()

_hasher = PasswordHasher()


def _recently_succeeded(state: repo_sync.SyncState | None) -> bool:
    if state is None or state.last_success_at is None:
        return False
    stamp = state.last_success_at
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - stamp).total_seconds() < DUE_HOURS * 3600


def _as_utc(stamp: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; every comparison here is in UTC."""
    if stamp is None:
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def _verify(password_hash: str, password: str) -> bool:
    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:  # noqa: BLE001 - argon2 raises VerificationError subclasses
        return False
    return True


def _set_session_cookie(response: Response, settings: Settings, principal: AdminPrincipal) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        issue_session(settings, principal),
        max_age=settings.session_max_age_seconds,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    username = (payload.user or "").strip()
    ip = client_ip(request)

    # Rate limit first: it is the cheapest rejection and it must not reveal
    # whether the account exists.
    if auth.lock_remaining(username, ip) > 0:
        raise HTTPException(
            status_code=429,
            detail="too_many_attempts",
            headers={"retry-after": str(int(auth.lock_remaining(username, ip)) or 1)},
        )

    row = await repo_admin.find_user(session, username)
    if row is not None:
        if not row.active:
            raise HTTPException(status_code=403, detail="account_disabled")
        locked_until = _as_utc(row.locked_until)
        if locked_until and locked_until > datetime.now(timezone.utc):
            wait = int((locked_until - datetime.now(timezone.utc)).total_seconds()) or 1
            raise HTTPException(
                status_code=423,
                detail="account_locked",
                headers={"retry-after": str(wait)},
            )
        if not _verify(row.password_hash, payload.password):
            await repo_admin.record_failure(
                session,
                row,
                now=datetime.now(timezone.utc),
                lock_after=auth.LOGIN_MAX_FAILURES,
                lock_seconds=auth.LOGIN_LOCK_SECONDS,
            )
            await session.commit()
            auth.register_failure(username, ip)
            raise HTTPException(status_code=401, detail="invalid_credentials")

        await repo_admin.touch_login(session, row, now=datetime.now(timezone.utc))
        await session.commit()
        auth.clear_failures(username, ip)
        principal = AdminPrincipal(username=row.username, role=row.role)
    else:
        # The env account is the bootstrap path and the permanent escape hatch;
        # it is always an owner and never appears in `admin_users`.
        if not settings.admin_password_hash:
            raise HTTPException(status_code=503, detail="admin_not_configured")
        if username != settings.admin_user or not _verify(
            settings.admin_password_hash, payload.password
        ):
            auth.register_failure(username, ip)
            raise HTTPException(status_code=401, detail="invalid_credentials")
        auth.clear_failures(username, ip)
        principal = AdminPrincipal(username=settings.admin_user, role="owner")

    _set_session_cookie(response, settings, principal)
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="login",
        target_type="admin_user",
        target_id=principal.username,
        summary=f"{principal.username} signed in",
        settings=settings,
        ip=ip,
    )
    await session.commit()
    return LoginResponse(user=principal.username)


@router.post("/logout")
async def logout(
    response: Response,
    principal: AdminPrincipal = Depends(require_admin_write),
) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/session", response_model=SessionResponse)
async def session_info(principal: AdminPrincipal = Depends(require_admin)) -> SessionResponse:
    return SessionResponse(
        user=principal.username,
        role=principal.role,
        permissions=principal.permissions,
    )


@router.post("/password")
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    principal: AdminPrincipal = Depends(require_admin_write),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Change your own password. An owner resets someone else's via `/users`."""
    new_password = payload.new_password or ""
    if len(new_password) < 12:
        raise HTTPException(status_code=400, detail="password_too_short")

    row = await repo_admin.find_user(session, principal.username)
    if row is None:
        # The env account's hash lives in the environment, not in the database.
        if not _verify(settings.admin_password_hash, payload.current_password or ""):
            raise HTTPException(status_code=401, detail="invalid_credentials")
        raise HTTPException(status_code=409, detail="env_account")

    if not _verify(row.password_hash, payload.current_password or ""):
        raise HTTPException(status_code=401, detail="invalid_credentials")

    await repo_admin.set_password(session, row, _hasher.hash(new_password))
    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="password.change",
        target_type="admin_user",
        target_id=principal.username,
        summary="password changed",
        detail={"self": True},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()
    return {"ok": True}


@router.get("/audit", response_model=AuditResponse)
async def read_audit(
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    principal: AdminPrincipal = Depends(require_permission("manage")),
    session: AsyncSession = Depends(get_session),
) -> AuditResponse:
    rows, total = await repo_admin.query_audit(
        session,
        action=action,
        actor=actor,
        target_type=target_type,
        q=q,
        page=page,
        size=size,
    )
    return AuditResponse(
        items=[
            AuditEntry(
                id=str(row.id),
                at=row.at.isoformat() if row.at else "",
                actor=row.actor,
                role=row.role,
                action=row.action,
                target_type=row.target_type,
                target_id=row.target_id,
                summary=row.summary,
                detail=row.detail or {},
                ip_hash=row.ip_hash,
            )
            for row in rows
        ],
        total=total,
        page=page,
        size=size,
    )


@router.post("/sync", response_model=SyncResponse, status_code=202)
async def trigger_sync(
    request: Request,
    trigger: str = Query(default=MANUAL_TRIGGER),
    principal: AdminPrincipal = Depends(require_permission("sync", write=True)),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
    session_factory: Any = Depends(get_session_factory),
) -> SyncResponse:
    if trigger not in (MANUAL_TRIGGER, AUTO_TRIGGER):
        raise HTTPException(status_code=400, detail="invalid_trigger")

    state = await repo_sync.read_state(session)
    if repo_sync.lease_is_held(state, int(time.time() * 1000)):
        raise HTTPException(
            status_code=409, detail="sync_busy", headers={"retry-after": "20"}
        )
    if trigger == AUTO_TRIGGER and _recently_succeeded(state):
        return SyncResponse(triggered=False, status="not_due", run_id=None, result=None)

    run_id = uuid.uuid4()

    await audit.record(
        session,
        actor=principal.username,
        role=principal.role,
        action="sync.trigger",
        target_type="sync_run",
        target_id=str(run_id),
        summary=f"{trigger} run requested",
        detail={"trigger": trigger},
        settings=settings,
        ip=client_ip(request),
    )
    await session.commit()

    async def worker() -> None:
        try:
            async with session_factory() as background_session:
                await run_sync(
                    background_session,
                    trigger=trigger,
                    env=judge_env(settings),
                    run_id=run_id,
                )
        except Exception as error:  # noqa: BLE001 - the run row already records it
            print(f"[admin] sync failed: {getattr(error, 'code', 'sync_failed')}")

    task = asyncio.create_task(worker())
    _background.add(task)
    task.add_done_callback(_background.discard)

    return SyncResponse(
        triggered=True, status="running", run_id=str(run_id), result=None
    )


@router.get("/runs")
async def list_runs(
    limit: str | None = Query(default=None),
    principal: AdminPrincipal = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    resolved = 20
    if limit is not None:
        if not limit.isdigit() or not 1 <= int(limit) <= 200:
            raise HTTPException(status_code=400, detail="invalid_limit")
        resolved = int(limit)
    runs = await repo_sync.recent_runs(session, resolved)
    return {"ok": True, "runs": [run_record(row) for row in runs]}


@router.get("/holds", response_model=HoldsResponse)
async def list_holds(
    limit: str | None = Query(default=None),
    principal: AdminPrincipal = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> HoldsResponse:
    resolved = 50
    if limit is not None:
        if not limit.isdigit() or not 1 <= int(limit) <= 200:
            raise HTTPException(status_code=400, detail="invalid_limit")
        resolved = int(limit)

    rows = await repo_events.list_holds(session, resolved)
    items = []
    for row in rows:
        review = row.editorial_review if isinstance(row.editorial_review, dict) else {}
        items.append(
            {
                "id": str(row.id),
                "slug": row.slug or None,
                "title": row.title,
                "category": row.category,
                "sortDate": row.sort_date,
                "sourceCount": row.source_count,
                "score": review.get("score"),
                "decision": review.get("decision"),
                "votes": review.get("votes") or [],
                "notes": review.get("source"),
            }
        )
    total = len(items)
    return HoldsResponse(items=items, total=total)
