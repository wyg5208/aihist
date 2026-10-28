"""The source catalogue as a table: seeding, fallback, keys, and the URL guard.

Two invariants carry the whole feature and are asserted here rather than
implied by the pipeline tests:

* an empty table answers with the frozen seed, so every pre-existing test (and a
  fresh install) keeps collecting the same seventeen sources;
* a row that exists is never overwritten, so an operator edit survives a deploy.
"""

from __future__ import annotations

import ipaddress
import socket
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.api import admin_sources
from app.db.models import IngestSource
from app.ingest import catalog, registry
from app.ingest.catalog import CATALOG_SEED, SEED_SOURCES
from app.ingest.registry import _seed_row


def as_ip_or_public(host: str) -> list[str]:
    """A resolver that never touches the network but still answers honestly.

    A literal address resolves to itself (that is what makes the loopback and
    link-local cases real); anything else is treated as a public name.
    """
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return ["93.184.216.34"]
    return [host]


@pytest.fixture(autouse=True)
def offline_resolver(monkeypatch):
    async def resolve(host: str) -> list[str]:
        return as_ip_or_public(host)

    monkeypatch.setattr(admin_sources, "_resolve", resolve)


def test_the_seed_is_the_seventeen_frozen_sources():
    """`test_sources_parity` indexes this list positionally."""
    assert SEED_SOURCES is catalog.SEED_SOURCES
    assert len(SEED_SOURCES) == 17
    assert CATALOG_SEED[: len(SEED_SOURCES)] == SEED_SOURCES
    assert len(CATALOG_SEED) > len(SEED_SOURCES), "extension candidates live in EXTRA_SOURCES"


def test_every_candidate_names_a_known_family_and_kind():
    for source in CATALOG_SEED:
        assert source["family"] in catalog.FAMILIES, source["key"]
        assert source["kind"] in catalog.KINDS, source["key"]
        assert source["url"].startswith("http"), source["key"]
    assert "policy" in catalog.FAMILIES
    assert catalog.FAMILY_LABELS["policy"] == "监管原文"


async def test_seeding_is_idempotent_and_keeps_operator_edits(db_session):
    first = await registry.ensure_catalog(db_session)
    assert first == len(CATALOG_SEED)
    assert await registry.ensure_catalog(db_session) == 0, "a second seed adds nothing"

    row = await registry.get_source(db_session, "openai")
    assert row is not None
    row.name = "OpenAI (renamed by an operator)"
    row.enabled = False
    await db_session.commit()

    assert await registry.ensure_catalog(db_session) == 0, "nothing was deleted, nothing re-added"
    again = await registry.get_source(db_session, "openai")
    assert again is not None
    assert again.name == "OpenAI (renamed by an operator)"
    assert again.enabled is False


async def test_an_empty_table_falls_back_to_the_frozen_seed(db_session):
    """No rows, no fixtures: the pipeline must still collect the seventeen."""
    enabled = await registry.enabled_sources(db_session)
    assert [source["key"] for source in enabled] == [source["key"] for source in SEED_SOURCES]
    assert all(source["enabled"] for source in enabled)

    everything = await registry.all_sources(db_session)
    assert len(everything) == len(SEED_SOURCES)


async def test_a_disabled_source_is_not_fetched_but_stays_listed(db_session):
    await registry.ensure_catalog(db_session)
    row = await registry.get_source(db_session, "techcrunch")
    assert row is not None
    row.enabled = False
    await db_session.commit()

    enabled = {source["key"] for source in await registry.enabled_sources(db_session)}
    listed = {source["key"] for source in await registry.all_sources(db_session)}

    assert "techcrunch" not in enabled
    assert "techcrunch" in listed, "the catalogue answers 'what could we collect'"


async def test_allowed_hosts_come_from_registered_config_only(db_session):
    """A redirect may only reach a host someone registered, never an item's URL."""
    before = await registry.allowed_hosts(db_session)
    assert "openai.com" in before or any(host.endswith("openai.com") for host in before)

    row = _seed_row(
        {
            "key": "probe-target",
            "name": "Probe Target",
            "family": "official",
            "kind": "feed",
            "url": "https://probe-target.invalid/feed.xml",
        },
        datetime.now(timezone.utc),
    )
    db_session.add(IngestSource(**row))
    await db_session.commit()

    after = await registry.allowed_hosts(db_session)
    assert "probe-target.invalid" in after
    assert "evil.example" not in after


async def test_a_disabled_source_does_not_widen_the_allow_list(db_session):
    await registry.ensure_catalog(db_session)
    row = await registry.get_source(db_session, "nist")
    assert row is not None
    row.enabled = False
    await db_session.commit()

    allowed = await registry.allowed_hosts(db_session)
    assert "www.nist.gov" not in allowed


@pytest.mark.parametrize(
    "key",
    ["openrouter", "arxiv", "hf-trending", "hn-llm", "with space", "x", "9"],
)
def test_reserved_and_malformed_keys_are_refused(key):
    with pytest.raises(ValueError):
        catalog.validate_key(key)


@pytest.mark.parametrize("key", ["nist", "eu-digital", "my-feed-2026", "a1"])
def test_ordinary_keys_normalise(key):
    assert catalog.validate_key(key.upper()) == key


# ---------------------------------------------------------------------------
# SSRF guard: the one place console input reaches the network
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "detail"),
    [
        ("http://127.0.0.1/feed", "private_address"),
        ("http://169.254.169.254/latest/meta-data", "private_address"),
        ("http://[::1]/feed", "private_address"),
        ("file:///etc/passwd", "invalid_scheme"),
        ("ftp://example.com/feed", "invalid_scheme"),
        ("https://user:pass@example.com/feed", "userinfo_not_allowed"),
        ("https://example.com:2222/feed", "port_not_allowed"),
        ("https:///feed", "invalid_url"),
    ],
)
async def test_the_url_guard_refuses_private_targets_and_credentials(url, detail):
    with pytest.raises(HTTPException) as caught:
        await admin_sources.validate_source_url(url)
    assert caught.value.status_code == 400
    assert caught.value.detail == detail


@pytest.mark.parametrize(
    "url",
    [
        "https://www.nist.gov/news-events/news/rss.xml",
        "http://example.com:8080/feed.xml",
        "https://example.com/feed",
    ],
)
async def test_a_public_http_url_passes(url):
    host = await admin_sources.validate_source_url(url)
    assert host == "example.com" or host.endswith("nist.gov")


async def test_a_name_that_does_not_resolve_is_left_to_the_probe(monkeypatch):
    """Rejecting on DNS failure would refuse a feed whose resolver is briefly down."""

    async def boom(host: str) -> list[str]:
        raise socket.gaierror("no such host")

    monkeypatch.setattr(admin_sources, "_resolve", boom)
    assert await admin_sources.validate_source_url("https://nowhere.invalid/feed") == "nowhere.invalid"


async def test_an_overlong_url_is_refused():
    url = "https://example.com/" + "a" * admin_sources.MAX_URL_LENGTH
    with pytest.raises(HTTPException) as caught:
        await admin_sources.validate_source_url(url)
    assert caught.value.detail == "invalid_url"
