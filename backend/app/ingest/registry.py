"""The registry: read the catalogue out of the database, with a safe fallback.

Two invariants keep this cheap to adopt:

* **The table wins.** Once a row exists, code never overwrites it — that is what
  makes an operator edit survive the next deploy.
* **An empty table falls back to the frozen seed.** Every existing test creates
  its schema with `create_all` and never seeds, so `enabled_sources` has to
  answer "the seventeen sources" without anyone writing fixtures first.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import IngestSource
from app.ingest.catalog import CATALOG_SEED, SEED_SOURCES, hosts_of
from app.ingest.sources import ALLOWED_HOSTS


def _dialect_name(session: AsyncSession) -> str:
    bind = session.get_bind()
    return bind.dialect.name if bind is not None else "postgresql"


def source_dict(row: IngestSource) -> dict[str, Any]:
    """Row -> the dict shape `load_sources` / `normalize_results` expect.

    The key names are the ones `sources.py` already uses (`timeout`, `aiOnly`,
    `pathPattern`), so callers cannot tell a seeded constant from a database
    row — which is exactly the property that lets the pipeline switch over in
    one line.
    """
    return {
        "key": row.key,
        "family": row.family,
        "name": row.name,
        "kind": row.kind,
        "url": row.url,
        "pathPattern": row.path_pattern,
        "timeout": row.timeout_ms,
        "domestic": bool(row.domestic),
        "aiOnly": bool(row.ai_only),
        "enabled": bool(row.enabled),
        "weight": row.weight,
        "rationale": row.rationale,
        "verifiedAt": row.verified_at,
        "createdBy": row.created_by,
    }


def _seed_row(source: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Seed sources are already live in production, so they arrive verified."""
    return {
        "key": source["key"],
        "name": source.get("name") or source["key"],
        "family": source.get("family") or "official",
        "kind": source.get("kind") or "feed",
        "url": source.get("url") or "",
        "path_pattern": source.get("pathPattern") or "/news/",
        "domestic": bool(source.get("domestic")),
        "ai_only": bool(source.get("aiOnly")),
        "enabled": bool(source.get("enabled", True)),
        "weight": int(source.get("weight", 100)),
        "timeout_ms": int(source.get("timeout") or 12_000),
        "rationale": source.get("rationale", ""),
        "verified_at": now if source.get("verified", True) else None,
        "created_by": "seed",
        "created_at": now,
        "updated_at": now,
    }


async def ensure_catalog(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Seed the catalogue. Insert-or-ignore, so it is safe on every run.

    Returns how many rows were added — `catalog-seed` prints it, the pipeline
    only logs it. Exceptions are the caller's to swallow: a missing table must
    degrade to the frozen seed, never fail a collection run.
    """
    stamp = now or datetime.now(timezone.utc)
    rows = [_seed_row(source, stamp) for source in CATALOG_SEED]

    existing = await session.execute(select(IngestSource.key))
    known = set(existing.scalars().all())
    fresh = [row for row in rows if row["key"] not in known]
    if not fresh:
        return 0

    if _dialect_name(session) == "sqlite":
        statement = sqlite_insert(IngestSource).values(fresh).on_conflict_do_nothing()
    else:
        statement = pg_insert(IngestSource).values(fresh).on_conflict_do_nothing()
    await session.execute(statement)
    await session.commit()
    return len(fresh)


async def all_sources(session: AsyncSession) -> list[dict[str, Any]]:
    """Every row, enabled or not. Falls back to the seed when the table is empty."""
    result = await session.execute(
        select(IngestSource).order_by(IngestSource.weight, IngestSource.key)
    )
    rows = list(result.scalars().all())
    if rows:
        return [source_dict(row) for row in rows]
    return [dict(source, enabled=True) for source in SEED_SOURCES]


async def enabled_sources(session: AsyncSession) -> list[dict[str, Any]]:
    """Exactly what the pipeline should fetch this run."""
    result = await session.execute(
        select(IngestSource)
        .where(IngestSource.enabled.is_(True))
        .order_by(IngestSource.weight, IngestSource.key)
    )
    rows = list(result.scalars().all())
    if rows:
        return [source_dict(row) for row in rows]
    return [dict(source, enabled=True) for source in SEED_SOURCES]


async def allowed_hosts(session: AsyncSession) -> frozenset[str]:
    """Redirect allow-list: the historical base plus every *enabled* source.

    Deriving hosts from configuration rather than from item URLs is the point.
    A feed that redirects elsewhere can only reach a host someone registered.
    """
    sources = await enabled_sources(session)
    return frozenset(ALLOWED_HOSTS | hosts_of(sources))


async def get_source(session: AsyncSession, key: str) -> IngestSource | None:
    result = await session.execute(select(IngestSource).where(IngestSource.key == key))
    return result.scalar_one_or_none()
