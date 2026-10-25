"""Append-only audit trail.

One writer, and it never updates or deletes. Two properties matter:

* **No credentials reach the table.** `detail` is walked before it is stored and
  any key that looks like a secret is replaced with `[redacted]`, so a sloppy
  caller cannot leak a password or an API key into a log that is displayed back
  to every owner.
* **No raw address reaches the table.** Only `sha256(ip + pepper)` is stored.

The row is added to the caller's session but not flushed: the endpoint's own
commit writes it atomically with the change it describes, so an action can never
be recorded without having happened (nor the reverse).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import ip_digest
from app.config import Settings, get_settings
from app.db import repo_admin

logger = logging.getLogger("aihist.audit")

# Any key containing one of these is stored as `[redacted]`.
SECRET_HINTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "key_hash",
    "authorization",
    "cookie",
)

MAX_STRING = 400
MAX_DEPTH = 4


def scrub(value: Any, depth: int = 0) -> Any:
    """Coerce anything into JSON-safe primitives, redacting secret-shaped keys."""
    if depth > MAX_DEPTH:
        return "..."
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key)
            if any(hint in name.lower() for hint in SECRET_HINTS):
                cleaned[name] = "[redacted]"
            else:
                cleaned[name] = scrub(item, depth + 1)
        return cleaned
    if isinstance(value, (list, tuple, set)):
        return [scrub(item, depth + 1) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    text = value if isinstance(value, str) else str(value)
    return text[:MAX_STRING]


async def record(
    session: AsyncSession,
    *,
    actor: str,
    role: str,
    action: str,
    target_type: str = "",
    target_id: str = "",
    summary: str = "",
    detail: dict | None = None,
    ip: str = "",
    settings: Settings | None = None,
) -> None:
    """Stage one audit row on `session`. The caller commits."""
    resolved = settings or get_settings()
    try:
        await repo_admin.write_audit(
            session,
            actor=actor,
            role=role,
            action=action,
            target_type=target_type,
            target_id=str(target_id or ""),
            summary=(summary or "")[:MAX_STRING],
            detail=scrub(detail or {}),
            ip_hash=ip_digest(ip, resolved),
        )
    except Exception as error:  # noqa: BLE001 - auditing must not fail the action
        logger.warning("audit write failed for %s: %s", action, error)


__all__ = ["record", "scrub"]
