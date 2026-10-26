"""Operational metrics: the single place every console number comes from.

Everything is a query over the raw tables; nothing is materialised. The dataset
is small (a few thousand rows a day at most), so a `day` index plus a `GROUP BY`
is fast enough and -- unlike a rollup table -- cannot drift away from the rows it
summarises.

Two vocabularies are kept strictly apart and never added together:

* ``page_views``  -- a browser ran the SPA and sent a beacon.
* ``crawl_hits``  -- the reverse proxy served a document to anyone, which is the
  only signal that covers the static reference pages (no JavaScript by design)
  and the AI crawlers.

``PV`` is a row count of human page views. ``UV`` is the number of distinct
``visitor_hash`` values in that day -- and because the hash is salted with the
day, it cannot be stitched together across days.
"""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import local_day
from app.db.models import (
    ApiKey,
    ApiKeyUsage,
    CrawlHit,
    Event,
    PageView,
    Partner,
    PartnerClick,
    ReviewDecision,
    SourceHealth,
    Subscriber,
    SyncRun,
    SyncState,
    utc_now,
)
from app.db.repo_events import observable
from app.ingest.sources import SOURCES
from app.schemas.admin import (
    admin_run_record,
    api_key_record,
    event_admin_record,
    partner_record,
)

# A run is "stale" once the last success is older than this. Collection is daily
# (01:05), so 26 hours means a whole missed day — not a single late run. Keep it
# in step with STALE_AFTER_HOURS in app/api/public.py: both answer "is the
# scheduler broken", and two different answers would be worse than none.
STALE_HOURS = 26
HOLDS_BACKLOG_LIMIT = 20
SOURCE_FAILURE_LIMIT = 3


async def _count(session: AsyncSession, statement: Any) -> int:
    return int(await session.scalar(statement) or 0)


async def _group(
    session: AsyncSession, column: Any, *, where: Any = None, limit: int | None = None
) -> list[dict[str, Any]]:
    statement = (
        select(column, func.count())
        .group_by(column)
        .order_by(func.count().desc())
    )
    if where is not None:
        statement = statement.where(where)
    if limit:
        statement = statement.limit(limit)
    rows = await session.execute(statement)
    return [{"key": (row[0] if row[0] is not None else ""), "count": int(row[1])} for row in rows]


def since_day(days: int, *, now: datetime | None = None) -> str:
    """Inclusive `YYYY-MM-DD` lower bound on the UTC+8 calendar."""
    moment = now or utc_now()
    return local_day(moment - timedelta(days=max(days, 1) - 1))


def _as_utc(stamp: datetime | None) -> datetime | None:
    if stamp is None:
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------


async def content_snapshot(session: AsyncSession, *, days: int = 30) -> dict[str, Any]:
    total = await _count(session, select(func.count()).select_from(Event))
    admitted = await _count(
        session, select(func.count()).select_from(Event).where(Event.editorial_status == "admitted")
    )
    hold = await _count(
        session, select(func.count()).select_from(Event).where(Event.editorial_status == "hold")
    )
    excluded = await _count(
        session, select(func.count()).select_from(Event).where(Event.editorial_status == "excluded")
    )
    # Rows predating the editorial gate have a null status and stay public.
    legacy = await _count(
        session,
        select(func.count()).select_from(Event).where(Event.editorial_status.is_(None)),
    )
    cutoff = utc_now() - timedelta(days=days)
    recent = await _count(
        session,
        observable(select(func.count()).select_from(Event)).where(Event.first_seen_at >= cutoff),
    )

    return {
        "total": total,
        # `live` is exactly what the public timeline can return.
        "live": await _count(session, observable(select(func.count()).select_from(Event))),
        "admitted": admitted,
        "hold": hold,
        "excluded": excluded,
        "legacy": legacy,
        "recent": recent,
        "recentDays": days,
        "byOrigin": await _group(session, Event.origin),
        "byConfidence": await _group(session, Event.confidence),
        "byCategory": await _group(session, Event.category),
    }


