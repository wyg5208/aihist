"""HTML/text helpers ported from functions/lib/http.mjs.

The parsing rules are byte-for-byte equivalents, because the fingerprints that
identify events are derived from these strings.
"""

from __future__ import annotations

import email.utils
import hashlib
import re
from datetime import datetime, timedelta, timezone

_SCRIPT_RE = re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE)
_STYLE_RE = re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

_CDATA_RE = re.compile(r"<!\[CDATA\[([\s\S]*?)\]\]>")
_HEX_ENTITY_RE = re.compile(r"&#x([0-9a-f]+);", re.IGNORECASE)
_DEC_ENTITY_RE = re.compile(r"&#([0-9]+);")
_NAMED_ENTITY_RE = re.compile(r"&([a-z][a-z0-9]+);", re.IGNORECASE)

_ENTITIES = {
    "amp": "&",
    "lt": "<",
    "gt": ">",
    "quot": '"',
    "apos": "'",
    "nbsp": " ",
    "ndash": "\u2013",
    "mdash": "\u2014",
    "hellip": "\u2026",
    "rsquo": "\u2019",
    "lsquo": "\u2018",
    "rdquo": "\u201d",
    "ldquo": "\u201c",
    "copy": "\u00a9",
    "reg": "\u00ae",
    "trade": "\u2122",
}


def clean_text(value: object, limit: int = 2000) -> str:
    if not isinstance(value, str):
        return ""
    text = _SCRIPT_RE.sub(" ", value)
    text = _STYLE_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text[:limit]


def _hex_entity(match: re.Match[str]) -> str:
    try:
        return chr(int(match.group(1), 16))
    except (ValueError, OverflowError):
        return ""


def _dec_entity(match: re.Match[str]) -> str:
    try:
        return chr(int(match.group(1), 10))
    except (ValueError, OverflowError):
        return ""


def _named_entity(match: re.Match[str]) -> str:
    name = match.group(1).lower()
    return _ENTITIES.get(name, match.group(0))


def decode_entities(value: object) -> str:
    if not isinstance(value, str):
        return ""
    text = _CDATA_RE.sub(r"\1", value)
    text = _HEX_ENTITY_RE.sub(_hex_entity, text)
    text = _DEC_ENTITY_RE.sub(_dec_entity, text)
    return _NAMED_ENTITY_RE.sub(_named_entity, text)


def html_to_text(value: object, limit: int = 2000) -> str:
    return clean_text(decode_entities(value), limit)


def sha256_hex(value: object) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    """JavaScript `new Date().toISOString()`: milliseconds and a `Z` suffix."""

    return format_iso(utc_now())


def format_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def hours_ago(hours: float) -> str:
    return format_iso(utc_now() - timedelta(hours=hours))


def iso_day(value: object) -> str:
    """Port of `isoDay`: an ISO-8601 instant reduced to `YYYY-MM-DD`."""

    if not value:
        return ""
    parsed = parse_iso(str(value))
    if parsed is None:
        return ""
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d")


def parse_iso(value: str) -> datetime | None:
    """Approximate `Date.parse` for the formats the sources emit.

    JavaScript treats a date-only string as UTC midnight, which is what
    `datetime.fromisoformat` does as well once we attach UTC. RSS 2.0 feeds
    publish RFC 2822 stamps instead, so that format is parsed as a fallback.
    """

    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        try:
            parsed = email.utils.parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return None
        if parsed is None:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def timestamp_of(date: object) -> str | None:
    """`timestampOf`: a date/`YYYY-MM`/`YYYY` string to an ISO instant."""

    if not isinstance(date, str):
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return f"{date}T00:00:00.000Z"
    if re.fullmatch(r"\d{4}-\d{2}", date):
        return f"{date}-01T00:00:00.000Z"
    if re.fullmatch(r"\d{4}", date):
        return f"{date}-01-01T00:00:00.000Z"
    return None


def iso_instant(millis: int) -> str:
    return format_iso(datetime.fromtimestamp(millis / 1000, tz=timezone.utc))
