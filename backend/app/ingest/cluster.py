"""Candidate clustering and fingerprinting, ported from functions/lib/cluster.mjs.

`matches` decides whether two candidates describe the same event. Its branch
order is the algorithm: model keys first, then model families, then URLs, then
title tokens. Reordering the checks changes which cluster wins, so the order is
kept verbatim.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from app.domain.text import sha256_hex
from app.ingest.normalize import title_tokens, normalize_url

Candidate = dict[str, Any]

FAMILY_ORDER = [
    "official",
    # Regulatory primary sources rank beside official announcements: a published
    # rule is a first-hand event, not commentary about one.
    "policy",
    "openrouter",
    "huggingface",
    "arxiv",
    "paper",
    "media",
    "community",
    "reference",
]

PRIMARY_FAMILIES = frozenset({"official", "policy", "openrouter", "huggingface", "arxiv", "paper"})

SOURCE_LIMIT = 6


def family_rank(family: object) -> int:
    try:
        return FAMILY_ORDER.index(str(family))
    except ValueError:
        return len(FAMILY_ORDER)


def _source_key_of(entry: Mapping[str, Any]) -> str:
    family = entry.get("family") or entry.get("sourceFamily") or ""
    identity = normalize_url(entry.get("url") or "") or entry.get("title") or ""
    return f"{family}|{identity}"


def merge_sources(*lists: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Deduplicate evidence entries, keep the earliest date, cap at six."""
    merged: dict[str, dict[str, Any]] = {}
    for items in lists:
        for raw in items or []:
            if not raw or not raw.get("url"):
                continue
            entry = dict(raw)
            entry["family"] = raw.get("family") or raw.get("sourceFamily") or ""
            entry["name"] = raw.get("name") or raw.get("sourceName") or ""
            entry.pop("sourceFamily", None)
            entry.pop("sourceName", None)
            key = _source_key_of(entry)
            existing = merged.get(key)
            if existing is None:
                merged[key] = entry
                continue
            if (entry.get("publishedAt") or "") < (existing.get("publishedAt") or ""):
                existing["publishedAt"] = entry.get("publishedAt")
            if not existing.get("title") and entry.get("title"):
                existing["title"] = entry["title"]
    ordered = sorted(merged.values(), key=lambda item: family_rank(item.get("family")))
    return ordered[:SOURCE_LIMIT]


def _union(left: list[Any] | None, right: list[Any] | None) -> list[Any]:
    out: list[Any] = []
    for value in list(left or []) + list(right or []):
        if value not in out:
            out.append(value)
    return out


def _min_date(values: list[str]) -> str:
    dates = sorted(value for value in values if _is_iso_day(value))
    return dates[0] if dates else ""


def _is_iso_day(value: object) -> bool:
    if not isinstance(value, str) or len(value) < 10:
        return False
    head = value[:10]
    return (
        head[4] == "-"
        and head[7] == "-"
        and head[:4].isdigit()
        and head[5:7].isdigit()
        and head[8:10].isdigit()
    )


def _category_rank(candidate: Mapping[str, Any]) -> int:
    category = candidate.get("category")
    if category == "model":
        return 0
    if category == "research":
        return 1
    return 2


def _pick_host(cluster: list[Candidate]) -> Candidate:
    def sort_key(candidate: Candidate) -> tuple[int, int, int]:
        evidence = candidate.get("evidence") or [{}]
        first = evidence[0] or {}
        rank = family_rank(first.get("sourceFamily") or first.get("family"))
        return (rank, _category_rank(candidate), -len(candidate.get("summary") or ""))

    return sorted(cluster, key=sort_key)[0]


def _merge_meta(target: Mapping[str, Any], source: Mapping[str, Any] | None) -> dict[str, Any]:
    meta = dict(target)
    for key, value in (source or {}).items():
        if value is None or value == "":
            continue
        if key == "contextWindow":
            meta["contextWindow"] = max(_number(meta.get("contextWindow")), _number(value))
        elif key in ("likes", "hfLikes"):
            meta[key] = max(_number(meta.get(key)), _number(value))
        elif key == "openWeights":
            meta["openWeights"] = bool(meta.get("openWeights")) or bool(value)
        elif key == "aliases":
            meta["aliases"] = _union(meta.get("aliases"), value)
        elif key == "hnPoints":
            meta["hnPoints"] = max(_number(meta.get("hnPoints")), _number(value))
        elif key not in meta:
            meta[key] = value
    return meta