async def data_health(session: AsyncSession) -> dict[str, int]:
    """Rows that are technically stored but cannot be shown or cited.

    `source_count = 0` stands in for "the sources array is empty": the counter is
    derived from that array on write, and it is the only form that is portable
    between JSONB and SQLite's JSON text.
    """
    return {
        "unslugged": await _count(
            session, select(func.count()).select_from(Event).where(Event.slug.is_(None))
        ),
        "sourceless": await _count(
            session,
            select(func.count()).select_from(Event).where(Event.source_count <= 0),
        ),
        "ungated": await _count(
            session,
            select(func.count()).select_from(Event).where(Event.editorial_status.is_(None)),
        ),
        "uncategorized": await _count(
            session,
            select(func.count()).select_from(Event).where(
                or_(Event.category.is_(None), Event.category == "")
            ),
        ),
    }


SORTS: dict[str, tuple[Any, ...]] = {
    "recent": (Event.sort_date.desc(), Event.importance.desc()),
    "importance": (Event.importance.desc(), Event.sort_date.desc()),
    "newest": (Event.first_seen_at.desc(),),
    "updated": (Event.updated_at.desc(),),
}

STATUS_FILTERS = ("live", "admitted", "hold", "excluded", "legacy", "all")

# The four defects `data_health` counts, as filters. Same predicates, so an
# alert that says "3 rows cannot be cited" opens a list of exactly those three.
MISSING_FILTERS: dict[str, Any] = {
    "unslugged": lambda: Event.slug.is_(None),
    "sourceless": lambda: Event.source_count <= 0,
    "ungated": lambda: Event.editorial_status.is_(None),
    "uncategorized": lambda: or_(Event.category.is_(None), Event.category == ""),
}


async def search_events(
    session: AsyncSession,
    *,
    q: str | None = None,
    category: str | None = None,
    confidence: str | None = None,
    status: str | None = None,
    origin: str | None = None,
    year: int | None = None,
    missing: str | None = None,
    sort: str = "recent",
    page: int = 1,
    size: int = 25,
) -> tuple[list[Event], int]:
    """Admin-side retrieval: unlike the public timeline this sees every status."""
    statement = select(Event)
    if status == "live":
        statement = observable(statement)
    elif status == "legacy":
        statement = statement.where(Event.editorial_status.is_(None))
    elif status in ("admitted", "hold", "excluded"):
        statement = statement.where(Event.editorial_status == status)
    if missing and missing in MISSING_FILTERS:
        statement = statement.where(MISSING_FILTERS[missing]())
    if category:
        statement = statement.where(Event.category == category)
    if confidence:
        statement = statement.where(Event.confidence == confidence)
    if origin:
        statement = statement.where(Event.origin == origin)
    if year is not None:
        statement = statement.where(Event.year == year)
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            Event.title.ilike(pattern)
            | Event.summary.ilike(pattern)
            | Event.slug.ilike(pattern)
        )

    total = await _count(session, select(func.count()).select_from(statement.subquery()))
    order = SORTS.get(sort, SORTS["recent"])
    rows = await session.execute(
        statement.order_by(*order)
        .offset(max(page - 1, 0) * size)
        .limit(size)
    )
    return list(rows.scalars().all()), total


async def admission_series(session: AsyncSession, *, days: int = 14) -> list[dict[str, Any]]:
    """Daily counts by verdict, bucketed in Python.

    Bucketing in SQL would need `strftime` on SQLite and `to_char` on Postgres for
    the same answer. One pass over a handful of rows is cheaper than that
    dialect split, and it reuses the single `local_day` definition.
    """
    cutoff = utc_now() - timedelta(days=max(days, 1))
    rows = await session.execute(
        select(Event.first_seen_at, Event.editorial_status).where(Event.first_seen_at >= cutoff)
    )
    buckets: dict[str, dict[str, int]] = {}
    for stamp, status in rows.all():
        if stamp is None:
            continue
        day = local_day(_as_utc(stamp))
        bucket = buckets.setdefault(day, {"day": day, "admitted": 0, "hold": 0, "excluded": 0, "legacy": 0})
        key = status if status in ("admitted", "hold", "excluded") else "legacy"
        bucket[key] += 1

    ordered: list[dict[str, Any]] = []
    today = utc_now()
    for offset in range(days - 1, -1, -1):
        day = local_day(today - timedelta(days=offset))
        ordered.append(
            buckets.get(day, {"day": day, "admitted": 0, "hold": 0, "excluded": 0, "legacy": 0})
        )
    return ordered


