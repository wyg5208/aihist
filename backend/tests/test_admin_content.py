"""Content decisions: search, admit, exclude, hold, re-review, importance, note.

The load-bearing property is the one the product promises: a retired entry
disappears from the public API immediately, but the row is never deleted, so the
audit trail and the "we withdrew this" explanation both survive.
"""

from __future__ import annotations

import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select

from app import auth
from app.config import Settings
from app.db import repo_admin
from app.db.models import Event, ReviewDecision

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)
CSRF = {"X-Requested-With": "admin"}


@pytest.fixture(autouse=True)
def clear_throttle():
    auth.reset_throttle()
    yield
    auth.reset_throttle()


@pytest.fixture
def admin_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        admin_user="admin",
        admin_password_hash=PASSWORD_HASH,
        analytics_salt="test-salt",
        site_origin="https://aihist.net",
        _env_file=None,
    )


async def seed_one(db_factory) -> Event:
    """A single admitted, slugged row to act on."""
    from app.ingest.pipeline import seed_rows

    async with db_factory() as session:
        from app.db import repo_events

        await repo_events.insert_events(session, seed_rows(datetime(2026, 10, 24, tzinfo=timezone.utc)))
        row = await session.scalar(select(Event).where(Event.slug.is_not(None)).limit(1))
        return row


@asynccontextmanager
async def console(db_factory, settings, role: str = "owner"):
    """Sign in and hand back a client already holding the session cookie."""
    if role != "owner":
        async with db_factory() as session:
            await repo_admin.create_user(
                session, username=role, password_hash=PASSWORD_HASH, role=role
            )
            await session.commit()
    async with client_for(db_factory, settings, scheme="https") as client:
        username = "admin" if role == "owner" else role
        response = await client.post(
            "/api/v1/admin/login",
            json={"user": username, "password": PASSWORD},
            headers=CSRF,
        )
        assert response.status_code == 200, response.text
        yield client


async def decide(client, event_id: str, action: str, **extra):
    return await client.post(
        f"/api/v1/admin/events/{event_id}/decision",
        json={"action": action, **extra},
        headers=CSRF,
    )


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


async def test_search_sees_every_status_and_paginates(db_factory, admin_settings, seeded_db):
    async with console(db_factory, admin_settings) as client:
        page = await client.get("/api/v1/admin/events?size=10")
        assert page.status_code == 200
        body = page.json()
        assert body["total"] == 158
        assert len(body["items"]) == 10
        assert body["page"] == 1 and body["size"] == 10

        first = body["items"][0]
        assert {
            "id",
            "slug",
            "title",
            "category",
            "sortDate",
            "importance",
            "confidence",
            "sourceCount",
            "origin",
            "editorialStatus",
            "opsNote",
            "fingerprint",
        } <= set(first)


async def test_search_filters_by_every_axis(db_factory, admin_settings, seeded_db):
    async with db_factory() as session:
        target = await session.scalar(select(Event).where(Event.slug.is_not(None)).limit(1))
        slug = target.slug
        category = target.category
        year = target.year

    async with console(db_factory, admin_settings) as client:
        by_text = (await client.get(f"/api/v1/admin/events?q={slug}")).json()
        assert by_text["total"] >= 1
        assert by_text["items"][0]["slug"] == slug

        by_category = (await client.get(f"/api/v1/admin/events?category={category}")).json()
        assert by_category["total"] >= 1
        assert all(item["category"] == category for item in by_category["items"])

        by_year = (await client.get(f"/api/v1/admin/events?year={year}")).json()
        assert all(item["year"] == year for item in by_year["items"])

        live = (await client.get("/api/v1/admin/events?status=live")).json()
        excluded = (await client.get("/api/v1/admin/events?status=excluded")).json()
        assert live["total"] == 158
        assert excluded["total"] == 0

        bad_sort = await client.get("/api/v1/admin/events?sort=nonsense")
        assert bad_sort.status_code == 200, "an unknown sort falls back, it does not 400"


