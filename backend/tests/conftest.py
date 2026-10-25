"""Shared fixtures: the recorded upstream bodies and the golden expectations.

`golden/*.json` records the instant (`nowMs`) the reference implementation ran
at. Every date window inside normalize is relative to that clock, so the tests
replay it instead of using the wall clock.
"""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

from app.ingest.sources import SOURCES, FetchResult, load_sources

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
GOLDEN_DIR = BACKEND / "tests" / "fixtures" / "golden"
UPSTREAM_DIR = ROOT / "dev" / "fixtures" / "upstream"

FIXTURE_FILES = {
    "openrouter": "openrouter.json",
    "hf-trending": "hf-trending.json",
    "hf-textgen": "hf-textgen.json",
    "arxiv": "arxiv.xml",
    "hn-llm": "hn-llm.json",
    "hn-ai": "hn-ai.json",
    "openai": "openai.rss.xml",
    "google": "google.rss.xml",
    "anthropic": "anthropic.sitemap.xml",
    "hf-blog": "hf-blog.rss.xml",
    "techcrunch": "techcrunch.rss.xml",
    "verge": "verge.atom.xml",
    "mittr": "mittr.rss.xml",
    "qbitai": "qbitai.rss.xml",
    "infoq": "infoq.rss.xml",
    "tmtpost": "tmtpost.rss.xml",
    "leiphone": "leiphone.rss.xml",
}


def load_golden(name: str) -> dict[str, Any]:
    with (GOLDEN_DIR / f"{name}.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def source_key_for(url: str) -> str | None:
    for source in SOURCES:
        if source["url"] == url:
            return source["key"]
    if "hn.algolia.com" in url:
        from urllib.parse import unquote

        return "hn-llm" if "query=LLM" in unquote(url) else "hn-ai"
    return None


def make_fixture_fetch(cache: dict[str, str] | None = None):
    bodies = cache if cache is not None else {}

    async def fetch(url: str) -> FetchResult:
        key = source_key_for(url)
        filename = FIXTURE_FILES.get(key) if key else None
        if not filename:
            return FetchResult(ok=False, status=404, url=url, text="")
        if filename not in bodies:
            bodies[filename] = (UPSTREAM_DIR / filename).read_text(encoding="utf-8")
        body = bodies[filename]
        return FetchResult(
            ok=True,
            status=200,
            url=url,
            text=body,
            content_length=len(body.encode("utf-8")),
            headers={
                "content-type": "application/json" if filename.endswith(".json") else "application/xml"
            },
        )

    return fetch


@pytest.fixture(scope="session")
def golden_sources() -> dict[str, Any]:
    return load_golden("sources")


@pytest.fixture(scope="session")
def golden_normalize() -> dict[str, Any]:
    return load_golden("normalize")


@pytest.fixture(scope="session")
def golden_editorial() -> dict[str, Any]:
    return load_golden("editorial")


@pytest.fixture(scope="session")
def golden_cluster() -> dict[str, Any]:
    return load_golden("cluster")


@pytest.fixture(scope="session")
def now_ms(golden_normalize: dict[str, Any]) -> int:
    return int(golden_normalize["nowMs"])


@pytest.fixture(scope="session")
def source_results() -> list[dict[str, Any]]:
    """Replay the recorded upstream bodies through the ported loader."""
    import asyncio

    deadline = int(time.time() * 1000) + 120_000
    return asyncio.run(
        load_sources(
            SOURCES,
            fetch=make_fixture_fetch(),
            deadline_ms=deadline,
            concurrency=5,
        )
    )


# ---------------------------------------------------------------------------
# Database: an in-memory SQLite instance created from the same metadata the
# Alembic migration was written against, so the tests exercise the real models.
# ---------------------------------------------------------------------------


@pytest.fixture
async def db_engine(tmp_path):
    """A throwaway SQLite file, created from the real metadata.

    A file (not `:memory:` with StaticPool) is required because the admin sync
    endpoint runs the pipeline in a detached task: two sessions must be able to
    hold their own connection at the same time.
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.db.models import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'aihist.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
def db_factory(db_engine):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db_session(db_factory):
    async with db_factory() as session:
        yield session


@pytest.fixture
async def seeded_db(db_factory):
    """The five tables plus the 158 frozen seed rows."""
    from datetime import datetime, timezone

    from app.db import repo_events
    from app.ingest.pipeline import seed_rows

    now = datetime(2026, 10, 24, tzinfo=timezone.utc)
    async with db_factory() as session:
        inserted = await repo_events.insert_events(session, seed_rows(now))
        await session.commit()
    assert inserted == 158, f"seed should insert 158 rows, got {inserted}"
    return db_factory


@pytest.fixture
def test_settings():
    from app.config import Settings

    return Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        admin_user="admin",
        admin_password_hash="",
        site_origin="https://aihist.net",
        _env_file=None,
    )


@asynccontextmanager
async def client_for(db_factory, settings, *, scheme: str = "http"):
    """An ASGI client wired to the in-memory session factory.

    The app's lifespan is not entered: it only reconciles stale run rows in the
    real database, which is irrelevant (and unconfigured) here. Admin cookies
    are marked `secure`, so anything that needs to carry a session must talk
    over `https`.
    """
    from httpx import ASGITransport, AsyncClient

    from app.config import get_settings
    from app.deps import get_session, get_session_factory
    from app.main import create_app

    application = create_app()

    async def override_session():
        async with db_factory() as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    application.dependency_overrides[get_session_factory] = lambda: db_factory
    application.dependency_overrides[get_settings] = lambda: settings

    transport = ASGITransport(app=application)
    async with AsyncClient(
        transport=transport, base_url=f"{scheme}://testserver"
    ) as client:
        client.asgi_app = application
        yield client


@pytest.fixture
async def api_client(db_factory, test_settings):
    async with client_for(db_factory, test_settings) as client:
        yield client
