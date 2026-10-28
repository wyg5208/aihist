"""source registry and collection ledger

Three additive changes:

1. `ingest_sources` — one row per configured source. It is both the catalogue
   the console edits and the allow-list the fetcher derives redirect hosts from,
   so adding a feed is an INSERT instead of a release.
2. `collect_verdicts` — append-only trail. `review_decisions` is upserted in
   place (one row per cluster fingerprint), which is correct for "what is the
   decision now" and useless for "how did it change". This table keeps every
   transition.
3. Thirteen columns on `raw_items` — the current disposition of each collected
   entry. `fingerprint` and its unique index are deliberately untouched: the
   hash formula is sha256(sourceName|externalId), and changing it would
   duplicate the whole table the moment the upgrade runs.

Why plain `op.add_column` again instead of `batch_alter_table`: SQLite implements
the batch recipe as create-copy-drop-rename, which rebuilds `raw_items` and
therefore re-creates `ux_raw_items_fingerprint`. 0002 already established the
rule (see its module docstring); `ADD COLUMN` with a constant default is native
on SQLite 3.2+, so the rebuild is avoidable. `downgrade()` uses the batch path
because `DROP COLUMN` needs SQLite 3.35 and downgrades are not in the deploy
loop.

Revision ID: 0004_ingest_catalog_and_ledger
Revises: 0003_open_applications
Create Date: 2026-11-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_ingest_catalog_and_ledger"
down_revision = "0003_open_applications"
branch_labels = None
depends_on = None

# A literal both dialects accept verbatim; overwritten by the backfill below.
_EPOCH = sa.text("'1970-01-01 00:00:00'")

ADDED_COLUMNS = (
    ("source_key", sa.Column("source_key", sa.String(length=48), nullable=False, server_default="")),
    ("run_id", sa.Column("run_id", sa.Uuid(), nullable=True)),
    (
        "status",
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
    ),
    ("stage", sa.Column("stage", sa.String(length=16), nullable=False, server_default="fetch")),
    (
        "reason_code",
        sa.Column("reason_code", sa.String(length=40), nullable=False, server_default=""),
    ),
    (
        "reason_text",
        sa.Column("reason_text", sa.Text(), nullable=False, server_default=""),
    ),
    ("score", sa.Column("score", sa.Integer(), nullable=False, server_default="0")),
    ("event_id", sa.Column("event_id", sa.Uuid(), nullable=True)),
    ("event_fingerprint", sa.Column("event_fingerprint", sa.String(length=64), nullable=True)),
    (
        "first_seen_at",
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=_EPOCH),
    ),
    (
        "last_seen_at",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=_EPOCH),
    ),
    ("seen_count", sa.Column("seen_count", sa.Integer(), nullable=False, server_default="1")),
    ("decided_at", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True)),
)


def upgrade() -> None:
    # ----- source registry ---------------------------------------------------
    op.create_table(
        "ingest_sources",
        sa.Column("key", sa.String(length=48), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("family", sa.String(length=20), nullable=False, server_default="official"),
        sa.Column("kind", sa.String(length=12), nullable=False, server_default="feed"),
        sa.Column("url", sa.Text(), nullable=False, server_default=""),
        sa.Column("path_pattern", sa.String(length=80), nullable=False, server_default="/news/"),
        sa.Column("domestic", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ai_only", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("timeout_ms", sa.Integer(), nullable=False, server_default="12000"),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        # NULL = never probed. The API refuses to enable a source without it.
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_index("ix_ingest_sources_family", "ingest_sources", ["family"])
    op.create_index("ix_ingest_sources_enabled", "ingest_sources", ["enabled"])

    # ----- append-only verdict trail -----------------------------------------
    op.create_table(
        "collect_verdicts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("item_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("stage", sa.String(length=16), nullable=False, server_default="fetch"),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("reason_code", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("reason_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("event_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_collect_verdicts_item", "collect_verdicts", ["item_fingerprint", "at"]
    )
    op.create_index("ix_collect_verdicts_at", "collect_verdicts", ["at"])
    op.create_index("ix_collect_verdicts_run", "collect_verdicts", ["run_id"])
    op.create_index("ix_collect_verdicts_status", "collect_verdicts", ["status", "at"])

    # ----- current disposition on the staging table --------------------------
    for _, column in ADDED_COLUMNS:
        op.add_column("raw_items", column)

    # Rows that predate this migration have no ledger history; their fetch time
    # is the only honest answer for "first seen".
    op.execute(
        "update raw_items set first_seen_at = fetched_at, last_seen_at = fetched_at"
    )

    op.create_index("ix_raw_items_status_seen", "raw_items", ["status", "last_seen_at"])
    op.create_index("ix_raw_items_source_seen", "raw_items", ["source_key", "last_seen_at"])
    op.create_index("ix_raw_items_event_fp", "raw_items", ["event_fingerprint"])
    op.create_index("ix_raw_items_run", "raw_items", ["run_id"])


def downgrade() -> None:
    for name in (
        "ix_raw_items_run",
        "ix_raw_items_event_fp",
        "ix_raw_items_source_seen",
        "ix_raw_items_status_seen",
    ):
        op.drop_index(name, table_name="raw_items")

    with op.batch_alter_table("raw_items") as batch:
        for name, _ in reversed(ADDED_COLUMNS):
            batch.drop_column(name)

    op.drop_table("collect_verdicts")
    op.drop_table("ingest_sources")
