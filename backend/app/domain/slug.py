"""Immutable event addresses, ported from functions/lib/slug.mjs."""

from __future__ import annotations

import re

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def seed_slug(seed_id: object) -> str:
    value = str(seed_id or "").lower()
    return value if SLUG_RE.match(value) else ""


def auto_slug(year: object, fingerprint: object, length: int = 8) -> str:
    head = str(fingerprint or "").lower()[:length]
    if not re.fullmatch(r"[a-z0-9]+", head):
        return ""
    return f"y{year}-{head}"


def is_slug(value: object) -> bool:
    return (
        isinstance(value, str)
        and 4 <= len(value) <= 120
        and bool(SLUG_RE.match(value))
    )
