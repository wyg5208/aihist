"""One synchronisation run: seed → fetch → normalise → cluster → review → write.

This is the orchestration only. Every rule lives in `normalize`, `cluster` and
`editorial`; this module decides the order, the caps and what gets persisted.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Mapping

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import repo_events, repo_ops, repo_sync
from app.db.repo_sync import utc_now
from app.domain.slug import auto_slug, seed_slug
from app.editorial.panel import aggregate_reviews, build_panel_config, httpx_post, judge_batch
from app.editorial.rules import (
    MIN_INCLUDE_VOTES,
    RUBRIC_VERSION,
    RULE_PANEL_THRESHOLD,
    assess_candidate,
    decision_record,
    review_summary,
    rule_decision,
    should_audit_out,
)
from app.ingest.cluster import cluster_candidates, confidence_of, fingerprint_of
from app.ingest.ledger import Ledger
from app.ingest.normalize import CATEGORY_KEYS, normalize_results
from app.ingest.registry import allowed_hosts, enabled_sources, ensure_catalog
from app.ingest.seed import SEED_EVENTS, SEED_VERSION
from app.ingest.sources import ALLOWED_HOSTS, SOURCE_TIMEOUT_MS, load_sources
from app.ingest.catalog import SEED_SOURCES

DEFAULT_RUN_BUDGET_MS = 300_000
DEFAULT_FETCH_BUDGET_MS = 120_000
MAX_RAW_ITEMS = 180
MAX_NEW_EVENTS = 50
MAX_PANEL_ITEMS = 24
MAX_FETCH_CONCURRENCY = 6
RECENT_YEAR_SPAN = 2
SUMMARY_TIMEOUT_MS = 8_000

SUMMARY_PROMPT = (
    "你是 AI 编年史的编辑。为给定事件写一句简洁、只陈述事实的中文摘要，不要推测。"
    '输出 JSON：{"items":[{"id":"...","summary":"..."}]}'
)

Post = Callable[[str, str, dict[str, Any], int], Awaitable[tuple[int, Any]]]


class SyncError(Exception):
    """A run-stage failure carrying the code that is written to `sync_runs`."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def stable(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def precision_of(date: str) -> str:
    if len(date) == 4 and date.isdigit():
        return "year"
    if len(date) == 7 and date[4] == "-" and date[:4].isdigit() and date[5:].isdigit():
        return "month"
    return "day"


def timestamp_of(date: object) -> str | None:
    if not isinstance(date, str):
        return None
    if len(date) == 10 and date[4] == "-" and date[7] == "-":
        return f"{date}T00:00:00.000Z"
    if len(date) == 7 and date[4] == "-":
        return f"{date}-01T00:00:00.000Z"
    if len(date) == 4 and date.isdigit():
        return f"{date}-01-01T00:00:00.000Z"
    return None


