"""Admin accounts and the audit trail.

Two tables and nothing else: `admin_users` (who may sign in) and `audit_log`
(what they did). The audit table has no update or delete helper here on
purpose -- the absence of the function is the guarantee.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AdminUser, AuditLog, utc_now


async def count_users(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(AdminUser)) or 0)


async def find_user(session: AsyncSession, username: str) -> AdminUser | None:
    if not username:
        return None
    return await session.scalar(
        select(AdminUser).where(AdminUser.username == username.strip())
    )


async def find_user_by_id(
    session: AsyncSession, user_id: uuid.UUID
) -> AdminUser | None:
    """The console addresses accounts by id, not by name: a rename is a write."""
    return await session.get(AdminUser, user_id)


async def list_users(session: AsyncSession) -> list[AdminUser]:
    rows = await session.execute(select(AdminUser).order_by(AdminUser.created_at))
    return list(rows.scalars().all())


async def create_user(
    session: AsyncSession,
    *,
    username: str,
    password_hash: str,
    role: str = "analyst",
    now: datetime | None = None,
) -> AdminUser:
    """Insert without committing; the caller owns the transaction."""
    row = AdminUser(
        id=uuid.uuid4(),
        username=username.strip(),
        password_hash=password_hash,
        role=role,
        active=True,
        created_at=now or utc_now(),
    )
    session.add(row)
    await session.flush()
    return row


async def set_password(session: AsyncSession, user: AdminUser, password_hash: str) -> None:
    user.password_hash = password_hash
    user.failed_attempts = 0
    user.locked_until = None
    await session.flush()


async def update_user(
    session: AsyncSession,
    user: AdminUser,
    *,
    role: str | None = None,
    active: bool | None = None,
) -> AdminUser:
    if role is not None:
        user.role = role
    if active is not None:
        user.active = active
    await session.flush()
    return user


async def touch_login(session: AsyncSession, user: AdminUser, *, now: datetime) -> None:
    """Success clears the failure counter: the lock is about *consecutive* misses."""
    user.last_login_at = now
    user.failed_attempts = 0
    user.locked_until = None
    await session.flush()


async def record_failure(
    session: AsyncSession,
    user: AdminUser,
    *,
    now: datetime,
    lock_after: int,
    lock_seconds: int,
) -> None:
    user.failed_attempts = int(user.failed_attempts or 0) + 1
    if user.failed_attempts >= lock_after:
        user.locked_until = now + timedelta(seconds=lock_seconds)
    await session.flush()


async def write_audit(
    session: AsyncSession,
    *,
    actor: str,
    role: str,
    action: str,
    target_type: str = "",
    target_id: str = "",
    summary: str = "",
    detail: dict | None = None,
    ip_hash: str = "",
    now: datetime | None = None,
) -> None:
    session.add(
        AuditLog(
            id=uuid.uuid4(),
            at=now or utc_now(),
            actor=actor or "",
            role=role or "",
            action=action,
            target_type=target_type or "",
            target_id=target_id or "",
            summary=summary or "",
            detail=detail or {},
            ip_hash=ip_hash or "",
        )
    )
    await session.flush()


async def query_audit(
    session: AsyncSession,
    *,
    action: str | None = None,
    actor: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    q: str | None = None,
    page: int = 1,
    size: int = 50,
) -> tuple[list[AuditLog], int]:
    statement = select(AuditLog)
    if action:
        statement = statement.where(AuditLog.action == action)
    if actor:
        statement = statement.where(AuditLog.actor == actor)
    if target_type:
        statement = statement.where(AuditLog.target_type == target_type)
    if target_id:
        statement = statement.where(AuditLog.target_id == target_id)
    if q:
        # Case-insensitive on both dialects: `ilike` is translated by the SQLite
        # driver into a `LIKE ... COLLATE NOCASE` equivalent.
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            AuditLog.summary.ilike(pattern)
            | AuditLog.target_id.ilike(pattern)
            | AuditLog.actor.ilike(pattern)
        )

    total = int(
        await session.scalar(
            select(func.count()).select_from(statement.subquery())
        )
        or 0
    )
    rows = await session.execute(
        statement.order_by(AuditLog.at.desc())
        .offset(max(page - 1, 0) * size)
        .limit(size)
    )
    return list(rows.scalars().all()), total


__all__ = [
    "count_users",
    "create_user",
    "find_user",
    "find_user_by_id",
    "list_users",
    "query_audit",
    "record_failure",
    "set_password",
    "touch_login",
    "update_user",
    "write_audit",
]
