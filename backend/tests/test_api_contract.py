"""Contract tests against the frozen responses of the previous deployment.

The fixture `golden/api-*.json` was produced by running the real Reference
handler over the 148 frozen seeds (`scripts/export-api-golden.mjs`). Every key
in those files must exist, with the same name and nesting, in the Python
response — a silently renamed field would render as an empty cell in the React
app with no error anywhere.

Values are compared where they are deterministic (slugs, counts, the standard
snapshot). Row identifiers, timestamps and the panel's configured/models/reason
trio are not.

The standard document was re-baselined once on purpose: the panel grew from
three judges / two votes to five vendors / three votes (`editorial/rules.py`)
and the rubric version moved to `chronicle-v2`. Those fields are the only values
that differ from the original reference snapshot, and `test_standard_contract`
pins the current policy, not the old one.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

GOLDEN_DIR = Path(__file__).resolve().parent / "fixtures" / "golden"


def golden_api(name: str) -> dict:
    """A frozen response of the reference handler (`scripts/export-api-golden.mjs`)."""
    with (GOLDEN_DIR / f"api-{name.replace('_', '-')}.json").open(encoding="utf-8") as handle:
        return json.load(handle)


VOLATILE_EVENT_KEYS = {"id", "firstSeenAt", "updatedAt"}
VOLATILE_SYNC_KEYS = {"lastSuccessAt", "lastAttemptAt", "stale"}


def keys_of(value: dict) -> set[str]:
    return set(value.keys())


def assert_same_keys(actual: dict, expected: dict, *, context: str, ignore=()) -> None:
    wanted = keys_of(expected) - set(ignore)
    got = keys_of(actual) - set(ignore)
    missing = wanted - got
    extra = got - wanted
    assert not missing, f"{context}: missing keys {sorted(missing)}"
    assert not extra, f"{context}: unexpected keys {sorted(extra)}"


# ---------------------------------------------------------------------------
# Empty database
# ---------------------------------------------------------------------------


async def test_timeline_is_empty_on_a_fresh_database(api_client):
    response = await api_client.get("/api/v1/timeline")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["items"] == []
    assert body["total"] == 0
    assert body["truncated"] is False


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------


async def test_timeline_contract(api_client, seeded_db):
    golden = golden_api("timeline")
    response = await api_client.get("/api/v1/timeline")
    assert response.status_code == 200
    body = response.json()

    assert_same_keys(body, golden, context="timeline")
    assert_same_keys(body["sync"], golden["sync"], context="timeline.sync", ignore=VOLATILE_SYNC_KEYS)
    assert_same_keys(body["items"][0], golden["items"][0], context="timeline.items[0]")

    assert body["total"] == golden["total"] == 148
    assert body["truncated"] == golden["truncated"] is False
    assert [item["slug"] for item in body["items"]] == [
        item["slug"] for item in golden["items"]
    ]


async def test_timeline_item_values_match(api_client, seeded_db):
    golden = golden_api("timeline")
    body = (await api_client.get("/api/v1/timeline")).json()

    for actual, expected in zip(body["items"], golden["items"], strict=True):
        comparable = {k: v for k, v in actual.items() if k not in VOLATILE_EVENT_KEYS}
        reference = {k: v for k, v in expected.items() if k not in VOLATILE_EVENT_KEYS}
        assert comparable == reference, f"item {expected['slug']}"


async def test_timeline_filters(api_client, seeded_db):
    filtered = (await api_client.get("/api/v1/timeline", params={"category": "policy"})).json()
    assert filtered["total"] > 0
    assert all(item["category"] == "policy" for item in filtered["items"])

    year = (await api_client.get("/api/v1/timeline", params={"year": "2023"})).json()
    assert all(item["year"] == 2023 for item in year["items"])

    limited = (await api_client.get("/api/v1/timeline", params={"limit": "10"})).json()
    assert len(limited["items"]) == 10
    assert limited["truncated"] is True


@pytest.mark.parametrize(
    ("params", "detail"),
    [
        ({"limit": "0"}, "invalid_limit"),
        ({"limit": "010"}, "invalid_limit"),
        ({"limit": "5000"}, "invalid_limit"),
        ({"category": "nope"}, "invalid_category"),
        ({"confidence": "maybe"}, "invalid_confidence"),
        ({"year": "1800"}, "invalid_year"),
    ],
)
async def test_timeline_rejects_bad_parameters(api_client, params, detail):
    response = await api_client.get("/api/v1/timeline", params=params)
    assert response.status_code == 400
    assert response.json()["detail"] == detail


# ---------------------------------------------------------------------------
# Event detail
# ---------------------------------------------------------------------------


async def test_event_by_slug_contract(api_client, seeded_db):
    golden = golden_api("event")
    slug = golden["event"]["slug"]

    response = await api_client.get(f"/api/v1/events/{slug}")
    assert response.status_code == 200
    body = response.json()

    assert_same_keys(body, golden, context="event")
    assert_same_keys(body["event"], golden["event"], context="event.event")

    for key, expected in golden["event"].items():
        if key in VOLATILE_EVENT_KEYS:
            continue
        assert body["event"][key] == expected, f"event.{key}"


async def test_event_by_id_matches_by_slug(api_client, seeded_db):
    golden = golden_api("event")
    by_slug = (await api_client.get(f"/api/v1/events/{golden['event']['slug']}")).json()

    event_id = by_slug["event"]["id"]
    by_id = (await api_client.get("/api/v1/events", params={"id": event_id})).json()
    assert by_id["event"] == by_slug["event"]


async def test_event_by_id_golden_keys(api_client, seeded_db):
    golden = golden_api("event_by_id")
    response = await api_client.get(
        f"/api/v1/events/{golden['event']['slug']}"
    )
    assert_same_keys(response.json()["event"], golden["event"], context="event_by_id.event")


async def test_event_unknown_slug_is_404(api_client, seeded_db):
    response = await api_client.get("/api/v1/events/does-not-exist-2024")
    assert response.status_code == 404
    assert response.json()["detail"] == "not_found"


async def test_event_invalid_slug_is_400(api_client, seeded_db):
    response = await api_client.get("/api/v1/events/Not_A_Slug")
    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_slug"


async def test_event_invalid_id_is_400(api_client, seeded_db):
    response = await api_client.get("/api/v1/events", params={"id": "nope"})
    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_id"


async def test_held_events_are_not_reachable(api_client, db_factory, seeded_db):
    """A hold row is invisible even if someone guesses its slug."""
    from sqlalchemy import update

    from app.db.models import Event

    golden = golden_api("event")
    slug = golden["event"]["slug"]

    async with db_factory() as session:
        await session.execute(
            update(Event).where(Event.slug == slug).values(editorial_status="hold")
        )
        await session.commit()

    response = await api_client.get(f"/api/v1/events/{slug}")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


async def test_status_contract(api_client, db_factory, seeded_db):
    import uuid
    from datetime import datetime, timezone

    from app.db import repo_sync

    golden = golden_api("status")
    now = datetime.now(timezone.utc)
    run_id = uuid.uuid4()
    async with db_factory() as session:
        await repo_sync.start_run(session, run_id=run_id, trigger="manual", now=now)
        await repo_sync.finish_run(
            session,
            run_id,
            {
                "status": "succeeded",
                "rawCount": 180,
                "createdCount": 4,
                "mergedCount": 2,
                "failedSources": [],
                "notes": None,
            },
        )
        await session.commit()

    body = (await api_client.get("/api/v1/status")).json()

    assert_same_keys(body, golden, context="status")
    assert_same_keys(body["sync"], golden["sync"], context="status.sync", ignore=VOLATILE_SYNC_KEYS)
    # The panel descriptor depends on whether this machine has judge keys in
    # `.env`, so only its shape and its rubric constants are pinned; the
    # configured/models/reason trio is left to the deployment.
    assert_same_keys(body["panel"], golden["panel"], context="status.panel")
    assert body["panel"]["rubricVersion"] == golden["panel"]["rubricVersion"]
    assert body["panel"]["includeScore"] == golden["panel"]["includeScore"]
    assert body["panel"]["minVotes"] == golden["panel"]["minVotes"]
    assert (body["panel"]["reason"] is None) is body["panel"]["configured"]
    assert body["sync"]["eventCount"] == 148
    assert len(body["runs"]) == 1
    assert_same_keys(body["runs"][0], golden["runs"][0], context="status.runs[0]")
    assert body["runs"][0]["status"] == "succeeded"
    assert body["runs"][0]["rawCount"] == 180


# ---------------------------------------------------------------------------
# Standard
# ---------------------------------------------------------------------------


async def test_standard_contract(api_client):
    golden = golden_api("standard")
    body = (await api_client.get("/api/v1/standard")).json()
    assert body == golden


async def test_health(api_client):
    body = (await api_client.get("/api/v1/health")).json()
    assert body["ok"] is True
