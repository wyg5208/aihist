"""Shared FastAPI dependencies: database session, admin identity, judge config.

Identity lives in `app.auth`; this module only turns it into dependencies. The
one addition over the single-account build is `require_permission`, a factory so
a route can state the grant it needs instead of re-deriving it from a role
string:

    principal: AdminPrincipal = Depends(require_permission("decide", write=True))

`write=True` also enforces the `X-Requested-With: admin` header. SameSite=Lax
already blocks most cross-site POSTs; the header is the second lock and the
reason a stolen cookie alone cannot be replayed from an attacker's page.
"""

from __future__ import annotations

from typing import Any, Callable, Coroutine

from fastapi import Depends, Header, HTTPException, Request, status

from app.auth import AdminPrincipal, issue_session, read_session  # noqa: F401 - re-exported
from app.config import Settings, get_settings
from app.db.session import SessionLocal, get_session  # noqa: F401 - re-exported

SESSION_COOKIE = "aihist_admin"

JUDGE_ENV_KEYS = (
    "EDITORIAL_JUDGE_BASE",
    "EDITORIAL_JUDGE_KEY",
    "EDITORIAL_JUDGE_MODELS",
    "EDITORIAL_JUDGE_TIMEOUT_MS",
    "EDITORIAL_JUDGE_1_PROVIDER",
    "EDITORIAL_JUDGE_1_MODEL",
    "EDITORIAL_JUDGE_1_BASE",
    "EDITORIAL_JUDGE_1_KEY",
    "EDITORIAL_JUDGE_2_PROVIDER",
    "EDITORIAL_JUDGE_2_MODEL",
    "EDITORIAL_JUDGE_2_BASE",
    "EDITORIAL_JUDGE_2_KEY",
    "EDITORIAL_JUDGE_3_PROVIDER",
    "EDITORIAL_JUDGE_3_MODEL",
    "EDITORIAL_JUDGE_3_BASE",
    "EDITORIAL_JUDGE_3_KEY",
    "EDITORIAL_JUDGE_4_PROVIDER",
    "EDITORIAL_JUDGE_4_MODEL",
    "EDITORIAL_JUDGE_4_BASE",
    "EDITORIAL_JUDGE_4_KEY",
    "EDITORIAL_JUDGE_5_PROVIDER",
    "EDITORIAL_JUDGE_5_MODEL",
    "EDITORIAL_JUDGE_5_BASE",
    "EDITORIAL_JUDGE_5_KEY",
    "LLM_API_BASE",
    "LLM_API_KEY",
    "LLM_MODEL",
)


def judge_env(settings: Settings) -> dict[str, Any]:
    """The panel reads a plain mapping, exactly like the previous `env` object."""
    values: dict[str, Any] = {}
    for key in JUDGE_ENV_KEYS:
        value = getattr(settings, key.lower(), "")
        if value not in ("", None):
            values[key] = value
    return values


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


async def require_admin(
    request: Request, settings: Settings = Depends(get_settings)
) -> AdminPrincipal:
    principal = read_session(settings, request.cookies.get(SESSION_COOKIE))
    if principal is None:
        raise _unauthorized()
    return principal


def require_csrf(
    x_requested_with: str | None = Header(default=None),
) -> None:
    if (x_requested_with or "").lower() != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="missing_request_header"
        )


async def require_admin_write(
    principal: AdminPrincipal = Depends(require_admin),
    _csrf: None = Depends(require_csrf),
) -> AdminPrincipal:
    return principal


def require_permission(
    permission: str, *, write: bool = False
) -> Callable[..., Coroutine[Any, Any, AdminPrincipal]]:
    """Dependency factory: a session, a grant, and (for writes) the CSRF header."""

    def check(principal: AdminPrincipal) -> AdminPrincipal:
        if not principal.can(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="forbidden",
                headers={"x-required-permission": permission},
            )
        return principal

    if write:

        async def dependency_write(
            principal: AdminPrincipal = Depends(require_admin),
            _csrf: None = Depends(require_csrf),
        ) -> AdminPrincipal:
            return check(principal)

        return dependency_write

    async def dependency_read(
        principal: AdminPrincipal = Depends(require_admin),
    ) -> AdminPrincipal:
        return check(principal)

    return dependency_read


def get_session_factory() -> Any:
    """The factory a detached background task should open its own session from.

    It is a dependency purely so tests can point it at an in-memory database;
    production always resolves to the module-level `SessionLocal`.
    """
    return SessionLocal


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


__all__ = [
    "SESSION_COOKIE",
    "AdminPrincipal",
    "client_ip",
    "get_session",
    "get_session_factory",
    "issue_session",
    "judge_env",
    "read_session",
    "require_admin",
    "require_admin_write",
    "require_csrf",
    "require_permission",
]
