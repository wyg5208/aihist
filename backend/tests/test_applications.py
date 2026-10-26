"""The application channel: a public form, a human queue, one issued key.

What is pinned here, in the order it can go wrong:

* the form is closed while `OPEN_API_ENABLED` is false — the programme should not
  collect requests it cannot honour, and the same switch closes the read API;
* a submission never issues anything: it writes one `pending` row, and the cheap
  anti-abuse measures (honeypot, per-address window) either write nothing or
  write exactly one row;
* approval is atomic with the key, happens once, and is the only response that
  ever contains the plaintext;
* the key an approval mints actually opens the keyed read API;
* mail is optional: with no SMTP configured the approval still succeeds and says
  so, rather than failing the decision.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from sqlalchemy import func, select

from app import mailer
from app.api import apply as apply_api
from app.config import Settings
from app.db import repo_admin, repo_commercial
from app.db.models import ApiApplication, ApiKey, AuditLog

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

PASSWORD = "correct horse battery staple"
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)
CSRF = {"X-Requested-With": "admin"}
ADMIN = "/api/v1/admin"
FORM = "/api/v1/open/apply"

PURPOSE = "把 AI 大事记嵌进产品页的侧栏，每天大约二十次请求。"


@pytest.fixture(autouse=True)
def clear_window():
    apply_api.reset_rate_limit()
    yield
    apply_api.reset_rate_limit()


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
    if role != "owner":
        async with db_factory() as session:
            await repo_admin.create_user(
                session, username=role, password_hash=PASSWORD_HASH, role=role
            )
            await session.commit()
    async with client_for(db_factory, settings, scheme="https") as client:
        response = await client.post(
            f"{ADMIN}/login",
            json={"user": "admin" if role == "owner" else role, "password": PASSWORD},
            headers=CSRF,
        )
        assert response.status_code == 200, response.text
        yield client


def form_fields(**overrides: str) -> dict[str, str]:
    fields = {
        "email": "reader@example.com",
        "name": "独立开发者",
        "purpose": PURPOSE,
        "siteUrl": "https://example.com/timeline",
        "website": "",
        "consent": "on",
    }
    fields.update(overrides)
    return fields


async def applications(db_factory) -> list[ApiApplication]:
    async with db_factory() as session:
        rows = await session.execute(select(ApiApplication).order_by(ApiApplication.created_at))
        return list(rows.scalars().all())


async def seed_application(db_factory, *, email: str = "reader@example.com") -> ApiApplication:
    async with db_factory() as session:
        row = await repo_commercial.create_application(
            session, email=email, name="独立开发者", purpose=PURPOSE
        )
        await session.commit()
        return row


# ---------------------------------------------------------------------------
# The public form
# ---------------------------------------------------------------------------


async def test_form_is_closed_while_the_programme_is_off(db_factory, base_settings):
    async with client_for(db_factory, base_settings) as client:
        page = await client.get(FORM)
        assert page.status_code == 404
        assert "尚未开放" in page.text

        posted = await client.post(FORM, data=form_fields())
        assert posted.status_code == 404

    assert await applications(db_factory) == []


async def test_form_renders_a_noindex_page_with_the_honeypot(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        page = await client.get(FORM)

    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-store"
    assert "noindex" in page.headers["x-robots-tag"]
    assert 'name="email"' in page.text
    assert 'name="purpose"' in page.text
    # The trap is present but hidden from anyone using a browser.
    assert 'name="website"' in page.text
    assert "hp" in page.text


async def test_submission_writes_one_pending_row(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        response = await client.post(
            FORM, data=form_fields(email="Reader@Example.com ")
        )

    assert response.status_code == 200
    assert "已收到申请" in response.text

    rows = await applications(db_factory)
    assert len(rows) == 1
    row = rows[0]
    assert row.email == "reader@example.com"
    assert row.status == "pending"
    assert row.name == "独立开发者"
    assert row.purpose == PURPOSE
    assert row.site_url == "https://example.com/timeline"
    assert row.monthly_quota == repo_commercial.DEFAULT_APPLICATION_QUOTA
    assert row.decided_at is None and row.key_id is None


async def test_a_second_pending_application_is_refused(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        await client.post(FORM, data=form_fields())
        again = await client.post(FORM, data=form_fields(email="READER@example.com"))

    assert again.status_code == 200
    assert "已在队列中" in again.text
    assert len(await applications(db_factory)) == 1


async def test_honeypot_answers_success_and_writes_nothing(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        response = await client.post(FORM, data=form_fields(website="https://spam.example"))

    # The page must look identical to a real submission: telling a bot what it
    # got wrong is how it learns to pass next time.
    assert response.status_code == 200
    assert "已收到申请" in response.text
    assert await applications(db_factory) == []


async def test_consent_is_required(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        response = await client.post(FORM, data=form_fields(consent=""))

    assert response.status_code == 400
    assert "同意条款" in response.text
    assert await applications(db_factory) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"email": "not-an-address"},
        {"name": "  "},
        {"purpose": "太短"},
    ],
)
async def test_incomplete_details_are_rejected(db_factory, open_settings, overrides):
    async with client_for(db_factory, open_settings) as client:
        response = await client.post(FORM, data=form_fields(**overrides))

    assert response.status_code == 400
    assert await applications(db_factory) == []


async def test_one_address_cannot_fill_the_queue(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        for index in range(apply_api.RATE_LIMIT):
            accepted = await client.post(
                FORM, data=form_fields(email=f"reader{index}@example.com")
            )
            assert accepted.status_code == 200, accepted.text

        blocked = await client.post(FORM, data=form_fields(email="late@example.com"))

    assert blocked.status_code == 429
    assert "过于频繁" in blocked.text
    assert len(await applications(db_factory)) == apply_api.RATE_LIMIT


async def test_an_unusable_site_url_is_dropped_not_stored(db_factory, open_settings):
    async with client_for(db_factory, open_settings) as client:
        response = await client.post(
            FORM, data=form_fields(siteUrl="javascript:alert(1)")
        )

    assert response.status_code == 200
    rows = await applications(db_factory)
    assert len(rows) == 1
    # `javascript:` in a link the console renders would be an XSS; the row keeps
    # the application and loses only the unusable URL.
    assert rows[0].site_url == ""


# ---------------------------------------------------------------------------
# The queue
# ---------------------------------------------------------------------------


async def test_queue_reports_counts_per_status(db_factory, open_settings):
    pending = await seed_application(db_factory, email="one@example.com")
    await seed_application(db_factory, email="two@example.com")
    async with db_factory() as session:
        rejected = await repo_commercial.find_application(session, pending.id)
        await repo_commercial.decide_application(
            session, rejected, status="rejected", note="用途不足", decided_by="admin"
        )
        await session.commit()

    async with console(db_factory, open_settings) as client:
        everything = await client.get(f"{ADMIN}/applications")
        only_pending = await client.get(f"{ADMIN}/applications?status=pending")

    assert everything.status_code == 200
    body = everything.json()
    assert body["total"] == 2
    assert body["counts"] == {"pending": 1, "approved": 0, "rejected": 1}
    assert len(body["applications"]) == 2
    assert {row["status"] for row in body["applications"]} == {"pending", "rejected"}

    assert only_pending.json()["total"] == 1
    assert only_pending.json()["applications"][0]["status"] == "pending"


async def test_approval_issues_a_key_and_is_the_only_plaintext_response(
    db_factory, open_settings
):
    row = await seed_application(db_factory)

    async with console(db_factory, open_settings) as client:
        response = await client.post(
            f"{ADMIN}/applications/{row.id}/approve",
            json={"monthlyQuota": 250, "note": "示例站点，量级与配额相符"},
            headers=CSRF,
        )

    assert response.status_code == 200, response.text
    body = response.json()
    plaintext = body["plaintext"]
    assert plaintext.startswith("aih_")
    assert body["key"]["prefix"] in plaintext
    assert body["key"]["monthlyQuota"] == 250
    assert body["application"]["status"] == "approved"
    assert body["application"]["decidedBy"] == "admin"
    # No SMTP in the test settings: the decision stands, the mail is a report.
    assert body["email"] == {
        "configured": False,
        "sent": False,
        "error": "smtp_not_configured",
    }

    async with db_factory() as session:
        stored = await session.get(ApiKey, uuid.UUID(body["key"]["id"]))
        application = await session.get(ApiApplication, row.id)
        audits = (
            await session.execute(
                select(AuditLog).where(AuditLog.action == "application.approve")
            )
        ).scalars().all()

    assert stored is not None
    assert plaintext not in stored.key_hash
    assert stored.key_hash == repo_commercial.hash_key(plaintext)
    assert application.status == "approved"
    assert application.key_id == stored.id
    assert application.monthly_quota == 250
    assert application.note.startswith("示例站点")
    assert len(audits) == 1
    assert audits[0].target_id == str(row.id)


async def test_the_minted_key_opens_the_read_api(db_factory, open_settings):
    row = await seed_application(db_factory)

    async with console(db_factory, open_settings) as client:
        approved = await client.post(
            f"{ADMIN}/applications/{row.id}/approve", json={}, headers=CSRF
        )
        plaintext = approved.json()["plaintext"]

        keyed = await client.get(
            "/api/v1/open/events", headers={"X-API-Key": plaintext}
        )
        anonymous = await client.get("/api/v1/open/events")

    assert keyed.status_code == 200
    assert keyed.json()["ok"] is True
    assert anonymous.status_code == 401


async def test_a_decided_application_cannot_be_decided_again(db_factory, open_settings):
    row = await seed_application(db_factory)

    async with console(db_factory, open_settings) as client:
        first = await client.post(
            f"{ADMIN}/applications/{row.id}/approve", json={}, headers=CSRF
        )
        second = await client.post(
            f"{ADMIN}/applications/{row.id}/approve", json={}, headers=CSRF
        )
        rejected = await client.post(
            f"{ADMIN}/applications/{row.id}/reject", json={"note": "改主意"}, headers=CSRF
        )

    assert first.status_code == 200
    # Checked before minting: a double click cannot leave a second key behind.
    assert second.status_code == 409
    assert second.json()["detail"] == "application_already_decided"
    assert rejected.status_code == 409

    async with db_factory() as session:
        keys = await session.scalar(select(func.count()).select_from(ApiKey))
    assert keys == 1


async def test_rejection_keeps_the_row_and_the_reason(db_factory, open_settings):
    row = await seed_application(db_factory, email="spam@example.com")

    async with console(db_factory, open_settings) as client:
        response = await client.post(
            f"{ADMIN}/applications/{row.id}/reject",
            json={"note": "用途描述不足，且域名无法访问"},
            headers=CSRF,
        )

    assert response.status_code == 200
    async with db_factory() as session:
        stored = await session.get(ApiApplication, row.id)
        audits = (
            await session.execute(
                select(AuditLog).where(AuditLog.action == "application.reject")
            )
        ).scalars().all()
        keys = await session.scalar(select(func.count()).select_from(ApiKey))

    assert stored.status == "rejected"
    assert stored.note == "用途描述不足，且域名无法访问"
    assert stored.decided_at is not None
    assert stored.decided_by == "admin"
    assert stored.key_id is None
    assert len(audits) == 1
    assert keys == 0


async def test_editor_cannot_decide(db_factory, open_settings):
    row = await seed_application(db_factory)

    async with console(db_factory, open_settings, role="editor") as client:
        listed = await client.get(f"{ADMIN}/applications")
        approved = await client.post(
            f"{ADMIN}/applications/{row.id}/approve", json={}, headers=CSRF
        )

    assert listed.status_code == 403
    assert approved.status_code == 403

    async with db_factory() as session:
        stored = await session.get(ApiApplication, row.id)
    assert stored.status == "pending"


async def test_a_missing_application_is_a_404(db_factory, open_settings):
    async with console(db_factory, open_settings) as client:
        missing = await client.post(
            f"{ADMIN}/applications/{uuid.uuid4()}/approve", json={}, headers=CSRF
        )
        malformed = await client.post(
            f"{ADMIN}/applications/not-a-uuid/approve", json={}, headers=CSRF
        )

    assert missing.status_code == 404
    assert malformed.status_code == 400


# ---------------------------------------------------------------------------
# The mailer
# ---------------------------------------------------------------------------


def test_mailer_reports_missing_configuration_instead_of_raising(open_settings):
    assert mailer.configured(open_settings) is False

    sent, error = asyncio.run(
        mailer.send_api_key(
            open_settings,
            to="reader@example.com",
            name="独立开发者",
            plaintext="aih_test_key_value",
            monthly_quota=1000,
        )
    )

    assert (sent, error) == (False, "smtp_not_configured")


def test_the_letter_carries_the_key_the_quota_and_the_rules(open_settings):
    body = mailer._body(
        name="独立开发者",
        plaintext="aih_test_key_value",
        monthly_quota=1000,
        site_origin="https://aihist.net/",
    )

    assert "aih_test_key_value" in body
    assert "1000 次/月" in body
    assert "https://aihist.net/api/v1/open/events" in body
    # The promise that makes revoke-and-reissue the recovery path.
    assert "sha256" in body


def test_configuration_appears_once_a_host_is_present(open_settings):
    configured = open_settings.model_copy(
        update={"smtp_host": "smtp.example.com", "smtp_from": "api@aihist.net"}
    )
    assert mailer.configured(configured) is True
