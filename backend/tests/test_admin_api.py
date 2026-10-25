"""Admin console: session handling, manual sync, run history, held queue.

Collection is decoupled from page views, so this surface is the only way a
human can start a run. It therefore has to be locked down precisely: no
session means 401, a session without the CSRF header means 403.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select

from app.config import Settings
from app.db.models import Event, SyncRun

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
CSRF = {"X-Requested-With": "admin"}


@pytest.fixture(scope="module")
def password_hash() -> str:
    return PasswordHasher().hash(PASSWORD)


@pytest.fixture
def admin_settings(password_hash) -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        admin_user="admin",
        admin_password_hash=password_hash,
        site_origin="https://aihist.net",
        editorial_judge_base="",
        editorial_judge_key="",
        editorial_judge_models="",
        _env_file=None,
    )


async def wait_for_runs(db_factory, expected: int, timeout: float = 30.0) -> list[SyncRun]:
    """The endpoint returns 202 immediately; the row appears a little later."""
    deadline = asyncio.get_running_loop().time() + timeout
    observed: list[SyncRun] = []
    while asyncio.get_running_loop().time() < deadline:
        async with db_factory() as session:
            observed = list((await session.execute(select(SyncRun))).scalars().all())
            if len(observed) >= expected and all(run.finished_at for run in observed):
                return observed
        await asyncio.sleep(0.05)
    detail = [(str(run.id), run.status, run.finished_at) for run in observed]
    raise AssertionError(f"expected {expected} finished runs, timed out; saw {detail}")


async def login(client) -> None:
    response = await client.post(
        "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}, headers=CSRF
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


async def test_login_is_unavailable_without_a_configured_hash(db_factory, test_settings):
    async with client_for(db_factory, test_settings, scheme="https") as client:
        response = await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}
        )
    assert response.status_code == 503
    assert response.json()["detail"] == "admin_not_configured"


async def test_login_rejects_a_wrong_password(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": "wrong"}
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_credentials"


async def test_login_rejects_a_wrong_user(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await client.post(
            "/api/v1/admin/login", json={"user": "someone", "password": PASSWORD}
        )
    assert response.status_code == 401


async def test_login_sets_a_hardened_cookie(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await client.post(
            "/api/v1/admin/login", json={"user": "admin", "password": PASSWORD}
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True, "user": "admin"}

        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "secure" in cookie
        assert "samesite=lax" in cookie
        assert "max-age=43200" in cookie

        session = await client.get("/api/v1/admin/session")
        assert session.status_code == 200
        assert session.json()["user"] == "admin"


async def test_logout_clears_the_session(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        response = await client.post("/api/v1/admin/logout", headers=CSRF)
        assert response.status_code == 200
        assert (await client.get("/api/v1/admin/session")).status_code == 401


# ---------------------------------------------------------------------------
# Guard rails
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/v1/admin/sync"),
        ("post", "/api/v1/admin/logout"),
        ("get", "/api/v1/admin/session"),
        ("get", "/api/v1/admin/runs"),
        ("get", "/api/v1/admin/holds"),
    ],
)
async def test_every_admin_endpoint_requires_a_session(db_factory, admin_settings, method, path):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await getattr(client, method)(path, headers=CSRF)
    assert response.status_code == 401


async def test_writes_require_the_csrf_header(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        response = await client.post("/api/v1/admin/sync")
        assert response.status_code == 403
        assert response.json()["detail"] == "missing_request_header"


# ---------------------------------------------------------------------------
# Manual sync
# ---------------------------------------------------------------------------


async def test_sync_returns_202_and_records_a_run(db_factory, admin_settings, monkeypatch):
    """A real run would hit the network, so the pipeline is stubbed out."""

    seen: list[str] = []

    async def fake_run_sync(session, *, trigger="manual", **kwargs):
        seen.append(trigger)
        from app.db import repo_sync

        run_id = kwargs.get("run_id")
        await repo_sync.start_run(session, run_id=run_id, trigger=trigger, now=repo_sync.utc_now())
        await repo_sync.finish_run(
            session,
            run_id,
            {
                "status": "succeeded",
                "rawCount": 0,
                "createdCount": 0,
                "mergedCount": 0,
                "failedSources": [],
                "notes": "stubbed",
            },
        )
        await session.commit()
        return {"ok": True, "busy": False, "status": "succeeded", "runId": str(run_id)}

    monkeypatch.setattr("app.api.admin.run_sync", fake_run_sync)

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        response = await client.post("/api/v1/admin/sync?trigger=manual", headers=CSRF)
        assert response.status_code == 202
        body = response.json()
        assert body["triggered"] is True
        assert body["status"] == "running"
        assert body["runId"]
        assert body["result"] is None

        runs = await wait_for_runs(db_factory, 1)

    assert seen == ["manual"], "the background task must run the real pipeline entry point"
    assert runs[0].trigger == "manual"
    assert runs[0].notes == "stubbed"


async def test_auto_sync_is_a_no_op_when_recently_successful(
    db_factory, admin_settings, monkeypatch
):
    import uuid

    async def explode(*args, **kwargs):  # pragma: no cover - must not run
        raise AssertionError("the cron path must not start a run that is not due")

    monkeypatch.setattr("app.api.admin.run_sync", explode)

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        # Simulate cron: the lease is free but the last success is fresh.
        from app.db import repo_sync

        async with db_factory() as session:
            now = repo_sync.utc_now()
            run_id = uuid.uuid4()
            await repo_sync.acquire_lease(
                session,
                None,
                run_id=run_id,
                token="t",
                now=now,
                trigger="manual",
            )
            await repo_sync.release_lease(session, "t", run_id, status="succeeded")
            await session.commit()

        response = await client.post("/api/v1/admin/sync?trigger=auto", headers=CSRF)
        assert response.status_code == 202
        body = response.json()
        assert body["triggered"] is False
        assert body["status"] == "not_due"
        assert body["runId"] is None


async def test_sync_rejects_an_unknown_trigger(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        response = await client.post("/api/v1/admin/sync?trigger=sometimes", headers=CSRF)
    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_trigger"


async def test_sync_conflicts_with_a_held_lease(db_factory, admin_settings):
    import uuid

    from app.db import repo_sync

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        async with db_factory() as session:
            await repo_sync.acquire_lease(
                session,
                None,
                run_id=uuid.uuid4(),
                token="holder",
                now=repo_sync.utc_now(),
                trigger="manual",
            )
            await session.commit()

        response = await client.post("/api/v1/admin/sync?trigger=manual", headers=CSRF)

    assert response.status_code == 409
    assert response.json()["detail"] == "sync_busy"
    assert response.headers["retry-after"] == "20"


# ---------------------------------------------------------------------------
# Read-only views
# ---------------------------------------------------------------------------


async def test_runs_lists_recent_history(db_factory, admin_settings):
    import uuid

    from app.db import repo_sync

    async with db_factory() as session:
        for index in range(3):
            run_id = uuid.uuid4()
            await repo_sync.start_run(
                session, run_id=run_id, trigger="manual", now=repo_sync.utc_now()
            )
            await repo_sync.finish_run(
                session,
                run_id,
                {
                    "status": "succeeded",
                    "rawCount": index,
                    "createdCount": 0,
                    "mergedCount": 0,
                    "failedSources": [],
                    "notes": None,
                },
            )
        await session.commit()

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        response = await client.get("/api/v1/admin/runs")
        limited = await client.get("/api/v1/admin/runs?limit=2")
        bad = await client.get("/api/v1/admin/runs?limit=0")

    body = response.json()
    assert body["ok"] is True
    assert len(body["runs"]) == 3
    assert set(body["runs"][0]) == {
        "id",
        "trigger",
        "status",
        "startedAt",
        "finishedAt",
        "rawCount",
        "createdCount",
        "mergedCount",
        "failedSources",
        "notes",
    }
    assert len(limited.json()["runs"]) == 2
    assert bad.status_code == 400


async def test_holds_lists_only_held_entries(db_factory, admin_settings, seeded_db):
    from sqlalchemy import update

    async with db_factory() as session:
        rows = (await session.execute(select(Event).limit(3))).scalars().all()
        for row in rows:
            row.editorial_status = "hold"
            row.editorial_review = {
                "version": "chronicle-v1",
                "source": "deferred",
                "decision": "hold",
                "score": 42,
                "votes": [],
            }
        await session.execute(
            update(Event)
            .where(Event.id.notin_([row.id for row in rows]))
            .values(editorial_status="admitted")
        )
        await session.commit()

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await login(client)
        response = await client.get("/api/v1/admin/holds")

    body = response.json()
    assert body["ok"] is True
    assert body["total"] == 3
    assert len(body["items"]) == 3
    first = body["items"][0]
    assert set(first) == {
        "id",
        "slug",
        "title",
        "category",
        "sortDate",
        "sourceCount",
        "score",
        "decision",
        "votes",
        "notes",
    }
    assert first["score"] == 42
    assert first["decision"] == "hold"
    assert first["notes"] == "deferred"
