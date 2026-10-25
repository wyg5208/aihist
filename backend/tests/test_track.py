"""The beacon: always 204, never identifying, and honest about the clock.

The properties worth pinning are the ones a future refactor would quietly break:
the response code never varies, no raw IP or client id reaches a column, the
calendar day is UTC+8 rather than UTC, and the off switch really writes nothing.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.analytics import local_day
from app.analytics.ua import classify_ua, detect_crawler
from app.api import track as track_api
from app.config import Settings
from app.db.models import PageView

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import client_for  # noqa: E402

BEACON = "/api/v1/track"

CHROME = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
GPTBOT = (
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; "
    "+https://openai.com/gptbot"
)


@pytest.fixture(autouse=True)
def clear_rate_limit():
    track_api.reset_rate_limit()
    yield
    track_api.reset_rate_limit()


def settings_for(enabled: bool = True) -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite://",
        session_secret="test-secret",
        analytics_salt="test-salt",
        analytics_enabled=enabled,
        site_origin="https://aihist.net",
        _env_file=None,
    )


async def rows(db_factory) -> list[PageView]:
    async with db_factory() as session:
        result = await session.execute(select(PageView).order_by(PageView.at))
        return list(result.scalars().all())


async def count(db_factory) -> int:
    async with db_factory() as session:
        return await session.scalar(select(func.count()).select_from(PageView)) or 0


async def send(client, **body):
    return await client.post(
        BEACON, json=body, headers={"user-agent": CHROME, "x-forwarded-for": "203.0.113.9"}
    )


# ---------------------------------------------------------------------------
# Pure classification
# ---------------------------------------------------------------------------


def test_the_calendar_day_is_utc_plus_eight():
    """16:00 UTC is already tomorrow in the only timezone this site reports in."""
    assert local_day(datetime(2026, 1, 1, 15, 59, tzinfo=timezone.utc)) == "2026-01-01"
    assert local_day(datetime(2026, 1, 1, 16, 0, tzinfo=timezone.utc)) == "2026-01-02"


def test_ai_crawlers_are_separated_from_search_crawlers():
    assert detect_crawler(GPTBOT) == ("GPTBot", True)
    assert detect_crawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)") == (
        "Googlebot",
        False,
    )
    assert detect_crawler("Mozilla/5.0 (compatible; Applebot-Extended/0.1)")[1] is True
    assert detect_crawler(CHROME) == ("", False)


def test_classify_ua_labels_browsers_and_devices():
    assert classify_ua(CHROME) == ("chrome", "desktop")
    iphone = (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    )
    assert classify_ua(iphone) == ("safari", "mobile")
    wechat = (
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.42"
    )
    assert classify_ua(wechat) == ("wechat", "mobile")
    assert classify_ua(GPTBOT) == ("bot", "bot")
    assert classify_ua("") == ("other", "desktop")


def test_channel_and_page_kind_buckets():
    classify = track_api.classify_channel
    assert classify("", "aihist.net") == "direct"
    assert classify("https://aihist.net/timeline", "aihist.net") == "internal"
    assert classify("https://www.perplexity.ai/search", "aihist.net") == "ai"
    assert classify("https://chatgpt.com/", "aihist.net") == "ai"
    assert classify("https://www.google.com/", "aihist.net") == "search"
    assert classify("https://news.ycombinator.com/", "aihist.net") == "social"
    assert classify("https://example.org/post", "aihist.net") == "other"

    kind = track_api.page_kind
    assert kind("/") == "home"
    assert kind("/?e=some-slug") == "event"
    assert kind("/e/some-slug.html") == "event"
    assert kind("/admin") == "admin"
    assert kind("/timeline") == "other"


# ---------------------------------------------------------------------------
# The endpoint
# ---------------------------------------------------------------------------


async def test_a_beacon_is_recorded_without_storing_the_caller(db_factory):
    client_settings = settings_for()
    async with client_for(db_factory, client_settings) as client:
        response = await send(
            client,
            path="/?e=gpt-4",
            referrer="https://chatgpt.com/c/abc",
            lang="zh-CN",
            sid="abcdefghijklmnop1234",
            vid="abcdefghijklmnop5678",
        )
    assert response.status_code == 204
    assert response.content == b""

    stored = await rows(db_factory)
    assert len(stored) == 1
    row = stored[0]
    assert row.path == "/?e=gpt-4"
    assert row.page_kind == "event"
    assert row.channel == "ai"
    assert row.referrer_host == "chatgpt.com"
    assert row.lang == "zh-CN"
    assert row.ua_family == "chrome" and row.device == "desktop" and row.is_bot is False
    assert len(row.visitor_hash) == 64 and len(row.session_hash) == 64
    assert row.visitor_hash != "abcdefghijklmnop5678"

    # Nothing identifying survived the write.
    for value in (
        row.visitor_hash,
        row.session_hash,
        row.referrer_host,
        row.ua_family,
        row.lang,
        row.path,
    ):
        assert "203.0.113.9" not in value
        assert "abcdefghijklmnop" not in value


async def test_the_row_day_matches_the_utc8_calendar(db_factory):
    async with client_for(db_factory, settings_for()) as client:
        await send(client, path="/")
    row = (await rows(db_factory))[0]
    assert row.day == local_day(row.at)


async def test_a_crawler_ua_is_flagged(db_factory):
    async with client_for(db_factory, settings_for()) as client:
        await client.post(BEACON, json={"path": "/e/gpt-4.html"}, headers={"user-agent": GPTBOT})
    row = (await rows(db_factory))[0]
    assert row.is_bot is True
    assert row.ua_family == "bot"
    assert row.page_kind == "event"


async def test_every_malformed_beacon_still_answers_204(db_factory):
    async with client_for(db_factory, settings_for()) as client:
        not_a_path = await send(client, path="javascript:alert(1)")
        missing_path = await send(client, referrer="https://example.org")
        wrong_types = await send(client, path=42, vid=["x"])
        # A body that is not an object at all.
        raw = await client.post(BEACON, content=b"not json", headers={"user-agent": CHROME})

    for response in (not_a_path, missing_path, wrong_types, raw):
        assert response.status_code == 204
    assert await count(db_factory) == 0


async def test_an_oversized_path_is_truncated_not_rejected(db_factory):
    async with client_for(db_factory, settings_for()) as client:
        await send(client, path="/" + "a" * 500)
    row = (await rows(db_factory))[0]
    assert len(row.path) == 300


async def test_a_bogus_client_id_is_dropped_not_stored(db_factory):
    async with client_for(db_factory, settings_for()) as client:
        await send(client, path="/", vid="a" * 500, sid="short")
    row = (await rows(db_factory))[0]
    assert row.visitor_hash == ""
    assert row.session_hash == ""


async def test_the_rate_limit_drops_the_surplus(db_factory):
    async with client_for(db_factory, settings_for()) as client:
        codes = set()
        for index in range(track_api.RATE_LIMIT + 5):
            response = await send(client, path=f"/?n={index}")
            codes.add(response.status_code)

    assert codes == {204}, "a throttled beacon is not distinguishable from a recorded one"
    assert await count(db_factory) == track_api.RATE_LIMIT


async def test_the_switch_turns_the_beacon_off(db_factory):
    async with client_for(db_factory, settings_for(enabled=False)) as client:
        response = await send(client, path="/")
    assert response.status_code == 204
    assert await count(db_factory) == 0
