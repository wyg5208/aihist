"""The archive sources: history-only, one year per backfill.

A daily run can only see what a feed still remembers. These sources exist so a
sweep can ask about 2015 at all, and the `-archive` suffix is the mode switch —
which is why these tests are about *when* the sources are fetched, not about
what they return (that is `sources.py`'s job and already parity-tested).
"""

from __future__ import annotations

import sys
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db import repo_events

from app.ingest.catalog import (
    ARCHIVE_SOURCES,
    CATALOG_SEED,
    archive_year_for,
    archive_years,
    is_archive_source,
    resolve_archive_source,
)
from app.ingest.pipeline import audit_candidate, run_sync

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import make_fixture_fetch  # noqa: E402

HF_ARCHIVE_URL = "https://huggingface.co/api/models?sort=downloads&direction=-1&limit=100"


def now() -> datetime:
    return datetime.now(timezone.utc)


def recording_fetch(seen: list[str]):
    """Fixture transport that also remembers every URL it was asked for."""
    inner = make_fixture_fetch()

    async def fetch(url: str):
        seen.append(url)
        return await inner(url)

    return fetch


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------


def test_both_archives_are_catalogued_and_enabled() -> None:
    keys = {source["key"] for source in ARCHIVE_SOURCES}
    assert keys == {"hf-archive", "arxiv-archive"}
    assert all(source["enabled"] for source in ARCHIVE_SOURCES)
    seeded = {source["key"] for source in CATALOG_SEED}
    assert keys <= seeded


def test_the_mode_switch_is_the_key_suffix() -> None:
    """`source_dict` drops unknown columns, so the suffix has to carry the flag."""
    for source in ARCHIVE_SOURCES:
        assert is_archive_source(source) is True
        # What a row looks like after the database round trip.
        assert is_archive_source({"key": source["key"], "url": source["url"]}) is True
    assert is_archive_source({"key": "hf-trending"}) is False
    assert is_archive_source({"key": "arxiv"}) is False


def test_the_archive_starts_at_2012_and_stops_at_last_year() -> None:
    years = archive_years(2026)
    assert years[0] == 2012
    assert years[-1] == 2025
    assert len(years) == 14


def test_each_turn_takes_the_next_year_and_then_wraps() -> None:
    assert archive_year_for(0, 2026) == 2012
    assert archive_year_for(1, 2026) == 2013
    assert archive_year_for(13, 2026) == 2025
    assert archive_year_for(14, 2026) == 2012


def test_the_year_placeholder_is_filled_without_touching_the_catalogue() -> None:
    arxiv = next(source for source in ARCHIVE_SOURCES if source["key"] == "arxiv-archive")
    resolved = resolve_archive_source(arxiv, 2015)

    assert "{year}" not in resolved["url"]
    assert "submittedDate:[201501010000+TO+201512312359]" in resolved["url"]
    assert resolved["kind"] == "arxiv"
    # The catalogue entry is a constant: filling it must not rewrite it, or the
    # next run would ask for 2015 again.
    assert "{year}" in arxiv["url"]


def test_a_fixed_url_is_passed_through() -> None:
    hf = next(source for source in ARCHIVE_SOURCES if source["key"] == "hf-archive")
    assert resolve_archive_source(hf, 2013) is hf
    assert hf["url"] == HF_ARCHIVE_URL


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


async def test_a_daily_run_never_asks_the_archive(db_factory) -> None:
    seen: list[str] = []
    async with db_factory() as session:
        await run_sync(session, now=now(), fetch=recording_fetch(seen), editorial=False)

    assert seen, "the run fetched nothing at all"
    assert not [url for url in seen if "sort=downloads" in url]
    assert not [url for url in seen if "submittedDate:" in url]


async def test_a_backfill_asks_one_year_and_advances(db_factory) -> None:
    seen: list[str] = []
    async with db_factory() as session:
        first = await run_sync(
            session,
            trigger="backfill",
            now=now(),
            fetch=recording_fetch(seen),
            editorial=False,
            history_min_year=1900,
        )
    year = now().year
    expected = archive_years(year)[0]

    assert "archive:" + str(expected) in (first["result"]["notes"] or "")
    assert any(f"submittedDate:[{expected}01010000" in url for url in seen)
    assert any("sort=downloads" in url for url in seen)

    seen.clear()
    async with db_factory() as session:
        second = await run_sync(
            session,
            trigger="backfill",
            now=now(),
            fetch=recording_fetch(seen),
            editorial=False,
            history_min_year=1900,
        )
    assert "archive:" + str(expected + 1) in (second["result"]["notes"] or "")
    assert any(f"submittedDate:[{expected + 1}01010000" in url for url in seen)


