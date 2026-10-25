"""Console identity: the three-role matrix, throttling, and bootstrap.

`test_admin_api.py` covers the single-account behaviour that predates roles and
must keep working. This file covers what roles added, plus the escape hatches
(the env account, the in-process lock, the legacy cookie) that stop a bad deploy
from locking the operator out of their own console.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from argon2 import PasswordHasher

from app import auth
from app.config import Settings
from app.db import repo_admin

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
CSRF = {"X-Requested-With": "admin"}

# One hash, reused: argon2 is deliberately slow and the password never varies
# between the accounts these tests create.
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)


@pytest.fixture(autouse=True)
def clear_throttle():
    """The failure ledger is module state; a leftover lock would poison a case."""
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


async def make_user(db_factory, username: str, role: str, *, active: bool = True) -> None:
    async with db_factory() as session:
        row = await repo_admin.create_user(
            session, username=username, password_hash=PASSWORD_HASH, role=role
        )
        if not active:
            row.active = False
        await session.commit()


async def sign_in(client, username: str, password: str = PASSWORD):
    return await client.post(
        "/api/v1/admin/login", json={"user": username, "password": password}, headers=CSRF
    )


# ---------------------------------------------------------------------------
# Role matrix
# ---------------------------------------------------------------------------


async def test_analyst_reads_but_may_not_collect(db_factory, admin_settings):
    await make_user(db_factory, "ana", "analyst")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        assert (await sign_in(client, "ana")).status_code == 200
        session = (await client.get("/api/v1/admin/session")).json()
        assert session["role"] == "analyst"
        assert session["permissions"] == ["read"]

        assert (await client.get("/api/v1/admin/overview")).status_code == 200
        assert (await client.get("/api/v1/admin/events")).status_code == 200

        denied = await client.post("/api/v1/admin/sync", headers=CSRF)
        assert denied.status_code == 403
        assert denied.json()["detail"] == "forbidden"
        assert denied.headers["x-required-permission"] == "sync"


async def test_editor_collects_and_decides_but_may_not_manage(db_factory, admin_settings, monkeypatch):
    calls: list[str] = []

    async def fake_run_sync(session, *, trigger="manual", **kwargs):
        calls.append(trigger)
        return {"ok": True}

    monkeypatch.setattr("app.api.admin.run_sync", fake_run_sync)
    await make_user(db_factory, "edi", "editor")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        assert (await sign_in(client, "edi")).status_code == 200
        accepted = await client.post("/api/v1/admin/sync", headers=CSRF)
        assert accepted.status_code == 202

        audit = await client.get("/api/v1/admin/audit")
        assert audit.status_code == 403, "manage is owner-only"

        session = (await client.get("/api/v1/admin/session")).json()
        assert session["permissions"] == ["read", "sync", "decide"]


async def test_owner_may_read_the_audit_log(db_factory, admin_settings):
    await make_user(db_factory, "boss", "owner")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client, "boss")
        audit = await client.get("/api/v1/admin/audit")
        assert audit.status_code == 200
        body = audit.json()
        assert body["ok"] is True
        assert any(item["action"] == "login" for item in body["items"])


# ---------------------------------------------------------------------------
# Escape hatches
# ---------------------------------------------------------------------------


async def test_env_account_still_owns_the_console_alongside_db_users(db_factory, admin_settings):
    """The env account is the bootstrap path: it must work even with rows present."""
    await make_user(db_factory, "ana", "analyst")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await sign_in(client, "admin")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "user": "admin"}
        session = (await client.get("/api/v1/admin/session")).json()
        assert session["role"] == "owner"
        assert session["permissions"] == ["read", "sync", "decide", "manage"]


def test_a_cookie_from_before_roles_reads_as_owner(admin_settings):
    legacy = auth.serializer(admin_settings).dumps({"user": "old-operator"})
    principal = auth.read_session(admin_settings, legacy)
    assert principal == auth.AdminPrincipal("old-operator", "owner")


def test_an_unknown_role_degrades_to_analyst(admin_settings):
    """A renamed role must not hand out leftover grants."""
    weird = auth.serializer(admin_settings).dumps({"u": "x", "r": "wizard", "v": 1})
    principal = auth.read_session(admin_settings, weird)
    assert principal is not None
    assert principal.role == "analyst"
    assert principal.permissions == ["read"]


# ---------------------------------------------------------------------------
# Lockout
# ---------------------------------------------------------------------------


async def test_five_misses_lock_the_account_out(db_factory, admin_settings):
    await make_user(db_factory, "ana", "analyst")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        for attempt in range(auth.LOGIN_MAX_FAILURES):
            response = await sign_in(client, "ana", "not-the-password")
            assert response.status_code == 401, f"attempt {attempt}"

        locked = await sign_in(client, "ana", PASSWORD)
        assert locked.status_code == 429
        assert locked.json()["detail"] == "too_many_attempts"
        assert int(locked.headers["retry-after"]) > 0


async def test_a_successful_login_clears_the_counter(db_factory, admin_settings):
    await make_user(db_factory, "ana", "analyst")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        for _ in range(auth.LOGIN_MAX_FAILURES - 1):
            assert (await sign_in(client, "ana", "nope")).status_code == 401
        assert (await sign_in(client, "ana", PASSWORD)).status_code == 200
        assert auth.lock_remaining("ana", "testclient") == 0
        assert (await sign_in(client, "ana", "nope")).status_code == 401


async def test_a_disabled_account_is_refused(db_factory, admin_settings):
    await make_user(db_factory, "gone", "editor", active=False)

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await sign_in(client, "gone")
    assert response.status_code == 403
    assert response.json()["detail"] == "account_disabled"


# ---------------------------------------------------------------------------
# Password
# ---------------------------------------------------------------------------


async def test_owner_can_change_their_own_password(db_factory, admin_settings):
    await make_user(db_factory, "boss", "owner")
    new_password = "a completely different passphrase"

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client, "boss")

        wrong = await client.post(
            "/api/v1/admin/password",
            json={"currentPassword": "nope", "newPassword": new_password},
            headers=CSRF,
        )
        assert wrong.status_code == 401

        short = await client.post(
            "/api/v1/admin/password",
            json={"currentPassword": PASSWORD, "newPassword": "short"},
            headers=CSRF,
        )
        assert short.status_code == 400
        assert short.json()["detail"] == "password_too_short"

        changed = await client.post(
            "/api/v1/admin/password",
            json={"currentPassword": PASSWORD, "newPassword": new_password},
            headers=CSRF,
        )
        assert changed.status_code == 200

        assert (await sign_in(client, "boss", PASSWORD)).status_code == 401
        assert (await sign_in(client, "boss", new_password)).status_code == 200


async def test_the_env_account_cannot_rewrite_its_own_hash(db_factory, admin_settings):
    """Its hash lives in the environment; accepting a change would silently no-op."""

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client, "admin")
        response = await client.post(
            "/api/v1/admin/password",
            json={"currentPassword": PASSWORD, "newPassword": "another long passphrase"},
            headers=CSRF,
        )
    assert response.status_code == 409
    assert response.json()["detail"] == "env_account"


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


async def test_bootstrap_inserts_one_owner_and_is_idempotent(db_factory, admin_settings):
    async with db_factory() as session:
        assert await auth.ensure_bootstrap_owner(session, admin_settings) == "admin"
        assert await auth.ensure_bootstrap_owner(session, admin_settings) is None
        assert await repo_admin.count_users(session) == 1

        row = await repo_admin.find_user(session, "admin")
        assert row is not None
        assert row.role == "owner"
        assert row.active is True


async def test_bootstrap_does_nothing_without_a_configured_hash(db_factory, test_settings):
    async with db_factory() as session:
        assert await auth.ensure_bootstrap_owner(session, test_settings) is None
        assert await repo_admin.count_users(session) == 0


async def test_bootstrap_leaves_an_existing_table_alone(db_factory, admin_settings):
    await make_user(db_factory, "ana", "analyst")

    async with db_factory() as session:
        assert await auth.ensure_bootstrap_owner(session, admin_settings) is None
        assert await repo_admin.count_users(session) == 1
