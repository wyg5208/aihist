"""delivery ledger for the weekly digest

`subscribers` records consent; until now nothing recorded what was actually
delivered, because nothing was. The weekly job (`python -m app.cli
weekly-digest`) needs three answers it cannot get from the mailing list itself:

1. Has this address already received *this* issue? A re-run after a failed
   SMTP connection must not hand anyone a second copy, so (`issue`, `email`)
   is unique and the sender upserts onto it.
2. Who failed, and why? `error` keeps the short reason the mailer returns
   (`smtp_not_configured`, `smtp_failed`); the address is skipped, the run
   continues.
3. What did last Monday do? `at` is indexed for exactly that one query.

No foreign key to `subscribers` on purpose, matching `api_key_usage`: the
address is snapshotted, so the row still explains itself if the subscriber is
ever corrected in place.

Revision ID: 0006_weekly_digest
Revises: 0005_legacy_collected_rows
Create Date: 2026-11-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_weekly_digest"
down_revision = "0005_legacy_collected_rows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "digest_sends",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("issue", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("subscriber_id", sa.Uuid(), nullable=True),
        sa.Column("email", sa.String(length=254), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="queued"),
        sa.Column("error", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_digest_sends_issue_email", "digest_sends", ["issue", "email"], unique=True
    )
    op.create_index("ix_digest_sends_at", "digest_sends", ["at"])


def downgrade() -> None:
    # The ledger goes with the sender: without the job these rows describe a
    # delivery nothing can explain or repeat.
    op.drop_index("ix_digest_sends_at", table_name="digest_sends")
    op.drop_index("ux_digest_sends_issue_email", table_name="digest_sends")
    op.drop_table("digest_sends")
