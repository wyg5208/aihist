"""The collection library endpoints: filters, paging, detail, and who may read.

The library is deliberately read-only, so the contract under test is narrow:
every list answers from `raw_items` with paging and the shared summary, the
detail joins the trail to the ballot, and an analyst — whose only grant is
`read` — can audit a rejection but cannot change one.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select

from app import auth
from app.config import Settings
from app.db import repo_admin, repo_events
from app.db.models import CollectVerdict, RawItem, ReviewDecision
from app.editorial.rules import RUBRIC_VERSION

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)
CSRF = {"X-Requested-With": "admin"}
NOW = datetime.now(timezone.utc)
EVENT_FP = "a" * 64


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
        editorial_judge_base="",
        _env_file=None,
    )


def item_row(
    *,
    name: str,
    url: str,
    status: str,
    stage: str = "panel",
    reason_code: str = "",
    source_key: str = "openai",
    family: str = "official",
    title: str = "",
    last_seen: datetime | None = None,
    event_fingerprint: str | None = None,
    reason_text: str = "",
) -> dict[str, Any]:
    moment = last_seen or NOW
    return {
        "id": uuid.uuid4(),
        "fingerprint": uuid.uuid4().hex + uuid.uuid4().hex,
        "source_family": family,
        "source_name": name,
        "external_id": url,
        "title": title or f"{name} item",
        "url": url,
        "published_at": moment.date().isoformat(),
        "payload": {},
        "fetched_at": moment,
        "source_key": source_key,
        "run_id": None,
        "status": status,
        "stage": stage,
        "reason_code": reason_code,
        "reason_text": reason_text,
        "score": 0,
        "event_id": None,
        "event_fingerprint": event_fingerprint,
        "first_seen_at": moment,
        "last_seen_at": moment,
        "seen_count": 1,
        "decided_at": None if status == "pending" else moment,
    }


async def seed_library(db_factory) -> dict[str, str]:
    """Three rows that exercise each filter: admitted, excluded, dropped."""
    rows = [
        item_row(
            name="OpenAI News",
            url="https://openai.com/news/gpt-5",
            status="admitted",
            reason_code="admitted",
            title="GPT-5 ships to the API",
            event_fingerprint=EVENT_FP,
        ),
        item_row(
            name="TechCrunch",
            url="https://techcrunch.com/2026/10/20/funding-round",
            status="excluded",
            reason_code="rule:funding",
            source_key="techcrunch",
            family="media",
            title="A vendor raises another round",
            reason_text="硬性排除：融资与估值",
        ),
        item_row(
            name="OpenAI News",
            url="https://openai.com/news/stale-post",
            status="dropped",
            stage="normalize",
            reason_code="window_age",
            title="An old post outside the window",
        ),
    ]
    async with db_factory() as session:
        await repo_events.upsert_collected(session, rows)
        session.add(
            ReviewDecision(
                id=EVENT_FP,
                fingerprint=EVENT_FP,
                rubric_version=RUBRIC_VERSION,
                decision="include",
                score=88,
                include_votes=5,
                valid_votes=5,
                votes=[
                    {
                        "judge": index,
                        "model": f"judge/{index}",
                        "score": 88,
                        "vote": "include",
                        "reason": "stub",
                        "flags": [],
                    }
                    for index in range(1, 6)
                ],
                title="GPT-5 ships to the API",
                category="model",
                source_count=1,
                decision_source="panel",
                decided_at=NOW,
            )
        )
        session.add(
            CollectVerdict(
                id=uuid.uuid4(),
                item_fingerprint=rows[0]["fingerprint"],
                stage="panel",
                status="admitted",
                reason_code="admitted",
                reason_text="已纳入",
                score=88,
                event_fingerprint=EVENT_FP,
                at=NOW,
            )
        )
        await session.commit()
    return {"admitted": rows[0]["fingerprint"], "excluded": rows[1]["fingerprint"]}


async def get(client, path: str):
    response = await client.get(path)
    assert response.status_code == 200, response.text
    return response.json()


async def sign_in(client, user: str = "admin") -> None:
    response = await client.post(
        "/api/v1/admin/login", json={"user": user, "password": PASSWORD}, headers=CSRF
    )
    assert response.status_code == 200, response.text


async def make_user(db_factory, username: str, role: str) -> None:
    async with db_factory() as session:
        await repo_admin.create_user(
            session, username=username, password_hash=PASSWORD_HASH, role=role
        )
        await session.commit()


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


async def test_the_list_is_unfiltered_by_default(db_factory, admin_settings):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        body = await get(client, "/api/v1/admin/library?days=7")

    assert body["total"] == 3
    assert {row["status"] for row in body["items"]} == {"admitted", "excluded", "dropped"}
    first = next(row for row in body["items"] if row["status"] == "admitted")
    assert first["reasonCode"] == "admitted"
    assert first["reasonLabel"] == "已纳入"
    assert first["eventFingerprint"] == EVENT_FP
    assert first["sourceFamily"] == "official"


async def test_the_status_and_reason_filters_narrow_the_set(db_factory, admin_settings):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        excluded = await get(client, "/api/v1/admin/library?status=excluded&days=7")
        ruled = await get(client, "/api/v1/admin/library?reason=rule:&days=7")
        by_source = await get(client, "/api/v1/admin/library?sourceKey=techcrunch&days=7")

    assert excluded["total"] == 1
    assert excluded["items"][0]["reasonLabel"].startswith("硬性排除")
    assert ruled["total"] == 1, "a reason prefix matches every hard rule at once"
    assert by_source["total"] == 1


async def test_the_keyword_search_covers_title_and_url(db_factory, admin_settings):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        by_title = await get(client, "/api/v1/admin/library?q=GPT-5&days=7")
        by_url = await get(client, "/api/v1/admin/library?q=funding-round&days=7")
        nothing = await get(client, "/api/v1/admin/library?q=zzz-nothing&days=7")

    assert by_title["total"] == 1
    assert by_url["total"] == 1
    assert nothing["total"] == 0
    assert nothing["items"] == []


async def test_paging_and_the_window_are_bounded(db_factory, admin_settings):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        page1 = await get(client, "/api/v1/admin/library?size=2&page=1&days=7")
        page2 = await get(client, "/api/v1/admin/library?size=2&page=2&days=7")
        wide = await get(client, "/api/v1/admin/library?days=7&size=100")
        too_big = await client.get("/api/v1/admin/library?size=101")
        zero_days = await client.get("/api/v1/admin/library?days=0")

    assert len(page1["items"]) == 2 and len(page2["items"]) == 1
    assert page1["total"] == page2["total"] == 3
    assert len(wide["items"]) == 3
    assert too_big.status_code == 422, "the page size is capped server-side"
    assert zero_days.status_code == 422


async def test_rows_older_than_the_window_are_hidden(db_factory, admin_settings):
    async with db_factory() as session:
        await repo_events.upsert_collected(
            session,
            [
                item_row(
                    name="Old Source",
                    url="https://example.com/ancient",
                    status="dropped",
                    stage="normalize",
                    reason_code="window_age",
                    last_seen=NOW - timedelta(days=30),
                )
            ],
        )
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        assert (await get(client, "/api/v1/admin/library?days=7"))["total"] == 0
        assert (await get(client, "/api/v1/admin/library?days=90"))["total"] == 1


async def test_the_summary_matches_the_list(db_factory, admin_settings):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        listing = await get(client, "/api/v1/admin/library?days=7")
        summary = await get(client, "/api/v1/admin/library/summary?days=7")

    assert summary["summary"] == listing["summary"]
    assert summary["summary"]["byStatus"] == {"admitted": 1, "dropped": 1, "excluded": 1}
    assert summary["summary"]["total"] == 3


async def test_the_reason_endpoint_reports_counts_and_the_whole_vocabulary(
    db_factory, admin_settings
):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        body = await get(client, "/api/v1/admin/library/reasons")

    codes = {row["code"]: row for row in body["items"]}
    assert codes["window_age"]["count"] == 1
    assert codes["window_age"]["label"] == "超出时间窗"
    vocabulary = {row["code"] for row in body["vocabulary"]}
    assert {"window_age", "cap_raw", "panel:hold", "admitted"} <= vocabulary
    assert "score_low" in vocabulary


async def test_the_funnel_reports_the_window_and_the_last_run(db_factory, admin_settings):
    await seed_library(db_factory)
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        body = await get(client, "/api/v1/admin/library/funnel?days=7")

    assert body["latest"]["funnel"] == {}, "no run has happened in this fixture"
    by_source = {row["key"]: row for row in body["bySource"]}
    assert by_source["openai"]["total"] == 2
    assert by_source["techcrunch"]["excluded"] == 1


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------


async def test_the_detail_joins_the_trail_and_the_ballot(db_factory, admin_settings):
    fingerprints = await seed_library(db_factory)
    async with db_factory() as session:
        rows = (await session.execute(select(RawItem))).scalars().all()
    item = next(row for row in rows if row.fingerprint == fingerprints["admitted"])

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        body = await get(client, f"/api/v1/admin/library/{item.id}")

    assert body["item"]["id"] == str(item.id)
    assert body["item"]["title"] == "GPT-5 ships to the API"
    assert body["item"]["reasonLabel"] == "已纳入"
    assert len(body["verdicts"]) == 1
    assert body["verdicts"][0]["stage"] == "panel"
    assert body["review"]["rubricVersion"] == RUBRIC_VERSION
    assert body["review"]["decision"] == "include"
    assert body["review"]["validVotes"] == 5
    assert len(body["review"]["votes"]) == 5


async def test_an_item_without_a_ballot_still_answers(db_factory, admin_settings):
    fingerprints = await seed_library(db_factory)
    async with db_factory() as session:
        rows = (await session.execute(select(RawItem))).scalars().all()
    item = next(row for row in rows if row.fingerprint == fingerprints["excluded"])

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        body = await get(client, f"/api/v1/admin/library/{item.id}")

    assert body["review"] is None, "a hard rule rejects before the panel"
    assert body["item"]["reasonLabel"].startswith("硬性排除")
    assert body["item"]["reasonText"] == "硬性排除：融资与估值"


async def test_a_malformed_or_unknown_id_is_reported(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        bad = await client.get("/api/v1/admin/library/not-a-uuid")
        missing = await client.get(f"/api/v1/admin/library/{uuid.uuid4()}")

    assert bad.status_code == 400
    assert bad.json()["detail"] == "invalid_item_id"
    assert missing.status_code == 404


# ---------------------------------------------------------------------------
# Who may read
# ---------------------------------------------------------------------------


async def test_an_analyst_may_audit_but_not_write(db_factory, admin_settings):
    await seed_library(db_factory)
    await make_user(db_factory, "ana", "analyst")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client, "ana")
        assert (await client.get("/api/v1/admin/library?days=7")).status_code == 200
        assert (await client.get("/api/v1/admin/library/reasons")).status_code == 200
        # Read-only surface: the write verbs must not exist at all.
        assert (await client.post("/api/v1/admin/library", headers=CSRF)).status_code in (
            404,
            405,
        )


async def test_an_anonymous_request_is_rejected(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await client.get("/api/v1/admin/library?days=7")
    assert response.status_code == 401
