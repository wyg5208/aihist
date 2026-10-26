"""The mailing list: consent, dedupe, the two links, and the export.

Batches 3 and 4 share this file — mailing list here, API keys and `/go` in B4.

The properties worth pinning are the ones a future refactor would quietly drop:
an address is stored once, `confirmed` only ever comes from following a link,
nothing is deleted, the CSV is escaped rather than concatenated, and the console
routes are owner-only.
"""

from __future__ import annotations

import csv
import io
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from sqlalchemy import func, select

from app import auth
from app.config import Settings
from app.db import repo_admin
from app.db.models import AuditLog, Subscriber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

from app.api import growth as growth_api  # noqa: E402

PASSWORD = "correct horse battery staple"
PASSWORD_HASH = PasswordHasher().hash(PASSWORD)
CSRF = {"X-Requested-With": "admin"}
SUBSCRIBE = "/api/v1/subscribe"


@pytest.fixture(autouse=True)
def clear_throttle():
    auth.reset_throttle()
    growth_api.reset_form_throttle()
    yield
    auth.reset_throttle()
    growth_api.reset_form_throttle()


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


async def rows(db_factory) -> list[Subscriber]:
    async with db_factory() as session:
        result = await session.execute(select(Subscriber).order_by(Subscriber.created_at))
        return list(result.scalars().all())


async def token_for(db_factory, email: str) -> str:
    async with db_factory() as session:
        row = await session.scalar(select(Subscriber).where(Subscriber.email == email))
        assert row is not None, f"{email} was never stored"
        return row.token


async def audit_actions(db_factory) -> list[str]:
    async with db_factory() as session:
        result = await session.execute(select(AuditLog.action).order_by(AuditLog.at))
        return [str(action) for action in result.scalars().all()]


# ---------------------------------------------------------------------------
# Subscribing
# ---------------------------------------------------------------------------


