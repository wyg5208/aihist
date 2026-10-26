"""The correction page: the door behind "发现错误" on every citation page.

What is worth pinning here is what the page promises a stranger: no script, no
indexing, the entry's real sources, and a mailbox that exists even when nobody
configured one. An entry that is not public is not offered for correction —
the same visibility rule as the JSON API.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import select

from app.config import Settings
from app.db.models import Event

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        site_origin="https://aihist.net",
        _env_file=None,
    )


async def first_seeded_slug(db_factory) -> str:
    async with db_factory() as session:
        row = await session.scalar(
            select(Event).where(Event.slug.is_not(None)).order_by(Event.slug)
        )
    assert row is not None, "the seed fixture should have inserted slugs"
    return str(row.slug)


async def test_the_page_without_a_slug_explains_what_to_send(db_factory, settings):
    async with client_for(db_factory, settings) as client:
        page = await client.get("/api/v1/correct")
    assert page.status_code == 200
    assert "报告一条错误" in page.text
    assert "mailto:correct@aihist.net" in page.text, "the fallback inbox is derived, not empty"
    assert page.headers["x-robots-tag"] == "noindex, nofollow"
    assert "<script" not in page.text


async def test_an_entry_page_shows_its_sources_and_a_prefilled_mailto(
    db_factory, settings, seeded_db
):
    slug = await first_seeded_slug(db_factory)
    async with client_for(db_factory, settings) as client:
        page = await client.get(f"/api/v1/correct?slug={slug}")

    assert page.status_code == 200
    assert slug in page.text
    assert f"/e/{slug}.html" in page.text, "the mailto must point at the citable page"
    assert "mailto:correct@aihist.net?subject=" in page.text
    assert 'class="sources"' in page.text or "没有可点开的来源" in page.text


async def test_an_entry_that_is_not_public_is_not_offered_for_correction(
    db_factory, settings, seeded_db
):
    slug = await first_seeded_slug(db_factory)
    async with db_factory() as session:
        row = await session.scalar(select(Event).where(Event.slug == slug))
        assert row is not None
        row.editorial_status = "excluded"
        await session.commit()

    async with client_for(db_factory, settings) as client:
        hidden = await client.get(f"/api/v1/correct?slug={slug}")
        nonsense = await client.get("/api/v1/correct?slug=Not%20A%20Slug")

    assert hidden.status_code == 404 and "不在公开档案里" in hidden.text
    assert nonsense.status_code == 404


async def test_a_configured_mailbox_is_used_verbatim(db_factory):
    configured = Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        site_origin="https://aihist.net",
        contact_email="fix@example.com",
        _env_file=None,
    )
    async with client_for(db_factory, configured) as client:
        page = await client.get("/api/v1/correct")
    assert "mailto:fix@example.com" in page.text
    assert "correct@aihist.net" not in page.text
