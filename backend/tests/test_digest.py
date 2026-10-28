"""The weekly digest: who gets it, what it says, and what a failure costs.

The properties worth pinning are the ones a future edit would quietly drop:

* an address that never confirmed is never mailed, and an unsubscribed one is
  never re-added to the list by a retry;
* a week with no new entries sends nothing at all, not an empty issue;
* every message carries the reader's own unsubscribe token and a link per entry;
* one address failing does not stop the others, and the failure is written down;
* a second run inside the window does not mail anyone twice.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import digest, mailer
from app.config import Settings
from app.db import repo_growth
from app.db.models import DigestSend, Event

# A Monday, so the issue label and the window are both easy to reason about.
NOW = datetime(2026, 11, 2, 7, 10, tzinfo=timezone.utc)
ORIGIN = "https://aihist.net"


@pytest.fixture
def digest_settings() -> Settings:
    """A configured mailer without a server: `send_batch` is patched per test."""
    return Settings(
        database_url="sqlite+aiosqlite://",
        site_origin=ORIGIN,
        smtp_host="smtp.example.com",
        smtp_from="news@aihist.net",
        _env_file=None,
    )


def make_event(
    index: int,
    *,
    first_seen_at: datetime = NOW - timedelta(days=2),
    editorial_status: str | None = None,
) -> Event:
    return Event(
        fingerprint=f"fp-digest-{uuid.uuid4().hex}",
        slug=f"digest-entry-{index}",
        event_date="2026-10-30",
        sort_date="2026-10-30",
        year=2026,
        title=f"第 {index} 条新增",
        summary="模型在推理基准上取得新成绩，并公开了完整技术报告与评测方法。",
        category="model",
        importance=70 + index,
        editorial_status=editorial_status,
        first_seen_at=first_seen_at,
        updated_at=first_seen_at,
    )


async def add_events(session, count: int = 2, **overrides) -> list[Event]:
    rows = [make_event(index, **overrides) for index in range(1, count + 1)]
    session.add_all(rows)
    await session.commit()
    return rows


async def add_subscriber(session, email: str, status: str = "confirmed"):
    row = await repo_growth.create_subscriber(session, email=email)
    if status != "pending":
        await repo_growth.set_status(session, row, status)
    await session.commit()
    return row


def patch_mailer(monkeypatch, answers):
    """Replace the SMTP batch with a recorder.

    `answers` is either `(sent, error)` for every message or a callable that
    receives the list and returns one answer per message.
    """
    sent: list[tuple[str, str, str]] = []

    async def send_batch(settings, messages):
        sent.extend(messages)
        if callable(answers):
            return answers(messages)
        return [answers for _ in messages]

    monkeypatch.setattr(mailer, "send_batch", send_batch)
    return sent


async def count_sends(session) -> int:
    return int(await session.scalar(select(func.count()).select_from(DigestSend)) or 0)


async def test_a_week_with_nothing_new_sends_nothing(db_factory, digest_settings, monkeypatch):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_subscriber(session, "reader@example.com")
        # Eight days old: outside the rolling week.
        await add_events(session, 1, first_seen_at=NOW - timedelta(days=8))

        report = await digest.send_weekly(session, digest_settings, now=NOW)

        assert report.reason == "no_new_entries"
        assert report.sent == 0
        assert sent == []
        assert await count_sends(session) == 0


async def test_only_confirmed_addresses_are_mailed(db_factory, digest_settings, monkeypatch):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_events(session, 1)
        confirmed = await add_subscriber(session, "yes@example.com")
        await add_subscriber(session, "waiting@example.com", status="pending")
        await add_subscriber(session, "gone@example.com", status="unsubscribed")

        report = await digest.send_weekly(session, digest_settings, now=NOW)

        assert report.recipients == 1
        assert report.sent == 1
        assert [message[0] for message in sent] == ["yes@example.com"]
        # The reader's own token, not a shared one.
        assert f"/api/v1/unsubscribe?token={confirmed.token}" in sent[0][2]


async def test_body_carries_the_date_the_summary_the_link_and_the_way_out(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        events = await add_events(session, 2)
        await add_subscriber(session, "reader@example.com")

        report = await digest.send_weekly(session, digest_settings, now=NOW)
        body = sent[0][2]

        assert report.items == 2
        assert sent[0][1] == "[AI 纪年] 本周新增 2 条"
        assert "档案里新增 2 条。" in body
        for event in events:
            assert event.title in body
            assert event.event_date in body
            assert f"{ORIGIN}/?e={event.slug}" in body
        assert "退订：https://aihist.net/api/v1/unsubscribe?token=" in body


async def test_a_busy_week_counts_every_entry_and_lists_only_twelve(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_events(session, digest.MAX_ITEMS + 2)
        await add_subscriber(session, "reader@example.com")

        report = await digest.send_weekly(session, digest_settings, now=NOW)
        body = sent[0][2]

        # The week gained 14; the mail carries 12 of them and says both numbers.
        assert report.items == digest.MAX_ITEMS + 2
        assert sent[0][1] == "[AI 纪年] 本周新增 14 条"
        assert "档案里新增 14 条。" in body
        assert f"这里只列最新的 {digest.MAX_ITEMS} 条，其余 2 条在站点上。" in body
        assert f"\n{digest.MAX_ITEMS}. " in body
        assert f"\n{digest.MAX_ITEMS + 1}. " not in body


async def test_a_failed_address_is_recorded_and_the_list_keeps_going(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(
        monkeypatch, lambda messages: [(True, None), (False, "smtp_failed")][: len(messages)]
    )
    async with db_factory() as session:
        await add_events(session, 1)
        await add_subscriber(session, "first@example.com")
        await add_subscriber(session, "second@example.com")

        report = await digest.send_weekly(session, digest_settings, now=NOW)

        assert len(sent) == 2
        assert (report.sent, report.failed) == (1, 1)
        rows = {
            row.email: row for row in (await session.execute(select(DigestSend))).scalars()
        }
        assert rows["first@example.com"].status == "sent"
        assert rows["second@example.com"].status == "failed"
        assert rows["second@example.com"].error == "smtp_failed"


async def test_a_second_run_in_the_window_does_not_mail_twice(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_events(session, 1)
        await add_subscriber(session, "reader@example.com")

        await digest.send_weekly(session, digest_settings, now=NOW)
        again = await digest.send_weekly(
            session, digest_settings, now=NOW + timedelta(days=3)
        )

        assert again.reason == "all_delivered"
        assert again.skipped == 1
        assert len(sent) == 1
        assert await count_sends(session) == 1


async def test_a_failed_address_is_retried_on_the_next_run(
    db_factory, digest_settings, monkeypatch
):
    answers = [(False, "smtp_failed")]
    patch_mailer(monkeypatch, lambda messages: answers[: len(messages)])
    async with db_factory() as session:
        await add_events(session, 1)
        await add_subscriber(session, "reader@example.com")

        first = await digest.send_weekly(session, digest_settings, now=NOW)
        assert first.failed == 1

        answers[:] = [(True, None)]
        second = await digest.send_weekly(
            session, digest_settings, now=NOW + timedelta(days=1)
        )

        assert second.sent == 1
        attempts = sorted(
            (row.issue, row.status)
            for row in (await session.execute(select(DigestSend))).scalars()
        )
        # Two attempts, two issues: the failed row is what Monday did, the sent
        # one is what Tuesday did. The ledger records attempts, not a verdict.
        assert attempts == [("2026-11-02", "failed"), ("2026-11-03", "sent")]


async def test_force_resends_to_an_address_already_served(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_events(session, 1)
        await add_subscriber(session, "reader@example.com")

        await digest.send_weekly(session, digest_settings, now=NOW)
        forced = await digest.send_weekly(
            session, digest_settings, now=NOW, force=True
        )

        assert forced.sent == 1
        assert len(sent) == 2
        # Same issue, same address: one row, updated in place.
        assert await count_sends(session) == 1


async def test_held_and_excluded_entries_stay_out_of_the_digest(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_events(session, 1, editorial_status="hold")
        await add_subscriber(session, "reader@example.com")

        report = await digest.send_weekly(session, digest_settings, now=NOW)

        assert report.reason == "no_new_entries"
        assert sent == []


async def test_dry_run_prints_a_body_and_writes_nothing(
    db_factory, digest_settings, monkeypatch
):
    sent = patch_mailer(monkeypatch, (True, None))
    async with db_factory() as session:
        await add_events(session, 1)
        await add_subscriber(session, "reader@example.com")

        report = await digest.send_weekly(
            session, digest_settings, now=NOW, dry_run=True
        )

        assert report.reason == "dry_run"
        assert "第 1 条新增" in report.sample
        assert sent == []
        assert await count_sends(session) == 0


async def test_an_unconfigured_mailer_sends_nothing(db_factory, monkeypatch):
    sent = patch_mailer(monkeypatch, (True, None))
    settings = Settings(
        database_url="sqlite+aiosqlite://", site_origin=ORIGIN, _env_file=None
    )
    async with db_factory() as session:
        await add_events(session, 1)
        await add_subscriber(session, "reader@example.com")

        report = await digest.send_weekly(session, settings, now=NOW)

        assert report.reason == "smtp_not_configured"
        assert sent == []
        assert await count_sends(session) == 0


def test_brief_collapses_whitespace_and_prefers_a_sentence_end():
    # Chinese prose has no spaces at a line break, so none is introduced.
    assert digest.brief("  第一句。\n第二句。  ") == "第一句。第二句。"
    # A space that belongs between a Latin token and Chinese stays.
    assert digest.brief("GPT-4 的对手") == "GPT-4 的对手"
    long = "甲" * 200
    assert digest.brief(long, limit=20).endswith("…")
    assert len(digest.brief(long, limit=20)) == 21
    sentence = "这是一句足够短的结论。" + "乙" * 200
    assert digest.brief(sentence, limit=20) == "这是一句足够短的结论。"


def test_event_link_falls_back_to_the_archive_root():
    assert digest.event_link(ORIGIN, "some-slug") == f"{ORIGIN}/?e=some-slug"
    assert digest.event_link(ORIGIN + "/", None) == f"{ORIGIN}/"
