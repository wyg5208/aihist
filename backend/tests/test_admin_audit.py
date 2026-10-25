"""Audit trail: every write lands one row, and no row can carry a secret.

The table is the answer to "who retired this entry and why". That is only worth
something if it is complete (a decision without a row is a decision nobody can
attribute) and if it is safe to render back to the console (a password in
`detail` would be shown to every owner forever).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select

from app import audit, auth
from app.config import Settings
from app.db import repo_admin
from app.db.models import AuditLog

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


async def rows(db_factory) -> list[AuditLog]:
    async with db_factory() as session:
        result = await session.execute(select(AuditLog).order_by(AuditLog.at))
        return list(result.scalars().all())


async def sign_in(client, user: str = "admin", password: str = PASSWORD):
    return await client.post(
        "/api/v1/admin/login", json={"user": user, "password": password}, headers=CSRF
    )


# ---------------------------------------------------------------------------
# Scrubbing (pure)
# ---------------------------------------------------------------------------


def test_secret_shaped_keys_are_redacted_at_any_depth():
    cleaned = audit.scrub(
        {
            "password": "hunter2",
            "nested": {"apiKey": "sk-live", "token": "abc"},
            "list": [{"secretValue": "s"}],
            "note": "kept",
            "count": 3,
        }
    )
    assert cleaned["password"] == "[redacted]"
    assert cleaned["nested"]["apiKey"] == "[redacted]"
    assert cleaned["nested"]["token"] == "[redacted]"
    assert cleaned["list"][0]["secretValue"] == "[redacted]"
    assert cleaned["note"] == "kept"
    assert cleaned["count"] == 3


def test_scrub_coerces_anything_into_json():
    """A datetime or an object must not blow up the caller's commit."""
    cleaned = audit.scrub({"stamp": object(), "long": "x" * 900, "none": None})
    assert isinstance(cleaned["stamp"], str)
    assert len(cleaned["long"]) == audit.MAX_STRING
    assert cleaned["none"] is None


# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------


async def test_a_login_leaves_a_row_with_a_hashed_address(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        assert (await sign_in(client)).status_code == 200

    written = await rows(db_factory)
    assert [row.action for row in written] == ["login"]
    entry = written[0]
    assert entry.actor == "admin"
    assert entry.role == "owner"
    # 64 hex characters, and emphatically not the client address itself.
    assert len(entry.ip_hash) == 64
    assert "testclient" not in entry.ip_hash
    int(entry.ip_hash, 16)  # raises if it is not hex


async def test_triggering_a_run_is_audited(db_factory, admin_settings, monkeypatch):
    async def fake_run_sync(session, *, trigger="manual", **kwargs):
        return {"ok": True}

    monkeypatch.setattr("app.api.admin.run_sync", fake_run_sync)

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        assert (await client.post("/api/v1/admin/sync", headers=CSRF)).status_code == 202

    actions = [row.action for row in await rows(db_factory)]
    assert "login" in actions
    assert "sync.trigger" in actions
    sync_row = next(row for row in await rows(db_factory) if row.action == "sync.trigger")
    assert sync_row.target_type == "sync_run"
    assert sync_row.detail["trigger"] == "manual"


async def test_a_password_change_is_audited_without_the_password(
    db_factory, admin_settings
):
    async with db_factory() as session:
        await repo_admin.create_user(
            session, username="boss", password_hash=PASSWORD_HASH, role="owner"
        )
        await session.commit()

    new_password = "a completely different passphrase"
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client, "boss")
        changed = await client.post(
            "/api/v1/admin/password",
            json={"currentPassword": PASSWORD, "newPassword": new_password},
            headers=CSRF,
        )
        assert changed.status_code == 200

    entry = next(row for row in await rows(db_factory) if row.action == "password.change")
    blob = f"{entry.summary} {entry.detail}"
    assert new_password not in blob
    assert PASSWORD not in blob


async def test_the_audit_log_is_readable_and_filterable(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)

        everything = await client.get("/api/v1/admin/audit")
        assert everything.status_code == 200
        body = everything.json()
        assert body["total"] >= 1
        assert {"id", "at", "actor", "role", "action", "summary"} <= set(body["items"][0])

        filtered = await client.get("/api/v1/admin/audit?action=login")
        assert filtered.json()["total"] == 1

        nothing = await client.get("/api/v1/admin/audit?action=nope")
        assert nothing.json()["total"] == 0


async def test_audit_write_failure_does_not_fail_the_caller(db_factory, admin_settings, monkeypatch):
    """An audit hiccup must never turn a successful action into a 500."""
    from app.db import repo_admin as repo

    async def explode(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(repo, "write_audit", explode)

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await sign_in(client)
    assert response.status_code == 200
