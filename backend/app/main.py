"""Application assembly.

CORS is limited to the local dev origins: in production Nginx serves the built
front end and the API from the same origin, so no browser ever needs a
cross-origin request.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin as admin_api
from app.api import admin_applications as admin_applications_api
from app.api import admin_commercial as admin_commercial_api
from app.api import admin_growth as admin_growth_api
from app.api import admin_ops as admin_ops_api
from app.api import admin_system as admin_system_api
from app.api import apply as apply_api
from app.api import correct as correct_api
from app.api import growth as growth_api
from app.api import open as open_api
from app.api import public as public_api
from app.api import redirect as redirect_api
from app.api import track as track_api
from app.auth import ensure_bootstrap_owner
from app.config import get_settings
from app.db.session import SessionLocal
from app.db.repo_sync import recover_stale_runs

logger = logging.getLogger("aihist")

LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # A run started with `asyncio.create_task` dies with the process, leaving a
    # row that claims to still be in flight.
    try:
        async with SessionLocal() as session:
            recovered = await recover_stale_runs(session)
            if recovered:
                logger.warning("marked %s stale sync_runs as failed", recovered)
            bootstrapped = await ensure_bootstrap_owner(session, get_settings())
            if bootstrapped:
                logger.info("seeded admin_users with the env account %r", bootstrapped)
    except Exception as error:  # noqa: BLE001 - never block startup on this
        logger.warning("could not reconcile stale runs: %s", error)
    yield


def app_version() -> str:
    """The product version, read from the installed distribution.

    `backend/pyproject.toml` is the only declaration; a literal here would drift
    silently the next time the version is bumped (scripts/check-version.mjs).
    """
    try:
        return package_version("aihist-backend")
    except PackageNotFoundError:  # running from a source tree without an install
        return "0.0.0"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AI 纪年 API",
        version=app_version(),
        docs_url="/api/v1/docs",
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=LOCAL_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, error: Exception) -> JSONResponse:  # noqa: ARG001
        logger.exception("internal_error")
        return JSONResponse(status_code=500, content={"ok": False, "error": "internal_error"})

    app.include_router(public_api.router, prefix="/api/v1", tags=["public"])
    app.include_router(admin_api.router, prefix="/api/v1/admin", tags=["admin"])
    # Distinct module, same prefix: `/sync` and its `run_sync` import stay in
    # `admin.py` because the existing tests monkeypatch that exact symbol.
    app.include_router(admin_ops_api.router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(admin_growth_api.router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(admin_commercial_api.router, prefix="/api/v1/admin", tags=["admin"])
    # The application queue sits next to the keys it mints, but in its own module:
    # it is the only admin surface a stranger's text reaches.
    app.include_router(
        admin_applications_api.router, prefix="/api/v1/admin", tags=["admin"]
    )
    app.include_router(admin_system_api.router, prefix="/api/v1/admin", tags=["admin"])
    # Public, unauthenticated, always 204: see the module docstring for why the
    # response never varies.
    app.include_router(track_api.router, prefix="/api/v1", tags=["analytics"])
    # Public subscribe / confirm / unsubscribe. Returns HTML on the two links
    # because the reader arrives from an email client, not from the SPA.
    app.include_router(growth_api.router, prefix="/api/v1", tags=["growth"])
    # Commercial surface: a keyed read API and the one tracked outbound link.
    # `/go` sits at the root because it is a link people paste, not an API path.
    app.include_router(open_api.router, prefix="/api/v1/open", tags=["open"])
    # The application form renders its own HTML: it is reached from a link on the
    # site, not from the SPA, and the process that stores the row serves the page.
    app.include_router(apply_api.router, prefix="/api/v1/open", tags=["open"])
    # Reader corrections: a reader-facing page with a prefilled mailto, served
    # by the same process because it needs the entry's sources to be useful.
    app.include_router(correct_api.router, prefix="/api/v1", tags=["growth"])
    app.include_router(redirect_api.router, tags=["redirect"])

    @app.get("/api/v1/health")
    async def health() -> dict:
        return {"ok": True, "origin": settings.site_origin}

    return app


app = create_app()
