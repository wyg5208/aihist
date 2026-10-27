"""Failure handling in `load_source`: typed codes, one retry, shared deadline.

The 2026-10-27 sync reported eight sources as `timeout` and the log could not say
which of them hung, which failed to resolve, or which were refused — every
`httpx.HTTPError` became the same word. These tests pin the three properties that
make such a night diagnosable: the code names the failure, a blip is retried
once, and a permanent answer is not.
"""

from __future__ import annotations

import asyncio
import socket
import time
from typing import Any

import httpx
import pytest

from app.ingest.pipeline import _failure_note
from app.ingest.sources import (
    RETRY_TIMEOUT_MS,
    SOURCE_TIMEOUT_MS,
    SOURCES,
    FetchResult,
    SourceFailure,
    _fetch_error_code,
    httpx_fetch,
    load_source,
)

FEED = (
    "<rss><channel><item><title>量子位 · 一条新闻</title>"
    "<link>https://www.qbitai.com/2026/10/1.html</link>"
    "<pubDate>Mon, 27 Oct 2026 09:00:00 +0800</pubDate></item></channel></rss>"
)

SOURCE: dict[str, Any] = {
    "key": "qbitai",
    "family": "media",
    "name": "量子位",
    "kind": "feed",
    "url": "https://www.qbitai.com/feed",
    "timeout": SOURCE_TIMEOUT_MS,
}


def ok_fetch(url: str) -> FetchResult:
    return FetchResult(ok=True, status=200, url=url, text=FEED)


def deadline_in(ms: int) -> int:
    return int(time.time() * 1000) + ms


# --- the code has to name the failure ----------------------------------------


def dns_error() -> httpx.ConnectError:
    """The chain httpcore really produces: ConnectError -> ConnectError -> gaierror."""
    inner = httpx.ConnectError("All connection attempts failed")
    inner.__cause__ = socket.gaierror(11001, "getaddrinfo failed")
    outer = httpx.ConnectError("All connection attempts failed")
    outer.__cause__ = inner
    return outer


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (httpx.ReadTimeout("read timed out"), "timeout"),
        (httpx.ConnectTimeout("connect timed out"), "timeout"),
        (httpx.RemoteProtocolError("peer closed connection"), "protocol"),
        (httpx.ConnectError("connection refused"), "network"),
        (httpx.ProxyError("proxy refused"), "network"),
        (dns_error(), "dns"),
    ],
)
def test_a_transport_error_keeps_its_identity(error: BaseException, code: str) -> None:
    assert _fetch_error_code(error) == code  # type: ignore[arg-type]


async def test_httpx_fetch_no_longer_calls_everything_a_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refused(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> Any:
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx.AsyncClient, "get", refused)

    with pytest.raises(SourceFailure) as caught:
        await httpx_fetch("https://www.qbitai.com/feed", timeout_ms=1_000)

    assert caught.value.code == "network"
    assert str(caught.value) == "network"


# --- one retry, and only for a blip -------------------------------------------


async def test_a_blip_is_retried_once_and_then_succeeds() -> None:
    calls: list[str] = []

    async def fetch(url: str) -> FetchResult:
        calls.append(url)
        if len(calls) == 1:
            raise SourceFailure("network")
        return ok_fetch(url)

    result = await load_source(SOURCE, fetch=fetch, deadline_ms=deadline_in(60_000))

    assert result["ok"] is True
    assert result["attempts"] == 2
    assert len(calls) == 2
    assert len(result["items"]) == 1


async def test_a_permanent_answer_is_not_retried() -> None:
    calls: list[str] = []

    async def fetch(url: str) -> FetchResult:
        calls.append(url)
        return FetchResult(ok=False, status=404, url=url)

    result = await load_source(SOURCE, fetch=fetch, deadline_ms=deadline_in(60_000))

    assert result["ok"] is False
    assert result["error"] == "http_404"
    assert result["attempts"] == 1
    assert len(calls) == 1


async def test_a_parse_error_is_not_retried() -> None:
    calls: list[str] = []

    async def fetch(url: str) -> FetchResult:
        calls.append(url)
        return FetchResult(ok=True, status=200, url=url, text="<rss></rss>" + " " * 40)

    result = await load_source(SOURCE, fetch=fetch, deadline_ms=deadline_in(60_000))

    assert result["error"] == "empty_source"
    assert len(calls) == 1


async def test_the_retry_is_skipped_once_the_budget_is_spent() -> None:
    calls: list[str] = []

    async def fetch(url: str) -> FetchResult:
        calls.append(url)
        await asyncio.sleep(0.15)
        raise SourceFailure("timeout")

    # 300 ms of budget, 150 ms gone by the time the first attempt fails: the
    # remaining slice is under the 250 ms floor, so no second call is made.
    result = await load_source(SOURCE, fetch=fetch, deadline_ms=deadline_in(300))

    assert result["ok"] is False
    assert result["error"] == "timeout"
    assert result["attempts"] == 1
    assert len(calls) == 1


async def test_a_spent_deadline_does_not_even_try() -> None:
    calls: list[str] = []

    async def fetch(url: str) -> FetchResult:
        calls.append(url)
        return ok_fetch(url)

    result = await load_source(
        SOURCE, fetch=fetch, deadline_ms=int(time.time() * 1000) - 1
    )

    assert result["error"] == "deadline"
    assert result["attempts"] == 0
    assert calls == []


# --- the wider budget still fits the run --------------------------------------


def test_every_source_gets_the_wider_budget() -> None:
    assert SOURCE_TIMEOUT_MS >= 12_000
    assert RETRY_TIMEOUT_MS <= 5_000
    assert {source["timeout"] for source in SOURCES} == {SOURCE_TIMEOUT_MS}

    # 17 sources over 5 slots is four waves; the worst case has to stay inside
    # the 120 s fetch budget with room for the panel stage that follows.
    waves = -(-len(SOURCES) // 5)
    assert waves * (SOURCE_TIMEOUT_MS + RETRY_TIMEOUT_MS) < 120_000


# --- the log line carries the timing ------------------------------------------


def test_the_failure_note_carries_the_elapsed_time() -> None:
    note = _failure_note(
        [
            {"key": "arxiv", "error": "timeout", "ms": 12_002},
            {"key": "infoq", "error": "network", "ms": 613},
        ]
    )
    assert note == "failed:arxiv=timeout(12002ms),infoq=network(613ms)"


def test_the_failure_note_survives_a_missing_code_and_timing() -> None:
    assert _failure_note([{"key": "arxiv"}]) == "failed:arxiv=unknown"
