"""Parser parity against the recorded reference output."""

from __future__ import annotations

from typing import Any

import pytest


def test_every_source_loaded(source_results: list[dict[str, Any]]) -> None:
    assert all(result["ok"] for result in source_results), {
        result["key"]: result["error"] for result in source_results if not result["ok"]
    }


def test_source_order_and_keys(
    source_results: list[dict[str, Any]], golden_sources: dict[str, Any]
) -> None:
    assert [result["key"] for result in source_results] == [
        entry["key"] for entry in golden_sources["parsed"]
    ]


@pytest.mark.parametrize("index", range(17))
def test_parsed_items_match(
    source_results: list[dict[str, Any]], golden_sources: dict[str, Any], index: int
) -> None:
    golden = golden_sources["parsed"][index]
    actual = source_results[index]
    assert actual["key"] == golden["key"]
    assert actual["ok"] == golden["ok"]
    assert len(actual["items"]) == golden["itemCount"]
    for position, expected in enumerate(golden["items"]):
        produced = actual["items"][position]
        for field, value in expected.items():
            assert produced.get(field) == value, (
                f"{golden['key']}#{position}.{field}: "
                f"expected {value!r}, got {produced.get(field)!r}"
            )
