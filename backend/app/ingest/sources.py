"""Upstream fetching and parsing, ported from functions/lib/sources.mjs.

Every outbound URL is a constant from this module; redirects are re-checked
against the same host list. The parsing stays regex-based so the output is
identical to the reference implementation.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx

from app.domain.text import decode_entities, html_to_text, parse_iso

ALLOWED_HOSTS = frozenset(
    {
        "openrouter.ai",
        "huggingface.co",
        "export.arxiv.org",
        "arxiv.org",
        "hn.algolia.com",
        "openai.com",
        "blog.google",
        "www.anthropic.com",
        "techcrunch.com",
        "www.theverge.com",
        "www.technologyreview.com",
        "www.qbitai.com",
        "www.leiphone.com",
        "www.tmtpost.com",
        "www.infoq.cn",
    }
)

FAMILY_LABELS = {
    "openrouter": "模型目录",
    "huggingface": "开源模型库",
    "arxiv": "论文预印本",
    "official": "官方公告",
    "community": "社区讨论",
    "media": "媒体报道",
}

ARXIV_QUERY = "+OR+".join(["cat:cs.AI", "cat:cs.CL", "cat:cs.LG", "cat:cs.MA", "cat:cs.RO"])

MAX_BODY_BYTES = 3 * 1024 * 1024


def _hn_url(query: str, days: int) -> str:
    from urllib.parse import quote

    since = int(time.time()) - days * 86400
    return (
        "https://hn.algolia.com/api/v1/search_by_date?tags=story"
        f"&query={quote(query, safe='')}"
        f"&numericFilters=points%3E120,created_at_i%3E{since}"
        "&hitsPerPage=50"
    )


SOURCES: list[dict[str, Any]] = [
    {
        "key": "openrouter",
        "family": "openrouter",
        "name": "OpenRouter",
        "kind": "openrouter",
        "url": "https://openrouter.ai/api/v1/models",
        "timeout": 7000,
    },
    {
        "key": "arxiv",
        "family": "arxiv",
        "name": "arXiv",
        "kind": "arxiv",
        "url": (
            "https://export.arxiv.org/api/query?search_query="
            + ARXIV_QUERY
            + "&sortBy=submittedDate&sortOrder=descending&max_results=30"
        ),
        "timeout": 7000,
    },
    {
        "key": "qbitai",
        "family": "media",
        "name": "量子位",
        "kind": "feed",
        "url": "https://www.qbitai.com/feed",
        "timeout": 7000,
        "domestic": True,
        "aiOnly": True,
    },
    {
        "key": "infoq",
        "family": "media",
        "name": "InfoQ 中国",
        "kind": "feed",
        "url": "https://www.infoq.cn/feed",
        "timeout": 7000,
        "domestic": True,
        "aiOnly": True,
    },
    {
        "key": "tmtpost",
        "family": "media",
        "name": "钛媒体",
        "kind": "feed",
        "url": "https://www.tmtpost.com/rss",
        "timeout": 7000,
        "domestic": True,
        "aiOnly": True,
    },
    {
        "key": "leiphone",
        "family": "media",
        "name": "雷峰网",
        "kind": "feed",
        "url": "https://www.leiphone.com/feed",
        "timeout": 7000,
        "domestic": True,
        "aiOnly": True,
    },
    {
        "key": "hn-llm",
        "family": "community",
        "name": "Hacker News · LLM",
        "kind": "hn",
        "url": _hn_url("LLM", 14),
        "timeout": 7000,
    },
    {
        "key": "hn-ai",
        "family": "community",
        "name": "Hacker News · AI",
        "kind": "hn",
        "url": _hn_url("AI", 14),
        "timeout": 7000,
    },
    {
        "key": "openai",
        "family": "official",
        "name": "OpenAI News",
        "kind": "feed",
        "url": "https://openai.com/news/rss.xml",
        "timeout": 7000,
    },
    {
        "key": "google",
        "family": "official",
        "name": "Google AI Blog",
        "kind": "feed",
        "url": "https://blog.google/technology/ai/rss/",
        "timeout": 7000,
    },
    {
        "key": "anthropic",
        "family": "official",
        "name": "Anthropic News",
        "kind": "sitemap",
        "url": "https://www.anthropic.com/sitemap.xml",
        "timeout": 7000,
    },
    {
        "key": "techcrunch",
        "family": "media",
        "name": "TechCrunch AI",
        "kind": "feed",
        "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
        "timeout": 7000,
    },
    {
        "key": "verge",
        "family": "media",
        "name": "The Verge AI",
        "kind": "feed",
        "url": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
        "timeout": 7000,
    },
    {
        "key": "mittr",
        "family": "media",
        "name": "MIT Technology Review AI",
        "kind": "feed",
        "url": "https://www.technologyreview.com/topic/artificial-intelligence/feed",
        "timeout": 7000,
    },
    # Hugging Face endpoints are the slowest at the edge. They run last so a
    # timeout cannot consume the fetch slots the faster feeds need.
    {
        "key": "hf-blog",
        "family": "official",
        "name": "Hugging Face Blog",
        "kind": "feed",
        "url": "https://huggingface.co/blog/feed.xml",
        "timeout": 7000,
    },
    {
        "key": "hf-trending",
        "family": "huggingface",
        "name": "Hugging Face Trending",
        "kind": "hf",
        "url": "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=60",
        "timeout": 7000,
    },
    {
        "key": "hf-textgen",
        "family": "huggingface",
        "name": "Hugging Face 文本生成",
        "kind": "hf",
        "url": "https://huggingface.co/api/models?sort=likes&direction=-1&filter=text-generation&limit=40",
        "timeout": 7000,
    },
]

SOURCE_BY_KEY = {source["key"]: source for source in SOURCES}


@dataclass
class FetchResult:
    """Minimal Response stand-in, matching what sources.mjs reads."""

    ok: bool
    status: int
    url: str
    text: str = ""
    content_length: int | None = None
    headers: dict[str, str] = field(default_factory=dict)


Fetcher = Callable[[str], Awaitable[FetchResult]]


def host_allowed(url: str) -> bool:
    try:
        from urllib.parse import urlparse

        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host in ALLOWED_HOSTS


def _tagged(block: str, names: list[str]) -> str:
    for name in names:
        pattern = re.compile(
            rf"<{name}(?:\s[^>]*)?>([\s\S]*?)</{name}>", re.IGNORECASE | re.ASCII
        )
        match = pattern.search(block)
        if match:
            value = decode_entities(match.group(1)).strip()
            if value:
                return value
    return ""


def _attr(block: str, tag: str, name: str) -> str:
    pattern = re.compile(
        rf"<{tag}\b[^>]*\b{name}\s*=\s*[\"']([^\"']+)[\"'][^>]*>",
        re.IGNORECASE | re.ASCII,
    )
    match = pattern.search(block)
    return decode_entities(match.group(1)).strip() if match else ""


def _parse_date(value: str) -> str | None:
    if not value:
        return None
    parsed = parse_iso(value)
    if parsed is None:
        return None
    from app.domain.text import format_iso

    return format_iso(parsed)


def _pick_link(block: str) -> str:
    atom = re.search(
        r"<link\b[^>]*\brel\s*=\s*[\"']alternate[\"'][^>]*>", block, re.IGNORECASE | re.ASCII
    )
    if atom:
        href = _attr(atom.group(0) + ">", "link", "href")
        if href:
            return href
    any_href = re.search(r"<link\b[^>]*\bhref\s*=\s*[\"']([^\"']+)[\"'][^>]*>", block, re.IGNORECASE | re.ASCII)
    if any_href:
        href = decode_entities(any_href.group(1)).strip()
        if href:
            return href
    plain = _tagged(block, ["link"])
    if plain:
        return plain
    guid = _tagged(block, ["guid", "id"])
    return guid if re.match(r"^https?://", guid, re.I) else ""


def parse_feed(xml: str) -> list[dict[str, Any]]:
    """RSS 2.0 and Atom both end up here."""
    if not isinstance(xml, str) or len(xml) < 40:
        return []
    blocks: list[str] = []
    blocks.extend(match.group(0) for match in re.finditer(r"<item\b[\s\S]*?</item>", xml, re.I))
    blocks.extend(match.group(0) for match in re.finditer(r"<entry\b[\s\S]*?</entry>", xml, re.I))
    blocks = blocks[:120]

    out: list[dict[str, Any]] = []
    for block in blocks:
        title = html_to_text(_tagged(block, ["title"]), 300)
        if not title:
            continue
        url = _pick_link(block)
        summary = html_to_text(
            _tagged(block, ["description", "summary", "content:encoded", "content"]), 600
        )
        date = _parse_date(_tagged(block, ["pubDate", "published", "updated", "dc:date", "date"]))
        external_id = _tagged(block, ["guid", "id"]) or url or f"{title}|{date or ''}"
        out.append(
            {
                "title": title,
                "url": url,
                "summary": summary,
                "publishedAt": date,
                "externalId": external_id,
            }
        )
    return out


def parse_sitemap(xml: str, path_pattern: str = "/news/") -> list[dict[str, Any]]:
    if not isinstance(xml, str):
        return []
    out: list[dict[str, Any]] = []
    for match in re.finditer(r"<url>([\s\S]*?)</url>", xml, re.I):
        block = match.group(1)
        loc = _tagged(block, ["loc"])
        if not loc or path_pattern not in loc:
            continue
        lastmod = _parse_date(_tagged(block, ["lastmod"]))
        slug = [part for part in loc.split("/") if part][-1] if loc.split("/") else loc
        title = re.sub(r"\b\w", lambda m: m.group(0).upper(), re.sub(r"[-_]+", " ", slug)).strip()
        out.append({"title": title, "url": loc, "summary": "", "publishedAt": lastmod, "externalId": loc})
    return out


def parse_openrouter(payload: Any) -> list[dict[str, Any]]:
    from app.domain.text import format_iso
    from datetime import datetime, timezone

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for model in data:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str):
            continue
        created = model.get("created")
        created_iso = None
        if created:
            try:
                created_iso = format_iso(datetime.fromtimestamp(int(created), tz=timezone.utc))
            except (TypeError, ValueError, OSError):
                created_iso = None
        architecture = model.get("architecture") or {}
        context_length = model.get("context_length")
        out.append(
            {
                "id": model["id"],
                "canonicalSlug": model.get("canonical_slug") or model["id"],
                "name": model.get("name") or model["id"],
                "created": created_iso,
                "contextLength": context_length if isinstance(context_length, int) else None,
                "modality": architecture.get("modality") or "",
                "description": model.get("description") if isinstance(model.get("description"), str) else "",
                "huggingFaceId": model.get("hugging_face_id") or None,
                "inputModalities": (
                    architecture.get("input_modalities")
                    if isinstance(architecture.get("input_modalities"), list)
                    else []
                ),
            }
        )
    return out


def parse_hf(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    out: list[dict[str, Any]] = []
    for model in payload:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str):
            continue
        model_id = model["id"]
        out.append(
            {
                "id": model_id,
                "author": model.get("author") or model_id.split("/")[0] or "",
                "createdAt": _parse_date(model.get("createdAt") or ""),
                "likes": int(model.get("likes") or 0),
                "downloads": int(model.get("downloads") or 0),
                "trendingScore": int(model.get("trendingScore") or 0),
                "tags": [tag for tag in (model.get("tags") or []) if isinstance(tag, str)],
                "pipelineTag": model.get("pipeline_tag") or "",
            }
        )
    return out


def parse_arxiv(xml: str) -> list[dict[str, Any]]:
    if not isinstance(xml, str):
        return []
    out: list[dict[str, Any]] = []
    for match in re.finditer(r"<entry\b[\s\S]*?</entry>", xml, re.I):
        block = match.group(0)
        raw_id = _tagged(block, ["id"])
        title = html_to_text(_tagged(block, ["title"]), 400)
        if not title or not raw_id:
            continue
        url = re.sub(r"^http:", "https:", raw_id) if re.match(r"^https?://", raw_id) else ""
        summary = html_to_text(_tagged(block, ["summary"]), 2000)
        published_at = _parse_date(_tagged(block, ["published"])) or _parse_date(_tagged(block, ["updated"]))
        categories = [m.group(1) for m in re.finditer(r"<category\b[^>]*term=[\"']([^\"']+)[\"']", block, re.I)]
        out.append(
            {
                "id": raw_id,
                "title": title,
                "url": url,
                "summary": summary,
                "publishedAt": published_at,
                "categories": categories,
                "externalId": raw_id,
            }
        )
    return out


def parse_hn(payload: Any) -> list[dict[str, Any]]:
    hits = payload.get("hits") if isinstance(payload, dict) else None
    if not isinstance(hits, list):
        return []
    out: list[dict[str, Any]] = []
    for hit in hits:
        if not isinstance(hit, dict) or not hit.get("title"):
            continue
        hn_link = f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        raw_url = hit.get("url")
        url = raw_url if isinstance(raw_url, str) and re.match(r"^https?:", raw_url, re.I) else hn_link
        out.append(
            {
                "id": hit.get("objectID"),
                "title": html_to_text(hit.get("title"), 300),
                "url": url,
                "hnLink": hn_link,
                "summary": "",
                "points": int(hit.get("points") or 0),
                "comments": int(hit.get("num_comments") or 0),
                "publishedAt": _parse_date(hit.get("created_at") or ""),
                "externalId": str(hit.get("objectID")),
                "author": hit.get("author") or "",
            }
        )
    return out


async def httpx_fetch(url: str, *, timeout_ms: int) -> FetchResult:
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(
                url,
                timeout=max(0.25, timeout_ms / 1000),
                headers={
                    "accept": "application/json, application/xml, text/xml, application/atom+xml, */*",
                    "user-agent": "AI-Chronicle/1.0 (+https://aihist.net)",
                },
            )
            declared = response.headers.get("content-length")
            return FetchResult(
                ok=response.status_code < 400,
                status=response.status_code,
                url=str(response.url),
                text=response.text,
                content_length=int(declared) if declared and declared.isdigit() else None,
                headers=dict(response.headers),
            )
    except httpx.HTTPError as error:  # reported as a fixed code, never raised
        raise TimeoutError("timeout") from error


def _classify_error(message: str, timed_out: bool) -> str:
    # Mirrors the JS heuristic: only purely lowercase/underscore messages are
    # treated as codes (`http_404` therefore degrades to `network`).
    if re.fullmatch(r"[a-z_]+", message):
        code = message
    else:
        code = "timeout" if timed_out else "network"
    return "too_large" if code == "body_too_large" else code


async def load_source(source: dict[str, Any], *, fetch: Fetcher, deadline_ms: int) -> dict[str, Any]:
    started = int(time.time() * 1000)
    if started >= deadline_ms:
        return {
            "key": source["key"],
            "family": source["family"],
            "name": source["name"],
            "ok": False,
            "error": "deadline",
            "items": [],
            "ms": 0,
        }
    remaining = max(250, deadline_ms - started)
    budget_ms = min(source.get("timeout", 7000), remaining)
    try:
        result = await asyncio.wait_for(fetch(source["url"]), timeout=budget_ms / 1000)
        if not host_allowed(result.url):
            raise ValueError("bad_redirect")
        if not result.ok:
            raise ValueError(f"http_{result.status}")
        body = result.text
        if result.content_length and result.content_length > MAX_BODY_BYTES:
            raise ValueError("body_too_large")
        if len(body) > MAX_BODY_BYTES:
            raise ValueError("body_too_large")
        kind = source.get("kind")
        items: list[dict[str, Any]] = []
        if kind == "feed":
            items = parse_feed(body)
        elif kind == "sitemap":
            items = parse_sitemap(body)
        elif kind == "arxiv":
            items = parse_arxiv(body)
        else:
            try:
                payload = json.loads(body)
            except json.JSONDecodeError as error:
                raise ValueError("parse_error") from error
            if kind == "openrouter":
                items = parse_openrouter(payload)
            elif kind == "hf":
                items = parse_hf(payload)
            elif kind == "hn":
                items = parse_hn(payload)
        if not items:
            raise ValueError("empty_source")
        return {
            "key": source["key"],
            "family": source["family"],
            "name": source["name"],
            "kind": source.get("kind"),
            "url": source["url"],
            "domestic": bool(source.get("domestic")),
            "aiOnly": bool(source.get("aiOnly")),
            "ok": True,
            "error": None,
            "items": items,
            "ms": int(time.time() * 1000) - started,
        }
    except asyncio.TimeoutError:
        error = "timeout"
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - a broken upstream is data, not a crash
        message = str(exc)
        timed_out = isinstance(exc, TimeoutError) or "timeout" in message.lower()
        error = _classify_error(message, timed_out)
    return {
        "key": source["key"],
        "family": source["family"],
        "name": source["name"],
        "ok": False,
        "error": error,
        "items": [],
        "ms": int(time.time() * 1000) - started,
    }


async def load_sources(
    sources: list[dict[str, Any]],
    *,
    fetch: Fetcher,
    deadline_ms: int,
    concurrency: int = 4,
) -> list[dict[str, Any]]:
    """Run fetches with a small concurrency ceiling and a shared deadline."""
    results: list[dict[str, Any] | None] = [None] * len(sources)
    cursor = 0
    lock = asyncio.Lock()

    async def worker() -> None:
        nonlocal cursor
        while True:
            async with lock:
                if cursor >= len(sources):
                    return
                index = cursor
                cursor += 1
            results[index] = await load_source(sources[index], fetch=fetch, deadline_ms=deadline_ms)

    await asyncio.gather(*(worker() for _ in range(min(concurrency, len(sources)))))
    return [result for result in results if result is not None]
