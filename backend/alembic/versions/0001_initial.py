"""initial five-table schema

Derived column-by-column from the previous PostgREST deployment
(`functions/lib/db.mjs`: EVENT_COLUMNS / EVENT_DETAIL_COLUMNS) plus the
lease bookkeeping that used to live in a shared `sync_state` row.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-24
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def _column_types() -> tuple[sa.types.TypeEngine, sa.types.TypeEngine]:
    """Resolve list/JSON columns for the database that is actually attached.

    Postgres keeps native `text[]` and `jsonb`; SQLite stores both as JSON text,
    the same mapping `app.db.models` declares through `with_variant`. Resolving
    at upgrade time (rather than at import time) means the migration works in
    offline `--sql` mode too, where no engine is bound.
    """
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ARRAY(sa.String()), postgresql.JSONB()
    return sa.JSON(), sa.JSON()


def upgrade() -> None:
    string_list, json_doc = _column_types()

    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=True),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        # Text, not Date: curated seeds carry month precision ("1950-10").
        sa.Column("event_date", sa.String(length=20), nullable=False),
        sa.Column("date_precision", sa.String(length=10), nullable=False),
        sa.Column("sort_date", sa.String(length=10), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("title_en", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("summary_kind", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("organization", sa.Text(), nullable=True),
        sa.Column("model_name", sa.Text(), nullable=True),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("confidence", sa.String(length=12), nullable=False),
        sa.Column("source_count", sa.Integer(), nullable=False),
        sa.Column("source_families", string_list, nullable=False),
        sa.Column("sources", json_doc, nullable=False),
        sa.Column("tags", string_list, nullable=False),
        sa.Column("meta", json_doc, nullable=False),
        sa.Column("origin", sa.String(length=12), nullable=False),
        sa.Column("editorial_status", sa.String(length=12), nullable=True),
        sa.Column("editorial_review", json_doc, nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_events_fingerprint", "events", ["fingerprint"], unique=True)
    op.create_index(
        "ux_events_slug",
        "events",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("slug IS NOT NULL"),
        sqlite_where=sa.text("slug IS NOT NULL"),
    )
    op.create_index("ix_events_timeline", "events", ["sort_date", "importance"])
    op.create_index("ix_events_year", "events", ["year"])
    op.create_index("ix_events_category", "events", ["category"])
    op.create_index("ix_events_confidence", "events", ["confidence"])
    op.create_index("ix_events_editorial_status", "events", ["editorial_status"])
    op.create_index("ix_events_origin", "events", ["origin"])

    op.create_table(
        "raw_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("source_family", sa.String(length=20), nullable=False),
        sa.Column("source_name", sa.Text(), nullable=False),
        sa.Column("external_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("published_at", sa.String(length=32), nullable=True),
        sa.Column("payload", json_doc, nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_raw_items_fingerprint", "raw_items", ["fingerprint"], unique=True)
    op.create_index("ix_raw_items_fetched_at", "raw_items", ["fetched_at"])
    op.create_index("ix_raw_items_family", "raw_items", ["source_family"])

    op.create_table(
        "sync_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("trigger", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_count", sa.Integer(), nullable=False),
        sa.Column("created_count", sa.Integer(), nullable=False),
        sa.Column("merged_count", sa.Integer(), nullable=False),
        sa.Column("failed_sources", string_list, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sync_runs_started_at", "sync_runs", ["started_at"])

    # Single-row table: the primary key is the literal string 'global'.
    op.create_table(
        "sync_state",
        sa.Column("id", sa.String(length=16), nullable=False),
        sa.Column("lease_token", sa.String(length=64), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=12), nullable=True),
        sa.Column("seed_version", sa.String(length=32), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "review_decisions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("rubric_version", sa.String(length=32), nullable=False),
        sa.Column("decision", sa.String(length=12), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("include_votes", sa.Integer(), nullable=False),
        sa.Column("valid_votes", sa.Integer(), nullable=False),
        sa.Column("votes", json_doc, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("source_count", sa.Integer(), nullable=False),
        sa.Column("decision_source", sa.String(length=12), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_decisions_rubric", "review_decisions", ["rubric_version"])
    op.create_index("ix_review_decisions_decision", "review_decisions", ["decision"])


def downgrade() -> None:
    op.drop_table("review_decisions")
    op.drop_table("sync_state")
    op.drop_table("sync_runs")
    op.drop_table("raw_items")
    op.drop_table("events")
