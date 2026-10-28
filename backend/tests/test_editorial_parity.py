"""Editorial gate parity and the panel's fail-closed vote arithmetic."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.editorial.panel import (
    aggregate_reviews,
    build_panel_config,
    judge_batch,
    parse_judge_content,
    public_panel_info,
)
from app.editorial.rules import RUBRIC_VERSION, assess_candidate, should_audit_out
from app.editorial.standard import STANDARD
from app.ingest.normalize import normalize_results

FIELDS = ("score", "flags", "reasons", "disqualify", "eligible", "families", "sourceNames")


@pytest.fixture(scope="module")
def candidates(source_results: list[dict[str, Any]], now_ms: int) -> list[dict[str, Any]]:
    return normalize_results(source_results, now_ms=now_ms)["candidates"]


def test_assessment_parity(candidates: list[dict[str, Any]], golden_editorial: dict[str, Any]) -> None:
    mismatches: list[str] = []
    for expected, candidate in zip(golden_editorial["assessments"], candidates, strict=False):
        produced = assess_candidate(candidate)
        for field in FIELDS:
            if produced.get(field) != expected.get(field):
                mismatches.append(
                    f"{expected['key']}.{field}: expected {expected.get(field)!r} "
                    f"got {produced.get(field)!r}"
                )
    assert not mismatches, "\n".join(mismatches[:20])


def test_assessment_count(candidates: list[dict[str, Any]], golden_editorial: dict[str, Any]) -> None:
    assert len(golden_editorial["assessments"]) == len(candidates)


def test_audit_threshold_follows_disqualify() -> None:
    assert should_audit_out({"disqualify": "funding", "score": 90}) is True
    assert should_audit_out({"disqualify": None, "score": 24}) is True
    assert should_audit_out({"disqualify": None, "score": 25}) is False


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ('{"reviews":[{"id":"a","score":80}]}', {"a": 80}),
        ('```json\n[{"id":"a","score":61,"vote":"include"}]\n```', {"a": 61}),
        ('noise [{"id":"a","score":12}] trailing', {"a": 12}),
    ],
)
def test_parse_judge_content_tolerates_wrappers(payload: str, expected: dict[str, int]) -> None:
    reviews = parse_judge_content(payload, {"a"})
    assert reviews is not None
    assert {key: value["score"] for key, value in reviews.items()} == expected


def test_parse_judge_content_vote_normalisation() -> None:
    reviews = parse_judge_content(json.dumps({"reviews": [{"id": "a", "score": 90}]}), {"a"})
    assert reviews is not None and reviews["a"]["vote"] == "include"
    reviews = parse_judge_content(
        json.dumps({"reviews": [{"id": "a", "score": 90, "vote": "exclude"}]}), {"a"}
    )
    assert reviews is not None and reviews["a"]["vote"] == "exclude"


def test_parse_judge_content_rejects_unknown_ids() -> None:
    assert parse_judge_content(json.dumps({"reviews": [{"id": "b", "score": 90}]}), {"a"}) is None
    assert parse_judge_content("not json at all", {"a"}) is None
    assert parse_judge_content("", {"a"}) is None


def _ballots(scores: list[int], ids: tuple[str, str] = ("a", "b")) -> list[dict[str, Any]]:
    """Build `len(scores)` judge results, each voting include above 75."""
    results = []
    for index, score in enumerate(scores):
        results.append(
            {
                "slot": index + 1,
                "model": f"m{index + 1}",
                "ok": True,
                "error": None,
                "reviews": {
                    ids[0]: {
                        "score": score,
                        "vote": "include" if score >= 75 else "exclude",
                        "flags": [],
                        "reason": "",
                    },
                    ids[1]: {
                        "score": 100 - score,
                        "vote": "include" if 100 - score >= 75 else "exclude",
                        "flags": [],
                        "reason": "",
                    },
                },
            }
        )
    return results


@pytest.mark.parametrize(
    ("scores", "expected"),
    [
        ([90, 88, 84], "include"),
        # Two of three is no longer a majority: three votes are the quorum.
        ([90, 88, 40], "hold"),
        ([90, 88, 84, 40, 30], "include"),
        ([90, 40, 30], "hold"),
        ([40, 30, 20], "exclude"),
        ([90, 40], "hold"),
        ([90], "hold"),
        ([], "hold"),
    ],
)
def test_vote_shapes(scores: list[int], expected: str) -> None:
    candidates = [{"fingerprint": "a"}, {"fingerprint": "b"}]
    outcome = aggregate_reviews(_ballots(scores), candidates)
    assert outcome["byId"]["a"]["decision"] == expected


def test_failed_judge_contributes_no_votes() -> None:
    results = _ballots([90, 88, 84, 86])
    results.append({"slot": 5, "model": "m5", "ok": False, "error": "timeout", "reviews": {}})
    outcome = aggregate_reviews(results, [{"fingerprint": "a"}, {"fingerprint": "b"}])
    entry = outcome["byId"]["a"]
    assert entry["decision"] == "include"
    assert entry["validVotes"] == 4
    assert outcome["failures"] == [{"judge": 5, "model": "m5", "error": "timeout"}]


def test_median_rounds_half_up() -> None:
    from app.editorial.panel import median

    assert median([90, 88, 84]) == 88
    assert median([75, 76]) == 76
    assert median([]) == 0


@pytest.mark.parametrize(
    ("env", "reason"),
    [
        ({}, "models"),
        ({"EDITORIAL_JUDGE_MODELS": "a,a,b,c,d"}, "duplicate_models"),
        (
            {
                "EDITORIAL_JUDGE_MODELS": "a,b,c,d,e",
                "EDITORIAL_JUDGE_BASE": "https://x",
            },
            "key",
        ),
        ({}, None),
    ],
)
def test_panel_config_reasons(env: dict[str, Any], reason: str | None) -> None:
    if reason is None:
        env = {
            "EDITORIAL_JUDGE_MODELS": "a,b,c,d,e",
            "EDITORIAL_JUDGE_BASE": "https://x",
            "EDITORIAL_JUDGE_KEY": "k",
        }
    config = build_panel_config(env)
    assert config["reason"] == reason
    assert config["configured"] is (reason is None)


def test_panel_not_configured_hides_models() -> None:
    info = public_panel_info({})
    assert info["configured"] is False
    assert info["models"] == []


def test_standard_is_serialisable() -> None:
    blob = json.dumps(STANDARD, ensure_ascii=False)
    # Pin the standard to the rubric constant rather than a literal: a version
    # bump is a deliberate change with its own review, not a test typo.
    assert json.dumps(RUBRIC_VERSION) in blob
    assert len(STANDARD["hardRejects"]) == 9


PROVIDER_ENV: dict[str, Any] = {
    f"EDITORIAL_JUDGE_{slot}_PROVIDER": name
    for slot, name in enumerate(("deepseek", "qwen", "glm", "kimi", "minimax"), start=1)
} | {f"EDITORIAL_JUDGE_{slot}_KEY": f"key-{slot}" for slot in range(1, 6)}


def test_provider_presets_fill_slot_defaults() -> None:
    config = build_panel_config(PROVIDER_ENV)
    assert config["configured"] is True
    judges = {judge["slot"]: judge for judge in config["judges"]}
    assert judges[1]["base"] == "https://api.deepseek.com"
    assert judges[2]["base"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert judges[3]["base"] == "https://open.bigmodel.cn/api/paas/v4"
    assert judges[4]["base"] == "https://api.moonshot.cn/v1"
    assert judges[5]["base"] == "https://api.minimax.cn/v1"
    assert len({judge["model"] for judge in config["judges"]}) == 5
    # Every vendor's own spelling of "do not think".
    assert judges[1]["extra"] == {"thinking": {"type": "disabled"}}
    assert judges[2]["extra"] == {"enable_thinking": False}
    assert judges[3]["extra"] == {"thinking": {"type": "disabled"}}
    assert judges[5]["extra"] == {"thinking": {"type": "disabled"}}
    # kimi-k3 rejects any temperature but 1, so none is sent at all.
    assert judges[4]["temperature"] is None
    assert judges[1]["temperature"] == 0.0


def test_blank_slot_leaves_the_panel() -> None:
    env = dict(PROVIDER_ENV)
    for suffix in ("PROVIDER", "MODEL", "BASE", "KEY"):
        env.pop(f"EDITORIAL_JUDGE_5_{suffix}", None)
    config = build_panel_config(env)
    assert config["configured"] is True
    assert len(config["judges"]) == 4
    assert len(config["models"]) == 4


def test_fewer_judges_than_the_quorum_is_not_a_panel() -> None:
    env = {
        key: value
        for key, value in PROVIDER_ENV.items()
        if not any(key.startswith(f"EDITORIAL_JUDGE_{slot}") for slot in (3, 4, 5))
    }
    config = build_panel_config(env)
    assert config["configured"] is False
    assert config["reason"] == "models"


def test_explicit_base_and_model_beat_the_preset() -> None:
    env = dict(PROVIDER_ENV)
    env["EDITORIAL_JUDGE_1_BASE"] = "https://gateway.internal/v1"
    env["EDITORIAL_JUDGE_1_MODEL"] = "alpha"
    judge = build_panel_config(env)["judges"][0]
    assert judge["base"] == "https://gateway.internal/v1"
    assert judge["model"] == "alpha"
    assert judge["extra"] == {"thinking": {"type": "disabled"}}


async def test_judge_request_follows_the_vendor_preset() -> None:
    sent: dict[str, dict[str, Any]] = {}

    async def post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
        sent[payload["model"]] = {"url": url, **payload}
        ballot = {"reviews": [{"id": "a", "score": 90}]}
        return 200, {"choices": [{"message": {"content": json.dumps(ballot)}}]}

    judges = build_panel_config(PROVIDER_ENV)["judges"]
    results = await judge_batch(judges, [{"fingerprint": "a"}], post=post, timeout_ms=2000)

    assert all(result["ok"] for result in results)
    kimi = sent["kimi-k3"]
    assert "temperature" not in kimi
    assert kimi["thinking"] == {"type": "disabled"}
    assert kimi["url"] == "https://api.moonshot.cn/v1/chat/completions"
    assert sent["deepseek-v4-flash"]["temperature"] == 0.0
    assert sent["qwen3.5-plus"]["enable_thinking"] is False
    assert sent["MiniMax-M3"]["thinking"] == {"type": "disabled"}
    assert sent["MiniMax-M3"]["url"] == "https://api.minimax.cn/v1/chat/completions"