async def test_subscribing_records_consent_and_a_confirmation_link(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        response = await client.post(
            SUBSCRIBE,
            json={"email": "  Reader@Example.COM ", "consent": True, "sourcePath": "/?e=gpt-4"},
            headers={"referer": "https://chatgpt.com/c/abc"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True and body["status"] == "pending"
    assert body["confirmUrl"].startswith("https://aihist.net/api/v1/subscribe/confirm?token=")

    stored = await rows(db_factory)
    assert len(stored) == 1
    row = stored[0]
    assert row.email == "reader@example.com", "the address is normalised on the way in"
    assert row.status == "pending"
    assert row.source_path == "/?e=gpt-4"
    assert row.source_channel == "ai", "the referrer vocabulary is shared with the beacon"
    assert row.consented_at is not None
    assert len(row.token) >= 16


async def test_a_second_submission_does_not_duplicate_or_fail(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        first = await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        second = await client.post(SUBSCRIBE, json={"email": "A@Example.com", "consent": True})
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["confirmUrl"] == second.json()["confirmUrl"]
    assert len(await rows(db_factory)) == 1


async def test_consent_and_a_plausible_address_are_required(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        no_consent = await client.post(SUBSCRIBE, json={"email": "a@example.com"})
        bad_address = await client.post(
            SUBSCRIBE, json={"email": "not-an-address", "consent": True}
        )
    assert no_consent.status_code == 400
    assert no_consent.json()["detail"] == "consent_required"
    assert bad_address.status_code == 400
    assert bad_address.json()["detail"] == "invalid_email"
    assert await rows(db_factory) == []


# ---------------------------------------------------------------------------
# The two links
# ---------------------------------------------------------------------------


async def test_confirming_flips_the_status_and_renders_a_quiet_page(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        token = await token_for(db_factory, "a@example.com")

        page = await client.get(f"/api/v1/subscribe/confirm?token={token}")
        again = await client.get(f"/api/v1/subscribe/confirm?token={token}")

    assert page.status_code == 200
    assert page.headers["x-robots-tag"] == "noindex, nofollow"
    assert "确认完成" in page.text
    assert again.status_code == 200 and "已在名单中" in again.text

    row = (await rows(db_factory))[0]
    assert row.status == "confirmed" and row.confirmed_at is not None


async def test_unsubscribing_keeps_the_row_as_a_suppression_record(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        token = await token_for(db_factory, "a@example.com")
        page = await client.get(f"/api/v1/unsubscribe?token={token}")

    assert page.status_code == 200
    stored = await rows(db_factory)
    assert len(stored) == 1, "leaving the list is a status change, never a delete"
    assert stored[0].status == "unsubscribed" and stored[0].unsubscribed_at is not None


async def test_a_reader_who_left_can_come_back(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        token = await token_for(db_factory, "a@example.com")
        await client.get(f"/api/v1/unsubscribe?token={token}")
        await client.get(f"/api/v1/subscribe/confirm?token={token}")
    assert (await rows(db_factory))[0].status == "confirmed"


async def test_an_unknown_token_is_a_page_not_a_stack_trace(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        confirm = await client.get("/api/v1/subscribe/confirm?token=nope")
        leave = await client.get("/api/v1/unsubscribe?token=nope")
    assert confirm.status_code == 404 and leave.status_code == 404
    assert "无效" in confirm.text
    assert "noindex" in confirm.text


# ---------------------------------------------------------------------------
# The console
# ---------------------------------------------------------------------------


async def test_the_list_reports_counts_and_filters(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        for index in range(3):
            await client.post(
                SUBSCRIBE, json={"email": f"reader{index}@example.com", "consent": True}
            )
        body = (await client.get("/api/v1/admin/subscribers")).json()
        assert body["total"] == 3
        assert body["counts"]["pending"] == 3
        assert body["counts"]["confirmed"] == 0
        assert set(body["items"][0]) == {
            "id",
            "email",
            "status",
            "sourcePath",
            "sourceChannel",
            "consentedAt",
            "createdAt",
            "confirmedAt",
            "unsubscribedAt",
        }

        narrowed = (await client.get("/api/v1/admin/subscribers?q=reader1")).json()
        assert narrowed["total"] == 1
        assert narrowed["items"][0]["email"] == "reader1@example.com"

        empty = (await client.get("/api/v1/admin/subscribers?status=confirmed")).json()
        assert empty["total"] == 0


async def test_marking_a_subscriber_writes_an_audit_row(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        async with db_factory() as session:
            raw = await session.scalar(select(Subscriber))
        assert raw is not None
        response = await client.post(
            f"/api/v1/admin/subscribers/{raw.id}/status",
            json={"status": "confirmed"},
            headers=CSRF,
        )
    assert response.status_code == 200
    assert response.json()["subscriber"]["status"] == "confirmed"
    assert "subscriber.status" in await audit_actions(db_factory)
    assert (await rows(db_factory))[0].status == "confirmed"


async def test_a_bad_status_or_an_unknown_id_is_rejected(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        async with db_factory() as session:
            raw = await session.scalar(select(Subscriber))
        assert raw is not None
        bad = await client.post(
            f"/api/v1/admin/subscribers/{raw.id}/status",
            json={"status": "vip"},
            headers=CSRF,
        )
        unknown = await client.post(
            "/api/v1/admin/subscribers/00000000-0000-0000-0000-000000000000/status",
            json={"status": "confirmed"},
            headers=CSRF,
        )
        nonsense = await client.post(
            "/api/v1/admin/subscribers/not-a-uuid/status",
            json={"status": "confirmed"},
            headers=CSRF,
        )
    assert bad.status_code == 400 and bad.json()["detail"] == "invalid_status"
    assert unknown.status_code == 404
    assert nonsense.status_code == 404


async def test_the_export_is_escaped_csv_and_is_audited(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        await client.post(
            SUBSCRIBE,
            json={
                "email": "quoted@example.com",
                "consent": True,
                # A comma and a quote in the source path is the case a naive
                # "join with commas" export gets wrong.
                "sourcePath": '/?e=a,b"c',
            },
        )
        await client.post(SUBSCRIBE, json={"email": "plain@example.com", "consent": True})

        response = await client.get("/api/v1/admin/subscribers/export.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]

    text = response.content.decode("utf-8")
    assert text.startswith("\ufeffemail,status,"), "the BOM is what makes Excel read UTF-8"
    parsed = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))
    assert parsed[0][0] == "email" and parsed[0][1] == "status"
    assert len(parsed) == 3, "header plus two rows"

    paths = {row[0]: row[2] for row in parsed[1:]}
    assert paths["quoted@example.com"] == '/?e=a,b"c'
    assert "subscribers.export" in await audit_actions(db_factory)


async def test_the_list_is_owner_only(db_factory, admin_settings):
    async with console(db_factory, admin_settings, role="editor") as client:
        listing = await client.get("/api/v1/admin/subscribers")
        export = await client.get("/api/v1/admin/subscribers/export.csv")
        change = await client.post(
            "/api/v1/admin/subscribers/00000000-0000-0000-0000-000000000000/status",
            json={"status": "confirmed"},
            headers=CSRF,
        )
    for response in (listing, export, change):
        assert response.status_code == 403


async def test_the_export_filter_narrows_and_ignores_nonsense(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        await client.post(SUBSCRIBE, json={"email": "a@example.com", "consent": True})
        await client.post(SUBSCRIBE, json={"email": "b@example.com", "consent": True})
        await client.get(f"/api/v1/subscribe/confirm?token={await token_for(db_factory, 'a@example.com')}")

        confirmed_only = await client.get("/api/v1/admin/subscribers/export.csv?status=confirmed")
        nonsense = await client.get("/api/v1/admin/subscribers/export.csv?status=vip")

    narrowed = list(
        csv.reader(io.StringIO(confirmed_only.content.decode("utf-8").lstrip("\ufeff")))
    )
    assert len(narrowed) == 2
    assert narrowed[1][0] == "a@example.com"

    # An unknown status is no filter at all, rather than "everything except".
    everything = list(csv.reader(io.StringIO(nonsense.content.decode("utf-8").lstrip("\ufeff"))))
    assert len(everything) == 3


async def test_the_table_stays_empty_when_nobody_signed_up(db_factory, admin_settings):
    async with console(db_factory, admin_settings) as client:
        body = (await client.get("/api/v1/admin/subscribers")).json()
        export = await client.get("/api/v1/admin/subscribers/export.csv")
    assert body["total"] == 0 and body["items"] == []
    assert export.text.lstrip("\ufeff").startswith("email,")
    async with db_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Subscriber)) == 0


# ---------------------------------------------------------------------------
# The HTML form (the footer's "订阅更新" entry)
# ---------------------------------------------------------------------------

FORM = "/api/v1/subscribe/form"


async def test_the_form_is_a_scriptless_page_with_the_campaign_tag(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        page = await client.get("/api/v1/subscribe?src=bili01")
    assert page.status_code == 200
    assert page.headers["x-robots-tag"] == "noindex, nofollow"
    assert 'action="/api/v1/subscribe/form"' in page.text
    assert 'name="src" value="bili01"' in page.text
    assert "<script" not in page.text, "the form must work with no build step"


async def test_submitting_the_form_records_consent_and_shows_the_confirm_link(
    db_factory, admin_settings
):
    async with client_for(db_factory, admin_settings) as client:
        response = await client.post(
            FORM,
            data={"email": " Reader@Example.com ", "consent": "on", "src": "xiaohongshu_01"},
            headers={"referer": "https://www.xiaohongshu.com/explore/abc"},
        )
    assert response.status_code == 200, response.text
    assert "还差一步" in response.text
    assert "https://aihist.net/api/v1/subscribe/confirm?token=" in response.text

    stored = await rows(db_factory)
    assert len(stored) == 1
    row = stored[0]
    assert row.email == "reader@example.com"
    assert row.status == "pending"
    assert row.source_path == "/subscribe?src=xiaohongshu_01"
    assert row.source_channel == "social", "the profile link must not land in `other`"
    assert row.consented_at is not None


async def test_the_form_ignores_the_honeypot_and_requires_consent(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        bot = await client.post(
            FORM,
            data={"email": "bot@example.com", "consent": "on", "website": "http://spam"},
        )
        no_consent = await client.post(FORM, data={"email": "human@example.com"})
        bad_address = await client.post(FORM, data={"email": "not-an-address", "consent": "on"})
    assert bot.status_code == 200 and "已收到" in bot.text
    assert no_consent.status_code == 400 and "勾选" in no_consent.text
    assert bad_address.status_code == 400 and "邮箱格式" in bad_address.text
    assert await rows(db_factory) == []


async def test_the_form_stops_after_five_posts_from_one_caller(db_factory, admin_settings):
    async with client_for(db_factory, admin_settings) as client:
        for index in range(5):
            await client.post(
                FORM, data={"email": f"reader{index}@example.com", "consent": "on"}
            )
        blocked = await client.post(FORM, data={"email": "late@example.com", "consent": "on"})
    assert blocked.status_code == 429
    assert len(await rows(db_factory)) == 5