def _unique(values: list[Any]) -> list[Any]:
    out: list[Any] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def interleave_candidates(candidates: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Round-robin across sources before the raw cap is applied.

    OpenRouter alone returns hundreds of models; a plain slice would spend the
    whole run budget on one source and drop every feed, including the domestic
    outlets.
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        evidence = candidate.get("evidence") or []
        first = evidence[0] if evidence else {}
        source_key = first.get("sourceKey") if isinstance(first, dict) else None
        key = source_key or (candidate.get("key") or "").split(":")[0] or "other"
        groups.setdefault(key, []).append(candidate)

    queues = [rows[:40] for rows in groups.values()]
    out: list[dict[str, Any]] = []
    added = True
    while len(out) < limit and added:
        added = False
        for queue in queues:
            if not queue:
                continue
            out.append(queue.pop(0))
            added = True
            if len(out) >= limit:
                break
    return out


def fallback_summary(candidate: Mapping[str, Any]) -> str:
    title = candidate.get("titleEn") or candidate.get("title") or ""
    return candidate.get("summary") or title


def event_row(candidate: dict[str, Any], now: datetime) -> dict[str, Any]:
    date = candidate.get("eventDate") or candidate.get("sortDate") or f"{candidate.get('year') or 2025}-01-01"
    year = candidate.get("year") or int(date[:4])
    families = _unique(
        [(source.get("family") if isinstance(source, dict) else None) or "official" for source in candidate.get("evidence") or []]
    )
    slug = ""
    if candidate.get("origin") == "seed":
        slug = seed_slug(candidate.get("seedId"))
    slug = slug or auto_slug(year, candidate.get("fingerprint"))
    evidence = candidate.get("evidence") or []
    return {
        "id": uuid.uuid4(),
        "slug": slug or None,
        "fingerprint": candidate["fingerprint"],
        "event_date": date,
        "date_precision": candidate.get("datePrecision") or precision_of(date),
        "sort_date": candidate.get("sortDate") or date,
        "year": year,
        "title": candidate.get("title") or "",
        "title_en": candidate.get("titleEn") or None,
        "summary": fallback_summary(candidate),
        "summary_kind": candidate.get("summaryKind") or "excerpt",
        "category": candidate.get("category"),
        "organization": candidate.get("organization") or None,
        "model_name": candidate.get("modelName") or None,
        "importance": candidate.get("importance"),
        "confidence": candidate.get("confidence"),
        "source_count": candidate.get("sourceCount")
        if candidate.get("sourceCount") is not None
        else len(evidence),
        "source_families": families,
        "sources": evidence,
        "tags": candidate.get("tags") or [],
        "meta": candidate.get("meta") or {},
        "origin": candidate.get("origin") or "auto",
        "editorial_status": "admitted"
        if candidate.get("origin") == "seed"
        else candidate.get("editorialStatus"),
        "editorial_review": candidate.get("editorialReview") or None,
        "first_seen_at": now,
        "updated_at": now,
    }


def _seed_fingerprint(candidate: dict[str, Any]) -> str:
    families = _unique(
        [(source.get("family") if isinstance(source, dict) else None) or "official" for source in candidate.get("evidence") or []]
    )
    curated = candidate.get("curatedImportance")
    importance = 50 if curated is None else curated
    return fingerprint_of(
        {
            **candidate,
            "importance": importance,
            "confidence": confidence_of({"families": families}, importance),
            "sourceCount": len(candidate.get("evidence") or []),
        }
    )


def seed_rows(now: datetime) -> list[dict[str, Any]]:
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    for candidate in SEED_EVENTS:
        if candidate.get("category") not in CATEGORY_KEYS:
            continue
        fingerprint = _seed_fingerprint(candidate)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        curated = candidate.get("curatedImportance")
        families = _unique(
            [
                (source.get("family") if isinstance(source, dict) else None) or "official"
                for source in candidate.get("evidence") or []
            ]
        )
        finalized = {
            **candidate,
            "importance": 50 if curated is None else curated,
            "confidence": confidence_of({"families": families}, 50 if curated is None else curated),
            "sourceCount": len(candidate.get("evidence") or []),
            "fingerprint": fingerprint,
        }
        rows.append(event_row(finalized, now))
    return rows


def seed_slug_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for candidate in SEED_EVENTS:
        slug = seed_slug(candidate.get("seedId"))
        if slug:
            mapping[_seed_fingerprint(candidate)] = slug
    return mapping


async def backfill_slugs(session: AsyncSession, now: datetime) -> int:
    """One-off, idempotent backfill for rows created before slugs existed."""
    rows = await repo_events.load_slugless_events(session, 300)
    if not rows:
        return 0
    seeds = seed_slug_map()
    patches = []
    for row in rows:
        slug = seeds.get(row.fingerprint) or auto_slug(row.year, row.fingerprint)
        if slug:
            patches.append({"id": row.id, "patch": {"slug": slug, "updated_at": now}})
    if not patches:
        return 0
    return await repo_events.update_events(session, patches)


def raw_rows(candidates: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in candidates:
        for source in candidate.get("evidence") or []:
            if not isinstance(source, dict) or not source.get("url"):
                continue
            external_id = source.get("externalId") or source["url"]
            fingerprint = hashlib.sha256(
                f"{source.get('name') or candidate.get('title') or ''}|{external_id}".encode("utf-8")
            ).hexdigest()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "fingerprint": fingerprint,
                    "source_family": source.get("family") or "official",
                    "source_name": source.get("name") or "Unknown",
                    "external_id": str(external_id),
                    "title": (source.get("title") or candidate.get("title") or "")[:500],
                    "url": source["url"],
                    "published_at": timestamp_of(candidate.get("eventDate") or candidate.get("sortDate")),
                    "payload": {
                        "category": candidate.get("category"),
                        "titleEn": candidate.get("titleEn") or None,
                        "modelKey": candidate.get("modelKey") or None,
                        "meta": candidate.get("meta") or {},
                    },
                    "fetched_at": now,
                }
            )
            if len(rows) >= MAX_RAW_ITEMS:
                return rows
    return rows


def update_patch(item: dict[str, Any], row: Any, now: datetime) -> dict[str, Any]:
    sources = item.get("evidence") or []
    patch: dict[str, Any] = {
        "sources": sources,
        "source_families": _unique(
            [(source.get("family") if isinstance(source, dict) else None) or "official" for source in sources]
        ),
        "confidence": item.get("confidence"),
        "source_count": len(sources),
        "importance": item.get("importance"),
        "tags": item.get("tags") or [],
        "meta": item.get("meta") or {},
        "updated_at": now,
    }
    if row.origin != "seed":
        patch.update(
            {
                "title": item.get("title") or "",
                "title_en": item.get("titleEn") or None,
                "summary": fallback_summary(item),
                "summary_kind": item.get("summaryKind") or "excerpt",
                "organization": item.get("organization") or None,
                "model_name": item.get("modelName") or None,
            }
        )
    return patch