# ---------------------------------------------------------------------------
# Collection runs
# ---------------------------------------------------------------------------


async def run_feed(session: AsyncSession, *, limit: int = 30) -> list[SyncRun]:
    rows = await session.execute(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(limit))
    return list(rows.scalars().all())


async def run_detail(session: AsyncSession, run_id: uuid.UUID) -> SyncRun | None:
    return await session.get(SyncRun, run_id)


async def registered_sources() -> list[dict[str, str]]:
    return [
        {"key": source["key"], "name": source["name"], "family": source["family"]}
        for source in SOURCES
    ]


async def source_health(session: AsyncSession) -> list[dict[str, Any]]:
    """The registry left-joined with its live state, so a never-run source shows up."""
    rows = await session.execute(select(SourceHealth))
    observed = {row.key: row for row in rows.scalars().all()}
    merged: list[dict[str, Any]] = []
    for source in await registered_sources():
        row = observed.pop(source["key"], None)
        merged.append(
            {
                "key": source["key"],
                "name": source["name"],
                "family": source["family"],
                "lastOkAt": _as_utc(row.last_ok_at).isoformat() if row and row.last_ok_at else None,
                "lastError": (row.last_error if row else "") or "",
                "consecutiveFailures": int(row.consecutive_failures if row else 0),
                "lastMs": int(row.last_ms if row else 0),
                "lastItemCount": int(row.last_item_count if row else 0),
                "totalRuns": int(row.total_runs if row else 0),
                "totalFailures": int(row.total_failures if row else 0),
            }
        )
    # A row whose source left the registry is still worth showing: it may be the
    # only record of why a family stopped producing items.
    for key, row in sorted(observed.items()):
        merged.append(
            {
                "key": key,
                "name": row.name or key,
                "family": row.family or "",
                "lastOkAt": _as_utc(row.last_ok_at).isoformat() if row.last_ok_at else None,
                "lastError": row.last_error or "",
                "consecutiveFailures": int(row.consecutive_failures or 0),
                "lastMs": int(row.last_ms or 0),
                "lastItemCount": int(row.last_item_count or 0),
                "totalRuns": int(row.total_runs or 0),
                "totalFailures": int(row.total_failures or 0),
            }
        )
    return merged


def _item_count(value: Any) -> int:
    """A source result reports its items as a list or as a pre-counted int."""
    if isinstance(value, (list, tuple, set)):
        return len(value)
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


