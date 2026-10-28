"""Delivery ledger for the weekly digest.

`repo_growth` owns who consented; this owns what left the building. Two callers
ask it things, and they must not disagree:

* `app/digest.py` asks "who is confirmed" and "who already got an issue this
  week" before composing anything.
* An operator asks the same table what last Monday did, which is why `record`
  commits per row instead of leaving the run to commit at the end.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DigestSend, Subscriber, utc_now

DIGEST_STATUSES = ("queued", "sent", "failed")

# Matches `Subscriber.email` / `DigestSend.email`; the columns are the contract,
# these constants only keep truncation from happening mid-character.
MAX_EMAIL_LENGTH = 254
MAX_ERROR_LENGTH = 64


async def confirmed_recipients(session: AsyncSession) -> list[Subscriber]:
    """Everyone who followed their own confirmation link, oldest first.

    `pending` is deliberately absent: an address that never confirmed has not
    agreed to receive anything, and mailing it would turn the consent record
    into decoration.
    """
    result = await session.execute(
        select(Subscriber)
        .where(Subscriber.status == "confirmed")
        .order_by(Subscriber.created_at, Subscriber.id)
    )
    return list(result.scalars().all())


async def recent_emails(session: AsyncSession, *, since: datetime) -> set[str]:
    """Addresses that already received an issue inside the window.

    Filtering by time rather than by issue is what makes a retry possible: an
    address whose copy failed is simply absent here and gets another attempt,
    while one that received yesterday's issue is not mailed again three days
    later because the issue date moved.
    """
    result = await session.execute(
        select(DigestSend.email).where(
            DigestSend.status == "sent", DigestSend.at >= since
        )
    )
    return set(result.scalars().all())


async def find_send(session: AsyncSession, *, issue: str, email: str) -> DigestSend | None:
    return await session.scalar(
        select(DigestSend).where(
            DigestSend.issue == issue, DigestSend.email == email
        )
    )


async def record(
    session: AsyncSession,
    *,
    issue: str,
    email: str,
    status: str,
    subscriber_id: uuid.UUID | None = None,
    error: str = "",
    item_count: int = 0,
    now: datetime | None = None,
) -> DigestSend:
    """Write one address's outcome for one issue, upserting on (issue, email).

    Committed here, not by the caller: the sender walks the list one message at
    a time, and a run that dies at recipient 40 must still leave the first 39
    outcomes behind — this table is the only evidence they were mailed.
    """
    if status not in DIGEST_STATUSES:
        raise ValueError(f"unknown digest status: {status}")
    moment = now or utc_now()
    normalised = (email or "").strip().lower()[:MAX_EMAIL_LENGTH]
    row = await find_send(session, issue=issue, email=normalised)
    if row is None:
        row = DigestSend(id=uuid.uuid4(), issue=issue[:10], email=normalised)
        session.add(row)
    row.subscriber_id = subscriber_id
    row.status = status
    row.error = (error or "")[:MAX_ERROR_LENGTH]
    row.item_count = item_count
    row.at = moment
    await session.commit()
    return row


__all__ = [
    "DIGEST_STATUSES",
    "confirmed_recipients",
    "find_send",
    "recent_emails",
    "record",
]