def changed(item: dict[str, Any], row: Any) -> bool:
    sources = item.get("evidence") or []
    row_sources = row.sources if isinstance(row.sources, list) else []
    stated = row.source_count if row.source_count is not None else len(row_sources)
    return (
        stable(sources) != stable(row_sources)
        or item.get("confidence") != row.confidence
        or item.get("importance") != row.importance
        or len(sources) != stated
        or (
            row.origin != "seed"
            and (
                item.get("title") != row.title
                or bool(item.get("summary")) and item.get("summary") != row.summary
            )
        )
    )


def audit_candidate(row: Any) -> dict[str, Any]:
    families = row.source_families if isinstance(row.source_families, list) else []
    evidence = row.sources if isinstance(row.sources, list) else []
    return {
        "fingerprint": row.fingerprint,
        "title": row.title,
        "titleEn": row.title_en,
        "summary": row.summary,
        "eventDate": row.event_date,
        "year": row.year,
        "category": row.category,
        "organization": row.organization,
        "modelName": row.model_name,
        "sourceCount": row.source_count,
        "families": families,
        "evidence": evidence,
        "signals": {},
        "meta": row.meta or {},
    }


def editorial_patch(status: str, review: dict[str, Any] | None, now: datetime) -> dict[str, Any]:
    return {
        "editorial_status": status,
        "editorial_review": review or None,
        "updated_at": now,
    }


def _rule_reason(assessment: dict[str, Any]) -> tuple[str, str]:
    """Reason code + readable text for a deterministic rule rejection."""
    from app.ingest.reasons import label_of

    key = assessment.get("disqualify")
    code = f"rule:{key}" if key else "score_low"
    text = "、".join(assessment.get("reasons") or []) or label_of(code)
    return code, text


def _panel_reason(outcome: dict[str, Any]) -> tuple[str, str]:
    """Reason code + readable text for a panel verdict."""
    from app.ingest.ledger import human_summary

    decision = outcome.get("decision")
    if decision == "include":
        return "admitted", human_summary(outcome)
    if decision == "exclude":
        return "panel:exclude", human_summary(outcome)
    return "panel:hold", human_summary(outcome)


def _review_from_cached(cached: Any) -> dict[str, Any]:
    return {
        "version": cached.rubric_version,
        "source": cached.decision_source or "panel",
        "decision": cached.decision,
        "score": cached.score,
        "includeVotes": cached.include_votes,
        "validVotes": cached.valid_votes,
        "votes": cached.votes or [],
        "at": cached.decided_at.isoformat() if cached.decided_at else None,
    }


def _held_review(score: int, source: str) -> dict[str, Any]:
    from app.domain.text import iso_now

    return {
        "version": RUBRIC_VERSION,
        "source": source,
        "decision": "hold",
        "score": score,
        "includeVotes": 0,
        "validVotes": 0,
        "votes": [],
        "at": iso_now(),
    }


async def enhance_summaries(
    items: list[dict[str, Any]],
    env: Mapping[str, Any],
    post: Post | None,
    *,
    timeout_ms: int = SUMMARY_TIMEOUT_MS,
) -> bool:
    """Optional LLM summarisation; absent configuration leaves templates alone."""
    base = env.get("LLM_API_BASE")
    key = env.get("LLM_API_KEY")
    model = env.get("LLM_MODEL")
    if not base or not key or not model or post is None:
        return False
    batch = [
        item
        for item in items
        if not item.get("existingId") and item.get("origin") != "seed"
    ][:10]
    if not batch:
        return False

    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SUMMARY_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    [
                        {
                            "id": item.get("fingerprint"),
                            "title": item.get("title"),
                            "titleEn": item.get("titleEn"),
                            "date": item.get("eventDate"),
                            "notes": item.get("summary"),
                        }
                        for item in batch
                    ],
                    ensure_ascii=False,
                ),
            },
        ],
    }
    try:
        status, data = await post(
            f"{str(base).rstrip('/')}/chat/completions", key, payload, timeout_ms
        )
    except Exception:  # noqa: BLE001 - summaries are best effort
        return False
    if status >= 400 or not isinstance(data, dict):
        return False
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return False
    if not isinstance(content, str):
        return False
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return False

    by_id = {item.get("fingerprint"): item for item in batch}
    for entry in parsed.get("items") or []:
        if not isinstance(entry, dict):
            continue
        item = by_id.get(entry.get("id"))
        summary = entry.get("summary")
        summary = summary.strip() if isinstance(summary, str) else ""
        if item is not None and 20 <= len(summary) <= 400:
            item["summary"] = summary
            item["summaryKind"] = "generated"
    return True


async def _guard_heartbeat(session: AsyncSession, token: str, run_id: uuid.UUID) -> None:
    if not await repo_sync.heartbeat(session, token, run_id):
        raise SyncError("lease_lost")


