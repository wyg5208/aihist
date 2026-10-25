"""Consistent online backup of the SQLite file named by DATABASE_URL.

`cp aihist.db` is not a backup once WAL is on: the copy can capture a torn
snapshot (some committed pages, some not) and silently produce a corrupt
archive. The sqlite3 backup API copies page by page while holding the proper
locks, against a live database.

Shared by `deploy/backup.sh` and `deploy/windows/backup.ps1` so the logic only
exists once.

usage: python deploy/backup.py <target-file>
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

from sqlalchemy.engine import make_url


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python deploy/backup.py <target-file>", file=sys.stderr)
        return 2

    target = Path(argv[1])
    if target.exists():
        print(f"{target} already exists", file=sys.stderr)
        return 1

    raw_url = os.environ.get("DATABASE_URL", "")
    if not raw_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    url = make_url(raw_url)
    if url.get_backend_name() != "sqlite":
        print("not a SQLite database: use pg_dump instead", file=sys.stderr)
        return 2
    if not url.database or url.database == ":memory:":
        print("DATABASE_URL does not point at a file", file=sys.stderr)
        return 2

    target.parent.mkdir(parents=True, exist_ok=True)

    source = sqlite3.connect(url.database)
    try:
        source.execute("PRAGMA busy_timeout=15000")
        destination = sqlite3.connect(str(target))
        try:
            source.backup(destination)
            # The archive is meant to be moved around on its own, so leave it
            # without a -wal sidecar.
            destination.execute("PRAGMA journal_mode=DELETE")
        finally:
            destination.close()
    finally:
        source.close()

    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
