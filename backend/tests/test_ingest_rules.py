"""The two intake rules that used to thin the archive out.

The library showed 349 rows filed as 「超出时间窗」 and 98 as 「模型条目不适用」.
Both were implementation choices rather than editorial ones: the age windows
were per parser (120 days for OpenRouter, 180 for Hugging Face, 10 for arXiv,
14 for Hacker News, 21/45 for feeds), so DeepSeek-V3 (2024-12-25) and R1
(2025-01-20) were dropped by the source that still lists them; and any repo
carrying a `gguf`/`fp8` tag was assumed to be someone else's re-upload, which
filed DeepSeek's own FP8 releases as derivatives.

What the tests below pin: age no longer decides on its own, a missing date
still does, and provenance — not the quantization tag — decides whether a
Hugging Face repo is a derivative. The last one is what lets
`deepseek-ai/DeepSeek-V4.1-Flash-1017` in while keeping
`unsloth/Qwen3.8-27B-GGUF` out.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.ingest.normalize import (
    MAX_AGE_DAYS,
    arxiv_candidates,
    feed_candidates,
    hf_candidates,
    is_derived_repo,
    openrouter_candidates,
    too_old,
)
from app.ingest.pipeline import PER_SOURCE_CAP, interleave_candidates

NOW_MS = int(datetime(2026, 10, 28, tzinfo=UTC).timestamp() * 1000)
OLD = "2024-12-25T00:00:00Z"


def openrouter_item(model_id: str, created: str | None) -> dict[str, Any]:
    return {
        "id": model_id,
        "name": model_id.split("/", 1)[-1],
        "created": created,
        "canonicalSlug": model_id.replace("/", "-"),
        "contextLength": 65_536,
        "huggingFaceId": model_id,
    }


def hf_item(model_id: str, *, tags: list[str], created_at: str | None = "2025-09-01T00:00:00Z",
            likes: int = 500) -> dict[str, Any]:
    return {
        "id": model_id,
        "createdAt": created_at,
        "tags": tags,
        "likes": likes,
        "downloads": 12_000,
        "author": model_id.split("/")[0],
    }


# --- age: no longer a filter of its own ---------------------------------------


def test_a_model_older_than_the_old_window_is_admitted() -> None:
    drops: list[dict[str, Any]] = []
    candidates = openrouter_candidates(
        {"items": [openrouter_item("deepseek/deepseek-v3", OLD)]}, NOW_MS, drops=drops
    )

    assert [candidate["key"] for candidate in candidates] == ["openrouter:deepseek/deepseek-v3"]
    assert [drop["reasonCode"] for drop in drops] == []


def test_a_paper_older_than_the_old_window_is_admitted() -> None:
    drops: list[dict[str, Any]] = []
    paper = {
        "id": "2412.19437",
        "title": "DeepSeek-V3 Technical Report: scaling a language model",
        "url": "https://arxiv.org/abs/2412.19437",
        "publishedAt": OLD,
        "externalId": "2412.19437",
    }
    candidates = arxiv_candidates({"items": [paper]}, NOW_MS, drops=drops)

    assert [candidate["key"] for candidate in candidates] == ["arxiv:2412.19437"]
    assert drops == []


def test_an_article_older_than_the_old_feed_window_is_admitted() -> None:
    drops: list[dict[str, Any]] = []
    source = {"key": "qbitai", "family": "media", "name": "量子位"}
    payload = {
        "items": [
            {
                "externalId": "old-1",
                "title": "DeepSeek 发布 V3 并开源全部权重",
                "url": "https://www.qbitai.com/2024/12/1.html",
                "publishedAt": OLD,
            }
        ]
    }
    candidates = feed_candidates(payload, source, NOW_MS, drops=drops)

    assert [candidate["key"] for candidate in candidates] == ["qbitai:old-1"]
    assert drops == []


def test_the_window_is_off_by_default_and_still_works_when_set() -> None:
    assert MAX_AGE_DAYS == 0
    # 0 means "no lower bound": a 1990 record is only too old once a window is set.
    assert too_old("1990-01-01T00:00:00Z", 0, NOW_MS) is False
    assert too_old("1990-01-01T00:00:00Z", 30, NOW_MS) is True
    assert too_old("2026-10-27T00:00:00Z", 30, NOW_MS) is False


def test_a_missing_date_is_still_a_drop() -> None:
    drops: list[dict[str, Any]] = []
    candidates = openrouter_candidates(
        {"items": [openrouter_item("somevendor/undated", None)]}, NOW_MS, drops=drops
    )

    assert candidates == []
    assert [drop["reasonCode"] for drop in drops] == ["date_missing"]


# --- provenance, not the quantization tag, decides a derivative ----------------


def test_a_vendors_own_fp8_release_is_not_a_derivative() -> None:
    assert is_derived_repo("deepseek-ai/DeepSeek-V4.1-Flash-1017", ["fp8", "8-bit"]) is False
    assert is_derived_repo("nvidia/Nemotron-4-340B-Instruct", ["fp8"]) is False
    assert is_derived_repo("zai-org/GLM-5.2", []) is False


def test_a_community_reupload_is_a_derivative() -> None:
    assert (
        is_derived_repo(
            "unsloth/Qwen3.8-27B-GGUF", ["gguf", "base_model:quantized:Qwen/Qwen3.8-27B"]
        )
        is True
    )
    assert (
        is_derived_repo(
            "ISTA-DASLab/Llama-4-70B-AWQ", ["awq", "base_model:meta-llama/Llama-4-70B"]
        )
        is True
    )


def test_the_authors_own_quantized_variant_is_a_derivative() -> None:
    assert (
        is_derived_repo(
            "nvidia/Nemotron-4-340B-Instruct-4GB",
            ["base_model:quantized:nvidia/Nemotron-4-340B-Instruct"],
        )
        is True
    )
    assert (
        is_derived_repo(
            "black-forest-labs/flux-3-image-klein-comfy",
            ["comfy", "base_model:black-forest-labs/flux-3-image-klein"],
        )
        is True
    )


def test_hf_keeps_the_release_and_drops_the_repackaging() -> None:
    drops: list[dict[str, Any]] = []
    payload = {
        "items": [
            hf_item("deepseek-ai/DeepSeek-V4.1-Flash-1017", tags=["fp8", "8-bit", "text-generation"]),
            hf_item(
                "unsloth/Qwen3.8-27B-GGUF",
                tags=["gguf", "base_model:quantized:Qwen/Qwen3.8-27B"],
            ),
        ]
    }
    candidates = hf_candidates(payload, NOW_MS, drops=drops)

    assert [candidate["key"] for candidate in candidates] == [
        "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017"
    ]
    assert [(drop["reasonCode"], drop["externalId"]) for drop in drops] == [
        ("model_filter", "unsloth/Qwen3.8-27B-GGUF")
    ]
    # A dropped model still carries its date, so the library can show when it happened.
    assert drops[0]["publishedAt"] == "2025-09-01T00:00:00Z"


# --- what the panel is shown about a catalogue model --------------------------


def test_a_catalogue_model_is_described_by_its_own_card() -> None:
    item = openrouter_item("deepseek/deepseek-v4.1-flash-1017", OLD)
    item["description"] = (
        "DeepSeek V4.1 Flash is a sparse mixture-of-experts model.\n\n"
        "It is served under the `deepseek-flash` API name."
    )
    candidate = openrouter_candidates({"items": [item]}, NOW_MS)[0]

    assert candidate["summaryKind"] == "card"
    assert candidate["summary"].startswith("DeepSeek V4.1 Flash is a sparse")
    # The card is one line, so a model card's paragraphs do not become the summary.
    assert "\n" not in candidate["summary"]
    assert "开放权重" in candidate["summary"]
    # The pipeline's own workings are not part of the event.
    assert "自动汇总" not in candidate["summary"]


def test_a_catalogue_entry_without_a_card_falls_back_to_the_facts() -> None:
    item = openrouter_item("vendor/thing-1", OLD)
    item["description"] = ""
    candidate = openrouter_candidates({"items": [item]}, NOW_MS)[0]

    assert candidate["summaryKind"] == "template"
    assert candidate["summary"] == "thing-1 由 Vendor 提供，开放权重，上下文窗口 66K token。"
    assert "自动汇总" not in candidate["summary"]


def test_the_card_keeps_room_for_the_facts_after_it() -> None:
    item = openrouter_item("vendor/thing-1", OLD)
    item["description"] = "word " * 200
    candidate = openrouter_candidates({"items": [item]}, NOW_MS)[0]

    # `panel.candidate_payload` truncates at 260 characters, so the facts have to
    # fit inside that budget or the ballot reads as a catalogue stub again.
    assert len(candidate["summary"]) < 260
    assert candidate["summary"].endswith("开放权重，上下文窗口 66K token）")


def test_a_hugging_face_summary_states_its_evidence_not_its_plumbing() -> None:
    candidate = hf_candidates(
        {"items": [hf_item("deepseek-ai/DeepSeek-V4.1-Flash", tags=["fp8"])]}, NOW_MS
    )[0]

    assert candidate["summary"].startswith("DeepSeek-V4.1-Flash 在 Hugging Face 开源发布")
    assert "500 次点赞" in candidate["summary"]
    assert "自动汇总" not in candidate["summary"]


# --- a backfill has to see past the daily slice -------------------------------


def test_a_daily_run_still_slices_each_source_at_forty() -> None:
    candidates = [
        {"key": f"openrouter:model-{index}", "evidence": [{"sourceKey": "openrouter"}]}
        for index in range(100)
    ]

    assert len(interleave_candidates(candidates, 200)) == PER_SOURCE_CAP


def test_a_backfill_is_not_sliced_per_source() -> None:
    candidates = [
        {"key": f"{source}:entry-{index}", "evidence": [{"sourceKey": source}]}
        for source in ("openrouter", "hf-trending", "arxiv")
        for index in range(100)
    ]

    sliced = interleave_candidates(candidates, 1_000)
    whole = interleave_candidates(candidates, 1_000, per_source=None)

    assert len(sliced) == 3 * PER_SOURCE_CAP
    assert len(whole) == 300