async def record_source_health(
    session: AsyncSession,
    results: Sequence[dict[str, Any]],
    *,
    run_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> int:
    """Refresh per-source liveness. Read-then-write, 17 rows, twice an hour.

    Deliberately not an upsert with `column + 1` expressions: `on_conflict_do_update`
    cannot increment a counter portably across both dialects without a `case`, and
    the row count here makes clarity free.

    `items` arrives in both shapes — `load_source` returns the parsed list, and a
    caller that only counted rows passes an int. Both mean "how many items did
    this source yield", so both are accepted.
    """
    moment = now or utc_now()
    touched = 0
    for entry in results or []:
        key = str(entry.get("key") or "")[:32]
        if not key:
            continue
        row = await session.get(SourceHealth, key)
        ok = bool(entry.get("ok"))
        if row is None:
            row = SourceHealth(
                key=key,
                name=str(entry.get("name") or key)[:200],
                family=str(entry.get("family") or "")[:20],
                total_runs=0,
                total_failures=0,
                consecutive_failures=0,
            )
            session.add(row)
        if entry.get("name"):
            row.name = str(entry["name"])[:200]
        if entry.get("family"):
            row.family = str(entry["family"])[:20]
        row.last_run_id = run_id
        row.last_ms = int(entry.get("ms") or 0)
        row.last_item_count = _item_count(entry.get("items"))
        row.total_runs = int(row.total_runs or 0) + 1
        row.updated_at = moment
        if ok:
            row.last_ok_at = moment
            row.last_error = ""
            row.consecutive_failures = 0
        else:
            row.last_error = str(entry.get("error") or "failed")[:64]
            row.consecutive_failures = int(row.consecutive_failures or 0) + 1
            row.total_failures = int(row.total_failures or 0) + 1
        touched += 1
    if touched:
        await session.commit()
    return touched


async def read_sync_state(session: AsyncSession) -> SyncState | None:
    return await session.scalar(select(SyncState))


# ---------------------------------------------------------------------------
# Editorial panel
# ---------------------------------------------------------------------------


async def judge_stats(session: AsyncSession, *, days: int = 30) -> list[dict[str, Any]]:
    """Include rate per judge slot, aggregated from `review_decisions.votes`.

    The votes live in a JSON list, so the aggregation happens in Python. That is
    a deliberate trade: 30 days of ballots is a few thousand rows, and
    `jsonb_array_elements` has no SQLite counterpart.
    """
    cutoff = utc_now() - timedelta(days=max(days, 1))
    rows = await session.execute(
        select(ReviewDecision.votes).where(ReviewDecision.decided_at >= cutoff)
    )
    buckets: dict[str, dict[str, Any]] = {}
    for votes in rows.scalars().all():
        if not isinstance(votes, list):
            continue
        for vote in votes:
            if not isinstance(vote, dict):
                continue
            key = str(vote.get("judge", "?"))
            bucket = buckets.setdefault(
                key,
                {
                    "judge": key,
                    "models": set(),
                    "ballots": 0,
                    "include": 0,
                    "exclude": 0,
                    "scoreSum": 0,
                    "scoreN": 0,
                    "flags": Counter(),
                },
            )
            if vote.get("model"):
                bucket["models"].add(str(vote["model"]))
            bucket["ballots"] += 1
            if str(vote.get("vote", "")).lower() == "include":
                bucket["include"] += 1
            else:
                bucket["exclude"] += 1
            try:
                bucket["scoreSum"] += int(vote.get("score") or 0)
                bucket["scoreN"] += 1
            except (TypeError, ValueError):
                pass
            for flag in vote.get("flags") or []:
                bucket["flags"][str(flag)] += 1

    result: list[dict[str, Any]] = []
    for key in sorted(buckets):
        bucket = buckets[key]
        ballots = bucket["ballots"] or 1
        result.append(
            {
                "judge": key,
                "models": sorted(bucket["models"]),
                "ballots": bucket["ballots"],
                "include": bucket["include"],
                "exclude": bucket["exclude"],
                "includeRate": round(bucket["include"] / ballots, 4),
                "meanScore": round(bucket["scoreSum"] / (bucket["scoreN"] or 1), 1),
                "topFlags": [flag for flag, _ in bucket["flags"].most_common(3)],
            }
        )
    return result


# ---------------------------------------------------------------------------
# First-party traffic
# ---------------------------------------------------------------------------


async def traffic_series(session: AsyncSession, *, days: int = 30) -> list[dict[str, Any]]:
    from_day = since_day(days)
    rows = await session.execute(
        select(
            PageView.day,
            func.count(),
            func.count(func.distinct(PageView.visitor_hash)),
        )
        .where(PageView.day >= from_day, PageView.is_bot.is_(False))
        .group_by(PageView.day)
        .order_by(PageView.day)
    )
    observed: dict[str, dict[str, Any]] = {}
    for day, views, visitors in rows.all():
        observed[day] = {"day": day, "pv": int(views), "uv": int(visitors)}
    return _fill_days(observed, days, "pv")


def _fill_days(
    observed: dict[str, dict[str, Any]], days: int, counter: str = "count"
) -> list[dict[str, Any]]:
    """A line chart must not skip a zero day, or the slope lies."""
    ordered: list[dict[str, Any]] = []
    today = utc_now()
    for offset in range(days - 1, -1, -1):
        day = local_day(today - timedelta(days=offset))
        ordered.append(observed.get(day, {"day": day, counter: 0, "uv": 0}))
    return ordered


async def traffic_breakdown(session: AsyncSession, *, days: int = 30) -> dict[str, Any]:
    from_day = since_day(days)
    where = (PageView.day >= from_day, PageView.is_bot.is_(False))
    return {
        "channel": await _group(session, PageView.channel, where=where[0] & where[1]),
        "pageKind": await _group(session, PageView.page_kind, where=where[0] & where[1]),
        "device": await _group(session, PageView.device, where=where[0] & where[1]),
        "uaFamily": await _group(session, PageView.ua_family, where=where[0] & where[1]),
    }


async def top_paths(
    session: AsyncSession, *, days: int = 30, limit: int = 20
) -> list[dict[str, Any]]:
    from_day = since_day(days)
    rows = await session.execute(
        select(
            PageView.path,
            func.count(),
            func.count(func.distinct(PageView.visitor_hash)),
        )
        .where(PageView.day >= from_day, PageView.is_bot.is_(False))
        .group_by(PageView.path)
        .order_by(func.count().desc())
        .limit(limit)
    )
    return [
        {"path": path, "views": int(views), "visitors": int(visitors)}
        for path, views, visitors in rows.all()
    ]


async def crawl_summary(session: AsyncSession, *, days: int = 30) -> dict[str, Any]:
    from_day = since_day(days)
    total = await _count(
        session, select(func.count()).select_from(CrawlHit).where(CrawlHit.day >= from_day)
    )
    ai_total = await _count(
        session,
        select(func.count())
        .select_from(CrawlHit)
        .where(CrawlHit.day >= from_day, CrawlHit.is_ai.is_(True)),
    )
    bots = await _group(
        session,
        CrawlHit.bot_name,
        where=(CrawlHit.day >= from_day) & (CrawlHit.bot_name != ""),
        limit=20,
    )
    paths = await session.execute(
        select(CrawlHit.path, func.count())
        .where(CrawlHit.day >= from_day, CrawlHit.is_ai.is_(True))
        .group_by(CrawlHit.path)
        .order_by(func.count().desc())
        .limit(20)
    )
    by_day = await session.execute(
        select(CrawlHit.day, func.count())
        .where(CrawlHit.day >= from_day, CrawlHit.is_ai.is_(True))
        .group_by(CrawlHit.day)
        .order_by(CrawlHit.day)
    )
    series = {day: {"day": day, "count": int(count), "uv": 0} for day, count in by_day.all()}
    return {
        "hits": total,
        "aiHits": ai_total,
        "byBot": bots,
        "topPaths": [{"path": path, "hits": int(hits)} for path, hits in paths.all()],
        "series": _fill_days(series, days),
    }


# ---------------------------------------------------------------------------
# Growth and commercial
# ---------------------------------------------------------------------------


async def subscriber_stats(session: AsyncSession, *, days: int = 14) -> dict[str, Any]:
    by_status = await _group(session, Subscriber.status)
    cutoff = utc_now() - timedelta(days=days)
    recent = [
        row
        for row in (
            await session.execute(
                select(Subscriber.created_at, Subscriber.status).where(
                    Subscriber.created_at >= cutoff
                )
            )
        ).all()
    ]
    buckets: dict[str, dict[str, Any]] = {}
    for stamp, status in recent:
        if stamp is None:
            continue
        day = local_day(_as_utc(stamp))
        bucket = buckets.setdefault(day, {"day": day, "pv": 0, "uv": 0})
        bucket["pv"] += 1
    return {
        "byStatus": by_status,
        "total": sum(item["count"] for item in by_status),
        "series": _fill_days(buckets, days, "pv"),
    }


async def key_usage(session: AsyncSession) -> dict[str, Any]:
    """Per-key month-to-date consumption against each key's own quota."""
    start = local_day(utc_now())[:7] + "-01"
    rows = await session.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))
    keys = list(rows.scalars().all())
    usage_rows = await session.execute(
        select(ApiKeyUsage.key_id, func.sum(ApiKeyUsage.requests), func.sum(ApiKeyUsage.errors))
        .where(ApiKeyUsage.day >= start)
        .group_by(ApiKeyUsage.key_id)
    )
    totals = {
        key_id: (int(requests or 0), int(errors or 0))
        for key_id, requests, errors in usage_rows.all()
    }
    items = []
    over_quota = 0
    for key in keys:
        requests, errors = totals.get(key.id, (0, 0))
        if requests >= int(key.monthly_quota or 0) and key.active:
            over_quota += 1
        items.append(api_key_record(key, requests=requests, errors=errors))
    return {"items": items, "overQuota": over_quota, "monthStart": start}