async def _insert_in_batches(
    session: AsyncSession, rows: list[dict[str, Any]], size: int = 20
) -> int:
    inserted = 0
    for index in range(0, len(rows), size):
        inserted += await repo_events.insert_events(session, rows[index : index + size])
    return inserted


async def run_sync(
    session: AsyncSession,
    *,
    trigger: str = "manual",
    now: datetime | None = None,
    fetch: Any = None,
    post: Post | None = None,
    env: Mapping[str, Any] | None = None,
    run_id: uuid.UUID | None = None,
    token: str | None = None,
    editorial: bool = True,
    run_budget_ms: int = DEFAULT_RUN_BUDGET_MS,
    fetch_budget_ms: int = DEFAULT_FETCH_BUDGET_MS,
    concurrency: int = MAX_FETCH_CONCURRENCY,
    raw_cap: int | None = None,
) -> dict[str, Any]:
    """One synchronisation run. Never exposes payloads, SQL or credentials."""
    env = env or {}
    now = now or utc_now()
    run_id = run_id or uuid.uuid4()
    token = token or uuid.uuid4().hex
    post = post or httpx_post
    raw_cap = raw_cap or get_settings().collect_raw_cap
    start_ms = int(time.time() * 1000)

    state = await repo_sync.read_state(session)
    if repo_sync.lease_is_held(state, start_ms):
        return {"ok": False, "busy": True, "runId": None, "status": "busy", "result": None}

    lease = await repo_sync.acquire_lease(
        session, state, run_id=run_id, token=token, now=now, trigger=trigger
    )
    if not lease["ok"]:
        return {"ok": False, "busy": True, "runId": None, "status": "busy", "result": None}

    seed_needed = state is None or state.seed_version != SEED_VERSION

    try:
        await repo_sync.start_run(session, run_id=run_id, trigger=trigger, now=now)
    except Exception as error:  # noqa: BLE001
        try:
            await repo_sync.release_lease(session, token, run_id, status="failed")
        except Exception:  # noqa: BLE001 - best effort
            pass
        raise SyncError("run_start_failed") from error

    notes: list[str] = []
    seed_inserted = raw_count = created_count = merged_count = 0
    reviewed_count = admitted_count = excluded_count = held_count = 0
    panel_configured = False
    failed_sources: list[str] = []
    ledger: Ledger | None = None
    status = "succeeded"

    try:
        now_iso_now = utc_now()

        if seed_needed:
            try:
                await _guard_heartbeat(session, token, run_id)
                rows = seed_rows(now_iso_now)
                seed_inserted = await _insert_in_batches(session, rows, 20)
                notes.append(f"seed:{len(rows)}")
            except SyncError:
                raise
            except Exception:  # noqa: BLE001
                notes.append("seed_failed")

        deadline_ms = start_ms + fetch_budget_ms
        # The catalogue is the source of truth, and the seed is only the
        # fallback: an operator edit must survive the next deploy, and every
        # existing test creates the schema without ever seeding a row.
        try:
            if await ensure_catalog(session, now=now_iso_now):
                notes.append("catalog:seeded")
        except Exception:  # noqa: BLE001 - a missing table is not a failed run
            notes.append("catalog_failed")
        try:
            sources = await enabled_sources(session)
            allowed = await allowed_hosts(session)
        except Exception:  # noqa: BLE001
            sources, allowed = SEED_SOURCES, ALLOWED_HOSTS
        if len(sources) != len(SEED_SOURCES):
            notes.append(f"catalog:{len(sources)}")

        if fetch is not None:
            results = await load_sources(
                sources,
                fetch=fetch,
                deadline_ms=deadline_ms,
                concurrency=concurrency,
                allowed_hosts=allowed,
            )
        else:
            from app.ingest.sources import httpx_fetch

            async def _fetch(url: str):
                return await httpx_fetch(url, timeout_ms=SOURCE_TIMEOUT_MS)

            results = await load_sources(
                sources,
                fetch=_fetch,
                deadline_ms=deadline_ms,
                concurrency=concurrency,
                allowed_hosts=allowed,
            )

        normalized = normalize_results(results, now_ms=int(time.time() * 1000))
        failed_sources = [entry["key"] for entry in normalized["failed"]]
        if failed_sources:
            status = "failed" if len(failed_sources) == len(results) else "partial"
            notes.append(f"sources:{len(failed_sources)}/{len(results)}")
            notes.append(_failure_note(normalized["failed"]))

        # Per-source liveness for the console's health matrix. Same defensive
        # posture as the slug backfill below: a bookkeeping failure must never
        # change what gets admitted, so it degrades to a note.
        try:
            await repo_ops.record_source_health(
                session, results, run_id=run_id, now=now_iso_now
            )
        except Exception:  # noqa: BLE001
            notes.append("source_health_failed")

        candidates_all = normalized["candidates"]
        candidates = interleave_candidates(candidates_all, raw_cap)

        # ----- ledger, first flush ------------------------------------------
        # Everything we saw is written *before* any verdict, so a run that dies
        # in the panel stage still leaves its intake visible.
        ledger = Ledger(run_id=run_id, now=now_iso_now)
        ledger.bump("fetched", sum(
            len(entry.get("items") or []) for entry in results if entry.get("ok")
        ))
        for drop in normalized.get("drops") or []:
            ledger.note_drop(drop, stage="normalize")
        kept = {id(candidate) for candidate in candidates}
        for candidate in candidates_all:
            if id(candidate) in kept:
                continue
            ledger.note_candidate(
                candidate, stage="cap", status="dropped", reason_code="cap_raw"
            )
        ledger.bump("capped", max(len(candidates_all) - len(candidates), 0))
        for candidate in candidates:
            ledger.note_candidate(candidate, stage="cluster", status="pending")
        raw_count = len(ledger.pending)

        await _guard_heartbeat(session, token, run_id)
        try:
            await repo_events.upsert_collected(session, ledger.pending_rows())
            notes.append(f"ledger:pending:{raw_count}")
        except Exception:  # noqa: BLE001 - bookkeeping never changes a verdict
            notes.append("ledger_failed")

        existing_rows = await repo_events.load_recent_events(
            session, now.year - RECENT_YEAR_SPAN, 600
        )
        clustered = cluster_candidates(candidates, existing_rows)
        items = clustered["items"]
        updates = clustered["updates"]
        for entry in clustered.get("dropped") or []:
            ledger.set_verdict(
                entry["candidate"],
                status="dropped",
                stage="cluster",
                reason_code=entry.get("reason") or "below_keep",
            )
        ledger.bump("clustered", len(items))
        ledger.bump("clusterDropped", len(clustered.get("dropped") or []))
        ledger.bump("deduped", int(clustered.get("dedup") or 0))
        for item in updates:
            # Merged into an event that already exists: admitted as evidence,
            # with the reason saying so.
            ledger.set_verdict(
                item,
                status="admitted",
                stage="dedup",
                reason_code="duplicate",
                reason_text="并入已有条目",
            )

        existing_by_id = {row.id: row for row in existing_rows}
        fresh_items = [item for item in items if not item.get("existingId")]
        over_cap = fresh_items[MAX_NEW_EVENTS:]
        for item in over_cap:
            ledger.set_verdict(
                item, status="dropped", stage="cap", reason_code="cap_events"
            )
        ledger.bump("overEventCap", len(over_cap))
        fresh_all = fresh_items[:MAX_NEW_EVENTS]
        changed_updates = []
        for item in updates:
            row = existing_by_id.get(item.get("existingId"))
            if row is None or not changed(item, row):
                continue
            changed_updates.append(
                {"id": item["existingId"], "patch": update_patch(item, row, now_iso_now)}
            )

        accepted: list[dict[str, Any]] = []
        if not editorial:
            # Catalogue checks use this switch to measure parsing and matching
            # only. It is never reachable from the HTTP handler.
            accepted.extend(fresh_all)
            for item in accepted:
                item["editorialStatus"] = "admitted"
                ledger.set_verdict(
                    item,
                    status="admitted",
                    stage="panel",
                    reason_code="admitted",
                    reason_text="目录校对模式，未送面板",
                )
        else:
            panel = build_panel_config(dict(env))
            panel_configured = panel["configured"]
            audit_rows = await repo_events.load_audit_events(session, 120)
            all_candidates = list(fresh_all) + [audit_candidate(row) for row in audit_rows]
            cached = await repo_events.load_review_decisions(
                session, [candidate["fingerprint"] for candidate in all_candidates]
            )
            panel_queue: list[dict[str, Any]] = []
            audit_patches: dict[Any, dict[str, Any]] = {}
            decisions: list[dict[str, Any]] = []

            for item in fresh_all:
                cached_row = cached.get(item["fingerprint"])
                if cached_row is not None and cached_row.rubric_version == RUBRIC_VERSION:
                    if cached_row.decision == "include":
                        item["editorialStatus"] = "admitted"
                        item["editorialReview"] = _review_from_cached(cached_row)
                        accepted.append(item)
                        admitted_count += 1
                        ledger.set_verdict(
                            item,
                            status="admitted",
                            stage="panel",
                            reason_code="admitted",
                            reason_text="沿用同版本面板裁决",
                            score=cached_row.score,
                        )
                        continue
                    if cached_row.decision == "exclude":
                        excluded_count += 1
                        ledger.set_verdict(
                            item,
                            status="excluded",
                            stage="panel",
                            reason_code="panel:exclude",
                            reason_text="沿用同版本面板裁决",
                            score=cached_row.score,
                        )
                        continue
                assessment = assess_candidate(item)
                if assessment["disqualify"] or assessment["score"] < RULE_PANEL_THRESHOLD:
                    outcome = rule_decision(item, assessment)
                    decisions.append(
                        decision_record(item, outcome, run_id=run_id, source="rule",
                                        now=now_iso_now)
                    )
                    excluded_count += 1
                    code, text = _rule_reason(assessment)
                    ledger.set_verdict(
                        item,
                        status="excluded",
                        stage="rule",
                        reason_code=code,
                        reason_text=text,
                        score=assessment["score"],
                    )
                    continue
                panel_queue.append({"kind": "new", "candidate": item, "assessment": assessment})

            for row in audit_rows:
                candidate = audit_candidate(row)
                cached_row = cached.get(candidate["fingerprint"])
                if (
                    cached_row is not None
                    and cached_row.rubric_version == RUBRIC_VERSION
                    and cached_row.decision != "hold"
                ):
                    state_status = "admitted" if cached_row.decision == "include" else "excluded"
                    audit_patches[row.id] = {
                        "id": row.id,
                        "patch": editorial_patch(
                            state_status, _review_from_cached(cached_row), now_iso_now
                        ),
                    }
                    if state_status == "excluded":
                        excluded_count += 1
                    else:
                        admitted_count += 1
                    ledger.set_verdict(
                        candidate,
                        status=state_status,
                        stage="panel",
                        reason_code="admitted" if state_status == "admitted" else "panel:exclude",
                        reason_text="沿用同版本面板裁决",
                        score=cached_row.score,
                    )
                    continue
                assessment = assess_candidate(candidate)
                if should_audit_out(assessment):
                    outcome = rule_decision(candidate, assessment)
                    decisions.append(
                        decision_record(candidate, outcome, run_id=run_id, source="rule",
                                        now=now_iso_now)
                    )
                    audit_patches[row.id] = {
                        "id": row.id,
                        "patch": editorial_patch("excluded", review_summary(outcome, "rule"), now_iso_now),
                    }
                    excluded_count += 1
                    code, text = _rule_reason(assessment)
                    ledger.set_verdict(
                        candidate,
                        status="excluded",
                        stage="rule",
                        reason_code=code,
                        reason_text=text,
                        score=assessment["score"],
                    )
                    continue
                if panel["configured"]:
                    panel_queue.append(
                        {"kind": "audit", "candidate": candidate, "row": row, "assessment": assessment}
                    )
                else:
                    # Fail closed. Rows written before the editorial gate had no
                    # panel verdict; keep them out of the public timeline until
                    # the panel can judge them. The next run retries.
                    audit_patches[row.id] = {
                        "id": row.id,
                        "patch": editorial_patch(
                            "hold", _held_review(assessment["score"], "legacy"), now_iso_now
                        ),
                    }
                    held_count += 1
                    ledger.set_verdict(
                        candidate,
                        status="held",
                        stage="panel",
                        reason_code="panel:unconfigured",
                        reason_text="面板未配置，下一轮重试",
                        score=assessment["score"],
                    )

            panel_queue.sort(key=lambda entry: (0 if entry["kind"] == "new" else 1, -entry["assessment"]["score"]))
            batch = panel_queue[:MAX_PANEL_ITEMS]
            deferred = panel_queue[MAX_PANEL_ITEMS:]
            for entry in deferred:
                held_count += 1
                ledger.set_verdict(
                    entry["candidate"],
                    status="held",
                    stage="panel",
                    reason_code="deferred",
                    reason_text=f"超出单批 {MAX_PANEL_ITEMS} 条上限，顺延到下一轮",
                    score=entry["assessment"]["score"],
                )
                if entry["kind"] == "audit":
                    audit_patches[entry["row"].id] = {
                        "id": entry["row"].id,
                        "patch": editorial_patch(
                            "hold", _held_review(entry["assessment"]["score"], "deferred"), now_iso_now
                        ),
                    }
            if deferred:
                notes.append(f"panel:deferred:{len(deferred)}")

            if batch:
                if panel["configured"]:
                    batch_candidates = [entry["candidate"] for entry in batch]
                    results_batch = await judge_batch(
                        panel["judges"],
                        batch_candidates,
                        post=post,
                        timeout_ms=panel["timeoutMs"],
                    )
                    aggregate = aggregate_reviews(results_batch, batch_candidates)
                    ok_count = sum(1 for result in results_batch if result["ok"])
                    notes.append(f"panel:{ok_count}/{len(panel['judges'])}")
                    if aggregate["failures"]:
                        notes.append(
                            "panel_failed:"
                            + ",".join(
                                f"{failure['judge']}={failure['error']}"
                                for failure in aggregate["failures"]
                            )
                        )
                    for entry in batch:
                        outcome = aggregate["byId"].get(entry["candidate"]["fingerprint"])
                        if outcome is None:
                            held_count += 1
                            ledger.set_verdict(
                                entry["candidate"],
                                status="held",
                                stage="panel",
                                reason_code="panel:hold",
                                reason_text="未拿到任何有效票",
                                score=entry["assessment"]["score"],
                            )
                            continue
                        if outcome["validVotes"] >= MIN_INCLUDE_VOTES:
                            decisions.append(
                                decision_record(
                                    entry["candidate"], outcome, run_id=run_id,
                                    source="panel", now=now_iso_now,
                                )
                            )
                        code, text = _panel_reason(outcome)
                        ledger.set_verdict(
                            entry["candidate"],
                            status="admitted"
                            if outcome["decision"] == "include"
                            else "excluded"
                            if outcome["decision"] == "exclude"
                            else "held",
                            stage="panel",
                            reason_code=code,
                            reason_text=text,
                            score=outcome.get("score") or 0,
                        )
                        if outcome["decision"] == "include":
                            admitted_count += 1
                            if entry["kind"] == "new":
                                entry["candidate"]["editorialStatus"] = "admitted"
                                entry["candidate"]["editorialReview"] = review_summary(outcome, "panel")
                                accepted.append(entry["candidate"])
                            else:
                                audit_patches[entry["row"].id] = {
                                    "id": entry["row"].id,
                                    "patch": editorial_patch(
                                        "admitted", review_summary(outcome, "panel"), now_iso_now
                                    ),
                                }
                        elif outcome["decision"] == "exclude":
                            excluded_count += 1
                            if entry["kind"] == "audit":
                                audit_patches[entry["row"].id] = {
                                    "id": entry["row"].id,
                                    "patch": editorial_patch(
                                        "excluded", review_summary(outcome, "panel"), now_iso_now
                                    ),
                                }
                        else:
                            held_count += 1
                            if entry["kind"] == "audit":
                                audit_patches[entry["row"].id] = {
                                    "id": entry["row"].id,
                                    "patch": editorial_patch(
                                        "hold", review_summary(outcome, "panel"), now_iso_now
                                    ),
                                }
                else:
                    notes.append("panel:unconfigured")
                    held_count += len(batch)
                    for entry in batch:
                        ledger.set_verdict(
                            entry["candidate"],
                            status="held",
                            stage="panel",
                            reason_code="panel:unconfigured",
                            reason_text="五席面板未配置，暂不裁决",
                            score=entry["assessment"]["score"],
                        )

            if audit_patches:
                await _guard_heartbeat(session, token, run_id)
                await repo_events.update_events(session, list(audit_patches.values()))
            if decisions:
                try:
                    await repo_events.upsert_review_decisions(session, decisions)
                except SyncError:
                    raise
                except Exception:  # noqa: BLE001
                    notes.append("review_write_failed")
            reviewed_count = admitted_count + excluded_count + held_count
            if admitted_count:
                notes.append(f"review_admitted:{admitted_count}")
            if excluded_count:
                notes.append(f"review_excluded:{excluded_count}")
            if held_count:
                notes.append(f"review_held:{held_count}")

        if (
            accepted
            and _elapsed_ms(start_ms) < run_budget_ms - 9000
            and await enhance_summaries(accepted, env, post)
        ):
            notes.append("summary:llm")

        await _guard_heartbeat(session, token, run_id)
        if accepted:
            created_count = await _insert_in_batches(
                session, [event_row(item, now_iso_now) for item in accepted], 20
            )
        if changed_updates:
            merged_count = await repo_events.update_events(
                session, changed_updates[:MAX_NEW_EVENTS]
            )

        try:
            slugged = await backfill_slugs(session, now_iso_now)
            if slugged:
                notes.append(f"slug:{slugged}")
        except SyncError:
            raise
        except Exception:  # noqa: BLE001
            notes.append("slug_failed")

        if len(fresh_all) >= MAX_NEW_EVENTS:
            notes.append("cap:events")
        if _elapsed_ms(start_ms) > run_budget_ms:
            notes.append("stage:deadline")

        # ----- ledger, second flush ------------------------------------------
        # After the verdicts exist: the same rows are rewritten with their final
        # status, and only the *changes* become trail lines.
        ledger.bump("reviewed", reviewed_count)
        try:
            if ledger.pending:
                # Same rows, final status: one run is one sighting, so the
                # second write must not advance `seen_count` again.
                await repo_events.upsert_collected(
                    session, ledger.pending_rows(), bump_seen=False
                )
            trail = ledger.verdict_rows()
            if trail:
                await repo_events.insert_verdicts(session, trail)
                notes.append(f"ledger:verdicts:{len(trail)}")
        except Exception:  # noqa: BLE001 - bookkeeping never changes a verdict
            notes.append("ledger_failed")

        final_status = status
        if status == "failed" and (seed_inserted > 0 or created_count + merged_count > 0):
            final_status = "partial"

        result = {
            "status": final_status,
            "seedInserted": seed_inserted,
            "rawCount": raw_count,
            "createdCount": created_count,
            "mergedCount": merged_count,
            "reviewedCount": reviewed_count,
            "admittedCount": admitted_count,
            "excludedCount": excluded_count,
            "heldCount": held_count,
            "panelConfigured": panel_configured,
            "failedSources": failed_sources,
            "notes": "; ".join(notes) or None,
            "durationMs": _elapsed_ms(start_ms),
            "detail": _run_detail(
                results,
                notes,
                funnel=ledger.funnel() if ledger else None,
                verdicts=ledger.verdict_counts() if ledger else None,
            ),
        }

        await repo_sync.finish_run(session, run_id, result)
        if seed_needed and final_status in ("succeeded", "partial"):
            await repo_sync.update_seed_version(session, token, run_id, SEED_VERSION)
        await repo_sync.release_lease(
            session,
            token,
            run_id,
            status=final_status,
            seed_version=SEED_VERSION if seed_needed and final_status != "failed" else None,
        )
        return {"ok": True, "busy": False, "runId": str(run_id), "status": final_status, "result": result}
    except BaseException as error:  # noqa: BLE001 - the run row must always be closed
        code = getattr(error, "code", None) or "sync_failed"
        failed_result = {
            "status": "failed",
            "rawCount": raw_count,
            "createdCount": created_count,
            "mergedCount": merged_count,
            "reviewedCount": reviewed_count,
            "admittedCount": admitted_count,
            "excludedCount": excluded_count,
            "heldCount": held_count,
            "panelConfigured": panel_configured,
            "failedSources": failed_sources,
            "notes": "; ".join([*notes, f"stage:{code}"]),
            "durationMs": _elapsed_ms(start_ms),
            "detail": _run_detail(
                results,
                [*notes, f"stage:{code}"],
                funnel=ledger.funnel() if ledger else None,
                verdicts=ledger.verdict_counts() if ledger else None,
            ),
        }
        try:
            await repo_sync.finish_run(session, run_id, failed_result)
        except Exception:  # noqa: BLE001 - best effort
            pass
        try:
            await repo_sync.release_lease(session, token, run_id, status="failed")
        except Exception:  # noqa: BLE001 - best effort
            pass
        raise SyncError(code) from error


