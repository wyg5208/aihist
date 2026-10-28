"""The collection ledger, end to end.

Every item a run sees ends up in `raw_items` with a disposition, and every
disposition change ends up in the append-only `collect_verdicts`. These tests
pin the properties the console relies on:

* one row per item, not one per sighting;
* a trail that only grows, and never loses a fingerprint it wrote before;
* a funnel whose buckets add up to what was parsed;
* no exclusion without a code from the shared vocabulary, and — when a panel
  decided it — a bridge to the cached ballot.
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from app.db.models import CollectVerdict, RawItem, ReviewDecision, SyncRun
from app.ingest import reasons
from app.ingest.pipeline import run_sync

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import make_fixture_fetch  # noqa: E402

PANEL_ENV = {
    "EDITORIAL_JUDGE_BASE": "https://judges.invalid/v1",
    "EDITORIAL_JUDGE_KEY": "test-key",
    "EDITORIAL_JUDGE_MODELS": "alpha,beta,gamma,delta,epsilon",
}


def ballot(score: int, vote: str | None = None):
    async def post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
        body = json.loads(payload["messages"][1]["content"])
        entries: list[dict[str, Any]] = []
        for candidate in body["candidates"]:
            entry: dict[str, Any] = {
                "id": candidate["id"],
                "score": score,
                "flags": [],
                "reason": "stub",
            }
            if vote:
                entry["vote"] = vote
            entries.append(entry)
        return 200, {"choices": [{"message": {"content": json.dumps(entries)}}]}

    return post


def now() -> datetime:
    return datetime.now(timezone.utc)


async def collect(db_factory, *, editorial: bool = False, post=None) -> dict[str, Any]:
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            trigger="manual",
            now=now(),
            fetch=make_fixture_fetch(),
            post=post,
            env=PANEL_ENV if post else {},
            editorial=editorial,
        )
    assert outcome["ok"] is True, outcome
    return outcome


async def rows_of(db_factory, model) -> list[Any]:
    async with db_factory() as session:
        return list((await session.execute(select(model))).scalars().all())


# ---------------------------------------------------------------------------
# Intake
# ---------------------------------------------------------------------------


async def test_every_parsed_item_lands_in_one_row(db_factory):
    outcome = await collect(db_factory)
    result = outcome["result"]

    items = await rows_of(db_factory, RawItem)
    assert len(items) == result["rawCount"]
    assert len({row.fingerprint for row in items}) == len(items), "one row per item"
    assert result["detail"]["funnel"]["parsed"] == len(items)


async def test_the_run_row_carries_the_funnel(db_factory):
    outcome = await collect(db_factory)
    async with db_factory() as session:
        run = await session.get(SyncRun, uuid.UUID(outcome["runId"]))
    assert run is not None and run.detail is not None
    funnel = run.detail["funnel"]
    # `dropped` is the reason histogram; `droppedTotal` is the bucket.
    buckets = ("admitted", "excluded", "held", "droppedTotal", "pending")
    assert sum(funnel[name] for name in buckets) == funnel["parsed"]
    assert sum(funnel["dropped"].values()) == funnel["droppedTotal"]
    assert funnel["fetched"] >= funnel["parsed"], "parsing can only lose items"
    assert isinstance(run.detail["verdicts"], dict)


async def test_a_second_sighting_updates_instead_of_duplicating(db_factory):
    first = await collect(db_factory)
    seen_after_first = {row.fingerprint: row.seen_count for row in await rows_of(db_factory, RawItem)}

    second = await collect(db_factory)

    items = await rows_of(db_factory, RawItem)
    assert len(items) == len(seen_after_first), "the same feed must not grow the table"
    assert len(items) == second["result"]["rawCount"]
    for row in items:
        assert row.seen_count == seen_after_first[row.fingerprint] + 1
    assert first["result"]["rawCount"] == second["result"]["rawCount"]


# ---------------------------------------------------------------------------
# Trail
# ---------------------------------------------------------------------------


async def test_the_trail_only_grows_and_covers_every_item(db_factory):
    await collect(db_factory)
    after_first = await rows_of(db_factory, CollectVerdict)

    await collect(db_factory)
    after_second = await rows_of(db_factory, CollectVerdict)

    assert len(after_second) >= len(after_first)
    assert {row.id for row in after_first} <= {row.id for row in after_second}, (
        "the trail is append-only"
    )

    items = await rows_of(db_factory, RawItem)
    covered = {row.item_fingerprint for row in after_second}
    assert {row.fingerprint for row in items} <= covered, "every item has at least one line"


async def test_the_trail_never_invents_a_fingerprint(db_factory):
    await collect(db_factory, editorial=True, post=ballot(90))
    items = await rows_of(db_factory, RawItem)
    trail = await rows_of(db_factory, CollectVerdict)

    known = {row.fingerprint for row in items}
    assert {row.item_fingerprint for row in trail} <= known


async def test_every_verdict_uses_the_shared_vocabulary(db_factory):
    await collect(db_factory, editorial=True, post=ballot(10))
    trail = await rows_of(db_factory, CollectVerdict)
    items = await rows_of(db_factory, RawItem)

    known = set(reasons.all_codes())
    for row in [*trail, *items]:
        code = row.reason_code
        if not code:
            # An admitted row may legitimately carry no code.
            continue
        assert (
            code in known
            or code.startswith(reasons.RULE_PREFIX)
            or code.startswith(reasons.MANUAL_PREFIX)
        ), f"unknown reason code {code!r}"
        assert reasons.label_of(code) != code or code.startswith(reasons.RULE_PREFIX), (
            f"{code} has no label"
        )


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------


async def test_a_panel_exclusion_bridges_to_the_cached_ballot(db_factory):
    outcome = await collect(db_factory, editorial=True, post=ballot(10))
    assert outcome["result"]["excludedCount"] > 0

    items = await rows_of(db_factory, RawItem)
    decisions = await rows_of(db_factory, ReviewDecision)
    cached = {row.id for row in decisions}

    excluded = [row for row in items if row.status == "excluded"]
    assert excluded, "the stub panel rejected everything"
    for row in excluded:
        assert (
            row.reason_code in ("panel:exclude", "score_low")
            or row.reason_code.startswith(reasons.RULE_PREFIX)
        ), row.reason_code
        if row.event_fingerprint is None:
            # A deterministic rule rejects before any ballot exists to join.
            continue
        assert row.event_fingerprint in cached


async def test_an_admitted_item_points_at_the_event_it_became(db_factory):
    outcome = await collect(db_factory, editorial=True, post=ballot(90))
    assert outcome["result"]["admittedCount"] > 0

    items = await rows_of(db_factory, RawItem)
    admitted = [row for row in items if row.status == "admitted"]
    assert admitted
    assert any(row.event_fingerprint for row in admitted)


async def test_the_numbers_on_the_page_match_the_funnel(db_factory):
    outcome = await collect(db_factory, editorial=True, post=ballot(90))
    async with db_factory() as session:
        counted = {
            status: int(count)
            for status, count in (
                await session.execute(
                    select(RawItem.status, func.count()).group_by(RawItem.status)
                )
            ).all()
        }
    funnel = outcome["result"]["detail"]["funnel"]
    assert counted.get("admitted", 0) == funnel["admitted"]
    assert counted.get("excluded", 0) == funnel["excluded"]
    assert counted.get("held", 0) == funnel["held"]
    assert counted.get("dropped", 0) == funnel["droppedTotal"]
    assert counted.get("pending", 0) == funnel["pending"]