async def test_a_manual_run_does_not_advance_the_archive(db_factory) -> None:
    """Only a sweep owns a year; a retry of the same sweep repeats it."""
    async with db_factory() as session:
        await run_sync(session, trigger="manual", now=now(), fetch=make_fixture_fetch(),
                       editorial=False)

    seen: list[str] = []
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            trigger="backfill",
            now=now(),
            fetch=recording_fetch(seen),
            editorial=False,
            history_min_year=1900,
        )
    expected = archive_years(now().year)[0]
    assert "archive:" + str(expected) in (outcome["result"]["notes"] or "")


# ---------------------------------------------------------------------------
# The generation key survives the audit path
# ---------------------------------------------------------------------------


def _row(**overrides: Any) -> Any:
    fields = {
        "fingerprint": "fp-gemini",
        "title": "Google 发布 Gemini 3.8 Flash",
        "title_en": "Google: Gemini 3.8 Flash",
        "summary": "Google 发布 Gemini 3.8 Flash。",
        "event_date": "2026-09-02",
        "year": 2026,
        "category": "model",
        "organization": "Google",
        "model_name": "Gemini 3.8 Flash",
        "source_count": 2,
        "source_families": ["openrouter", "huggingface"],
        "sources": [],
        "meta": {},
    }
    fields.update(overrides)
    return types.SimpleNamespace(**fields)


def test_an_audited_row_keeps_its_generation() -> None:
    """Without `familyKey` a legacy row is scored as if it had no siblings."""
    candidate = audit_candidate(_row())
    assert candidate["modelKey"] == "gemini-3.8-flash"
    assert candidate["familyKey"] == "gemini-3.8"


def test_a_row_without_a_model_name_has_no_generation() -> None:
    candidate = audit_candidate(_row(model_name=None))
    assert candidate["modelKey"] == ""
    assert candidate["familyKey"] == ""


# ---------------------------------------------------------------------------
# The archive raises the row count past SQLite's parameter budget
# ---------------------------------------------------------------------------


def _ledger_row(index: int) -> dict[str, Any]:
    moment = now()
    return {
        "id": uuid.uuid4(),
        "fingerprint": f"{index:064x}",
        "source_family": "huggingface",
        "source_name": "Hugging Face 全时下载榜",
        "external_id": f"archive-{index}",
        "title": f"archive row {index}",
        "url": f"https://example.com/archive/{index}",
        "published_at": None,
        "payload": {},
        "fetched_at": moment,
        "source_key": "hf-archive",
        "run_id": None,
        "status": "pending",
        "stage": "fetch",
        "reason_code": "",
        "reason_text": "",
        "score": 0,
        "event_id": None,
        "event_fingerprint": None,
        "first_seen_at": moment,
        "last_seen_at": moment,
        "seen_count": 1,
        "decided_at": None,
    }


async def test_a_backfill_sized_batch_reaches_the_ledger(db_factory) -> None:
    """23 columns × 1,510 rows is past SQLite's 32,766 bound parameters.

    The failure mode was silent: the pipeline catches every ledger exception and
    notes `ledger_failed`, so one oversized statement dropped the whole audit
    trail for a run without failing it. The archive sources are what pushed a
    sweep over the limit (1,379 rows before, 1,510 after).
    """
    rows = [_ledger_row(index) for index in range(1510)]
    moment = now()
    verdicts = [
        {
            "id": uuid.uuid4(),
            "item_fingerprint": row["fingerprint"],
            "run_id": None,
            "stage": "fetch",
            "status": "pending",
            "reason_code": "",
            "reason_text": "",
            "score": 0,
            "event_fingerprint": None,
            "at": moment,
        }
        for row in rows
    ]

    async with db_factory() as session:
        assert await repo_events.upsert_collected(session, rows) == len(rows)

    async with db_factory() as session:
        assert await repo_events.read_collected(session, rows[-1]["fingerprint"])
        assert await repo_events.insert_verdicts(session, verdicts) == len(verdicts)
