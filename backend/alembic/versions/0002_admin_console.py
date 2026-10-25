"""admin console: identity, audit, analytics, growth and commercial tables

Additive only. The five tables from 0001 keep their shape, and the two columns
added to `sync_runs` carry server defaults, so `alembic upgrade head` is safe on
a populated SQLite file.

Why plain `op.add_column` and not `batch_alter_table`: SQLite implements the
batch recipe by rebuilding the table (create new, copy, drop, rename). `events`
carries the partial unique index `ux_events_slug ... WHERE slug IS NOT NULL`,
and a rebuild drops it; recreating it silently changes which rows are covered.
`ADD COLUMN` with a constant default is native on SQLite 3.2+, so we avoid the
rebuild entirely. `downgrade()` uses the batch path because `DROP COLUMN` is
only native from SQLite 3.35 and downgrades are not part of the deploy loop.

Revision ID: 0002_admin_console
Revises: 0001_initial
Create Date: 2026-11-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002_admin_console"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _json_doc() -> sa.types.TypeEngine:
    """Resolve the JSON column for the attached dialect, not at import time."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB()
    return sa.JSON()


def upgrade() -> None:
    json_doc = _json_doc()

    # ----- identity and audit ------------------------------------------------
    op.create_table(
        "admin_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=40), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=12), nullable=False, server_default="analyst"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_admin_users_username", "admin_users", ["username"], unique=True)

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(length=40), nullable=False),
        sa.Column("role", sa.String(length=12), nullable=False, server_default=""),
        sa.Column("action", sa.String(length=48), nullable=False),
        sa.Column("target_type", sa.String(length=24), nullable=False, server_default=""),
        sa.Column("target_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("detail", json_doc, nullable=False, server_default=sa.text("'{}'")),
        # sha256(ip + salt): the raw address is never persisted.
        sa.Column("ip_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_at", "audit_log", ["at"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])
    op.create_index("ix_audit_log_target", "audit_log", ["target_type", "target_id"])

    # ----- first-party traffic ----------------------------------------------
    op.create_table(
        "page_views",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        # Pre-truncated to the UTC+8 calendar day: every rollup is a GROUP BY.
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("path", sa.String(length=300), nullable=False),
        sa.Column("page_kind", sa.String(length=16), nullable=False, server_default="other"),
        sa.Column("referrer_host", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("channel", sa.String(length=16), nullable=False, server_default="direct"),
        sa.Column("visitor_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("session_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("ua_family", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("is_bot", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("device", sa.String(length=12), nullable=False, server_default="desktop"),
        sa.Column("lang", sa.String(length=16), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_views_day", "page_views", ["day"])
    op.create_index("ix_page_views_visitor", "page_views", ["visitor_hash", "day"])

    op.create_table(
        "crawl_hits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("path", sa.String(length=300), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False, server_default="200"),
        sa.Column("ua_family", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("bot_name", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("is_ai", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_crawl_hits_day", "crawl_hits", ["day"])
    op.create_index("ix_crawl_hits_ai", "crawl_hits", ["is_ai", "day"])

    op.create_table(
        "log_ingest_state",
        sa.Column("path", sa.String(length=300), nullable=False),
        sa.Column("offset", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("path"),
    )

    # ----- collection operations --------------------------------------------
    op.create_table(
        "source_health",
        sa.Column("key", sa.String(length=32), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("family", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("last_run_id", sa.Uuid(), nullable=True),
        sa.Column("last_ok_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_runs", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )

    # ----- growth -----------------------------------------------------------
    op.create_table(
        "subscribers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("token", sa.String(length=48), nullable=False),
        sa.Column("source_path", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("source_channel", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_subscribers_email", "subscribers", ["email"], unique=True)
    op.create_index("ux_subscribers_token", "subscribers", ["token"], unique=True)

    # ----- commercial -------------------------------------------------------
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("prefix", sa.String(length=12), nullable=False, server_default=""),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("scopes", json_doc, nullable=False, server_default=sa.text("'[\"read\"]'")),
        sa.Column("monthly_quota", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)
    op.create_index("ix_api_keys_prefix", "api_keys", ["prefix"])

    op.create_table(
        "api_key_usage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_api_key_usage_key_day", "api_key_usage", ["key_id", "day"], unique=True
    )

    op.create_table(
        "partners",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="sponsor"),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="prospect"),
        sa.Column("code", sa.String(length=24), nullable=False),
        sa.Column("target_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("contact", sa.Text(), nullable=False, server_default=""),
        sa.Column("terms_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("starts_on", sa.String(length=10), nullable=True),
        sa.Column("ends_on", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_partners_code", "partners", ["code"], unique=True)

    op.create_table(
        "partner_clicks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("partner_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("referrer_host", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("ua_family", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("is_bot", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_partner_clicks_partner_day", "partner_clicks", ["partner_id", "day"]
    )

    # ----- columns added to existing tables ----------------------------------
    # Operator-only memo. Deliberately absent from `schemas/event.py`, so the
    # public event payload is byte-for-byte unchanged.
    op.add_column("events", sa.Column("ops_note", sa.Text(), nullable=True))

    # Counters the pipeline already computes but used to discard; plus the
    # structured per-source breakdown that replaces parsing the `notes` string.
    op.add_column(
        "sync_runs", sa.Column("reviewed_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "sync_runs", sa.Column("admitted_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "sync_runs", sa.Column("excluded_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "sync_runs", sa.Column("held_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "sync_runs",
        sa.Column("panel_configured", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "sync_runs", sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "sync_runs", sa.Column("detail", json_doc, nullable=False, server_default=sa.text("'{}'"))
    )


def downgrade() -> None:
    for column in (
        "detail",
        "duration_ms",
        "panel_configured",
        "held_count",
        "excluded_count",
        "admitted_count",
        "reviewed_count",
    ):
        with op.batch_alter_table("sync_runs") as batch:
            batch.drop_column(column)
    with op.batch_alter_table("events") as batch:
        batch.drop_column("ops_note")

    op.drop_table("partner_clicks")
    op.drop_table("partners")
    op.drop_table("api_key_usage")
    op.drop_table("api_keys")
    op.drop_table("subscribers")
    op.drop_table("source_health")
    op.drop_table("log_ingest_state")
    op.drop_table("crawl_hits")
    op.drop_table("page_views")
    op.drop_table("audit_log")
    op.drop_table("admin_users")
