"""open-data key applications

One new table, additive only: nothing in 0001/0002 changes shape, so
`alembic upgrade head` stays safe on a populated SQLite file.

No foreign key to `api_keys` on purpose. The two rows are written in the same
transaction, but a database-level cascade would either forbid revoking the key
or delete the application that explains it — and the application is the record
that has to outlive the credential.

Revision ID: 0003_open_applications
Revises: 0002_admin_console
Create Date: 2026-10-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_open_applications"
down_revision = "0002_admin_console"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("purpose", sa.Text(), nullable=False, server_default=""),
        sa.Column("site_url", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("monthly_quota", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("key_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.String(length=40), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_api_applications_status", "api_applications", ["status", "created_at"]
    )
    op.create_index("ix_api_applications_email", "api_applications", ["email"])


def downgrade() -> None:
    op.drop_index("ix_api_applications_email", table_name="api_applications")
    op.drop_index("ix_api_applications_status", table_name="api_applications")
    op.drop_table("api_applications")
