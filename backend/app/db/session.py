"""Async engine and session factory.

SQLite is the default backend: one small site, one writer at a time, reads far
outnumbering writes. WAL mode is what makes that safe — without it a write
blocks every reader for the duration of the transaction.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

_settings = get_settings()

# Milliseconds a writer waits for the lock before SQLite raises "database is
# locked". The pipeline commits in small steps, so a few seconds is plenty;
# 15s only matters if a backup or an external tool briefly holds the file.
SQLITE_BUSY_TIMEOUT_MS = 15_000

_URL = make_url(_settings.database_url)
_IS_SQLITE = _URL.get_backend_name() == "sqlite"
# `:memory:` has no journal file, so `journal_mode=WAL` is meaningless there.
_IS_MEMORY = _IS_SQLITE and (not _URL.database or _URL.database == ":memory:")

_KWARGS: dict[str, Any] = {"pool_pre_ping": True, "future": True}
if _IS_SQLITE:
    _KWARGS["connect_args"] = {"timeout": SQLITE_BUSY_TIMEOUT_MS / 1000}

engine = create_async_engine(_settings.database_url, **_KWARGS)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def apply_sqlite_pragmas(dbapi_connection: Any, *, in_memory: bool = False) -> None:
    """Per-connection SQLite setup. Exposed so the test suite can assert it."""
    cursor = dbapi_connection.cursor()
    try:
        if not in_memory:
            # WAL lets readers run while a write is open; `:memory:` has no
            # journal file, so the statement is skipped there.
            cursor.execute("PRAGMA journal_mode=WAL")
        # WAL + NORMAL is the documented durable-but-fast pairing: a crash can
        # lose the last transaction, never the database.
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


if _IS_SQLITE:
    # PRAGMAs are per connection, so they have to be applied on every connect,
    # not once at startup.
    @event.listens_for(engine.sync_engine, "connect")
    def _on_connect(dbapi_connection: Any, _record: Any) -> None:  # noqa: ARG001
        apply_sqlite_pragmas(dbapi_connection, in_memory=_IS_MEMORY)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
