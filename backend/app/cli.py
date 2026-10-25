"""Command line entry points.

`seed`, `sync`, `backfill-slugs`, `hash-password` run the archive; the three added
for the console are `ingest-access-log`, `prune` and `create-owner`. The two
scheduled ones return 0 even when they did nothing: cron and Task Scheduler both
report a non-zero exit as a broken box, and an operator who learns to ignore that
mail stops reading the one that matters.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from argon2 import PasswordHasher
from sqlalchemy import update

from app.analytics.ingest import ingest_access_log
from app.analytics.logs import LOG_FORMATS
from app.analytics.retention import prune
from app.config import get_settings
from app.db import repo_admin, repo_events, repo_sync
from app.db.models import STATE_ID, SyncState
from app.db.repo_sync import utc_now
from app.db.session import SessionLocal, engine
from app.deps import judge_env
from app.ingest.pipeline import backfill_slugs, run_sync, seed_rows
from app.ingest.seed import SEED_VERSION


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
    """Insert the frozen seed; idempotent because it upserts on fingerprint."""
    inserted = await repo_events.insert_events(session, seed_rows(utc_now()))
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("seed", help="insert the frozen seed events")

    sync_parser = sub.add_parser("sync", help="run one collection pass")
    sync_parser.add_argument("--trigger", default="manual", choices=["manual", "auto"])

    sub.add_parser("backfill-slugs", help="assign slugs to rows that lack one")

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

    args = parser.parse_args(argv)

    if args.command == "seed":
        return _seed_command()
    if args.command == "sync":
        return _run_sync_command(args.trigger)
    if args.command == "backfill-slugs":
        return _backfill()
    if args.command == "ingest-access-log":
        return _ingest_access_log(args.path, args.format, args.dry_run)
    if args.command == "prune":
        return _prune(args.days, args.dry_run)
    if args.command == "create-owner":
        return _create_owner(args.username, args.password or None)
    return _hash_password(args.password)


if __name__ == "__main__":
    raise SystemExit(main())