def _number(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def combine_candidates(cluster: list[Candidate]) -> Candidate:
    host = _pick_host(cluster)
    sources = merge_sources(*[candidate.get("evidence") or [] for candidate in cluster])
    families: list[str] = []
    for source in sources:
        if source.get("family") not in families:
            families.append(source.get("family"))

    model_keys: list[str] = []
    aliases: list[str] = []
    urls: list[str] = []
    meta: dict[str, Any] = {}
    hn_points = 0.0
    hf_likes = 0.0
    head_lab = False
    official_primary = False
    sitemap = False
    notable_official = False
    domestic = False
    tokens: list[str] = []
    tags: list[Any] = []
    host_meta = host.get("meta") or {}
    family_key = host.get("familyKey") or host_meta.get("familyKey") or None

    for candidate in cluster:
        key = candidate.get("modelKey")
        if key and key not in model_keys:
            model_keys.append(key)
        for alias in candidate.get("aliases") or []:
            if alias not in aliases:
                aliases.append(alias)
        for url in candidate.get("urls") or []:
            if url and url not in urls:
                urls.append(url)
        meta = _merge_meta(meta, candidate.get("meta"))
        if candidate.get("familyKey"):
            family_key = family_key or candidate.get("familyKey")
        signals = candidate.get("signals") or {}
        hn_points = max(hn_points, _number(signals.get("hnPoints")))
        hf_likes = max(hf_likes, _number(signals.get("hfLikes")))
        head_lab = head_lab or bool(signals.get("headLab"))
        official_primary = official_primary or bool(signals.get("officialPrimary"))
        sitemap = sitemap or bool(signals.get("sitemap"))
        notable_official = notable_official or bool(signals.get("notableOfficial"))
        domestic = domestic or bool(signals.get("domestic"))
        if len(candidate.get("tokens") or []) > len(tokens):
            tokens = candidate["tokens"]
        tags = _union(tags, candidate.get("tags"))

    if model_keys:
        first_key = model_keys[0]
        meta["modelKey"] = first_key
        meta["aliases"] = _union(_union(aliases, model_keys), [first_key])
    if family_key:
        meta["familyKey"] = family_key

    primary_dates = [
        (source.get("publishedAt") or "")[:10]
        for source in sources
        if source.get("family") != "community"
    ]
    all_dates = [(source.get("publishedAt") or "")[:10] for source in sources]
    event_date = _min_date(primary_dates or all_dates) or host.get("eventDate") or ""

    merged: Candidate = dict(host)
    merged.update(
        {
            "eventDate": event_date,
            "sortDate": event_date,
            "year": int(event_date[:4]) if _is_iso_day(event_date) else host.get("year"),
            "title": host.get("title"),
            "titleEn": host.get("titleEn"),
            "summary": host.get("summary"),
            "summaryKind": host.get("summaryKind"),
            "tags": tags,
            "meta": meta,
            "evidence": sources,
            "urls": urls,
            "aliases": aliases,
            "modelKey": model_keys[0] if model_keys else None,
            "familyKey": family_key or None,
            "tokens": tokens or host.get("tokens") or [],
            "signals": {
                "headLab": head_lab,
                "hnPoints": hn_points,
                "hfLikes": hf_likes,
                "officialPrimary": official_primary,
                "mediaOnly": len(families) == 1 and families[0] == "media",
                "sitemap": sitemap,
                "notableOfficial": notable_official,
                "domestic": domestic,
            },
            "familyCount": len(families),
            "families": families,
        }
    )
    return merged


def days_between(left: object, right: object) -> float:
    """UTC day-granularity distance, `Infinity` when either side is unparsable."""
    first = _parse_day(left)
    second = _parse_day(right)
    if first is None or second is None:
        return float("inf")
    return abs((first - second).total_seconds()) / 86_400


def _parse_day(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def token_overlap(left: list[str] | None, right: list[str] | None) -> float:
    if not left or not right:
        return 0.0
    known = set(left)
    shared = sum(1 for token in right if token in known)
    ratio = shared / min(len(left), len(right))
    return ratio if shared >= 2 and ratio >= 0.72 else 0.0


def matches(left: Candidate, right: Candidate) -> str:
    keys_left = {value for value in list(left.get("aliases") or []) + [left.get("modelKey")] if value}
    keys_right = {value for value in list(right.get("aliases") or []) + [right.get("modelKey")] if value}
    for key in keys_left:
        if key in keys_right:
            return "model-key"

    if left.get("category") == "model" and right.get("category") == "model":
        left_family = left.get("familyKey") or (left.get("meta") or {}).get("familyKey")
        left_vendor = (left.get("meta") or {}).get("vendorKey")
        right_family = right.get("familyKey") or (right.get("meta") or {}).get("familyKey")
        right_vendor = (right.get("meta") or {}).get("vendorKey")
        if left_family and left_family == right_family and left_vendor and left_vendor == right_vendor:
            if days_between(left.get("eventDate"), right.get("eventDate")) <= 7:
                return "model-family"

    urls_left = {url for url in left.get("urls") or [] if url}
    for url in right.get("urls") or []:
        if url and url in urls_left:
            return "url"

    community_links = {
        normalize_url(source.get("url"))
        for source in left.get("evidence") or []
        if source.get("family") == "community"
    }
    for url in right.get("urls") or []:
        if url and url in community_links:
            return "community-link"

    if left.get("category") == right.get("category"):
        if days_between(left.get("eventDate"), right.get("eventDate")) <= 10:
            if token_overlap(left.get("tokens"), right.get("tokens")) > 0:
                return "title"
    if left.get("category") != "model" and right.get("category") != "model":
        if days_between(left.get("eventDate"), right.get("eventDate")) <= 3:
            if token_overlap(left.get("tokens"), right.get("tokens")) > 0:
                return "title-cross-category"
    return ""


def importance_of(candidate: Candidate) -> int:
    families = candidate.get("families") or []
    signals = candidate.get("signals") or {}
    score = 20
    if len(families) >= 2:
        score += 25
    if len(families) >= 3:
        score += 10
    if signals.get("headLab"):
        score += 15
    hn = _number(signals.get("hnPoints"))
    if hn >= 500:
        score += 12
    elif hn >= 200:
        score += 6
    elif 0 < hn < 250:
        score -= 10
    if _number(signals.get("hfLikes")) >= 1000:
        score += 8
    if signals.get("officialPrimary"):
        score += 8
    # A preprint is a primary research artifact; the topic gate in normalize
    # already limits arXiv candidates to on-topic work.
    if "arxiv" in families:
        score += 8
    # Domestic AI outlets are often the first (and only) feed covering a
    # Chinese launch or policy move.
    if signals.get("domestic"):
        score += 12
    return max(0, min(100, score))


def confidence_of(candidate: Candidate, importance: int) -> str:
    families = candidate.get("families") or []
    if len(families) >= 2:
        return "verified"
    if len(families) == 1 and families[0] in PRIMARY_FAMILIES and importance >= 55:
        return "likely"
    return "single"


def should_keep(candidate: Candidate, importance: int, confidence: str) -> bool:
    if candidate.get("origin") == "seed":
        return True
    families = candidate.get("families") or []
    signals = candidate.get("signals") or {}
    head = families[0] if families else None

    # Sitemap `lastmod` values are bulk-refresh stamps, not publication dates.
    # A sitemap entry can corroborate a dated item, never stand alone.
    if signals.get("sitemap") and len(families) == 1:
        return False
    if len(families) >= 2:
        return True

    if candidate.get("category") == "model":
        if head == "official" and not signals.get("notableOfficial"):
            return False
        cross = "openrouter" in families and (
            "huggingface" in families or "official" in families or "media" in families
        )
        hf_cross = "huggingface" in families and "official" in families
        if not signals.get("headLab") and _number(signals.get("hfLikes")) < 100 and not cross and not hf_cross:
            return False
        return True

    if head == "official":
        return bool(signals.get("notableOfficial")) and importance >= 28
    # A regulator's own text has no `notableOfficial` signal to earn — the
    # `is_notable_official` gate is about press-release noise. One effective rule
    # is a milestone by itself, so the bar is the importance floor alone.
    if head == "policy":
        return importance >= 30
    # Single-source preprints are kept only when they pass the topic gate and
    # reach the preprint baseline importance; cross-source matches rank higher.
    if head == "arxiv":
        return importance >= 28
    if head == "media":
        if signals.get("domestic"):
            return importance >= 32
        return _number(signals.get("hnPoints")) >= 300 or importance >= 55
    if head == "community":
        return importance >= 45
    return confidence != "single" or importance >= 25


def fingerprint_of(candidate: Candidate) -> str:
    year = candidate.get("year") or (candidate.get("eventDate") or "")[:4]
    tokens = candidate.get("tokens") or []
    if candidate.get("modelKey"):
        identity = f"model:{candidate['modelKey']}|{year}"
    elif candidate.get("seedId") and not tokens:
        identity = f"seed:{candidate['seedId']}"
    else:
        identity = f"topic:{'-'.join(tokens[:6])}|{year}"
    return sha256_hex(f"{candidate.get('category')}|{identity}")


def finalize(candidate: Candidate) -> Candidate:
    curated = candidate.get("curatedImportance")
    importance = curated if curated is not None else importance_of(candidate)
    confidence = confidence_of(candidate, importance)
    out = dict(candidate)
    out["importance"] = importance
    out["confidence"] = confidence
    out["sourceCount"] = len(candidate.get("evidence") or [])
    if not out.get("fingerprint"):
        out["fingerprint"] = fingerprint_of(out)
    return out


def _row_get(row: object, key: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(key, default)
    return getattr(row, key, default)


def from_existing(row: object) -> Candidate:
    meta = _row_get(row, "meta") or {}
    sources = _row_get(row, "sources")
    if not isinstance(sources, list):
        sources = []
    urls = [url for url in (normalize_url(source.get("url")) for source in sources) if url]
    title_en = _row_get(row, "title_en")
    title = _row_get(row, "title")
    origin = _row_get(row, "origin")
    importance = _row_get(row, "importance")
    return {
        "id": _row_get(row, "id"),
        "existing": True,
        "category": _row_get(row, "category"),
        "title": title,
        "titleEn": title_en,
        "eventDate": _row_get(row, "event_date"),
        "sortDate": _row_get(row, "sort_date"),
        "year": _row_get(row, "year"),
        "organization": _row_get(row, "organization"),
        "modelName": _row_get(row, "model_name"),
        "modelKey": meta.get("modelKey"),
        "familyKey": meta.get("familyKey"),
        "aliases": meta.get("aliases") or [],
        "urls": urls,
        "tokens": title_tokens(title_en or title),
        "meta": meta,
        "evidence": sources,
        "origin": origin,
        "fingerprint": _row_get(row, "fingerprint"),
        "importance": importance,
        "confidence": _row_get(row, "confidence"),
        "firstSeenAt": _row_get(row, "first_seen_at"),
        "curatedImportance": importance if origin == "seed" else None,
    }


def cluster_candidates(
    candidates: list[Candidate], existing_rows: list[Any] | None = None
) -> dict[str, list[Candidate]]:
    """Group fresh candidates into events, then reconcile them with stored rows.

    Returns `{"items": [...], "updates": [...]}`; `updates` carry an
    `existingId` pointing at the row that must be rewritten. Two extra keys feed
    the collection funnel: `dropped` (one entry per cluster `should_keep`
    refused, with its reason) and `dedup` (how many evidence rows collapsed into
    already-known items). Neither changes `items`/`updates`.
    """
    clusters: list[list[Candidate]] = []
    for candidate in candidates:
        bucket = None
        for group in clusters:
            if any(matches(member, candidate) for member in group):
                bucket = group
                break
        if bucket is not None:
            bucket.append(candidate)
        else:
            clusters.append([candidate])

    existing = [from_existing(row) for row in existing_rows or []]
    results: list[Candidate] = []
    updates: list[Candidate] = []
    dropped: list[dict[str, Any]] = []
    dedup = 0
    by_existing: dict[Any, Candidate] = {}

    for bucket in clusters:
        merged = combine_candidates(bucket)
        match = next((row for row in existing if matches(row, merged)), None)
        if match is not None:
            merged = combine_candidates(
                [
                    merged,
                    {
                        **match,
                        "urls": match.get("urls"),
                        "aliases": match.get("aliases"),
                        "modelKey": match.get("modelKey"),
                        "tokens": [],
                        "evidence": match.get("evidence"),
                        "meta": match.get("meta"),
                        "signals": {
                            "headLab": False,
                            "hnPoints": 0,
                            "hfLikes": 0,
                            "officialPrimary": False,
                            "mediaOnly": False,
                        },
                        "category": match.get("category"),
                        "eventDate": match.get("eventDate"),
                    },
                ]
            )
            merged["existingId"] = match.get("id")
            merged["existingFingerprint"] = match.get("fingerprint")
            merged["existingOrigin"] = match.get("origin")
            merged["firstSeenAt"] = match.get("firstSeenAt")

        finalized = finalize(merged)
        # An item that never became an event still has to explain itself: this
        # was a silent `continue` until the collection ledger existed.
        dedup += max(len(bucket) - 1, 0)
        if not should_keep(finalized, finalized["importance"], finalized["confidence"]):
            dropped.append({"candidate": finalized, "reason": "below_keep"})
            continue

        existing_id = finalized.get("existingId")
        if existing_id:
            previous = by_existing.get(existing_id)
            if previous is not None:
                combined = finalize(combine_candidates([previous, finalized]))
                combined["existingId"] = finalized.get("existingId")
                combined["existingFingerprint"] = finalized.get("existingFingerprint")
                combined["existingOrigin"] = finalized.get("existingOrigin")
                combined["firstSeenAt"] = finalized.get("firstSeenAt")
                index = results.index(previous)
                if index != -1:
                    results[index] = combined
                update_index = updates.index(previous)
                if update_index != -1:
                    updates[update_index] = combined
                by_existing[existing_id] = combined
            else:
                results.append(finalized)
                updates.append(finalized)
                by_existing[existing_id] = finalized
        else:
            results.append(finalized)

    results.sort(key=lambda item: item.get("sortDate") or "", reverse=True)
    return {"items": results, "updates": updates, "dropped": dropped, "dedup": dedup}


def summarize_confidence(items: list[Candidate]) -> dict[str, int]:
    counts = {"verified": 0, "likely": 0, "single": 0}
    for item in items:
        key = item.get("confidence")
        counts[key] = counts.get(key, 0) + 1
    return counts
