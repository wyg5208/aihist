"""`POST /api/v1/track` — the SPA beacon.

Four properties this file exists to hold:

1. **It always answers 204.** A validation failure, a rate-limited caller and a
   successful write are indistinguishable from outside. Anything else would let
   a prober fingerprint the endpoint or learn which paths are recorded.
2. **Nothing identifying is stored.** No cookie is read or set; the raw IP is
   only ever a rate-limit key; `visitor_hash` / `session_hash` are salted
   digests mixed with the day, so yesterday cannot be joined to today.
3. **The write is one short row.** SQLite takes a single writer at a time and
   the sync pipeline holds that lock for minutes. A busy database loses one
   beacon, never the page view that already rendered.
4. **`ANALYTICS_ENABLED=false` is a real off switch.** The client keeps its
   beacon wired; the server just stops writing.

The static reference pages (`/e/<slug>.html`) carry no JavaScript by design, so
they are invisible to this endpoint. That half of the traffic story comes from
the reverse proxy's access log — see `app/analytics/logs.py`.
"""

from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import day_digest, ip_digest, local_day
from app.analytics.channels import (  # noqa: F401 - re-exported for callers/tests
    AI_REFERRERS,
    SEARCH_REFERRERS,
    SOCIAL_REFERRERS,
    classify_channel,
    host_of,
)
from app.analytics.ua import classify_ua, detect_crawler
from app.config import Settings, get_settings
from app.db.models import PageView, utc_now
from app.deps import client_ip, get_session

router = APIRouter()

RATE_LIMIT = 60
RATE_WINDOW_SECONDS = 60.0

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

# Process-local sliding window. Correct only for a single uvicorn worker, which
# is the deployment this console assumes; with several workers each keeps its
# own window and the effective ceiling multiplies. Replacing this with Redis or
# a DB counter is the one change needed to scale out.
_hits: dict[str, list[float]] = {}


def reset_rate_limit() -> None:
    """Testing seam. Also used by the `prune` CLI when it clears caches."""
    _hits.clear()


def allow(key: str, *, moment: float | None = None) -> bool:
    now = time.monotonic() if moment is None else moment
    cutoff = now - RATE_WINDOW_SECONDS
    stamps = [stamp for stamp in _hits.get(key, ()) if stamp >= cutoff]
    if len(stamps) >= RATE_LIMIT:
        _hits[key] = stamps
        return False
    if len(_hits) > 4096:
        # The map is a cache, not state: dropping it costs one window of
        # precision and keeps a spoofed X-Forwarded-For from growing it forever.
        _hits.clear()
    stamps.append(now)
    _hits[key] = stamps
    return True


def page_kind(path: str) -> str:
    """Which surface a view landed on. `?e=` is a deep link to one entry."""
    raw = path or "/"
    base, _, search = raw.partition("?")
    if base.startswith("/e/"):
        return "event"
    if base in ("", "/", "/index.html"):
        if "e" in parse_qs(search):
            return "event"
        return "home"
    if base.startswith("/admin"):
        return "admin"
    return "other"


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _token(value: Any) -> str:
    """A client-generated id, or nothing. Anything else is dropped, not fixed."""
    if not isinstance(value, str):
        return ""
    text = value.strip()
    return text if _TOKEN_RE.match(text) else ""


@router.post("/track", include_in_schema=False)
async def track(
    request: Request,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> Response:
    answered = Response(status_code=204)
    if not settings.analytics_enabled:
        return answered

    ip = client_ip(request)
    if not allow(ip_digest(ip, settings) or "anonymous"):
        return answered

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 - a malformed body is just "no beacon"
        return answered
    if not isinstance(payload, dict):
        return answered

    # Validated in-handler rather than by a request model: FastAPI answers 422
    # before the handler runs, and that difference is observable.
    path = _text(payload.get("path"), 300)
    if not path.startswith("/"):
        return answered

    referrer = _text(payload.get("referrer"), 600)
    moment = utc_now()
    day = local_day(moment)
    user_agent = request.headers.get("user-agent", "")
    family, device = classify_ua(user_agent)
    _, is_bot = detect_crawler(user_agent)

    session.add(
        PageView(
            at=moment,
            day=day,
            path=path,
            page_kind=page_kind(path),
            referrer_host=host_of(referrer),
            channel=classify_channel(referrer, host_of(settings.site_origin)),
            visitor_hash=day_digest(_token(payload.get("vid")), settings, day),
            session_hash=day_digest(_token(payload.get("sid")), settings, day),
            ua_family=family,
            is_bot=is_bot,
            device=device,
            lang=_text(payload.get("lang"), 16),
        )
    )
    try:
        await session.commit()
    except Exception:  # noqa: BLE001 - a lost beacon must not fail the page
        await session.rollback()
    return answered


__all__ = [
    "allow",
    "classify_channel",
    "host_of",
    "page_kind",
    "reset_rate_limit",
    "router",
]