async def key_usage_series(session: AsyncSession, *, days: int = 30) -> list[dict[str, Any]]:
    """Requests and errors per day, all keys summed.

    One line for the whole programme rather than one per key: the ApiKeys page
    answers "is anyone using this", and a key created last week has no history
    to compare against.
    """
    from_day = since_day(days)
    rows = await session.execute(
        select(
            ApiKeyUsage.day,
            func.sum(ApiKeyUsage.requests),
            func.sum(ApiKeyUsage.errors),
        )
        .where(ApiKeyUsage.day >= from_day)
        .group_by(ApiKeyUsage.day)
    )
    observed = {
        day: {"day": day, "count": int(requests or 0), "errors": int(errors or 0)}
        for day, requests, errors in rows.all()
    }
    series = _fill_days(observed, days)
    for point in series:
        point.setdefault("errors", 0)
    return series


async def partner_stats(session: AsyncSession, *, days: int = 30) -> dict[str, Any]:
    from_day = since_day(days)
    rows = await session.execute(select(Partner).order_by(Partner.created_at.desc()))
    partners = list(rows.scalars().all())
    clicks = await session.execute(
        select(PartnerClick.partner_id, func.count())
        .where(PartnerClick.day >= from_day, PartnerClick.is_bot.is_(False))
        .group_by(PartnerClick.partner_id)
    )
    totals = {partner_id: int(count) for partner_id, count in clicks.all()}
    return {
        "items": [partner_record(row, clicks=totals.get(row.id, 0)) for row in partners],
        "days": days,
    }


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


