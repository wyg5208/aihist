"""Editorial gate parity and the panel's fail-closed vote arithmetic."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.editorial.panel import (
    BALLOT_SIZE,
    aggregate_reviews,
    build_panel_config,
    judge_batch,
    parse_judge_content,
    public_panel_info,
)
from app.editorial.rules import (
    RUBRIC_VERSION,
    apply_tier_lines,
    assess_candidate,
    generation_of,
    should_audit_out,
    tier_line,
)
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


def test_a_generations_flagship_still_reaches_the_ballot() -> None:
    """A tier suffix is a handicap, not a veto.

    `Gemini 3.8 Flash` is the flagship of its generation, but its `familyKey`
    (`gemini-3.8`) differs from its `modelKey`, so it used to lose 8 points and
    land at 33 — below `RULE_PANEL_THRESHOLD`, which meant the panel never saw
    the only Gemini 3.8 entry the catalogue had.
    """
    candidate = {
        "key": "openrouter:google/gemini-3.8-flash",
        "category": "model",
        "title": "Google 发布 Gemini 3.8 Flash",
        "titleEn": "Google: Gemini 3.8 Flash",
        "modelName": "Gemini 3.8 Flash",
        "modelKey": "gemini-3.8-flash",
        "familyKey": "gemini-3.8",
        "eventDate": "2026-09-02",
        "families": ["openrouter", "huggingface"],
        "signals": {"headLab": True},
        "evidence": [
            {"family": "openrouter", "name": "OpenRouter", "url": "https://openrouter.ai/x"},
            {"family": "huggingface", "name": "Hugging Face", "url": "https://hf.co/x"},
        ],
    }

    assessment = assess_candidate(candidate)

    assert assessment["eligible"] is True, assessment
    assert "同族包装变体" in assessment["reasons"]


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


def ballot_ids(payload: dict[str, Any]) -> list[str]:
    body = json.loads(payload["messages"][1]["content"])
    return [candidate["id"] for candidate in body["candidates"]]


def perfect_ballot(ids: list[str]) -> tuple[int, Any]:
    ballot = {"reviews": [{"id": identifier, "score": 90} for identifier in ids]}
    return 200, {"choices": [{"message": {"content": json.dumps(ballot)}}]}


async def test_a_queue_longer_than_one_ballot_is_split_and_merged() -> None:
    """150 candidates cannot share one ballot: the reply is cut off at 2,400 tokens."""
    sizes: list[int] = []

    async def post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
        ids = ballot_ids(payload)
        sizes.append(len(ids))
        return perfect_ballot(ids)

    judges = build_panel_config(PROVIDER_ENV)["judges"][:1]
    queue = [{"fingerprint": f"c{index}"} for index in range(2 * BALLOT_SIZE + 6)]
    results = await judge_batch(judges, queue, post=post, timeout_ms=2000)

    assert sizes == [BALLOT_SIZE, BALLOT_SIZE, 6]
    assert results[0]["ok"] is True
    assert len(results[0]["reviews"]) == len(queue)


# ---------------------------------------------------------------------------
# The generation ladder
# ---------------------------------------------------------------------------


def test_tier_line_ladder() -> None:
    assert [tier_line(ordinal) for ordinal in range(1, 9)] == [75, 80, 85, 90, 95, 95, 95, 95]


def test_tier_line_parity(golden_editorial: dict[str, Any]) -> None:
    # The table is produced by the JS reference (`node scripts/export-golden.mjs`),
    # so the step and the cap have to be changed there first.
    assert [tier_line(ordinal) for ordinal in range(1, 9)] == golden_editorial["tierLines"]


def test_only_a_model_has_a_generation() -> None:
    assert generation_of({"category": "model", "familyKey": "gemini-3.8"}) == "gemini-3.8"
    # A family-less model is its own generation.
    assert generation_of({"category": "model", "modelKey": "gpt-6"}) == "gpt-6"
    # Two policies in a year are two events, not two SKUs.
    assert generation_of({"category": "policy", "familyKey": "eu-ai-act"}) == ""


def _outcome(score: int, decision: str = "include") -> dict[str, Any]:
    return {
        "decision": decision,
        "score": score,
        "includeVotes": 5,
        "excludeVotes": 0,
        "validVotes": 5,
        "votes": [],
    }


def _model(fingerprint: str, family: str = "gemini-3.8") -> dict[str, Any]:
    return {
        "fingerprint": fingerprint,
        "category": "model",
        "familyKey": family,
        "modelKey": f"{family}-{fingerprint}",
    }


def test_the_second_tier_of_a_generation_needs_a_higher_score() -> None:
    """One generation, one slot at 75; the second seat costs 80."""
    candidates = [_model("pro"), _model("flash")]
    by_id = {"pro": _outcome(91), "flash": _outcome(78)}

    apply_tier_lines(by_id, candidates)

    assert by_id["pro"]["decision"] == "include"
    assert by_id["pro"]["tierOrdinal"] == 1
    assert by_id["pro"]["tierLine"] == 75
    assert by_id["flash"]["tierOrdinal"] == 2
    assert by_id["flash"]["tierLine"] == 80
    assert by_id["flash"]["decision"] == "hold"
    assert by_id["flash"]["tierHeld"] is True


def test_the_ladder_ranks_by_score_not_by_arrival() -> None:
    """The better-scoring tier takes the seat, whatever order the batch holds."""
    candidates = [_model("flash"), _model("pro")]
    by_id = {"flash": _outcome(88), "pro": _outcome(76)}

    apply_tier_lines(by_id, candidates)

    assert by_id["flash"]["tierOrdinal"] == 1
    assert by_id["flash"]["decision"] == "include"
    # 76 clears the first line but not the second; the seat it wanted is taken.
    assert by_id["pro"]["tierOrdinal"] == 2
    assert by_id["pro"]["decision"] == "hold"


def test_a_held_tier_does_not_consume_its_seat() -> None:
    """A weak member must not block the sibling behind it."""
    candidates = [_model("pro"), _model("flash"), _model("mini")]
    by_id = {"pro": _outcome(92), "flash": _outcome(77), "mini": _outcome(81)}

    apply_tier_lines(by_id, candidates)

    assert by_id["pro"]["decision"] == "include"
    # `mini` at 81 cleared the 80 line, so it took seat 2; `flash` at 77 was
    # asked for 85 and is still waiting.
    assert by_id["mini"]["tierOrdinal"] == 2
    assert by_id["mini"]["decision"] == "include"
    assert by_id["flash"]["tierOrdinal"] == 3
    assert by_id["flash"]["tierLine"] == 85
    assert by_id["flash"]["decision"] == "hold"


def test_the_ladder_continues_from_what_the_archive_already_holds() -> None:
    candidates = [_model("flash")]
    by_id = {"flash": _outcome(84)}

    apply_tier_lines(by_id, candidates, {"gemini-3.8": 3})

    assert by_id["flash"]["tierOrdinal"] == 4
    assert by_id["flash"]["tierLine"] == 90
    assert by_id["flash"]["decision"] == "hold"

    again = {"flash": _outcome(84)}
    apply_tier_lines(again, candidates, {"gemini-3.8": 1})
    assert again["flash"]["tierOrdinal"] == 2
    assert again["flash"]["tierLine"] == 80
    assert again["flash"]["decision"] == "include"


def test_a_panel_rejection_is_never_rescued_by_the_ladder() -> None:
    candidates = [_model("pro"), _model("flash")]
    by_id = {"pro": _outcome(90), "flash": _outcome(76, decision="exclude")}

    apply_tier_lines(by_id, candidates)

    assert by_id["flash"]["decision"] == "exclude"
    assert "tierHeld" not in by_id["flash"]


def test_a_lone_generation_behaves_as_it_did_before_the_ladder() -> None:
    by_id = {"pro": _outcome(75)}
    apply_tier_lines(by_id, [_model("pro")])
    assert by_id["pro"]["tierLine"] == 75
    assert by_id["pro"]["decision"] == "include"


def test_a_non_model_candidate_is_not_laddered() -> None:
    by_id = {"act": _outcome(80)}
    apply_tier_lines(by_id, [{"fingerprint": "act", "category": "policy"}])
    assert "tierLine" not in by_id["act"]
    assert by_id["act"]["decision"] == "include"


async def test_a_failed_slice_only_costs_its_own_votes() -> None:
    calls: list[int] = []

    async def post(url: str, key: str, payload: dict[str, Any], timeout_ms: int):
        ids = ballot_ids(payload)
        calls.append(len(ids))
        if len(calls) == 1:
            return 200, {"choices": [{"message": {"content": "{\"reviews\": ["}}]}
        return perfect_ballot(ids)

    judges = build_panel_config(PROVIDER_ENV)["judges"][:1]
    queue = [{"fingerprint": f"c{index}"} for index in range(BALLOT_SIZE + 1)]
    results = await judge_batch(judges, queue, post=post, timeout_ms=2000)

    assert results[0]["ok"] is True
    assert results[0]["error"] == "invalid_json"
    # The candidates in the slice that parsed still get their vote.
    assert list(results[0]["reviews"]) == [f"c{BALLOT_SIZE}"]
