"""Open-data API: the part of the site that can be paid for.

Deliberately narrow — two read-only endpoints, a bearer key, a monthly quota.
No query language, no bulk dump, no writes.

Two properties are load-bearing:

* **Nothing operator-only is filtered at the last moment.** The payload is built
  from `schemas.event.timeline_item`, which knows nothing about `ops_note` or
  `editorial_review`; both columns simply never enter the dict. A `del payload[...]`
  would be one careless edit away from leaking a private memo.
* **The response is identical in shape to what the public pages already serve**,
  minus the editorial internals. A paying client should be buying convenience and
  quota, not privileged data — otherwise the public timeline starts looking like
  a deliberately degraded product.

Quota accounting goes through `api_key_usage`, one row per key per day, so the
console can answer "did the programme get used at all" without a second table.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import LOCAL_TZ, local_day
from app.config import Settings, get_settings
from app.db import repo_commercial, repo_events
from app.db.models import ApiKey, Event, utc_now
from app.db.repo_events import observable
from app.deps import get_session
from app.schemas.event import timeline_item

router = APIRouter()

DEFAULT_LIMIT = 100
MAX_LIMIT = 500
DEFAULT_SINCE_DAYS = 30

KEY_HEADER = "x-api-key"


def _auth_error(detail: str, status_code: int = 401) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=detail,
        headers={"www-authenticate": 'ApiKey realm="aihist-open"'},
    )


async def _authenticate(request: Request, session: AsyncSession) -> ApiKey:
    """Resolve the `X-API-Key` header to a usable key row.

    Order matters: existence is checked before state, so a revoked key never
    reaches the quota arithmetic, and a wrong key never learns whether the
    programme is enabled.
    """
    raw = (request.headers.get(KEY_HEADER) or "").strip()
    if not raw:
        raise _auth_error("missing_api_key")
    row = await repo_commercial.find_key_by_hash(session, repo_commercial.hash_key(raw))
    if row is None:
        raise _auth_error("invalid_api_key")
    if row.revoked_at is not None:
        raise _auth_error("key_revoked")
    if not row.active:
        raise _auth_error("key_disabled", status_code=403)
    scopes = list(row.scopes) if isinstance(row.scopes, list) else []
    if "read" not in scopes:
        raise _auth_error("scope_denied", status_code=403)
    return row


async def _charge(
    session: AsyncSession, row: ApiKey, *, day: str, is_error: bool = False
) -> None:
    """Book one request against today's row. Committed immediately.

    A separate commit from the query is intentional: the usage row must survive
    even if the response body fails to serialise, because the client still sent
    the request.
    """
    await repo_commercial.record_usage(session, row, day=day, is_error=is_error)
    await session.commit()


def _quota_guard(used: int, quota: int) -> None:
    if quota and used >= quota:
        raise HTTPException(
            status_code=429,
            detail="quota_exceeded",
            headers={"x-quota-limit": str(quota), "x-quota-used": str(used)},
        )


def _since_bound(value: str | None) -> datetime:
    """`YYYY-MM-DD` on the UTC+8 calendar, as a UTC instant.

    The conversion is not cosmetic: every stored timestamp carries a `+00:00`
    offset, and comparing a `+08:00` string against them would be a lexical
    comparison between two different baselines.
    """
    if not value:
        return utc_now() - timedelta(days=DEFAULT_SINCE_DAYS)
    try:
        local_midnight = datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=LOCAL_TZ)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_since") from None
    return local_midnight.astimezone(timezone.utc)


def _source_entry(source: Any) -> dict[str, Any] | None:
    """One evidence row, normalised.

    Stored sources arrive in both shapes (`publishedAt` from the ingest port,
    `published_at` from an older seed), so both are accepted and one is emitted.
    """
    if not isinstance(source, dict):
        return None
    return {
        "name": source.get("name") or "",
        "family": source.get("family") or "",
        "title": source.get("title") or "",
        "url": source.get("url") or "",
        "publishedAt": source.get("publishedAt") or source.get("published_at") or None,
    }


def _item(row: Event, *, detail: bool = False) -> dict[str, Any]:
    payload = timeline_item(row, with_summary=True)
    payload["summary"] = row.summary or ""
    if detail:
        sources = row.sources if isinstance(row.sources, list) else []
        payload["sources"] = [
            entry for entry in (_source_entry(source) for source in sources) if entry
        ]
    return payload


def _quota_block(used: int, quota: int) -> dict[str, Any]:
    return {
        "monthly": quota,
        "used": used,
        # `None` rather than a big number: an unlimited key is a different fact
        # from a key with a very large allowance.
        "remaining": max(quota - used, 0) if quota else None,
    }


def _gate(settings: Settings) -> None:
    if not settings.open_api_enabled:
        # 404, not 403: a programme that has not launched should not even confirm
        # that the route exists.
        raise HTTPException(status_code=404, detail="open_api_disabled")


@router.get("/events")
async def list_events(
    request: Request,
    since: str | None = Query(default=None, description="YYYY-MM-DD，按最后更新时间过滤"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Entries that changed on or after `since`.

    Filtering on `updated_at` rather than the event date is what makes the feed
    pollable: a correction to a 2019 entry must show up, or a client that synced
    last week has no way to see it.
    """
    _gate(settings)
    key_row = await _authenticate(request, session)
    day = local_day(utc_now())
    quota = int(key_row.monthly_quota or 0)

    used, _ = await repo_commercial.month_totals(session, key_row.id)
    try:
        _quota_guard(used, quota)
    except HTTPException:
        await _charge(session, key_row, day=day, is_error=True)
        raise

    bound = _since_bound(since)
    rows = await session.execute(
        observable(select(Event))
        .where(Event.updated_at >= bound)
        .order_by(Event.sort_date.desc(), Event.importance.desc())
        .limit(limit)
    )
    items = [_item(row) for row in rows.scalars().all()]
    await _charge(session, key_row, day=day)
    return {
        "ok": True,
        "items": items,
        "count": len(items),
        "limit": limit,
        "since": bound.isoformat(),
        "quota": _quota_block(used + 1, quota),
    }


@router.get("/events/{slug}")
async def read_event(
    slug: str,
    request: Request,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _gate(settings)
    key_row = await _authenticate(request, session)
    day = local_day(utc_now())
    quota = int(key_row.monthly_quota or 0)

    used, _ = await repo_commercial.month_totals(session, key_row.id)
    try:
        _quota_guard(used, quota)
    except HTTPException:
        await _charge(session, key_row, day=day, is_error=True)
        raise

    row = await repo_events.read_event_by_slug(session, slug)
    # A held or retracted entry must not be reachable through the paid door when
    # the free door returns 404 for it.
    visible = row is not None and (row.editorial_status in (None, "admitted"))
    if not visible:
        await _charge(session, key_row, day=day, is_error=True)
        raise HTTPException(status_code=404, detail="event_not_found")

    await _charge(session, key_row, day=day)
    return {
        "ok": True,
        "event": _item(row, detail=True),
        "quota": _quota_block(used + 1, quota),
    }


__all__ = ["router"]
