"""Cluster parity: fingerprints, families and evidence must line up exactly."""

from __future__ import annotations

from typing import Any

import pytest

from app.ingest.cluster import cluster_candidates
from app.ingest.normalize import normalize_results

FIELDS = (
    "fingerprint",
    "title",
    "category",
    "eventDate",
    "importance",
    "confidence",
    "sourceCount",
    "families",
    "evidenceUrls",
    "evidenceNames",
)


def _view(item: dict[str, Any]) -> dict[str, Any]:
    """Add the evidence projections the golden file records."""
    evidence = item.get("evidence") or []
    view = dict(item)
    view["evidenceUrls"] = [source.get("url") for source in evidence]
    view["evidenceNames"] = [source.get("name") for source in evidence]
    return view


@pytest.fixture(scope="module")
def clustered(
    source_results: list[dict[str, Any]], now_ms: int
) -> dict[str, list[dict[str, Any]]]:
    candidates = normalize_results(source_results, now_ms=now_ms)["candidates"]
    return cluster_candidates(candidates, [])


@pytest.fixture(scope="module")
def golden_rows(golden_cluster: dict[str, Any]) -> list[dict[str, Any]]:
    return golden_cluster["clustered"]


def test_cluster_count(clustered: dict[str, list[dict[str, Any]]], golden_rows: list[dict[str, Any]]) -> None:
    assert len(clustered["items"]) == len(golden_rows)


def test_cluster_fields(clustered: dict[str, list[dict[str, Any]]], golden_rows: list[dict[str, Any]]) -> None:
    mismatches: list[str] = []
    for expected, item in zip(golden_rows, clustered["items"], strict=False):
        produced = _view(item)
        for field in FIELDS:
            if produced.get(field) != expected.get(field):
                mismatches.append(
                    f"{expected['fingerprint']}.{field}: expected {expected.get(field)!r} "
                    f"got {produced.get(field)!r}"
                )
    assert not mismatches, "\n".join(mismatches[:20])


def test_fingerprints_are_unique(clustered: dict[str, list[dict[str, Any]]]) -> None:
    fingerprints = [item["fingerprint"] for item in clustered["items"]]
    assert len(fingerprints) == len(set(fingerprints))


def test_no_updates_without_existing_rows(clustered: dict[str, list[dict[str, Any]]]) -> None:
    assert clustered["updates"] == []
