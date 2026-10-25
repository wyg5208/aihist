"""Mailing list access.

One table, and two callers that must not disagree about it: the public
subscribe/confirm/unsubscribe endpoints and the console's subscriber page. The
rules that matter live here rather than in either route:

* **An address is stored once.** Re-submitting a known address returns the
  existing row instead of raising. A duplicate response that leaked "this email
  is already subscribed" is both a small privacy leak and a pointless error for
  a reader who forgot they had signed up.
* **Consent is a timestamp, not a boolean.** `consented_at` is set from the
  moment of the request and never updated, so the record shows when the reader
  agreed rather than when they last edited their preferences.
* **Nothing is deleted.** Unsubscribing moves `status` to `unsubscribed`, which
  keeps the suppression record an email tool needs.
"""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime
from typing import Any, AsyncIterator

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Subscriber, utc_now

SUBSCRIBER_STATUSES = ("pending", "confirmed", "unsubscribed")

# Deliberately loose: the confirmation link is what proves the address, so this
# only has to reject obvious typos, not implement RFC 5322.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")

MAX_EMAIL_LENGTH = 254
MAX_SOURCE_PATH = 200

# `secrets.token_urlsafe(24)` is 32 url-safe characters, inside `String(48)`.
TOKEN_BYTES = 24


def normalize_email(value: str) -> str:
    """Lower-case and trim. Every lookup goes through this, so `A@B` == `a@b`."""
    return (value or "").strip().lower()[:MAX_EMAIL_LENGTH]


def looks_like_email(value: str) -> bool:
    email = normalize_email(value)
    return bool(email) and bool(_EMAIL_RE.match(email))


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


async def find_by_email(session: AsyncSession, email: str) -> Subscriber | None:
    normalized = normalize_email(email)
    if not normalized:
        return None
    return await session.scalar(
        select(Subscriber).where(Subscriber.email == normalized)
    )


async def find_by_token(session: AsyncSession, token: str) -> Subscriber | None:
    cleaned = (token or "").strip()
    if not cleaned:
        return None
    return await session.scalar(select(Subscriber).where(Subscriber.token == cleaned))


async def find_by_id(session: AsyncSession, subscriber_id: str) -> Subscriber | None:
    """Look up by the id the console puts in a URL; a bad id is simply absent."""
    try:
        parsed = uuid.UUID(str(subscriber_id))
    except (ValueError, AttributeError, TypeError):
        return None
    return await session.scalar(select(Subscriber).where(Subscriber.id == parsed))


async def create_subscriber(
    session: AsyncSession,
    *,
    email: str,
    source_path: str = "",
    source_channel: str = "",
    now: datetime | None = None,
) -> Subscriber:
    """Insert a pending row. The caller commits, so this can join the audit write."""
    moment = now or utc_now()
    row = Subscriber(
        id=uuid.uuid4(),
        email=normalize_email(email),
        status="pending",
        token=new_token(),
        source_path=(source_path or "")[:MAX_SOURCE_PATH],
        source_channel=(source_channel or "")[:16],
        consented_at=moment,
        created_at=moment,
    )
    session.add(row)
    await session.flush()
    return row


async def set_status(
    session: AsyncSession,
    row: Subscriber,
    status: str,
    *,
    now: datetime | None = None,
) -> Subscriber:
    """Move a row between `pending` / `confirmed` / `unsubscribed`.

    The three timestamps are written once and then left alone: re-confirming an
    address should not rewrite when it was first confirmed.
    """
    if status not in SUBSCRIBER_STATUSES:
        raise ValueError(f"unknown subscriber status: {status}")
    moment = now or utc_now()
    row.status = status
    if status == "confirmed" and row.confirmed_at is None:
        row.confirmed_at = moment
    if status == "unsubscribed" and row.unsubscribed_at is None:
        row.unsubscribed_at = moment
    await session.flush()
    return row


async def list_subscribers(
    session: AsyncSession,
    *,
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    size: int = 50,
) -> tuple[list[Subscriber], int]:
    statement = select(Subscriber)
    if status and status in SUBSCRIBER_STATUSES:
        statement = statement.where(Subscriber.status == status)
    if q:
        statement = statement.where(Subscriber.email.ilike(f"%{q.strip()}%"))

    total = int(
        await session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    )
    rows = await session.execute(
        # `id` is the tiebreaker: offset paging over a non-unique sort key can
        # repeat or skip a row, and `export_rows` walks this in batches.
        statement.order_by(Subscriber.created_at.desc(), Subscriber.id)
        .offset(max(page - 1, 0) * size)
        .limit(size)
    )
    return list(rows.scalars().all()), total


async def count_by_status(session: AsyncSession) -> dict[str, int]:
    rows = await session.execute(
        select(Subscriber.status, func.count()).group_by(Subscriber.status)
    )
    counts = {status: 0 for status in SUBSCRIBER_STATUSES}
    for status, count in rows.all():
        counts[str(status)] = int(count)
    return counts


async def export_rows(
    session: AsyncSession, *, status: str | None = None, batch: int = 500
) -> AsyncIterator[list[Subscriber]]:
    """Walk the list in offset batches.

    An export is a snapshot of a mailing list, so paging by offset is honest:
    signing up during the download would shift one row between batches, and that
    is preferable to holding the whole table in memory to avoid it.
    """
    page = 1
    while True:
        rows, _ = await list_subscribers(session, status=status, page=page, size=batch)
        if not rows:
            return
        yield rows
        if len(rows) < batch:
            return
        page += 1


def subscriber_record(row: Subscriber) -> dict[str, Any]:
    from app.schemas.event import iso

    return {
        "id": str(row.id),
        "email": row.email,
        "status": row.status,
        "sourcePath": row.source_path or None,
        "sourceChannel": row.source_channel or None,
        "consentedAt": iso(row.consented_at),
        "createdAt": iso(row.created_at),
        "confirmedAt": iso(row.confirmed_at),
        "unsubscribedAt": iso(row.unsubscribed_at),
    }


__all__ = [
    "SUBSCRIBER_STATUSES",
    "count_by_status",
    "create_subscriber",
    "export_rows",
    "find_by_email",
    "find_by_id",
    "find_by_token",
    "list_subscribers",
    "looks_like_email",
    "new_token",
    "normalize_email",
    "set_status",
    "subscriber_record",
]
