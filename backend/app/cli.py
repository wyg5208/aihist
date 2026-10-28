"""Command line entry points.

`seed`, `sync`, `backfill-slugs`, `hash-password` run the archive; the three added
for the console are `ingest-access-log`, `prune` and `create-owner`. The catalogue
added its own trio: `catalog-seed` (first install), `probe` (is this feed alive?)
and `library-prune` (drop old *dropped* rows, never the evidence). `weekly-digest`
is the mailing list's one command: compose the week's new entries and mail them.
`backfill` is the archive's: it sweeps the same sources with the caps raised, so
the years that predate this installation can still be recorded.
The scheduled ones return 0 even when they did nothing: cron and Task Scheduler
both report a non-zero exit as a broken box, and an operator who learns to ignore
that mail stops reading the one that matters. `weekly-digest` is the exception it
has to be — see its docstring.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
import time
from typing import Any
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from sqlalchemy import update

from app.analytics.ingest import ingest_access_log
from app.analytics.logs import LOG_FORMATS
from app.analytics.retention import prune
from app.config import get_settings
from app.db import repo_admin, repo_events, repo_library, repo_sync
from app.db.models import STATE_ID, SyncState
from app.db.repo_sync import utc_now
from app.db.session import SessionLocal, engine
from app.deps import judge_env
from app.digest import send_weekly
from app.ingest import registry
from app.ingest.normalize import normalize_results
from app.ingest.pipeline import (
    DEFAULT_FETCH_BUDGET_MS,
    HISTORY_MIN_YEAR,
    MAX_FETCH_CONCURRENCY,
    backfill_slugs,
    run_sync,
    seed_rows,
)
from app.ingest.seed import SEED_VERSION
from app.ingest.sources import SOURCE_TIMEOUT_MS, httpx_fetch, load_source, load_sources

# A single probe is allowed to be slower than a batch fetch: an operator is
# waiting on one answer, and a slow feed is still a working feed.
PROBE_TIMEOUT_MS = 15_000

# A backfill is the opposite trade: it is meant to walk years of a catalogue in
# one pass, so the raw cap rises well above the daily 320 and the run gets its
# own, longer budgets. 1,500 covers the 1,018 candidates the current catalogue
# returns with room for growth — at 800 the oldest 218 lost their slot, and
# because the sweep always sees the same 800 first, they would never get one.
BACKFILL_RAW_CAP = 1500
BACKFILL_RUN_BUDGET_MS = 1_800_000
BACKFILL_FETCH_BUDGET_MS = 300_000


async def _with_session(work):
    """Run `work` in one session, then close the pool.

    aiosqlite keeps a worker thread per connection and the pool is not closed
    when the event loop stops, so without the explicit dispose the interpreter
    waits on that thread forever: `python -m app.cli seed` would print its line
    and never exit. Under Task Scheduler that means a hung task, and the next
    run is refused. `asyncio.run` closes the loop, so this belongs right after.
    """
    try:
        async with SessionLocal() as session:
            return await work(session)
    finally:
        await engine.dispose()


async def _seed(session) -> int:
    """Insert the frozen seed; idempotent because it upserts on fingerprint.

    A re-run also refreshes the evidence columns of rows that are already
    there, so a corrected source family reaches the live archive.
    """
    inserted = await repo_events.upsert_seed_events(session, seed_rows(utc_now()))
    state = await repo_sync.read_state(session)
    if state is None:
        session.add(SyncState(id=STATE_ID, seed_version=SEED_VERSION))
    elif state.seed_version != SEED_VERSION:
        await session.execute(
            update(SyncState).where(SyncState.id == STATE_ID).values(seed_version=SEED_VERSION)
        )
    await session.commit()
    return inserted


def _run_sync_command(trigger: str) -> int:
    async def main() -> dict:
        return await _with_session(
            lambda session: run_sync(
                session, trigger=trigger, env=judge_env(get_settings())
            )
        )

    outcome = asyncio.run(main())
    if outcome.get("busy"):
        print("sync skipped: another run holds the lease", file=sys.stderr)
        return 0
    result = outcome.get("result") or {}
    print(
        f"sync {outcome['status']}: raw={result.get('rawCount', 0)} "
        f"created={result.get('createdCount', 0)} merged={result.get('mergedCount', 0)} "
        f"admitted={result.get('admittedCount', 0)} held={result.get('heldCount', 0)}"
    )
    if result.get("notes"):
        print(f"notes: {result['notes']}")
    return 0 if outcome["status"] in ("succeeded", "partial") else 1


def _history_preview(max_events: int) -> int:
    """Fetch and normalize without writing: what would a backfill see?"""

    async def work(session):
        sources = await registry.enabled_sources(session)
        allowed = await registry.allowed_hosts(session)
        started = int(time.time() * 1000)
        results = await load_sources(
            sources,
            fetch=lambda url: httpx_fetch(url, timeout_ms=SOURCE_TIMEOUT_MS),
            deadline_ms=started + DEFAULT_FETCH_BUDGET_MS,
            concurrency=MAX_FETCH_CONCURRENCY,
            allowed_hosts=allowed,
        )
        return normalize_results(results, now_ms=started)

    normalized = asyncio.run(_with_session(work))
    candidates = normalized["candidates"]
    per_source: dict[str, int] = {}
    for candidate in candidates:
        evidence = candidate.get("evidence") or [{}]
        key = str((evidence[0] or {}).get("sourceKey") or "?")
        per_source[key] = per_source.get(key, 0) + 1
    print(f"backfill (dry run): {len(candidates)} candidates, {len(per_source)} sources")
    for key, count in sorted(per_source.items(), key=lambda pair: -pair[1]):
        print(f"  {key:20} {count:>4}")
    oldest = sorted(candidates, key=lambda entry: str(entry.get("eventDate") or ""))[:5]
    for candidate in oldest:
        print(f"  oldest → {candidate.get('eventDate')}  {str(candidate.get('title'))[:60]}")
    print(f"would admit at most {max_events} new events (raw cap {BACKFILL_RAW_CAP})")
    return 0


def _collect_history(max_events: int, dry_run: bool) -> int:
    """Sweep the enabled sources for entries a daily run would never reach.

    Same pipeline, four knobs turned up: no per-source slice (the 41st model of
    a catalogue would otherwise never get a slot), a higher raw cap, a larger
    panel batch, and a duplicate check that sees the whole archive — clustering
    against the last two years only would insert 2023 entries a second time.
    """
    if dry_run:
        return _history_preview(max_events)

    async def main() -> dict:
        return await _with_session(
            lambda session: run_sync(
                session,
                trigger="backfill",
                env=judge_env(get_settings()),
                raw_cap=BACKFILL_RAW_CAP,
                per_source=None,
                new_event_cap=max_events,
                panel_batch=max_events,
                history_min_year=HISTORY_MIN_YEAR,
                run_budget_ms=BACKFILL_RUN_BUDGET_MS,
                fetch_budget_ms=BACKFILL_FETCH_BUDGET_MS,
            )
        )

    outcome = asyncio.run(main())
    if outcome.get("busy"):
        print("backfill skipped: another run holds the lease", file=sys.stderr)
        return 0
    result = outcome.get("result") or {}
    print(
        f"backfill {outcome['status']}: raw={result.get('rawCount', 0)} "
        f"created={result.get('createdCount', 0)} merged={result.get('mergedCount', 0)} "
        f"admitted={result.get('admittedCount', 0)} held={result.get('heldCount', 0)}"
    )
    if result.get("notes"):
        print(f"notes: {result['notes']}")
    return 0 if outcome["status"] in ("succeeded", "partial") else 1


def _backfill() -> int:
    async def main() -> int:
        return await _with_session(lambda session: backfill_slugs(session, utc_now()))

    changed = asyncio.run(main())
    print(f"slugs backfilled: {changed}")
    return 0


def _seed_command() -> int:
    async def main() -> int:
        return await _with_session(_seed)

    inserted = asyncio.run(main())
    print(f"seed rows inserted: {inserted}")
    return 0


def _hash_password(password: str) -> int:
    print(PasswordHasher().hash(password))
    return 0


# ---------------------------------------------------------------------------
# Analytics: access log ingest and retention
# ---------------------------------------------------------------------------


def _ingest_access_log(path: str, fmt: str, dry_run: bool) -> int:
    """Read whatever is new in the proxy log. Exit 0 whatever happens."""
    settings = get_settings()
    target = path or settings.analytics_log_path
    chosen = fmt or settings.analytics_log_format or "auto"
    if not target:
        print("skip: no access log (ANALYTICS_LOG_PATH is empty)")
        return 0

    async def main():
        return await _with_session(
            lambda session: ingest_access_log(
                session, path=target, fmt=chosen, dry_run=dry_run
            )
        )

    report = asyncio.run(main())
    if report.skipped:
        # Not an error: an unconfigured or not-yet-rotated log is a normal state.
        print(f"skip: {report.skipped}")
        return 0

    suffix = " (dry run)" if report.dry_run else ""
    print(
        f"ingest {report.path}: scanned={report.scanned} documents={report.documents} "
        f"bots={report.bots} ai={report.ai} offset={report.start_offset}->{report.end_offset}{suffix}"
    )
    if report.by_bot:
        top = ", ".join(
            f"{name}={count}"
            for name, count in sorted(report.by_bot.items(), key=lambda item: -item[1])[:8]
        )
        print(f"bots: {top}")
    if report.truncated:
        print("note: line limit reached, the rest is read on the next pass")
    return 0


def _prune(days: int | None, dry_run: bool) -> int:
    settings = get_settings()
    if days is not None:
        settings = settings.model_copy(update={"analytics_retention_days": days})

    async def main():
        return await _with_session(lambda session: prune(session, settings=settings, dry_run=dry_run))

    removed = asyncio.run(main())
    parts = " ".join(f"{table}={count}" for table, count in removed.items())
    print(f"prune{' (dry run)' if dry_run else ''}: {parts}")
    return 0


def _create_owner(username: str, password: str | None) -> int:
    """Create or promote an owner straight in the database.

    The env account is enough to log in, but it cannot be audited per person and
    cannot be demoted. This is how a real owner row gets created during the
    migration from the env-only setup, without keeping the bootstrap password in
    the environment forever.
    """
    name = (username or "").strip()
    if not name:
        print("error: --username is required", file=sys.stderr)
        return 2
    secret = password or getpass.getpass(f"password for {name}: ")
    if len(secret) < 12:
        print("error: password must be at least 12 characters", file=sys.stderr)
        return 2

    async def work(session):
        row = await repo_admin.find_user(session, name)
        if row is None:
            row = await repo_admin.create_user(
                session,
                username=name,
                password_hash=PasswordHasher().hash(secret),
                role="owner",
            )
            await session.commit()
            return "created"
        await repo_admin.set_password(session, row, PasswordHasher().hash(secret))
        await repo_admin.update_user(session, row, role="owner", active=True)
        await session.commit()
        return "updated"

    outcome = asyncio.run(_with_session(work))
    print(f"owner {name}: {outcome}")
    return 0


# ---------------------------------------------------------------------------
# Mailing list: the weekly digest
# ---------------------------------------------------------------------------


def _weekly_digest(dry_run: bool, force: bool) -> int:
    """Mail the week's new entries to everyone who confirmed.

    Exit 0, except in one case: recipients were addressed and not one message
    went out. That is the shape a wrong SMTP password has, and letting it look
    like a quiet week for three Mondays in a row is how a newsletter quietly
    dies. An empty week (no new entries, nobody confirmed, mailer not
    configured) is a normal Monday and stays 0.
    """
    settings = get_settings()

    async def main():
        return await _with_session(
            lambda session: send_weekly(
                session, settings, dry_run=dry_run, force=force
            )
        )

    report = asyncio.run(main())
    print(report.summary())
    if report.sample:
        print("--- body ---")
        print(report.sample, end="")
    if report.failed and not report.sent:
        return 1
    return 0


# ---------------------------------------------------------------------------
# Catalogue: seed, probe, and ledger retention
# ---------------------------------------------------------------------------


def _catalog_seed() -> int:
    """Insert the catalogue rows a fresh database has never seen.

    `run_sync` does this on every pass, so the command exists for the first
    install and for a box that has never collected anything. Existing rows are
    never touched: an operator edit has to survive a deploy.
    """

    async def main() -> int:
        return await _with_session(lambda session: registry.ensure_catalog(session))

    added = asyncio.run(main())
    print(f"catalogue rows added: {added}")
    return 0


async def _resolve_probe_target(
    session, key: str, url: str, kind: str
) -> dict[str, Any] | None:
    """A probe reads either a stored row or an ad-hoc URL."""
    if key:
        row = await registry.get_source(session, key)
        if row is None:
            return None
        return {
            "key": row.key,
            "name": row.name,
            "family": row.family,
            "kind": row.kind,
            "url": row.url,
            "pathPattern": row.path_pattern,
            "timeout": row.timeout_ms,
        }
    return {
        "key": "probe",
        "name": "probe",
        "family": "official",
        "kind": kind or "feed",
        "url": url,
        "timeout": SOURCE_TIMEOUT_MS,
    }


def _probe(key: str, url: str, kind: str) -> int:
    """Fetch one source with its real parser. Never writes, never raises."""
    if not key and not url:
        print("error: pass --key or --url", file=sys.stderr)
        return 2

    async def main() -> dict[str, Any] | None:
        async def work(session):
            source = await _resolve_probe_target(session, key, url, kind)
            if source is None:
                return None
            started = int(time.time() * 1000)
            result = await load_source(
                source,
                fetch=lambda target: httpx_fetch(target, timeout_ms=PROBE_TIMEOUT_MS),
                deadline_ms=started + PROBE_TIMEOUT_MS,
                allowed={urlsplit(source["url"]).hostname or ""},
            )
            return {"source": source, **result}

        return await _with_session(work)

    outcome = asyncio.run(main())
    if outcome is None:
        print(f"error: no source with key `{key}`", file=sys.stderr)
        return 2

    source = outcome["source"]
    if not outcome.get("ok"):
        print(f"probe {source['key']} failed: {outcome.get('error')} ({outcome.get('ms')} ms)")
        return 1

    items = list(outcome.get("items") or [])
    dates = [str(item["publishedAt"]) for item in items if item.get("publishedAt")]
    print(
        f"probe {source['key']} ok: {outcome.get('ms')} ms items={len(items)} "
        f"latest={max(dates) if dates else '-'}"
    )
    for item in items[:3]:
        print(f"  {item.get('publishedAt') or '-'}  {item.get('title')}")
    return 0


def _library_prune(days: int | None, dry_run: bool) -> int:
    """Drop trail rows and *dropped* items past the window.

    `admitted` / `excluded` / `held` rows are never pruned: they are the audit
    evidence behind a published entry.
    """
    settings = get_settings()
    window = days if days is not None else settings.collect_retention_days

    async def main() -> int:
        return await _with_session(
            lambda session: repo_library.prune_verdicts(session, days=window, dry_run=dry_run)
        )

    removed = asyncio.run(main())
    suffix = " (dry run)" if dry_run else ""
    print(f"library-prune {window}d: rows={removed}{suffix}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("seed", help="insert the frozen seed events")

    sync_parser = sub.add_parser("sync", help="run one collection pass")
    sync_parser.add_argument("--trigger", default="manual", choices=["manual", "auto"])

    sub.add_parser("backfill-slugs", help="assign slugs to rows that lack one")

    history_parser = sub.add_parser(
        "backfill", help="sweep the sources for older entries (years, not a day)"
    )
    history_parser.add_argument(
        "--max-events", type=int, default=150, help="new events admitted in this pass"
    )
    history_parser.add_argument(
        "--dry-run", action="store_true", help="fetch and normalize only: no rows, no verdicts"
    )

    hash_parser = sub.add_parser("hash-password", help="print an argon2 hash")
    hash_parser.add_argument("password")

    ingest_parser = sub.add_parser(
        "ingest-access-log", help="read new lines of the proxy access log into crawl_hits"
    )
    ingest_parser.add_argument(
        "--path", default="", help="defaults to ANALYTICS_LOG_PATH"
    )
    ingest_parser.add_argument(
        "--format", default="", choices=["", *LOG_FORMATS], help="defaults to ANALYTICS_LOG_FORMAT"
    )
    ingest_parser.add_argument(
        "--dry-run", action="store_true", help="count only: no rows, no offset change"
    )

    prune_parser = sub.add_parser("prune", help="delete analytics rows past their window")
    prune_parser.add_argument(
        "--days", type=int, default=None, help="override ANALYTICS_RETENTION_DAYS"
    )
    prune_parser.add_argument("--dry-run", action="store_true", help="report what would go")

    owner_parser = sub.add_parser("create-owner", help="create or promote a console owner")
    owner_parser.add_argument("--username", required=True)
    owner_parser.add_argument(
        "--password", default="", help="omit to be prompted (keeps it out of shell history)"
    )

    sub.add_parser("catalog-seed", help="insert the source catalogue into ingest_sources")

    probe_parser = sub.add_parser("probe", help="fetch one source once, without writing")
    probe_parser.add_argument("--key", default="", help="a registered source key")
    probe_parser.add_argument("--url", default="", help="an ad-hoc URL (for a candidate)")
    probe_parser.add_argument(
        "--kind", default="feed", choices=["feed", "sitemap", "arxiv", "openrouter", "hf", "hn"]
    )

    library_parser = sub.add_parser(
        "library-prune", help="drop old trail rows and old dropped items"
    )
    library_parser.add_argument(
        "--days", type=int, default=None, help="override COLLECT_RETENTION_DAYS"
    )
    library_parser.add_argument("--dry-run", action="store_true", help="report what would go")

    digest_parser = sub.add_parser(
        "weekly-digest", help="mail the week's new entries to confirmed subscribers"
    )
    digest_parser.add_argument(
        "--dry-run", action="store_true", help="compose and print one body, send nothing"
    )
    digest_parser.add_argument(
        "--force",
        action="store_true",
        help="also mail addresses that already received an issue this week",
    )

    args = parser.parse_args(argv)

    if args.command == "seed":
        return _seed_command()
    if args.command == "sync":
        return _run_sync_command(args.trigger)
    if args.command == "backfill-slugs":
        return _backfill()
    if args.command == "backfill":
        return _collect_history(args.max_events, args.dry_run)
    if args.command == "ingest-access-log":
        return _ingest_access_log(args.path, args.format, args.dry_run)
    if args.command == "prune":
        return _prune(args.days, args.dry_run)
    if args.command == "create-owner":
        return _create_owner(args.username, args.password or None)
    if args.command == "catalog-seed":
        return _catalog_seed()
    if args.command == "probe":
        return _probe(args.key, args.url, args.kind)
    if args.command == "library-prune":
        return _library_prune(args.days, args.dry_run)
    if args.command == "weekly-digest":
        return _weekly_digest(args.dry_run, args.force)
    return _hash_password(args.password)


if __name__ == "__main__":
    raise SystemExit(main())
