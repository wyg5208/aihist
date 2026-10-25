"""Commercial surface: API keys, the open-data API, `/go`, accounts, settings.

The properties pinned here are the ones that cost money or leak data if they
ever regress:

* a key's plaintext appears in exactly one response and in no column;
* a quota is enforced and the rejected request is still counted;
* the open API payload contains no operator-only field, because the payload is
  built from a function that has never heard of those columns;
* `/go` records a click only for a live partner, and records a bot as a bot
  rather than as a customer;
* an owner cannot lock the console by demoting themselves or the last owner.
"""

from __future__ import annotations

import hashlib
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from sqlalchemy import func, select

from app import auth
from app.config import Settings
from app.db import repo_admin
from app.db.models import AdminUser, ApiKey, ApiKeyUsage, AuditLog, Event, PartnerClick

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)
CSRF = {"X-Requested-With": "admin"}
ADMIN = "/api/v1/admin"
OPEN = "/api/v1/open"


@pytest.fixture(autouse=True)
def clear_throttle():
    auth.reset_throttle()
    yield
    auth.reset_throttle()


@pytest.fixture
def base_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        admin_user="admin",
        admin_password_hash=PASSWORD_HASH,
        analytics_salt="test-salt",
        site_origin="https://aihist.net",
        _env_file=None,
    )


@pytest.fixture
def open_settings(base_settings) -> Settings:
    return base_settings.model_copy(update={"open_api_enabled": True})


@asynccontextmanager
async def console(db_factory, settings, role: str = "owner"):
    """Sign in and hand back a client holding the session cookie."""
    if role != "owner":
        async with db_factory() as session:
            await repo_admin.create_user(
                session, username=role, password_hash=PASSWORD_HASH, role=role
            )
            await session.commit()
    async with client_for(db_factory, settings, scheme="https") as client:
        username = "admin" if role == "owner" else role
        response = await client.post(
            f"{ADMIN}/login", json={"user": username, "password": PASSWORD}, headers=CSRF
        )
        assert response.status_code == 200, response.text
        yield client


async def add_event(
    db_factory,
    *,
    slug: str,
    status: str | None = "admitted",
    ops_note: str | None = None,
    review: dict | None = None,
    updated_at: datetime | None = None,
) -> str:
    """One entry, written straight through the model so the test owns every column."""
    moment = updated_at or datetime.now(timezone.utc)
    async with db_factory() as session:
        row = Event(
            id=uuid.uuid4(),
            slug=slug,
            fingerprint=f"fp-{slug}",
            event_date="2026-02-01",
            date_precision="day",
            sort_date="2026-02-01",
            year=2026,
            title=f"条目 {slug}",
            summary="一段摘要",
            summary_kind="excerpt",
            category="model",
            importance=60,
            confidence="verified",
            source_count=1,
            source_families=["official"],
            sources=[
                {
                    "name": "OpenAI",
                    "family": "official",
                    "title": "原文",
                    "url": "https://example.com/post",
                    "publishedAt": "2026-02-01",
                }
            ],
            tags=[],
            meta={},
            origin="auto",
            editorial_status=status,
            editorial_review=review,
            ops_note=ops_note,
            first_seen_at=moment,
            updated_at=moment,
        )
        session.add(row)
        await session.commit()
        return str(row.id)


async def issue_key(client, **body) -> dict:
    payload = {"name": "test key", **body}
    response = await client.post(f"{ADMIN}/keys", json=payload, headers=CSRF)
    assert response.status_code == 200, response.text
    return response.json()


async def stored_key(db_factory) -> ApiKey:
    async with db_factory() as session:
        row = await session.scalar(select(ApiKey))
        assert row is not None
        return row


async def usage_rows(db_factory) -> list[ApiKeyUsage]:
    async with db_factory() as session:
        result = await session.execute(select(ApiKeyUsage))
        return list(result.scalars().all())


async def audit_rows(db_factory) -> list[AuditLog]:
    async with db_factory() as session:
        result = await session.execute(select(AuditLog).order_by(AuditLog.at))
        return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Issuing a key
# ---------------------------------------------------------------------------


