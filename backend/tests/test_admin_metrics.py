"""Console metrics: the numbers and the alert conditions.

`repo_ops` is the only place a metric is defined, so this file is the contract
for the definitions themselves as much as for the HTTP shapes: PV is a row count
of non-bot beacons, UV is `count(distinct visitor_hash)` within one UTC+8 day,
and the crawl series is a different table that is never added to either.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from argon2 import PasswordHasher

from app import auth
from app.analytics import local_day
from app.config import Settings
from app.db.models import ApiKey, ApiKeyUsage, PageView, SourceHealth, Subscriber, SyncState
from app.ingest.sources import SOURCES

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
        editorial_judge_base="",
        editorial_judge_key="",
        editorial_judge_models="",
        _env_file=None,
    )


async def fetch_overview(db_factory, settings, **params):
    async with client_for(db_factory, settings, scheme="https") as client:
        await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}, headers=CSRF
        )
        query = "&".join(f"{key}={value}" for key, value in params.items())
        response = await client.get(f"/api/v1/admin/overview?{query}" if query else "/api/v1/admin/overview")
        assert response.status_code == 200, response.text
        return response.json()


def alert_codes(body) -> set[str]:
    return {alert["code"] for alert in body["alerts"]}


def beacon(day: str, visitor: str, *, path: str = "/", bot: bool = False) -> PageView:
    return PageView(
        id=uuid.uuid4(),
        at=datetime.now(timezone.utc),
        day=day,
        path=path,
        page_kind="home",
        channel="direct",
        visitor_hash=visitor,
        session_hash=visitor,
        ua_family="chrome",
        is_bot=bot,
        device="desktop",
        lang="zh",
    )


# ---------------------------------------------------------------------------
# Content counters
# ---------------------------------------------------------------------------


async def test_content_counters_match_the_seed(db_factory, admin_settings, seeded_db):
    body = await fetch_overview(db_factory, admin_settings)
    content = body["content"]

    assert content["total"] == 158
    # Curated seed rows ship already admitted, and are the only origin present.
    assert content["admitted"] == 158
    assert content["legacy"] == 0
    assert content["live"] == 158
    assert content["hold"] == 0
    assert content["excluded"] == 0
    assert content["byOrigin"] == [{"key": "seed", "count": 158}]


async def test_health_flags_rows_that_cannot_be_cited(db_factory, admin_settings, seeded_db):
    body = await fetch_overview(db_factory, admin_settings)
    health = body["health"]
    assert set(health) == {"unslugged", "sourceless", "ungated", "uncategorized"}
    assert health["ungated"] == 0, "every seed row carries a verdict"
    assert all(value >= 0 for value in health.values())


async def test_sources_lists_the_whole_registry(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}, headers=CSRF
        )
        response = await client.get("/api/v1/admin/sources")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == len(SOURCES)
    assert {item["key"] for item in body["items"]} == {source["key"] for source in SOURCES}
    # A source that has never run is still listed, at zero.
    assert all(item["totalRuns"] == 0 for item in body["items"])


# ---------------------------------------------------------------------------
# Traffic
# ---------------------------------------------------------------------------


async def test_pv_counts_rows_and_uv_counts_distinct_visitors(db_factory, admin_settings):
    day = local_day(datetime.now(timezone.utc))
    async with db_factory() as session:
        session.add_all(
            [
                beacon(day, "visitor-a"),
                beacon(day, "visitor-a"),  # same person, second page view
                beacon(day, "visitor-b"),
                beacon(day, "visitor-c", bot=True),  # crawler running the SPA
            ]
        )
        await session.commit()

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}, headers=CSRF
        )
        response = await client.get("/api/v1/admin/traffic?days=7")
        assert response.status_code == 200
        body = response.json()

    series = {item["day"]: item for item in body["beacon"]["series"]}
    assert series[day]["pv"] == 3, "the bot row must not count as a page view"
    assert series[day]["uv"] == 2
    # Every day in the window is present, so the line has no gaps.
    assert len(series) == 7
    assert body["crawl"]["hits"] == 0
    assert "不可相加" in body["note"]


async def test_crawl_and_beacon_are_reported_separately(db_factory, admin_settings):
    from app.db.models import CrawlHit

    day = local_day(datetime.now(timezone.utc))
    async with db_factory() as session:
        session.add(beacon(day, "visitor-a"))
        session.add(
            CrawlHit(
                id=uuid.uuid4(),
                at=datetime.now(timezone.utc),
                day=day,
                path="/e/some-slug.html",
                status=200,
                ua_family="gptbot",
                bot_name="GPTBot",
                is_ai=True,
                bytes=1200,
            )
        )
        await session.commit()

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}, headers=CSRF
        )
        body = (await client.get("/api/v1/admin/traffic?days=7")).json()

    assert body["beacon"]["series"][-1]["pv"] == 1
    assert body["crawl"]["hits"] == 1
    assert body["crawl"]["aiHits"] == 1
    assert body["crawl"]["byBot"] == [{"key": "GPTBot", "count": 1}]

    # The overview reads the beacon series only; a crawl hit is not a page view.
    overview = await fetch_overview(db_factory, admin_settings)
    assert overview["traffic"]["today"]["pv"] == 1


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


async def test_no_successful_run_yet_is_an_alert(db_factory, admin_settings):
    body = await fetch_overview(db_factory, admin_settings)
    assert "never_succeeded" in alert_codes(body)


async def test_a_stale_last_success_raises_a_warning(db_factory, admin_settings):
    # 30 hours: past the daily cadence (01:05) plus the two hours of grace, i.e. a
    # whole missed day. Anything smaller would flag a healthy schedule.
    async with db_factory() as session:
        session.add(
            SyncState(
                id="global",
                last_attempt_at=datetime.now(timezone.utc) - timedelta(hours=30),
                last_success_at=datetime.now(timezone.utc) - timedelta(hours=30),
                last_status="succeeded",
                updated_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()

    body = await fetch_overview(db_factory, admin_settings)
    codes = alert_codes(body)
    assert "stale" in codes
    assert "never_succeeded" not in codes


async def test_yesterdays_success_is_not_an_alert(db_factory, admin_settings):
    """Collection is daily, so 20 hours of silence is the normal state, not a warning."""
    async with db_factory() as session:
        session.add(
            SyncState(
                id="global",
                last_attempt_at=datetime.now(timezone.utc) - timedelta(hours=20),
                last_success_at=datetime.now(timezone.utc) - timedelta(hours=20),
                last_status="succeeded",
                updated_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()

    body = await fetch_overview(db_factory, admin_settings)
    assert "stale" not in alert_codes(body)


async def test_a_repeatedly_failing_source_is_an_alert(db_factory, admin_settings):
    key = SOURCES[0]["key"]
    async with db_factory() as session:
        session.add(
            SourceHealth(
                key=key,
                name=SOURCES[0]["name"],
                family=SOURCES[0]["family"],
                last_error="timeout",
                consecutive_failures=4,
                total_runs=10,
                total_failures=4,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()

    body = await fetch_overview(db_factory, admin_settings)
    assert "sources_failing" in alert_codes(body)
    failing = next(item for item in body["sources"] if item["key"] == key)
    assert failing["consecutiveFailures"] == 4
    assert failing["lastError"] == "timeout"


async def test_a_hold_backlog_is_an_alert(db_factory, admin_settings, seeded_db):
    from sqlalchemy import select as sa_select

    from app.db.models import Event

    async with db_factory() as session:
        rows = (await session.execute(sa_select(Event).limit(21))).scalars().all()
        for row in rows:
            row.editorial_status = "hold"
        await session.commit()

    body = await fetch_overview(db_factory, admin_settings)
    codes = alert_codes(body)
    assert "holds_backlog" in codes
    assert "unslugged" in codes or body["health"]["unslugged"] == 0


async def test_an_unconfigured_panel_is_a_danger_alert(db_factory, admin_settings):
    """Fail-closed: no panel means every candidate is held, so say so loudly."""
    body = await fetch_overview(db_factory, admin_settings)
    assert "panel_unconfigured" in alert_codes(body)
    assert body["panel"]["configured"] is False


async def test_a_missing_access_log_is_reported_but_not_fatal(db_factory, admin_settings):
    body = await fetch_overview(db_factory, admin_settings)
    assert "crawl_unconfigured" in alert_codes(body)


async def test_pending_subscribers_and_exhausted_keys_are_flagged(db_factory, admin_settings):
    today = local_day(datetime.now(timezone.utc))
    async with db_factory() as session:
        session.add(
            Subscriber(
                id=uuid.uuid4(),
                email="reader@example.com",
                status="pending",
                token="tok-1",
                source_path="/",
                source_channel="direct",
                consented_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
            )
        )
        key = ApiKey(
            id=uuid.uuid4(),
            name="client",
            prefix="aih_",
            key_hash="a" * 64,
            scopes=["read"],
            monthly_quota=10,
            active=True,
            created_by="admin",
            created_at=datetime.now(timezone.utc),
        )
        session.add(key)
        await session.flush()
        session.add(
            ApiKeyUsage(
                id=uuid.uuid4(), key_id=key.id, day=today, requests=10, errors=0
            )
        )
        await session.commit()

    body = await fetch_overview(db_factory, admin_settings)
    codes = alert_codes(body)
    assert "subscribers_pending" in codes
    assert "keys_over_quota" in codes
    assert body["keys"] == {"overQuota": 1, "total": 1}
    assert body["subscribers"]["total"] == 1


async def test_every_alert_points_somewhere(db_factory, admin_settings):
    body = await fetch_overview(db_factory, admin_settings)
    assert body["alerts"], "the default empty instance should still have advice"
    for alert in body["alerts"]:
        assert set(alert) == {"code", "level", "message", "href"}
        assert alert["href"].startswith("#/")
        assert alert["level"] in ("info", "warn", "danger")


async def test_the_range_parameter_is_validated(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}, headers=CSRF
        )
        assert (await client.get("/api/v1/admin/overview?days=0")).status_code == 422
        assert (await client.get("/api/v1/admin/overview?days=91")).status_code == 422
        assert (await client.get("/api/v1/admin/overview?days=30")).status_code == 200
