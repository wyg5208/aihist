"""Console identity: roles, the permission matrix, and the session payload.

The signed cookie is the only source of truth for "who is this". It carries
`{"u": <username>, "r": <role>, "v": 1}`. A cookie minted by the pre-roles build
carries `{"user": ...}` and is read as `owner`, so upgrading the server while a
console tab is open cannot lock the operator out of their own console.

Two scope limits, both deliberate:

* login throttling is in-process state. The deployment is one uvicorn worker;
  with several workers each would get its own budget and the durable half of
  the rule (`admin_users.failed_attempts` / `locked_until`) would still apply.
* the env-configured account always signs in and is always `owner`. It is the
  bootstrap path and the escape hatch when every row in `admin_users` is lost.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import repo_admin

SESSION_VERSION = 1

_hasher = PasswordHasher()


def hash_password(value: str) -> str:
    """One argon2 configuration for the whole application.

    Kept here rather than in a route so `admin.py` (own password) and
    `admin_system.py` (reset someone else's) cannot drift into two cost factors.
    """
    return _hasher.hash(value or "")


def verify_password(password_hash: str, value: str) -> bool:
    """Total: a malformed or empty hash simply does not match."""
    if not password_hash:
        return False
    try:
        _hasher.verify(password_hash, value or "")
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:  # noqa: BLE001 - argon2 raises VerificationError subclasses
        return False
    return True

ROLES = ("owner", "editor", "analyst")

# `read`   -- every GET under /api/v1/admin
# `sync`   -- trigger a collection run
# `decide` -- admit / exclude / hold / re-annotate a row
# `manage` -- accounts, API keys, partners, subscribers, audit log
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "analyst": frozenset({"read"}),
    "editor": frozenset({"read", "sync", "decide"}),
    "owner": frozenset({"read", "sync", "decide", "manage"}),
}

# Console actions map onto exactly one permission. Keeping the strings in one
# place means a route cannot invent a permission that no role holds.
PERMISSIONS = ("read", "sync", "decide", "manage")

# Five consecutive misses lock an account for a quarter of an hour. The window
# is per (username, address) so one noisy client cannot lock out a colleague.
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_SECONDS = 15 * 60


@dataclass(frozen=True, slots=True)
class AdminPrincipal:
    username: str
    role: str = "owner"

    @property
    def permissions(self) -> list[str]:
        grants = ROLE_PERMISSIONS.get(self.role, ROLE_PERMISSIONS["analyst"])
        return [name for name in PERMISSIONS if name in grants]

    def can(self, permission: str) -> bool:
        return permission in ROLE_PERMISSIONS.get(self.role, ROLE_PERMISSIONS["analyst"])


def serializer(settings: Settings) -> URLSafeTimedSerializer:
    secret = settings.session_secret or "insecure-development-secret"
    return URLSafeTimedSerializer(secret, salt="aihist-admin")


def issue_session(settings: Settings, principal: AdminPrincipal) -> str:
    return serializer(settings).dumps(
        {"u": principal.username, "r": principal.role, "v": SESSION_VERSION}
    )


def read_session(settings: Settings, token: str | None) -> AdminPrincipal | None:
    if not token:
        return None
    try:
        payload = serializer(settings).loads(
            token, max_age=settings.session_max_age_seconds
        )
    except (BadSignature, ValueError):
        return None
    if not isinstance(payload, dict):
        return None

    username = payload.get("u")
    if isinstance(username, str) and username:
        role = payload.get("r")
        if role not in ROLE_PERMISSIONS:
            # A token naming a role that no longer exists degrades to the least
            # privileged one instead of failing closed on a stale cookie.
            role = "analyst"
        return AdminPrincipal(username=username, role=role)

    # Pre-roles cookie (`{"user": ...}`): the holder was the single operator.
    legacy = payload.get("user")
    if isinstance(legacy, str) and legacy:
        return AdminPrincipal(username=legacy, role="owner")
    return None


# ---------------------------------------------------------------------------
# Login throttling
# ---------------------------------------------------------------------------
# The key is hashed so even the in-memory dictionary holds no raw address.
_failures: dict[str, tuple[int, float]] = {}


def _throttle_key(username: str, ip: str) -> str:
    address = hashlib.sha256(ip.encode("utf-8")).hexdigest()[:16]
    return f"{(username or '').strip().lower()}|{address}"


def lock_remaining(username: str, ip: str, *, now: float | None = None) -> float:
    """Seconds left on an in-process lock, or 0 when the account may try."""
    entry = _failures.get(_throttle_key(username, ip))
    if not entry:
        return 0.0
    _, until = entry
    current = now if now is not None else time.monotonic()
    return max(0.0, until - current)


def register_failure(username: str, ip: str, *, now: float | None = None) -> int:
    """Count one miss and return the new consecutive-failure total."""
    current = now if now is not None else time.monotonic()
    key = _throttle_key(username, ip)
    count = (_failures.get(key) or (0, 0.0))[0] + 1
    until = current + LOGIN_LOCK_SECONDS if count >= LOGIN_MAX_FAILURES else 0.0
    _failures[key] = (count, until)
    return count


def clear_failures(username: str, ip: str) -> None:
    _failures.pop(_throttle_key(username, ip), None)


def reset_throttle() -> None:
    """Test hook: the dictionary is module state and outlives a single case."""
    _failures.clear()


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


async def ensure_bootstrap_owner(session: AsyncSession, settings: Settings) -> str | None:
    """Create the env account as an `owner` row when the table is empty.

    Idempotent by construction: it only writes when there are zero rows, and
    `ux_admin_users_username` rejects a second insert of the same name. Returns
    the username it created, or None when nothing was needed.
    """
    if not settings.admin_password_hash:
        return None
    if await repo_admin.count_users(session):
        return None
    await repo_admin.create_user(
        session,
        username=settings.admin_user or "admin",
        password_hash=settings.admin_password_hash,
        role="owner",
    )
    await session.commit()
    return settings.admin_user or "admin"


__all__ = [
    "LOGIN_LOCK_SECONDS",
    "LOGIN_MAX_FAILURES",
    "PERMISSIONS",
    "ROLE_PERMISSIONS",
    "ROLES",
    "SESSION_VERSION",
    "AdminPrincipal",
    "clear_failures",
    "ensure_bootstrap_owner",
    "hash_password",
    "issue_session",
    "lock_remaining",
    "read_session",
    "register_failure",
    "reset_throttle",
    "serializer",
    "verify_password",
]
