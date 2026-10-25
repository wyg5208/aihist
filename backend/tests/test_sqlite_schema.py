"""The migration has to build the schema on the database that actually ships.

Every other test creates tables with `Base.metadata.create_all`, which proves the
models work but says nothing about `alembic upgrade head`. The migration once
hard-coded `postgresql.ARRAY` / `JSONB` / `postgresql_where`, so on SQLite it
failed outright and nobody noticed. These tests run the real migration.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.models import Base
from app.db.session import SQLITE_BUSY_TIMEOUT_MS, apply_sqlite_pragmas

BACKEND = Path(__file__).resolve().parent.parent

# 0001 (editorial) + 0002 (admin console). The second group is additive; the
# first five must keep their exact shape because the public API contract and the
# 158-row curated seed are frozen against them.
EXPECTED_TABLES = {
    "events",
    "raw_items",
    "sync_runs",
    "sync_state",
    "review_decisions",
    "admin_users",
    "audit_log",
    "page_views",
    "crawl_hits",
    "log_ingest_state",
    "source_health",
    "subscribers",
    "api_keys",
    "api_key_usage",
    "partners",
    "partner_clicks",
}

EXPECTED_INDEXES = {
    "ux_events_fingerprint",
    "ux_events_slug",
    "ix_events_timeline",
    "ix_events_year",
    "ix_events_category",
    "ix_events_confidence",
    "ix_events_editorial_status",
    "ix_events_origin",
    "ux_raw_items_fingerprint",
    "ix_raw_items_fetched_at",
    "ix_raw_items_family",
    "ix_sync_runs_started_at",
    "ix_review_decisions_rubric",
    "ix_review_decisions_decision",
    "ux_admin_users_username",
    "ix_audit_log_at",
    "ix_audit_log_action",
    "ix_audit_log_target",
    "ix_page_views_day",
    "ix_page_views_visitor",
    "ix_crawl_hits_day",
    "ix_crawl_hits_ai",
    "ux_subscribers_email",
    "ux_subscribers_token",
    "ux_api_keys_key_hash",
    "ix_api_keys_prefix",
    "ux_api_key_usage_key_day",
    "ux_partners_code",
    "ix_partner_clicks_partner_day",
}

# Columns added by 0002 to tables that already shipped in 0001. Asserted
# explicitly because an `ADD COLUMN` that silently no-ops on SQLite is exactly
# the failure the batch-vs-native debate was about.
ADDED_COLUMNS = {
    "events": {"ops_note"},
    "sync_runs": {
        "reviewed_count",
        "admitted_count",
        "excluded_count",
        "held_count",
        "panel_configured",
        "duration_ms",
        "detail",
    },
}


def migrate(db_path: Path, monkeypatch: pytest.MonkeyPatch) -> sa.Engine:
    """Run the real `alembic upgrade head` against a throwaway SQLite file."""
    url = f"sqlite:///{db_path.as_posix()}"
    # `alembic/env.py` prefers DATABASE_URL so the same url reaches the migration.
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")
    return create_engine(url)


def test_alembic_creates_the_whole_schema(tmp_path, monkeypatch):
    engine = migrate(tmp_path / "migrated.db", monkeypatch)

    with engine.connect() as connection:
        tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "select name from sqlite_master where type = 'table'"
            )
        }
        indexes = {
            row[0]
            for row in connection.exec_driver_sql(
                "select name from sqlite_master where type = 'index'"
            )
        }

    assert EXPECTED_TABLES <= tables
    assert EXPECTED_INDEXES <= indexes


def test_added_columns_survive_a_populated_upgrade(tmp_path, monkeypatch):
    """0002 must add columns to a table that already has rows, without a rebuild."""
    url = f"sqlite:///{(tmp_path / 'populated.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    config.set_main_option("sqlalchemy.url", url)

    command.upgrade(config, "0001_initial")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "insert into sync_runs (id, \"trigger\", status, started_at, raw_count,"
            " created_count, merged_count, failed_sources, notes) values"
            " ('00000000-0000-0000-0000-000000000000', 'cron', 'ok', '2026-01-01',"
            " 10, 2, 1, '[]', null)"
        )
    engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(url)
    with engine.connect() as connection:
        inspector = inspect(engine)
        for table, expected in ADDED_COLUMNS.items():
            actual = {column["name"] for column in inspector.get_columns(table)}
            assert expected <= actual, f"{table} is missing {expected - actual}"

        row = connection.exec_driver_sql(
            "select reviewed_count, admitted_count, excluded_count, held_count,"
            " panel_configured, duration_ms, detail from sync_runs"
        ).one()
    engine.dispose()

    # The pre-existing row keeps its identity and picks up the defaults.
    assert row[0] == 0 and row[5] == 0
    assert row[4] in (0, False)


def test_migration_and_models_agree(tmp_path, monkeypatch):
    """Guards against the two definitions drifting apart."""
    migrated = migrate(tmp_path / "migrated.db", monkeypatch)

    reference_path = tmp_path / "models.db"
    reference = create_engine(f"sqlite:///{reference_path.as_posix()}")
    Base.metadata.create_all(reference)

    got = inspect(migrated)
    want = inspect(reference)

    for table in sorted(EXPECTED_TABLES):
        assert {column["name"] for column in got.get_columns(table)} == {
            column["name"] for column in want.get_columns(table)
        }, f"{table} columns differ"

        assert {index["name"] for index in got.get_indexes(table)} == {
            index["name"] for index in want.get_indexes(table)
        }, f"{table} indexes differ"


def test_slug_uniqueness_only_applies_to_non_null(tmp_path, monkeypatch):
    """The index is partial: many rows may lack a slug, no slug may repeat."""
    engine = migrate(tmp_path / "slug.db", monkeypatch)

    insert = sa.text(
        "insert into events (id, slug, fingerprint, event_date, date_precision,"
        " sort_date, year, title, summary, summary_kind, category, importance,"
        " confidence, source_count, source_families, sources, tags, meta, origin,"
        " first_seen_at, updated_at) values (:id, :slug, :fingerprint, '1950-10',"
        " 'month', '1950-10-01', 1950, 't', 's', 'excerpt', 'milestone', 50,"
        " 'single', 0, '[]', '[]', '[]', '{}', 'auto', '2026-01-01', '2026-01-01')"
    )

    with engine.begin() as connection:
        for index in range(2):
            connection.execute(
                insert,
                {"id": f"00000000-0000-0000-0000-00000000000{index}",
                 "slug": None,
                 "fingerprint": f"fp-null-{index}"},
            )
        connection.execute(
            insert,
            {"id": "00000000-0000-0000-0000-000000000010",
             "slug": "agentic-ai-foundation",
             "fingerprint": "fp-slug"},
        )

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                insert,
                {"id": "00000000-0000-0000-0000-000000000011",
                 "slug": "agentic-ai-foundation",
                 "fingerprint": "fp-slug-2"},
            )


def test_sqlite_pragmas_are_applied(tmp_path):
    """WAL is what keeps reads alive while a collection run is writing."""
    engine = create_engine(f"sqlite:///{(tmp_path / 'pragmas.db').as_posix()}")
    raw = engine.raw_connection()
    try:
        apply_sqlite_pragmas(raw.driver_connection)
        cursor = raw.cursor()

        def pragma(name: str):
            cursor.execute(f"PRAGMA {name}")
            return cursor.fetchone()[0]

        assert pragma("journal_mode").lower() == "wal"
        assert pragma("synchronous") == 1  # NORMAL
        assert pragma("busy_timeout") == SQLITE_BUSY_TIMEOUT_MS
        assert pragma("foreign_keys") == 1
        cursor.close()
    finally:
        raw.close()
        engine.dispose()
