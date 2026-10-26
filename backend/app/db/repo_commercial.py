"""Open-data credentials, their usage, and the partner ledger.

Two shapes are worth naming before the code:

* **A key's plaintext exists exactly once**, in the response to `POST /keys`.
  What is stored is `sha256(plaintext)` plus its first twelve characters, so the
  console can recognise a key that turns up in a log without being able to mint
  it again. There is no `reveal()` here and there cannot be one.
* **A click is a row, not a counter.** Twelve months from now the question will
  be "how many, on which days, from where" — a `clicks int` column can answer
  only the first and would have to be trusted rather than recomputed.

`ApiKeyUsage` is upserted on every call with `column + 1` arithmetic inside the
statement, not read-then-write: two open-API requests can land in the same
hundred milliseconds, and a lost update there is a billing dispute.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import local_day
from app.analytics.ua import classify_ua, detect_crawler
from app.db import repo_growth
from app.db.models import ApiApplication, ApiKey, ApiKeyUsage, Partner, PartnerClick, utc_now

# `aih_` + 32 chars. The prefix column is `String(12)`, so it holds the marker
# plus eight entropy characters: enough to tell two keys apart in a log line.
KEY_MARKER = "aih_"
KEY_PREFIX_LEN = 12
KEY_BODY_BYTES = 24

# The only scope that exists today. Listing it explicitly means a typo in a
# request is rejected instead of silently granting nothing.
SCOPES: tuple[str, ...] = ("read",)

PARTNER_KINDS: tuple[str, ...] = ("sponsor", "partner", "mirror")
PARTNER_STATUSES: tuple[str, ...] = ("prospect", "active", "paused", "ended")

APPLICATION_STATUSES: tuple[str, ...] = ("pending", "approved", "rejected")

# The same default the console's "new key" form uses. A person may grant more
# on approval; the number is stored on the application so the decision shows
# what was actually granted, not what the form once suggested.
DEFAULT_APPLICATION_QUOTA = 1000
MAX_APPLICANT_NAME = 80
MAX_APPLICANT_PURPOSE = 1000
MAX_APPLICANT_SITE = 300
MAX_DECISION_NOTE = 500

# Lowercase, digits and hyphens: a `/go/<code>` must survive being read aloud
# over the phone and being typed into a chat window.
_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,23}$")


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------


def hash_key(value: str) -> str:
    """The stored form of a bearer token.

    A plain sha256 with no salt, deliberately: the input is 32 characters of
    `secrets`, so there is nothing to brute-force, and an unsalted digest keeps
    lookup a single indexed equality instead of a scan over every row.
    """
    return hashlib.sha256((value or "").strip().encode("utf-8")).hexdigest()


def new_key_material() -> tuple[str, str, str]:
    """`(plaintext, prefix, digest)`. The plaintext must not be persisted."""
    plaintext = KEY_MARKER + secrets.token_urlsafe(KEY_BODY_BYTES)
    return plaintext, plaintext[:KEY_PREFIX_LEN], hash_key(plaintext)


async def create_key(
    session: AsyncSession,
    *,
    name: str,
    scopes: list[str] | None = None,
    monthly_quota: int = 1000,
    created_by: str = "",
    now: datetime | None = None,
) -> tuple[ApiKey, str]:
    """Insert a key and return it with its plaintext. Caller commits."""
    plaintext, prefix, digest = new_key_material()
    row = ApiKey(
        id=uuid.uuid4(),
        name=(name or "")[:64],
        prefix=prefix,
        key_hash=digest,
        scopes=list(scopes or ["read"]),
        monthly_quota=max(int(monthly_quota or 0), 0),
        active=True,
        created_by=(created_by or "")[:40],
        created_at=now or utc_now(),
    )
    session.add(row)
    await session.flush()
    return row, plaintext


async def find_key_by_hash(session: AsyncSession, digest: str) -> ApiKey | None:
    if not digest:
        return None
    return await session.scalar(select(ApiKey).where(ApiKey.key_hash == digest))


async def find_key(session: AsyncSession, key_id: uuid.UUID) -> ApiKey | None:
    return await session.get(ApiKey, key_id)


async def revoke_key(
    session: AsyncSession, row: ApiKey, *, now: datetime | None = None
) -> ApiKey:
    """Idempotent: the first revocation is the one that is dated."""
    if row.revoked_at is None:
        row.revoked_at = now or utc_now()
    row.active = False
    await session.flush()
    return row


def month_start(*, now: datetime | None = None) -> str:
    """`YYYY-MM-01` on the UTC+8 calendar, matching `repo_ops.key_usage`."""
    return local_day(now or utc_now())[:7] + "-01"


async def month_totals(
    session: AsyncSession, key_id: uuid.UUID, *, since: str | None = None
) -> tuple[int, int]:
    """`(requests, errors)` for this key since the first of the month."""
    row = (
        await session.execute(
            select(func.sum(ApiKeyUsage.requests), func.sum(ApiKeyUsage.errors))
            .where(ApiKeyUsage.key_id == key_id, ApiKeyUsage.day >= (since or month_start()))
            .group_by(ApiKeyUsage.key_id)
        )
    ).first()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


async def record_usage(
    session: AsyncSession,
    row: ApiKey,
    *,
    day: str,
    is_error: bool = False,
    now: datetime | None = None,
) -> None:
    """Charge one request to `(key, day)`. Caller commits.

    Increments happen inside the statement so two concurrent calls cannot both
    read `4` and both write `5`.
    """
    moment = now or utc_now()
    values: dict[str, Any] = {"id": uuid.uuid4(), "key_id": row.id, "day": day,
                              "requests": 1, "errors": 1 if is_error else 0}
    if _dialect_name(session) == "sqlite":
        statement = sqlite_insert(ApiKeyUsage).values(**values)
    else:
        statement = pg_insert(ApiKeyUsage).values(**values)

    update: dict[str, Any] = {"requests": ApiKeyUsage.requests + 1}
    if is_error:
        update["errors"] = ApiKeyUsage.errors + 1
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[ApiKeyUsage.key_id, ApiKeyUsage.day], set_=update
        )
    )
    row.last_used_at = moment
    await session.flush()


def _dialect_name(session: AsyncSession) -> str:
    bind = session.get_bind()
    return bind.dialect.name if bind is not None else "postgresql"


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------


async def create_application(
    session: AsyncSession,
    *,
    email: str,
    name: str,
    purpose: str,
    site_url: str = "",
    now: datetime | None = None,
) -> ApiApplication:
    """Insert a pending row. The caller commits.

    The address goes through the subscriber list's normaliser, so `A@B` and
    `a@b` cannot become two applications and "is this address already waiting"
    remains a single indexed equality.
    """
    row = ApiApplication(
        id=uuid.uuid4(),
        email=repo_growth.normalize_email(email),
        name=(name or "").strip()[:MAX_APPLICANT_NAME],
        purpose=(purpose or "").strip()[:MAX_APPLICANT_PURPOSE],
        site_url=(site_url or "").strip()[:MAX_APPLICANT_SITE],
        status="pending",
        note="",
        monthly_quota=DEFAULT_APPLICATION_QUOTA,
        created_at=now or utc_now(),
    )
    session.add(row)
    await session.flush()
    return row


async def find_application(
    session: AsyncSession, application_id: uuid.UUID
) -> ApiApplication | None:
    return await session.get(ApiApplication, application_id)


async def find_pending_application(
    session: AsyncSession, email: str
) -> ApiApplication | None:
    """The oldest pending row for this address, if one exists.

    Only `pending` counts: an approved address asking again (lost key, second
    product) is a decision for a person, and a rejected one asking again after
    circumstances changed is the same. Deduplicating those silently would hide
    exactly the signals the queue exists to surface.
    """
    normalized = repo_growth.normalize_email(email)
    if not normalized:
        return None
    return await session.scalar(
        select(ApiApplication)
        .where(
            ApiApplication.email == normalized, ApiApplication.status == "pending"
        )
        .order_by(ApiApplication.created_at)
        .limit(1)
    )


async def list_applications(
    session: AsyncSession,
    *,
    status: str | None = None,
    page: int = 1,
    size: int = 50,
) -> tuple[list[ApiApplication], int, dict[str, int]]:
    """One page of the queue plus per-status totals for the tabs."""
    statement = select(ApiApplication)
    if status and status in APPLICATION_STATUSES:
        statement = statement.where(ApiApplication.status == status)

    total = int(
        await session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    )
    rows = await session.execute(
        statement.order_by(ApiApplication.created_at.desc(), ApiApplication.id)
        .offset(max(page - 1, 0) * size)
        .limit(size)
    )

    counts = {name: 0 for name in APPLICATION_STATUSES}
    grouped = await session.execute(
        select(ApiApplication.status, func.count()).group_by(ApiApplication.status)
    )
    for name, count in grouped.all():
        counts[str(name)] = int(count)
    return list(rows.scalars().all()), total, counts


async def decide_application(
    session: AsyncSession,
    row: ApiApplication,
    *,
    status: str,
    note: str = "",
    key_id: uuid.UUID | None = None,
    monthly_quota: int | None = None,
    decided_by: str = "",
    now: datetime | None = None,
) -> ApiApplication:
    """Close a pending row exactly once.

    A second decision raises rather than overwriting: the endpoint turns that
    into a 409, and the audit trail keeps the first decision as the real one.
    """
    if status not in ("approved", "rejected"):
        raise ValueError(f"unknown decision: {status}")
    if row.status != "pending":
        raise ValueError("application already decided")
    row.status = status
    row.note = (note or "")[:MAX_DECISION_NOTE]
    row.decided_at = now or utc_now()
    row.decided_by = (decided_by or "")[:40]
    if key_id is not None:
        row.key_id = key_id
    if monthly_quota is not None:
        row.monthly_quota = max(int(monthly_quota), 0)
    await session.flush()
    return row


# ---------------------------------------------------------------------------
# Partners
# ---------------------------------------------------------------------------


def normalize_code(value: str) -> str:
    return (value or "").strip().lower()


def looks_like_code(value: str) -> bool:
    return bool(_CODE_RE.match(normalize_code(value)))


def normalize_target(value: str) -> str:
    """Only absolute http(s) URLs survive: `javascript:` in `Location:` is XSS."""
    text = (value or "").strip()
    if not text:
        return ""
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return ""
    return text[:2000]


def _today(*, now: datetime | None = None) -> str:
    return local_day(now or utc_now())


def partner_is_live(row: Partner, *, today: str | None = None) -> bool:
    """Active, pointed somewhere, and inside its booked window.

    `starts_on` / `ends_on` are `YYYY-MM-DD` text, so a plain string comparison
    orders them correctly — the same trick the rest of the schema uses for dates
    that may be month-precision.
    """
    if row.status != "active" or not normalize_target(row.target_url or ""):
        return False
    day = today or _today()
    if row.starts_on and day < row.starts_on:
        return False
    if row.ends_on and day > row.ends_on:
        return False
    return True


async def create_partner(
    session: AsyncSession,
    *,
    name: str,
    code: str,
    kind: str = "sponsor",
    status: str = "prospect",
    target_url: str = "",
    contact: str = "",
    terms_note: str = "",
    starts_on: str | None = None,
    ends_on: str | None = None,
    now: datetime | None = None,
) -> Partner:
    moment = now or utc_now()
    row = Partner(
        id=uuid.uuid4(),
        name=(name or "")[:120],
        kind=kind,
        status=status,
        code=normalize_code(code),
        target_url=normalize_target(target_url),
        contact=contact or "",
        terms_note=terms_note or "",
        starts_on=starts_on or None,
        ends_on=ends_on or None,
        created_at=moment,
        updated_at=moment,
    )
    session.add(row)
    await session.flush()
    return row


async def find_partner_by_code(session: AsyncSession, code: str) -> Partner | None:
    normalized = normalize_code(code)
    if not normalized:
        return None
    return await session.scalar(select(Partner).where(Partner.code == normalized))


async def find_partner(session: AsyncSession, partner_id: uuid.UUID) -> Partner | None:
    return await session.get(Partner, partner_id)


async def update_partner(
    session: AsyncSession, row: Partner, *, now: datetime | None = None, **fields: Any
) -> Partner:
    """Apply only the keys the caller actually sent (`exclude_unset` upstream)."""
    for key, value in fields.items():
        if key == "code":
            row.code = normalize_code(value)
        elif key == "target_url":
            row.target_url = normalize_target(value)
        elif key in ("name", "kind", "status"):
            setattr(row, key, value)
        elif key in ("starts_on", "ends_on"):
            setattr(row, key, value or None)
        elif key in ("contact", "terms_note"):
            setattr(row, key, value or "")
    row.updated_at = now or utc_now()
    await session.flush()
    return row


def _referrer_host(value: str) -> str:
    """Just the host: a full referrer can carry a query string with a search term."""
    text = (value or "").strip()
    if not text:
        return ""
    parts = urlsplit(text)
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host[:120]


async def record_click(
    session: AsyncSession,
    row: Partner,
    *,
    user_agent: str = "",
    referrer: str = "",
    now: datetime | None = None,
) -> PartnerClick:
    moment = now or utc_now()
    family, _device = classify_ua(user_agent)
    is_bot = bool(detect_crawler(user_agent)[0])
    click = PartnerClick(
        id=uuid.uuid4(),
        partner_id=row.id,
        day=local_day(moment),
        at=moment,
        referrer_host=_referrer_host(referrer),
        ua_family=family,
        is_bot=is_bot,
    )
    session.add(click)
    await session.flush()
    return click


__all__ = [
    "APPLICATION_STATUSES",
    "DEFAULT_APPLICATION_QUOTA",
    "KEY_MARKER",
    "KEY_PREFIX_LEN",
    "PARTNER_KINDS",
    "PARTNER_STATUSES",
    "SCOPES",
    "create_application",
    "create_key",
    "create_partner",
    "decide_application",
    "find_application",
    "find_key",
    "find_key_by_hash",
    "find_partner",
    "find_partner_by_code",
    "find_pending_application",
    "hash_key",
    "list_applications",
    "looks_like_code",
    "month_start",
    "month_totals",
    "new_key_material",
    "normalize_code",
    "normalize_target",
    "partner_is_live",
    "record_click",
    "record_usage",
    "revoke_key",
    "update_partner",
]