def _alert(code: str, level: str, message: str, href: str) -> dict[str, str]:
    return {"code": code, "level": level, "message": message, "href": href}


async def _alerts(
    session: AsyncSession,
    *,
    content: dict[str, Any],
    health: dict[str, int],
    sources: list[dict[str, Any]],
    state: SyncState | None,
    runs: list[SyncRun],
    subscribers: dict[str, Any],
    keys: dict[str, Any],
    panel_configured: bool,
    analytics_log_configured: bool,
    now: datetime,
) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []

    running = any(run.status == "running" for run in runs[:1])
    if running:
        alerts.append(
            _alert("sync_running", "info", "采集正在运行", "#/runs")
        )

    last_success = _as_utc(state.last_success_at) if state else None
    if state is None or last_success is None:
        alerts.append(
            _alert("never_succeeded", "warn", "还没有一次成功的采集", "#/runs")
        )
    elif (now - last_success) > timedelta(hours=STALE_HOURS):
        hours = int((now - last_success).total_seconds() // 3600)
        alerts.append(
            _alert("stale", "warn", f"上次成功采集已是 {hours} 小时前", "#/runs")
        )

    failing = [item for item in sources if int(item["consecutiveFailures"]) >= SOURCE_FAILURE_LIMIT]
    if failing:
        names = "、".join(item["key"] for item in failing[:3])
        alerts.append(
            _alert(
                "sources_failing",
                "warn",
                f"{len(failing)} 个来源连续失败 ≥{SOURCE_FAILURE_LIMIT} 次：{names}",
                "#/sources",
            )
        )

    if int(content.get("hold") or 0) > HOLDS_BACKLOG_LIMIT:
        alerts.append(
            _alert(
                "holds_backlog",
                "warn",
                f"暂缓队列积压 {content['hold']} 条",
                "#/editorial",
            )
        )

    if not panel_configured:
        alerts.append(
            _alert("panel_unconfigured", "danger", "评审面板未配置，候选全部暂缓", "#/settings")
        )

    if health.get("unslugged"):
        alerts.append(
            _alert(
                "unslugged",
                "info",
                f"{health['unslugged']} 条缺少 slug，无法生成引用页",
                "#/content?filter=unslugged",
            )
        )

    pending = next(
        (item["count"] for item in subscribers["byStatus"] if item["key"] == "pending"), 0
    )
    if pending:
        alerts.append(
            _alert("subscribers_pending", "info", f"{pending} 个订阅待确认", "#/subscribers")
        )

    if keys["overQuota"]:
        alerts.append(
            _alert(
                "keys_over_quota",
                "warn",
                f"{keys['overQuota']} 个开放 API 密钥本月用量已满",
                "#/keys",
            )
        )

    if not analytics_log_configured:
        alerts.append(
            _alert(
                "crawl_unconfigured",
                "info",
                "未接入访问日志，AI 抓取与引用页浏览不可见",
                "#/settings",
            )
        )

    return alerts


async def overview(
    session: AsyncSession,
    *,
    days: int = 7,
    panel_configured: bool = True,
    analytics_log_configured: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    moment = now or utc_now()
    content = await content_snapshot(session, days=days)
    health = await data_health(session)
    runs = await run_feed(session, limit=3)
    sources = await source_health(session)
    state = await read_sync_state(session)
    traffic = await traffic_series(session, days=14)
    subscribers = await subscriber_stats(session)
    keys = await key_usage(session)

    today = traffic[-1] if traffic else {"pv": 0, "uv": 0, "day": local_day(moment)}
    previous = traffic[-2] if len(traffic) > 1 else {"pv": 0, "uv": 0}

    return {
        "generatedAt": moment.isoformat(),
        "days": days,
        "content": content,
        "health": health,
        "runs": [admin_run_record(row) for row in runs],
        "sources": sources,
        "admissions": await admission_series(session, days=14),
        "traffic": {
            "today": {
                "day": today.get("day"),
                "pv": int(today.get("pv") or 0),
                "uv": int(today.get("uv") or 0),
                "pvPrev": int(previous.get("pv") or 0),
                "uvPrev": int(previous.get("uv") or 0),
            },
            "series": traffic,
        },
        "subscribers": subscribers,
        "keys": {"overQuota": keys["overQuota"], "total": len(keys["items"])},
        "alerts": await _alerts(
            session,
            content=content,
            health=health,
            sources=sources,
            state=state,
            runs=runs,
            subscribers=subscribers,
            keys=keys,
            panel_configured=panel_configured,
            analytics_log_configured=analytics_log_configured,
            now=moment,
        ),
    }


__all__ = [
    "HOLDS_BACKLOG_LIMIT",
    "SORTS",
    "SOURCE_FAILURE_LIMIT",
    "STALE_HOURS",
    "STATUS_FILTERS",
    "admission_series",
    "content_snapshot",
    "crawl_summary",
    "data_health",
    "judge_stats",
    "key_usage",
    "key_usage_series",
    "overview",
    "partner_stats",
    "read_sync_state",
    "record_source_health",
    "registered_sources",
    "run_detail",
    "run_feed",
    "search_events",
    "since_day",
    "source_health",
    "subscriber_stats",
    "top_paths",
    "traffic_breakdown",
    "traffic_series",
]