async def test_search_rejects_an_oversized_page(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        assert (await client.get("/api/v1/admin/events?size=500")).status_code == 422


async def test_health_filters_match_the_counts_they_explain(db_factory, admin_settings, seeded_db):
    """`missing=` is the same predicate `data_health` counts.

    An Overview alert that says "N rows cannot be cited" opens a list, and that
    list has to be exactly N rows — otherwise the operator learns to distrust
    both numbers.
    """
    async with console(db_factory, admin_settings) as client:
        health = (await client.get("/api/v1/admin/overview")).json()["health"]

        unslugged = (await client.get("/api/v1/admin/events?missing=unslugged")).json()
        assert unslugged["total"] == health["unslugged"]
        assert all(item["slug"] is None for item in unslugged["items"])

        sourceless = (await client.get("/api/v1/admin/events?missing=sourceless")).json()
        assert sourceless["total"] == health["sourceless"]
        assert all(item["sourceCount"] == 0 for item in sourceless["items"])

        ungated = (await client.get("/api/v1/admin/events?missing=ungated")).json()
        assert ungated["total"] == health["ungated"]
        assert all(item["editorialStatus"] is None for item in ungated["items"])

        unknown = (await client.get("/api/v1/admin/events?missing=nonsense")).json()
        assert unknown["total"] == 158, "an unknown filter is ignored, not fatal"


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------


async def test_detail_exposes_review_note_and_audit(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)

    async with console(db_factory, admin_settings) as client:
        response = await client.get(f"/api/v1/admin/events/{row.id}")
        assert response.status_code == 200
        event = response.json()["event"]
        assert event["id"] == str(row.id)
        assert isinstance(event["sources"], list)
        assert isinstance(event["meta"], dict)
        assert "editorialReview" in event
        assert event["audit"] == []

        by_slug = await client.get(f"/api/v1/admin/events/{row.slug}")
        assert by_slug.status_code == 200
        assert by_slug.json()["event"]["id"] == str(row.id)

        missing = await client.get(f"/api/v1/admin/events/{uuid.uuid4()}")
        assert missing.status_code == 404


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------


async def test_excluding_hides_the_entry_from_the_public_api(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)

    async with console(db_factory, admin_settings) as client:
        before = await client.get(f"/api/v1/events/{row.slug}")
        assert before.status_code == 200

        response = await decide(client, str(row.id), "exclude", reason="无法核实")
        assert response.status_code == 200
        assert response.json()["event"]["editorialStatus"] == "excluded"

        after = await client.get(f"/api/v1/events/{row.slug}")
        assert after.status_code == 404, "retired entries must vanish immediately"

    # The row survives: no DELETE anywhere in the console.
    async with db_factory() as session:
        still_there = await session.get(Event, row.id)
        assert still_there is not None
        assert still_there.editorial_status == "excluded"
        assert still_there.editorial_review["reason"] == "无法核实"
        assert still_there.editorial_review["source"] == "manual"


async def test_admitting_a_held_entry_publishes_it(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)

    async with db_factory() as session:
        target = await session.get(Event, row.id)
        target.editorial_status = "hold"
        await session.commit()

    async with console(db_factory, admin_settings) as client:
        assert (await client.get(f"/api/v1/events/{row.slug}")).status_code == 404
        response = await decide(client, str(row.id), "admit", reason="人工复核通过")
        assert response.status_code == 200
        assert response.json()["event"]["editorialStatus"] == "admitted"
        assert (await client.get(f"/api/v1/events/{row.slug}")).status_code == 200


async def test_re_review_drops_the_stored_ballot(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)

    async with db_factory() as session:
        session.add(
            ReviewDecision(
                id=row.fingerprint,
                fingerprint=row.fingerprint,
                rubric_version="chronicle-v1",
                decision="hold",
                score=40,
                include_votes=1,
                valid_votes=5,
                votes=[],
                title=row.title,
                category=row.category,
                source_count=row.source_count,
                decision_source="panel",
                decided_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
                updated_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
            )
        )
        await session.commit()

    async with console(db_factory, admin_settings) as client:
        response = await decide(client, str(row.id), "re-review")
        assert response.status_code == 200
        assert response.json()["event"]["editorialStatus"] == "hold"

    async with db_factory() as session:
        assert await session.get(ReviewDecision, row.fingerprint) is None


async def test_importance_and_note_are_editable(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)
    original = row.importance

    async with console(db_factory, admin_settings) as client:
        bumped = await decide(client, str(row.id), "importance", importance=99)
        assert bumped.status_code == 200
        assert bumped.json()["event"]["importance"] == 99

        missing = await decide(client, str(row.id), "importance")
        assert missing.status_code == 400
        assert missing.json()["detail"] == "importance_required"

        noted = await decide(client, str(row.id), "note", reason="来源为官方博客，已人工确认")
        assert noted.status_code == 200
        assert noted.json()["event"]["opsNote"].startswith("来源为官方博客")

        empty = await decide(client, str(row.id), "note")
        assert empty.status_code == 400
        assert empty.json()["detail"] == "note_required"

        too_high = await decide(client, str(row.id), "importance", importance=101)
        assert too_high.status_code == 422

    assert original != 99


async def test_the_ops_note_never_reaches_the_public_payload(db_factory, admin_settings, seeded_db):
    """`ops_note` is an internal memo; `event_detail()` must not read it."""
    row = await seed_one(db_factory)

    async with console(db_factory, admin_settings) as client:
        await decide(client, str(row.id), "note", reason="内部按语：仅后台可见")
        public = await client.get(f"/api/v1/events/{row.slug}")

    body = public.json()["event"]
    assert "opsNote" not in body
    assert "内部按语" not in str(body)


async def test_each_decision_writes_an_audit_row(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)

    async with console(db_factory, admin_settings) as client:
        await decide(client, str(row.id), "exclude", reason="重复条目")
        detail = await client.get(f"/api/v1/admin/events/{row.id}")

    history = detail.json()["event"]["audit"]
    assert [entry["action"] for entry in history] == ["event.exclude"]
    assert history[0]["detail"]["note"] == "重复条目"
    assert history[0]["detail"]["to"] == "excluded"


async def test_an_analyst_may_not_decide(db_factory, admin_settings, seeded_db):
    row = await seed_one(db_factory)

    async with console(db_factory, admin_settings, role="analyst") as client:
        response = await decide(client, str(row.id), "exclude", reason="nope")
    assert response.status_code == 403
    assert response.json()["detail"] == "forbidden"