async def test_the_plaintext_appears_once_and_is_never_stored(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
        listing = await client.get(f"{ADMIN}/keys")
    plaintext = created["plaintext"]
    assert plaintext.startswith("aih_") and len(plaintext) > 20
    assert created["key"]["prefix"] == plaintext[:12]
    # The list endpoint returns the prefix and nothing that could be replayed.
    assert listing.status_code == 200
    assert plaintext not in listing.text
    assert hashlib.sha256(plaintext.encode()).hexdigest() not in listing.text

    async with db_factory() as session:
        row = await session.scalar(select(ApiKey))
        assert row is not None
        assert row.key_hash == hashlib.sha256(plaintext.encode()).hexdigest()
        assert plaintext not in row.key_hash


async def test_issuing_a_key_is_audited_without_the_secret(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client, name="合作伙伴 A")
    entries = [row for row in await audit_rows(db_factory) if row.action == "key.create"]
    assert len(entries) == 1
    detail = entries[0].detail
    assert detail["name"] == "合作伙伴 A"
    assert detail["prefix"] == created["key"]["prefix"]
    assert created["plaintext"] not in str(detail)


async def test_only_an_owner_can_see_or_mint_keys(db_factory, open_settings):
    async with console(db_factory, open_settings, role="editor") as client:
        assert (await client.get(f"{ADMIN}/keys")).status_code == 403
        denied = await client.post(f"{ADMIN}/keys", json={"name": "nope"}, headers=CSRF)
    assert denied.status_code == 403
    assert denied.json()["detail"] == "forbidden"


async def test_key_requests_are_validated(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        no_name = await client.post(f"{ADMIN}/keys", json={"name": "  "}, headers=CSRF)
        bad_scope = await client.post(
            f"{ADMIN}/keys", json={"name": "x", "scopes": ["write"]}, headers=CSRF
        )
    assert no_name.status_code == 400 and no_name.json()["detail"] == "name_required"
    assert bad_scope.status_code == 400 and bad_scope.json()["detail"] == "invalid_scope"


async def test_revoking_keeps_the_row_and_the_first_timestamp(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
        first = await client.post(f"{ADMIN}/keys/{created['key']['id']}/revoke", headers=CSRF)
        second = await client.post(f"{ADMIN}/keys/{created['key']['id']}/revoke", headers=CSRF)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["key"]["revokedAt"] == second.json()["key"]["revokedAt"]
    assert first.json()["key"]["active"] is False
    entries = [row for row in await audit_rows(db_factory) if row.action == "key.revoke"]
    assert len(entries) == 1, "a second revoke must not write a second audit line"


# ---------------------------------------------------------------------------
# Using a key
# ---------------------------------------------------------------------------


async def test_the_open_api_is_invisible_until_it_is_enabled(db_factory, base_settings):
    async with client_for(db_factory, base_settings) as client:
        response = await client.get(f"{OPEN}/events")
    assert response.status_code == 404
    assert response.json()["detail"] == "open_api_disabled"


async def test_a_missing_or_wrong_key_is_rejected_identically(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        await issue_key(client)
    async with client_for(db_factory, open_settings) as client:
        missing = await client.get(f"{OPEN}/events")
        wrong = await client.get(f"{OPEN}/events", headers={"x-api-key": "aih_nope"})
    assert missing.status_code == 401 and wrong.status_code == 401
    assert missing.json()["detail"] == "missing_api_key"
    assert wrong.json()["detail"] == "invalid_api_key"
    assert missing.headers["www-authenticate"].startswith("ApiKey")


async def test_a_valid_key_reads_the_feed(db_factory, open_settings):
    await add_event(db_factory, slug="gpt-5")
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
    async with client_for(db_factory, open_settings) as client:
        response = await client.get(
            f"{OPEN}/events", headers={"x-api-key": created["plaintext"]}
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] >= 1
    assert [item["slug"] for item in body["items"]] == ["gpt-5"]
    assert body["quota"] == {"monthly": 1000, "used": 1, "remaining": 999}


async def test_the_open_api_payload_has_no_operator_only_fields(db_factory, open_settings):
    await add_event(
        db_factory,
        slug="private-memo",
        ops_note="下架是因为厂商要求",
        review={"source": "manual", "decision": "admitted", "score": 88, "votes": []},
    )
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
    async with client_for(db_factory, open_settings) as client:
        listing = await client.get(
            f"{OPEN}/events", headers={"x-api-key": created["plaintext"]}
        )
        detail = await client.get(
            f"{OPEN}/events/private-memo", headers={"x-api-key": created["plaintext"]}
        )
    assert listing.status_code == 200 and detail.status_code == 200
    for body in (listing.json(), detail.json()):
        assert "下架是因为厂商要求" not in str(body)
    item = listing.json()["items"][0]
    assert "opsNote" not in item
    assert "editorialReview" not in item
    assert detail.json()["event"]["sources"][0]["url"] == "https://example.com/post"


async def test_the_quota_is_enforced_and_the_rejection_is_counted(db_factory, open_settings):
    await add_event(db_factory, slug="one")
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client, monthlyQuota=2)
    headers = {"x-api-key": created["plaintext"]}
    async with client_for(db_factory, open_settings) as client:
        first = await client.get(f"{OPEN}/events", headers=headers)
        second = await client.get(f"{OPEN}/events", headers=headers)
        third = await client.get(f"{OPEN}/events", headers=headers)
    assert (first.status_code, second.status_code) == (200, 200)
    assert third.status_code == 429 and third.json()["detail"] == "quota_exceeded"

    usage = await usage_rows(db_factory)
    assert len(usage) == 1
    assert usage[0].requests == 3, "the refused request still hit the door"
    assert usage[0].errors == 1
    assert (await stored_key(db_factory)).last_used_at is not None


async def test_a_revoked_key_stops_working_immediately(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
        await client.post(f"{ADMIN}/keys/{created['key']['id']}/revoke", headers=CSRF)
    async with client_for(db_factory, open_settings) as client:
        response = await client.get(
            f"{OPEN}/events", headers={"x-api-key": created["plaintext"]}
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "key_revoked"


async def test_held_and_retracted_entries_are_not_reachable_by_key(db_factory, open_settings):
    await add_event(db_factory, slug="held-one", status="hold")
    await add_event(db_factory, slug="gone-one", status="excluded")
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
    headers = {"x-api-key": created["plaintext"]}
    async with client_for(db_factory, open_settings) as client:
        listing = await client.get(f"{OPEN}/events", headers=headers)
        held = await client.get(f"{OPEN}/events/held-one", headers=headers)
    assert listing.json()["count"] == 0
    assert held.status_code == 404


async def test_since_filters_on_the_last_change(db_factory, open_settings):
    old = datetime.now(timezone.utc) - timedelta(days=40)
    await add_event(db_factory, slug="ancient", updated_at=old)
    await add_event(db_factory, slug="fresh")
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
    headers = {"x-api-key": created["plaintext"]}
    async with client_for(db_factory, open_settings) as client:
        everything = await client.get(f"{OPEN}/events?since=1970-01-01", headers=headers)
        recent = await client.get(f"{OPEN}/events", headers=headers)
        broken = await client.get(f"{OPEN}/events?since=not-a-day", headers=headers)
    assert sorted(item["slug"] for item in everything.json()["items"]) == ["ancient", "fresh"]
    assert [item["slug"] for item in recent.json()["items"]] == ["fresh"]
    assert broken.status_code == 400 and broken.json()["detail"] == "invalid_since"


async def test_usage_series_has_one_point_per_day(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        created = await issue_key(client)
    async with client_for(db_factory, open_settings) as client:
        await client.get(f"{OPEN}/events", headers={"x-api-key": created["plaintext"]})
    async with console(db_factory, open_settings) as client:
        series = await client.get(f"{ADMIN}/keys/usage?days=7")
    body = series.json()
    assert series.status_code == 200 and len(body["series"]) == 7
    assert sum(point["count"] for point in body["series"]) == 1


# ---------------------------------------------------------------------------
# Partners and /go
# ---------------------------------------------------------------------------


async def make_partner(client, **body) -> dict:
    payload = {"name": "Acme", "code": "acme", **body}
    response = await client.post(f"{ADMIN}/partners", json=payload, headers=CSRF)
    assert response.status_code == 200, response.text
    return response.json()["partner"]


async def test_a_live_partner_redirects_and_counts_a_human_click(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        await make_partner(
            client, status="active", targetUrl="https://acme.example.com/?ref=aihist"
        )
    async with client_for(db_factory, base_settings) as client:
        human = await client.get(
            "/go/acme",
            headers={"user-agent": "Mozilla/5.0 (Macintosh) Chrome/120", "referer": "https://aihist.net/?e=x"},
        )
        bot = await client.get(
            "/go/acme", headers={"user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)"}
        )
    assert human.status_code == 302
    assert human.headers["location"] == "https://acme.example.com/?ref=aihist"
    assert human.headers["cache-control"].startswith("no-store")
    assert bot.status_code == 302

    async with db_factory() as session:
        clicks = list((await session.execute(select(PartnerClick))).scalars().all())
    assert len(clicks) == 2
    assert clicks[0].referrer_host == "aihist.net"
    assert clicks[0].is_bot is False
    assert clicks[1].is_bot is True


async def test_a_partner_that_is_not_live_redirects_home_without_a_click(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        await make_partner(client, code="prospect", status="prospect", targetUrl="https://a.example")
        await make_partner(
            client, code="ended", status="active", targetUrl="https://b.example", endsOn="2020-01-01"
        )
        await make_partner(client, code="nowhere", status="active")
    async with client_for(db_factory, base_settings) as client:
        prospect = await client.get("/go/prospect")
        ended = await client.get("/go/ended")
        nowhere = await client.get("/go/nowhere")
        unknown = await client.get("/go/does-not-exist")
    for response in (prospect, ended, nowhere, unknown):
        assert response.status_code == 302
        assert response.headers["location"] == "/"
    async with db_factory() as session:
        assert int(await session.scalar(select(func.count()).select_from(PartnerClick)) or 0) == 0


async def test_partner_stats_report_the_window_and_ignore_bots(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        await make_partner(client, status="active", targetUrl="https://acme.example.com")
    async with client_for(db_factory, base_settings) as client:
        await client.get("/go/acme", headers={"user-agent": "Mozilla/5.0 Firefox/121"})
        await client.get("/go/acme", headers={"user-agent": "GPTBot/1.0"})
    async with console(db_factory, base_settings) as client:
        response = await client.get(f"{ADMIN}/partners/stats?days=30")
    body = response.json()
    assert response.status_code == 200 and body["days"] == 30
    assert body["items"][0]["clicks"] == 1


async def test_partner_codes_are_unique_and_urls_are_sane(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        await make_partner(client, code="acme")
        duplicate = await client.post(
            f"{ADMIN}/partners", json={"name": "Other", "code": "ACME"}, headers=CSRF
        )
        bad_code = await client.post(
            f"{ADMIN}/partners", json={"name": "X", "code": "no spaces"}, headers=CSRF
        )
        bad_url = await client.post(
            f"{ADMIN}/partners",
            json={"name": "X", "code": "js", "targetUrl": "javascript:alert(1)"},
            headers=CSRF,
        )
        no_name = await client.post(f"{ADMIN}/partners", json={"code": "nameless"}, headers=CSRF)
    assert duplicate.status_code == 409 and duplicate.json()["detail"] == "code_taken"
    assert bad_code.status_code == 400 and bad_code.json()["detail"] == "invalid_code"
    assert bad_url.status_code == 400 and bad_url.json()["detail"] == "invalid_target_url"
    assert no_name.status_code == 400 and no_name.json()["detail"] == "name_required"


async def test_patching_a_partner_touches_only_what_was_sent(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        created = await make_partner(
            client, status="prospect", contact="hi@acme.example", termsNote="季度结算"
        )
        patched = await client.patch(
            f"{ADMIN}/partners/{created['id']}", json={"status": "active"}, headers=CSRF
        )
        cleared = await client.patch(
            f"{ADMIN}/partners/{created['id']}", json={"termsNote": None}, headers=CSRF
        )
        empty = await client.patch(
            f"{ADMIN}/partners/{created['id']}", json={}, headers=CSRF
        )
    assert patched.status_code == 200
    assert patched.json()["partner"]["status"] == "active"
    assert patched.json()["partner"]["contact"] == "hi@acme.example"
    assert patched.json()["partner"]["termsNote"] == "季度结算"
    assert cleared.json()["partner"]["termsNote"] == ""
    assert empty.status_code == 400 and empty.json()["detail"] == "nothing_to_update"


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


async def list_accounts(db_factory) -> list[AdminUser]:
    async with db_factory() as session:
        return list((await session.execute(select(AdminUser))).scalars().all())


async def test_creating_an_account_validates_and_never_returns_the_hash(
    db_factory, base_settings
):
    async with console(db_factory, base_settings) as client:
        created = await client.post(
            f"{ADMIN}/users",
            json={"username": "analyst2", "password": PASSWORD, "role": "analyst"},
            headers=CSRF,
        )
        duplicate = await client.post(
            f"{ADMIN}/users",
            json={"username": "analyst2", "password": PASSWORD, "role": "analyst"},
            headers=CSRF,
        )
        short = await client.post(
            f"{ADMIN}/users",
            json={"username": "tiny", "password": "short", "role": "analyst"},
            headers=CSRF,
        )
        bad_role = await client.post(
            f"{ADMIN}/users",
            json={"username": "chief", "password": PASSWORD, "role": "god"},
            headers=CSRF,
        )
    assert created.status_code == 200, created.text
    assert created.json()["user"]["username"] == "analyst2"
    assert "password" not in created.text.lower().replace("password_too_short", "")
    assert duplicate.status_code == 409 and duplicate.json()["detail"] == "username_taken"
    assert short.status_code == 400 and short.json()["detail"] == "password_too_short"
    assert bad_role.status_code == 400 and bad_role.json()["detail"] == "invalid_role"


async def test_an_owner_cannot_demote_or_disable_themselves(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        me = (await client.get(f"{ADMIN}/users")).json()["items"]
        assert me == [], "the env account is not an admin_users row"
        created = await client.post(
            f"{ADMIN}/users",
            json={"username": "boss", "password": PASSWORD, "role": "owner"},
            headers=CSRF,
        )
    owner_id = created.json()["user"]["id"]

    # Sign in as `boss` and try to undo the account that can undo everything.
    async with client_for(db_factory, base_settings, scheme="https") as client:
        await client.post(
            f"{ADMIN}/login", json={"user": "boss", "password": PASSWORD}, headers=CSRF
        )
        demote = await client.patch(
            f"{ADMIN}/users/{owner_id}", json={"role": "analyst"}, headers=CSRF
        )
        disable = await client.patch(
            f"{ADMIN}/users/{owner_id}", json={"active": False}, headers=CSRF
        )
    assert demote.status_code == 400 and demote.json()["detail"] == "cannot_demote_self"
    assert disable.status_code == 400 and disable.json()["detail"] == "cannot_disable_self"


async def test_the_last_active_owner_cannot_be_removed(db_factory, base_settings):
    async with db_factory() as session:
        await repo_admin.create_user(
            session, username="boss", password_hash=PASSWORD_HASH, role="owner"
        )
        await session.commit()
    async with console(db_factory, base_settings) as client:
        accounts = (await client.get(f"{ADMIN}/users")).json()["items"]
        boss_id = accounts[0]["id"]
        response = await client.patch(
            f"{ADMIN}/users/{boss_id}", json={"role": "analyst"}, headers=CSRF
        )
    assert response.status_code == 400
    assert response.json()["detail"] == "last_owner"
    assert [row.role for row in await list_accounts(db_factory)] == ["owner"]


async def test_resetting_a_password_is_audited_and_enforced(db_factory, base_settings):
    async with console(db_factory, base_settings) as client:
        created = await client.post(
            f"{ADMIN}/users",
            json={"username": "editor2", "password": PASSWORD, "role": "editor"},
            headers=CSRF,
        )
        user_id = created.json()["user"]["id"]
        short = await client.post(
            f"{ADMIN}/users/{user_id}/password", json={"password": "short"}, headers=CSRF
        )
        ok = await client.post(
            f"{ADMIN}/users/{user_id}/password",
            json={"password": "a much longer passphrase"},
            headers=CSRF,
        )
        missing = await client.post(
            f"{ADMIN}/users/{uuid.uuid4()}/password",
            json={"password": "a much longer passphrase"},
            headers=CSRF,
        )
    assert short.status_code == 400
    assert ok.status_code == 200
    assert missing.status_code == 404

    entries = [row for row in await audit_rows(db_factory) if row.action == "user.password.reset"]
    assert len(entries) == 1
    assert "a much longer passphrase" not in str(entries[0].detail)


# ---------------------------------------------------------------------------
# Configuration report
# ---------------------------------------------------------------------------


async def test_the_settings_report_states_what_is_missing_without_leaking_secrets(
    db_factory, base_settings
):
    async with console(db_factory, base_settings) as client:
        response = await client.get(f"{ADMIN}/settings")
    assert response.status_code == 200
    body = response.json()
    entries = {entry["key"]: entry for entry in body["settings"]}
    assert set(entries) >= {
        "database",
        "session",
        "accounts",
        "env_account",
        "panel",
        "analytics",
        "access_log",
        "open_api",
        "retention",
        "mail",
    }
    assert entries["database"]["value"] == "sqlite"
    assert entries["access_log"]["value"] == "未接入"
    assert entries["access_log"]["level"] == "warn"
    assert entries["panel"]["level"] == "danger", "no judge env means no panel"
    assert entries["mail"]["level"] == "warn"
    assert entries["session"]["level"] == "ok"
    assert "test-secret" not in response.text
    assert PASSWORD_HASH not in response.text


async def test_a_missing_session_secret_is_reported_as_dangerous(db_factory, base_settings):
    unsigned = base_settings.model_copy(update={"session_secret": ""})
    async with console(db_factory, unsigned) as client:
        response = await client.get(f"{ADMIN}/settings")
    entries = {entry["key"]: entry for entry in response.json()["settings"]}
    assert entries["session"]["level"] == "danger"
