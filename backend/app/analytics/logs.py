"""Access-log parsing: the half of analytics a JavaScript-free page can still produce.

The reference pages under `/e/<slug>.html` are deliberately scriptless — a promise
the page checker enforces — so no beacon can ever see them. The reverse proxy's log
is therefore the only place where "someone fetched this page" and "GPTBot read it"
exist at all, which makes this module the sole source of the citation evidence the
site's positioning rests on.

Everything here is a pure function over one line of text: no I/O, no settings, no
database. That is what lets both log formats be pinned by fixed sample lines
instead of by a live server, and what turns a regex mistake into a failing test
rather than a silently missing row.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from app.analytics import local_day

LOG_FORMATS: tuple[str, ...] = ("auto", "nginx", "caddy")

_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})

# `%b` is locale-dependent — `strptime` fails on a Windows box set to Chinese — so
# the month is looked up by hand. Access logs are always English-month.
_MONTHS = {
    name: index
    for index, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"),
        start=1,
    )
}

_NGINX_HEAD = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<stamp>[^\]]+)\] "(?P<request>[^"]*)" (?P<status>\d{3}) (?P<size>\d+|-)'
)
_NGINX_QUOTED = re.compile(r'"([^"]*)"')

_CLF_STAMP = re.compile(
    r"^(?P<day>\d{1,2})/(?P<month>[A-Za-z]{3})/(?P<year>\d{4}):"
    r"(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2}) (?P<offset>[+-]\d{4})$"
)

# Paths that are never a "document read": the beacon endpoint, build assets, the
# console's own pages, and anything a browser fetches to render rather than to read.
_EXCLUDED_PREFIXES = ("/api/", "/assets/", "/go/", "/admin")
_EXCLUDED_EXACT = frozenset(
    {"/robots.txt", "/sitemap.xml", "/favicon.ico", "/manifest.webmanifest", "/404.html"}
)
_EXCLUDED_SUFFIXES = (
    ".map",
    ".js",
    ".mjs",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".webp",
    ".avif",
    ".woff",
    ".woff2",
    ".txt",
    ".xml",
    ".json",
)


@dataclass(frozen=True, slots=True)
class LogLine:
    """One request, reduced to the four columns `crawl_hits` stores."""

    at: datetime
    path: str
    status: int
    size: int
    user_agent: str


def _offset_timezone(offset: str) -> timezone | None:
    """`+0800` → a fixed offset. `Z` and malformed offsets are handled elsewhere."""
    if not offset or offset[0] not in "+-":
        return None
    try:
        hours = int(offset[1:3])
        minutes = int(offset[3:5])
    except ValueError:
        return None
    sign = -1 if offset[0] == "-" else 1
    return timezone(sign * timedelta(hours=hours, minutes=minutes))


def _clf_time(text: str) -> datetime | None:
    match = _CLF_STAMP.match(text or "")
    if not match:
        return None
    month = _MONTHS.get(match.group("month").lower())
    if month is None:
        return None
    zone = _offset_timezone(match.group("offset")) or timezone.utc
    try:
        return datetime(
            year=int(match.group("year")),
            month=month,
            day=int(match.group("day")),
            hour=int(match.group("hour")),
            minute=int(match.group("minute")),
            second=int(match.group("second")),
            tzinfo=zone,
        )
    except ValueError:
        return None


def _path_of(target: str) -> str:
    """The path only: a logging proxy may record an absolute-form request target."""
    text = (target or "").strip()
    if not text:
        return ""
    parts = urlsplit(text)
    return (parts.path or "/")[:300]


def _method_and_target(request: str) -> tuple[str, str]:
    """`GET /x HTTP/1.1` → `("GET", "/x")`.

    Splitting on the first space alone would leave the protocol glued to the
    path, and `/robots.txt HTTP/1.1` would then sail past the exclusion list.
    """
    pieces = (request or "").split()
    if len(pieces) < 2:
        return "", ""
    return pieces[0].upper(), pieces[1]


def parse_nginx_combined(line: str) -> LogLine | None:
    """One `combined` line, or `None` for anything that is not a request.

    The tail holds `"referrer" "user-agent"`; the referrer is deliberately dropped.
    It can carry a search term in its query string, and nothing in this console
    needs it — the beacon already supplies `referrer_host`.
    """
    text = (line or "").strip()
    if not text:
        return None
    head = _NGINX_HEAD.match(text)
    if not head:
        return None
    moment = _clf_time(head.group("stamp"))
    if moment is None:
        return None
    method, target = _method_and_target(head.group("request"))
    if method not in _METHODS:
        # `"-"` (a dropped or unparsable request) and health checks land here.
        return None
    quoted = _NGINX_QUOTED.findall(text[head.end() :])
    user_agent = quoted[-1] if quoted else ""
    if user_agent == "-":
        user_agent = ""
    size = head.group("size")
    return LogLine(
        at=moment,
        path=_path_of(target),
        status=int(head.group("status")),
        size=0 if size == "-" else int(size),
        user_agent=user_agent,
    )


def _caddy_time(value: object) -> datetime | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _caddy_user_agent(headers: object) -> str:
    if not isinstance(headers, dict):
        return ""
    for key, value in headers.items():
        if str(key).lower() != "user-agent":
            continue
        if isinstance(value, list):
            return str(value[0]) if value else ""
        return str(value)
    return ""


def _caddy_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


def parse_caddy_json(line: str) -> LogLine | None:
    """One Caddy structured-log entry (`format json`), or `None` when it is not one."""
    text = (line or "").strip()
    if not text.startswith("{"):
        return None
    try:
        payload = json.loads(text)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    request = payload.get("request")
    if not isinstance(request, dict):
        return None
    moment = _caddy_time(payload.get("ts"))
    if moment is None:
        return None
    # Structured logs keep the method in its own field, unlike nginx's combined
    # line, so the request target is never glued to it.
    method = str(request.get("method") or "").upper()
    if method not in _METHODS:
        return None
    uri = request.get("uri") or request.get("URI") or ""
    return LogLine(
        at=moment,
        path=_path_of(str(uri)),
        status=_caddy_int(payload.get("status")),
        size=_caddy_int(payload.get("size")),
        user_agent=_caddy_user_agent(request.get("headers")),
    )


def parse_line(line: str, fmt: str = "auto") -> LogLine | None:
    """Dispatch on the configured format, or sniff it when asked to guess."""
    if fmt == "caddy":
        return parse_caddy_json(line)
    if fmt == "nginx":
        return parse_nginx_combined(line)
    if (line or "").lstrip().startswith("{"):
        return parse_caddy_json(line)
    return parse_nginx_combined(line)


def bucket_day(moment: datetime) -> str:
    """`YYYY-MM-DD` on the UTC+8 calendar, the same bucket every other table uses."""
    return local_day(moment)


def is_document_request(path: str) -> bool:
    """Would a reader (or a crawler) have received HTML for this path?

    Excluding assets and endpoints is not tidiness: counting `/assets/app.js` as a
    page read would inflate every number by roughly the number of sub-resources,
    and no amount of later aggregation can undo that.
    """
    text = (path or "").strip()
    if not text or not text.startswith("/"):
        return False
    lowered = text.lower()
    if lowered in _EXCLUDED_EXACT:
        return False
    for prefix in _EXCLUDED_PREFIXES:
        if lowered == prefix.rstrip("/") or lowered.startswith(prefix):
            return False
    return not lowered.endswith(_EXCLUDED_SUFFIXES)


__all__ = [
    "LOG_FORMATS",
    "LogLine",
    "bucket_day",
    "is_document_request",
    "parse_caddy_json",
    "parse_line",
    "parse_nginx_combined",
]
