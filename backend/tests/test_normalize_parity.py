"""Candidate parity against the recorded reference output."""

from __future__ import annotations

from typing import Any

import pytest

from app.ingest.normalize import normalize_results

FIELDS = (
    "key",
    "title",
    "titleEn",
    "category",
    "eventDate",
    "sortDate",
    "year",
    "datePrecision",
    "summaryKind",
    "organization",
    "modelName",
    "modelKey",
    "familyKey",
    "aliases",
    "urls",
    "tokens",
    "tags",
    "signals",
    "meta",
    "evidence",
)


@pytest.fixture(scope="module")
def candidates(source_results: list[dict[str, Any]], now_ms: int) -> list[dict[str, Any]]:
    return normalize_results(source_results, now_ms=now_ms)["candidates"]


def test_failed_sources_match(
    source_results: list[dict[str, Any]], golden_normalize: dict[str, Any], now_ms: int
) -> None:
    assert normalize_results(source_results, now_ms=now_ms)["failed"] == golden_normalize["failed"]


def test_candidate_count(candidates: list[dict[str, Any]], golden_normalize: dict[str, Any]) -> None:
    assert len(candidates) == len(golden_normalize["candidates"])


def test_candidate_order(candidates: list[dict[str, Any]], golden_normalize: dict[str, Any]) -> None:
    assert [candidate["key"] for candidate in candidates] == [
        candidate["key"] for candidate in golden_normalize["candidates"]
    ]


def test_candidate_fields(candidates: list[dict[str, Any]], golden_normalize: dict[str, Any]) -> None:
    mismatches: list[str] = []
    for expected, produced in zip(golden_normalize["candidates"], candidates, strict=False):
        for field in FIELDS:
            if produced.get(field) != expected.get(field):
                mismatches.append(
                    f"{expected['key']}.{field}: expected {expected.get(field)!r} "
                    f"got {produced.get(field)!r}"
                )
    assert not mismatches, "\n".join(mismatches[:20])
