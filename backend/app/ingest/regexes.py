r"""Regex compilation helpers.

JavaScript's `\b`, `\w` and `\d` are ASCII-only, while Python's `re` defaults to
Unicode. That difference is not cosmetic: `\b(gpt|claude)\b` matches
"发布GPT-5" in JavaScript (G is a word char, 布 is not) but fails in Python,
where 布 also counts as a word character. Every pattern ported from the Deno
implementation must go through `compile_ascii`.
"""

from __future__ import annotations

import re


def compile_ascii(pattern: str, flags: int = 0) -> re.Pattern[str]:
    return re.compile(pattern, flags | re.ASCII)


def search_any(patterns: list[re.Pattern[str]], text: str) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def first_match(patterns: list[re.Pattern[str]], text: str) -> re.Match[str] | None:
    best: re.Match[str] | None = None
    for pattern in patterns:
        found = pattern.search(text)
        if not found:
            continue
        if best is None or found.start() < best.start():
            best = found
    return best
