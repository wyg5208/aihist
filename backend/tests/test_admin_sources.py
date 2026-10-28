"""The source catalogue console: create, edit, probe, enable.

Two rules are the whole point of the module and are asserted here: nothing is
enabled before it has been probed, and changing the address or the parser
retires the old proof. Both are enforced server-side, because a client can lie
about `verified_at` but cannot lie about what the probe returned.
"""

from __future__ import annotations

import ipaddress
import sys
from pathlib import Path
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select

from app import auth
from app.api import admin_sources
from app.config import Settings
from app.db import repo_admin
from app.db.models import AuditLog, IngestSource
from app.ingest.sources import FetchResult

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)
CSRF = {"X-Requested-With": "admin"}

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test feed</title>
  <link>https://feeds.example.com/</link>
  <item>
    <title>Regulator publishes model-risk guidance</title>
    <link>https://feeds.example.com/news/one</link>
    <pubDate>Mon, 20 Oct 2026 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Standards body opens a consultation</title>
    <link>https://feeds.example.com/news/two</link>
    <pubDate>Tue, 21 Oct 2026 00:00:00 GMT</pubDate>
  </item>
</channel></rss>
"""


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """No DNS and no network: the probe is stubbed, the resolver is faked."""

    async def resolve(host: str) -> list[str]:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return ["93.184.216.34"]
        return [host]

    async def fetch(url: str) -> FetchResult:
        return FetchResult(
            ok=True,
            status=200,
            url=url,
            text=RSS,
            content_length=len(RSS.encode("utf-8")),
            headers={"content-type": "application/rss+xml"},
        )

    monkeypatch.setattr(admin_sources, "_resolve", resolve)
    monkeypatch.setattr(admin_sources, "_default_probe_fetch", fetch)
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


async def audit_rows(db_factory) -> list[AuditLog]:
    async with db_factory() as session:
        result = await session.execute(select(AuditLog).order_by(AuditLog.at))
        return list(result.scalars().all())


async def row_of(db_factory, key: str) -> IngestSource | None:
    async with db_factory() as session:
        return await session.get(IngestSource, key)


CANDIDATE: dict[str, Any] = {
    "key": "nist-test",
    "name": "NIST Test Feed",
    "family": "policy",
    "kind": "feed",
    "url": "https://feeds.example.com/rss.xml",
    "rationale": "监管一手源，探活通过后启用",
}


async def create(client, **overrides) -> Any:
    payload = {**CANDIDATE, **overrides}
    return await client.post("/api/v1/admin/sources/registry", json=payload, headers=CSRF)


# ---------------------------------------------------------------------------
# The list
# ---------------------------------------------------------------------------


async def test_the_registry_lists_the_catalogue_including_disabled(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        response = await client.get("/api/v1/admin/sources/registry")

    assert response.status_code == 200
    body = response.json()
    keys = {item["key"] for item in body["items"]}
    assert "openai" in keys, "the frozen seed is listed before anyone seeds the table"
    assert "nist" in keys, "an unverified candidate is listed too"
    assert body["total"] == len(body["items"])
    assert body["enabled"] == sum(1 for item in body["items"] if item["enabled"])
    assert body["unverified"] >= 1
    assert {"feed", "sitemap", "arxiv", "openrouter", "hf", "hn"} <= set(body["kinds"])
    assert any(group["key"] == "policy" for group in body["families"])


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def test_a_new_source_is_saved_disabled_and_unverified(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        response = await create(client)

    assert response.status_code == 200, response.text
    source = response.json()["source"]
    assert source["key"] == "nist-test"
    assert source["enabled"] is False
    assert source["verifiedAt"] is None
    assert source["familyLabel"] == "监管原文"

    stored = await row_of(db_factory, "nist-test")
    assert stored is not None and stored.created_by == "admin"


async def test_creating_a_source_is_audited(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)

    actions = [row.action for row in await audit_rows(db_factory)]
    assert "source.create" in actions


@pytest.mark.parametrize(
    ("overrides", "status_code"),
    [
        ({"key": "openrouter"}, 400),
        ({"key": "hf-mine"}, 400),
        ({"key": "Not A Key"}, 400),
        ({"family": "gossip"}, 400),
        ({"kind": "scrape"}, 400),
        ({"url": "http://127.0.0.1/feed"}, 400),
        ({"url": "file:///etc/passwd"}, 400),
        ({"enabled": True}, 409),
    ],
)
async def test_bad_input_is_refused(db_factory, admin_settings, overrides, status_code):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        response = await create(client, **overrides)

    assert response.status_code == status_code, response.text
    assert response.json()["detail"] != ""
    assert await row_of(db_factory, overrides.get("key", CANDIDATE["key"])) is None


async def test_a_duplicate_key_is_refused(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        assert (await create(client)).status_code == 200
        duplicate = await create(client)

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "key_exists"


# ---------------------------------------------------------------------------
# Probe and enable
# ---------------------------------------------------------------------------


async def test_a_probe_reads_the_feed_without_writing_anything(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        response = await client.post(
            "/api/v1/admin/sources/probe",
            json={"url": CANDIDATE["url"], "kind": "feed"},
            headers=CSRF,
        )

    assert response.status_code == 200, response.text
    probe = response.json()["probe"]
    assert probe["ok"] is True
    assert probe["itemCount"] == 2
    assert len(probe["sample"]) == 2
    assert probe["latestAt"].startswith("2026-10-21")
    assert await row_of(db_factory, CANDIDATE["key"]) is None, "a probe never writes"


async def test_a_source_cannot_be_enabled_before_it_is_probed(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)
        refused = await client.post(
            "/api/v1/admin/sources/registry/nist-test/enabled",
            json={"enabled": True},
            headers=CSRF,
        )

    assert refused.status_code == 409
    assert refused.json()["detail"] == "probe_required"
    stored = await row_of(db_factory, "nist-test")
    assert stored is not None and stored.enabled is False


async def test_verifying_stamps_the_probe_and_then_enabling_works(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)
        verified = await client.post(
            "/api/v1/admin/sources/registry/nist-test/verify", headers=CSRF
        )
        enabled = await client.post(
            "/api/v1/admin/sources/registry/nist-test/enabled",
            json={"enabled": True},
            headers=CSRF,
        )

    assert verified.status_code == 200, verified.text
    assert verified.json()["probe"]["ok"] is True
    assert verified.json()["source"]["verifiedAt"] is not None
    assert enabled.status_code == 200
    assert enabled.json()["source"]["enabled"] is True

    actions = [row.action for row in await audit_rows(db_factory)]
    assert "source.verify" in actions
    assert "source.enable" in actions


async def test_a_failed_probe_leaves_the_source_unverified(db_factory, admin_settings, monkeypatch):
    async def dead(url: str) -> FetchResult:
        return FetchResult(ok=False, status=503, url=url, text="")

    monkeypatch.setattr(admin_sources, "_default_probe_fetch", dead)

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)
        verified = await client.post(
            "/api/v1/admin/sources/registry/nist-test/verify", headers=CSRF
        )
        refused = await client.post(
            "/api/v1/admin/sources/registry/nist-test/enabled",
            json={"enabled": True},
            headers=CSRF,
        )

    assert verified.status_code == 200
    assert verified.json()["probe"]["ok"] is False
    assert verified.json()["source"]["verifiedAt"] is None
    assert refused.status_code == 409


async def test_disabling_releases_a_live_source(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)
        await client.post("/api/v1/admin/sources/registry/nist-test/verify", headers=CSRF)
        await client.post(
            "/api/v1/admin/sources/registry/nist-test/enabled",
            json={"enabled": True},
            headers=CSRF,
        )
        off = await client.post(
            "/api/v1/admin/sources/registry/nist-test/enabled",
            json={"enabled": False},
            headers=CSRF,
        )

    assert off.status_code == 200
    assert off.json()["source"]["enabled"] is False
    actions = [row.action for row in await audit_rows(db_factory)]
    assert "source.disable" in actions


# ---------------------------------------------------------------------------
# Edit
# ---------------------------------------------------------------------------


async def test_editing_the_address_retires_the_old_probe(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)
        await client.post("/api/v1/admin/sources/registry/nist-test/verify", headers=CSRF)
        await client.post(
            "/api/v1/admin/sources/registry/nist-test/enabled",
            json={"enabled": True},
            headers=CSRF,
        )
        patched = await client.patch(
            "/api/v1/admin/sources/registry/nist-test",
            json={"url": "https://feeds.example.com/other.xml"},
            headers=CSRF,
        )

    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["probeRequired"] is True
    assert body["source"]["verifiedAt"] is None
    assert body["source"]["enabled"] is False

    actions = [row.action for row in await audit_rows(db_factory)]
    assert "source.update" in actions


async def test_editing_a_cosmetic_field_keeps_the_probe(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        await create(client)
        await client.post("/api/v1/admin/sources/registry/nist-test/verify", headers=CSRF)
        patched = await client.patch(
            "/api/v1/admin/sources/registry/nist-test",
            json={"name": "NIST (renamed)", "rationale": "更新的收录理由"},
            headers=CSRF,
        )

    assert patched.status_code == 200
    assert patched.json()["probeRequired"] is False
    assert patched.json()["source"]["verifiedAt"] is not None
    assert patched.json()["source"]["name"] == "NIST (renamed)"


async def test_a_patch_to_an_unknown_key_is_a_404(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        response = await client.patch(
            "/api/v1/admin/sources/registry/ghost", json={"name": "x"}, headers=CSRF
        )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


async def test_an_analyst_cannot_add_or_probe_a_source(db_factory, admin_settings):
    await make_user(db_factory, "ana", "analyst")

    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client, "ana")
        assert (await client.get("/api/v1/admin/sources/registry")).status_code == 200
        assert (await create(client)).status_code == 403
        probe = await client.post(
            "/api/v1/admin/sources/probe",
            json={"url": CANDIDATE["url"], "kind": "feed"},
            headers=CSRF,
        )
        assert probe.status_code == 403


async def test_a_write_without_the_csrf_header_is_refused(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        await sign_in(client)
        response = await client.post(
            "/api/v1/admin/sources/registry", json=CANDIDATE
        )
    assert response.status_code == 403


async def test_an_anonymous_request_is_rejected(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings, scheme="https") as client:
        response = await client.get("/api/v1/admin/sources/registry")
    assert response.status_code == 401