def _elapsed_ms(start_ms: int) -> int:
    return int(time.time() * 1000) - start_ms


def _failure_note(failed: list[dict[str, Any]]) -> str:
    """`failed:arxiv=timeout(12002ms),infoq=network(613ms)`.

    The elapsed time is the point of the line: a source that burned its whole
    budget and one that refused in 600 ms are different incidents, and the run
    row is the only place that distinction survives. `to_large`-style labels used
    to flatten both into `timeout`.
    """
    parts = []
    for entry in failed:
        code = entry.get("error") or "unknown"
        ms = entry.get("ms")
        suffix = f"({int(ms)}ms)" if isinstance(ms, (int, float)) else ""
        parts.append(f"{entry.get('key')}={code}{suffix}")
    return "failed:" + ",".join(parts)


def _run_detail(
    results: list[dict[str, Any]],
    notes: list[str],
    *,
    funnel: dict[str, Any] | None = None,
    verdicts: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Structured run detail, so the console never parses the `notes` string.

    `notes` predates the console and is the `;`-joined log line budget; it stays
    for the existing tests and for grep-ability. This is the same information in
    the shape a detail page needs: one entry per source with its own timing, plus
    the collection funnel (`fetched → parsed → … → admitted`) and the reason-code
    histogram the library page links back to.
    """
    sources = []
    for entry in results or []:
        items = entry.get("items")
        sources.append(
            {
                "key": str(entry.get("key") or ""),
                "name": str(entry.get("name") or entry.get("key") or ""),
                "family": str(entry.get("family") or ""),
                "ok": bool(entry.get("ok")),
                "ms": int(entry.get("ms") or 0),
                "items": len(items) if isinstance(items, list) else 0,
                "error": str(entry.get("error") or "") or None,
            }
        )
    return {"sources": sources, "notes": list(notes), "funnel": funnel or {}, "verdicts": verdicts or {}}


async def run_sync_detached(session_factory: Any, **kwargs: Any) -> dict[str, Any]:
    """Entry point for `asyncio.create_task`: owns its own session."""
    async with session_factory() as session:
        return await run_sync(session, **kwargs)


__all__ = [
    "MAX_NEW_EVENTS",
    "MAX_PANEL_ITEMS",
    "MAX_RAW_ITEMS",
    "SyncError",
    "cluster_candidates",
    "event_row",
    "interleave_candidates",
    "normalize_results",
    "raw_rows",
    "run_sync",
    "run_sync_detached",
    "seed_rows",
]
