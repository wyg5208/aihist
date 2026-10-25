"""End-to-end exercise of `run_sync` against recorded upstream data.

This is the only place the whole pipeline is wired together: lease, seed,
fetch, normalize, raw rows, cluster, editorial gate, insert, run row. The
upstream bodies are the same fixtures the parity tests replay, so a regression
anywhere in the chain shows up here.
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select

from app.db import repo_sync
from app.db.models import Event, RawItem, ReviewDecision, SourceHealth, SyncRun
from app.ingest.pipeline import run_sync

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import make_fixture_fetch  # noqa: E402

PANEL_ENV = {
    "EDITORIAL_JUDGE_BASE": "https://judges.invalid/v1",
    "EDITORIAL_JUDGE_KEY": "test-key",
    "EDITORIAL_JUDGE_MODELS": "alpha,beta,gamma,delta,epsilon",
}


def ballot(score: int, vote: str | None = None):
    """A panel transport that answers every candidate with the same score."""

    async def post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
        assert url.endswith("/chat/completions")
        assert key == "test-key"
        body = json.loads(payload["messages"][1]["content"])
        entries = []
        for candidate in body["candidates"]:
            entry: dict[str, Any] = {"id": candidate["id"], "score": score, "flags": [], "reason": "stub"}
            if vote:
                entry["vote"] = vote
            entries.append(entry)
        return 200, {"choices": [{"message": {"content": json.dumps(entries)}}]}

    return post


async def failing_post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
    raise TimeoutError("judge timed out")


def now() -> datetime:
    return datetime.now(timezone.utc)


async def seed_version_of(db_factory) -> str | None:
    async with db_factory() as session:
        state = await repo_sync.read_state(session)
        return state.seed_version if state else None


async def test_first_run_inserts_seed_and_collects(db_factory):
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            trigger="manual",
            now=now(),
            fetch=make_fixture_fetch(),
            editorial=False,
        )

    assert outcome["ok"] is True
    assert outcome["busy"] is False
    result = outcome["result"]
    assert result["seedInserted"] == 148
    assert result["rawCount"] > 0
    assert result["createdCount"] > 0
    assert result["status"] in ("succeeded", "partial")
    assert "seed:148" in (result["notes"] or "")

    async with db_factory() as session:
        events = await session.scalar(select(func.count()).select_from(Event))
        raw = await session.scalar(select(func.count()).select_from(RawItem))
    assert events == 148 + result["createdCount"]
    assert raw == result["rawCount"]
    assert await seed_version_of(db_factory) is not None


async def test_second_run_reuses_the_seed(db_factory):
    fetch = make_fixture_fetch()
    async with db_factory() as session:
        first = await run_sync(session, now=now(), fetch=fetch, editorial=False)
    async with db_factory() as session:
        second = await run_sync(session, now=now(), fetch=fetch, editorial=False)

    assert first["result"]["seedInserted"] == 148
    assert second["result"]["seedInserted"] == 0
    assert "seed:148" not in (second["result"]["notes"] or "")

    async with db_factory() as session:
        events = await session.scalar(select(func.count()).select_from(Event))
    assert events == 148 + second["result"]["createdCount"] + first["result"]["createdCount"]


async def test_editorial_gate_fails_closed_without_a_panel(db_factory):
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            now=now(),
            fetch=make_fixture_fetch(),
            env={},
            editorial=True,
        )

    result = outcome["result"]
    assert result["panelConfigured"] is False
    assert result["createdCount"] == 0
    assert "panel:unconfigured" in (result["notes"] or "")

    async with db_factory() as session:
        events = await session.scalar(select(func.count()).select_from(Event))
    assert events == 148, "nothing unvetted may reach the public timeline"


async def test_panel_includes_candidates(db_factory):
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            now=now(),
            fetch=make_fixture_fetch(),
            post=ballot(90),
            env=PANEL_ENV,
            editorial=True,
        )

    result = outcome["result"]
    assert result["panelConfigured"] is True
    assert result["admittedCount"] > 0
    assert result["createdCount"] > 0
    assert "panel:5/5" in (result["notes"] or "")

    async with db_factory() as session:
        accepted = (
            (
                await session.execute(
                    select(Event).where(
                        Event.origin == "auto", Event.editorial_status == "admitted"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(accepted) == result["createdCount"]
    for row in accepted:
        assert row.editorial_review is not None
        assert row.editorial_review["decision"] == "include"
        assert row.slug, "every published entry needs a permalink"


async def test_panel_excludes_low_scores(db_factory):
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            now=now(),
            fetch=make_fixture_fetch(),
            post=ballot(10),
            env=PANEL_ENV,
            editorial=True,
        )

    result = outcome["result"]
    assert result["createdCount"] == 0
    assert result["excludedCount"] > 0

    async with db_factory() as session:
        decisions = (await session.execute(select(ReviewDecision))).scalars().all()
    assert decisions, f"an exclude verdict must be cached, notes={result['notes']}"
    assert all(row.decision in ("include", "exclude") for row in decisions)


async def test_judge_failure_keeps_everything_out(db_factory):
    async with db_factory() as session:
        outcome = await run_sync(
            session,
            now=now(),
            fetch=make_fixture_fetch(),
            post=failing_post,
            env=PANEL_ENV,
            editorial=True,
        )

    result = outcome["result"]
    assert result["createdCount"] == 0
    assert "panel_failed:" in (result["notes"] or "")

    async with db_factory() as session:
        events = await session.scalar(select(func.count()).select_from(Event))
    assert events == 148


async def test_rule_and_panel_verdicts_are_disjoint(db_factory):
    batches: list[list[str]] = []

    async def recording_post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
        body = json.loads(payload["messages"][1]["content"])
        batches.append([candidate["id"] for candidate in body["candidates"]])
        return await ballot(90)(url, key, payload, timeout_ms)

    async with db_factory() as session:
        outcome = await run_sync(
            session,
            now=now(),
            fetch=make_fixture_fetch(),
            post=recording_post,
            env=PANEL_ENV,
            editorial=True,
        )

    assert batches, "the panel should have been asked about something"
    # One call per judge, each carrying the same candidate set.
    assert len(batches) == 5
    assert all(batch == batches[0] for batch in batches)
    assert len(set(batches[0])) == len(batches[0]), "a fingerprint is judged once per batch"

    async with db_factory() as session:
        rows = (await session.execute(select(ReviewDecision))).scalars().all()
    by_rule = {row.fingerprint for row in rows if row.decision_source == "rule"}
    by_panel = {row.fingerprint for row in rows if row.decision_source == "panel"}
    assert by_panel, "the panel verdicts must be cached"
    assert not by_rule & by_panel
    assert outcome["result"]["excludedCount"] >= len(by_rule)


async def test_lease_blocks_a_concurrent_run(db_factory):
    async with db_factory() as session:
        await repo_sync.acquire_lease(
            session,
            None,
            run_id=uuid.uuid4(),
            token="holder",
            now=now(),
            trigger="manual",
        )
        await session.commit()

    async with db_factory() as session:
        outcome = await run_sync(session, now=now(), fetch=make_fixture_fetch(), editorial=False)

    assert outcome["busy"] is True
    assert outcome["status"] == "busy"
    assert outcome["result"] is None


async def test_lease_is_released_after_a_run(db_factory):
    async with db_factory() as session:
        await run_sync(session, now=now(), fetch=make_fixture_fetch(), editorial=False)

    async with db_factory() as session:
        state = await repo_sync.read_state(session)
    assert state is not None
    assert state.lease_token is None
    assert state.lease_expires_at is None
    assert repo_sync.lease_is_held(state, int(now().timestamp() * 1000)) is False


async def test_each_run_is_recorded(db_factory):
    fetch = make_fixture_fetch()
    async with db_factory() as session:
        await run_sync(session, trigger="auto", now=now(), fetch=fetch, editorial=False)
    async with db_factory() as session:
        await run_sync(session, trigger="manual", now=now(), fetch=fetch, editorial=False)

    async with db_factory() as session:
        runs = (await session.execute(select(SyncRun).order_by(SyncRun.started_at))).scalars().all()
    assert [run.trigger for run in runs] == ["auto", "manual"]
    for run in runs:
        assert run.status in ("succeeded", "partial")
        assert run.finished_at is not None
    assert runs[0].notes and runs[0].notes.startswith("seed:148")


async def test_a_failing_fetch_degrades_to_partial(db_factory):
    """When every upstream is down the run is still closed, never left running."""

    async def dead_fetch(url: str):
        from app.ingest.sources import FetchResult

        return FetchResult(ok=False, status=503, url=url, text="")

    async with db_factory() as session:
        outcome = await run_sync(session, now=now(), fetch=dead_fetch, editorial=False)

    result = outcome["result"]
    assert result["status"] == "partial"
    assert len(result["failedSources"]) > 0

    async with db_factory() as session:
        runs = (await session.execute(select(SyncRun))).scalars().all()
    assert len(runs) == 1
    assert runs[0].finished_at is not None


@pytest.mark.parametrize("editorial", [False, True])
async def test_run_row_is_never_left_running(db_factory, editorial):
    async with db_factory() as session:
        await run_sync(session, now=now(), fetch=make_fixture_fetch(), editorial=editorial)

    async with db_factory() as session:
        status = await session.scalar(select(SyncRun.status))
    assert status != "running"


async def test_run_row_carries_counters_and_structured_detail(db_factory):
    """The console reads run history from columns, never by parsing `notes`."""
    async with db_factory() as session:
        outcome = await run_sync(
            session, trigger="manual", now=now(), fetch=make_fixture_fetch(), editorial=False
        )

    async with db_factory() as session:
        run = await session.get(SyncRun, uuid.UUID(outcome["runId"]))
        assert run is not None
        assert run.duration_ms > 0
        assert run.raw_count == outcome["result"]["rawCount"]
        assert run.detail is not None and "sources" in run.detail
        sources = run.detail["sources"]
        assert all({"key", "ok", "ms", "items"} <= set(entry) for entry in sources)
        assert any(entry["ok"] for entry in sources)


async def test_run_refreshes_source_health(db_factory):
    """A source that answered must show up healthy before the next run."""
    async with db_factory() as session:
        await run_sync(session, now=now(), fetch=make_fixture_fetch(), editorial=False)

    async with db_factory() as session:
        rows = (await session.execute(select(SourceHealth))).scalars().all()

    assert rows, "source_health is written by the pipeline"
    healthy = [row for row in rows if row.consecutive_failures == 0]
    assert healthy, "at least one source answered"
    assert all(row.last_ok_at is not None for row in healthy)
    assert all(row.total_runs == 1 for row in rows)


async def test_a_dead_upstream_increments_source_failures(db_factory):
    async def dead_fetch(url: str):
        from app.ingest.sources import FetchResult

        return FetchResult(ok=False, status=503, url=url, text="")

    async with db_factory() as session:
        await run_sync(session, now=now(), fetch=dead_fetch, editorial=False)

    async with db_factory() as session:
        rows = (await session.execute(select(SourceHealth))).scalars().all()

    assert rows
    for row in rows:
        assert row.consecutive_failures == 1
        assert row.total_failures == 1
        assert row.last_ok_at is None
        assert row.last_error
