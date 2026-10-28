"""label the rows that predate the collection ledger

0004 gave `raw_items` a `status` column with `server_default="pending"`. Every
row that already existed therefore reads as a candidate still waiting for a
verdict, which is wrong twice over: the pre-ledger pipeline had already finished
with those rows, and nothing will ever move them. On the production database
that was 364 rows of permanent "pending" noise on the collection-ledger page —
an audit surface whose whole promise is that every row can explain itself.

`run_id` is the discriminator. The pipeline builds its ledger with the run id
(`Ledger(run_id=...)`), so any row written after 0004 carries one; the backlog
does not and never will. Restricting on `reason_code = ''` as well keeps the
statement idempotent.

Why `dropped` and not a new status value: the status vocabulary is a contract
shared with the console and `GET /library?status=` (`ingest/reasons.py`). Adding
a sixth value would change that contract for one historical batch. `dropped`
plus an explicit `legacy_pre_ledger` reason says the same thing inside the
existing vocabulary, and it lets `library-prune` retire the rows on the normal
retention schedule instead of keeping them forever.
"""

from __future__ import annotations

from alembic import op

revision = "0005_legacy_collected_rows"
down_revision = "0004_ingest_catalog_and_ledger"
branch_labels = None
depends_on = None

REASON = "legacy_pre_ledger"
TEXT = "账本上线前的采集记录，旧流程已处理，没有决策轨迹"


def upgrade() -> None:
    op.execute(
        "update raw_items set status = 'dropped', stage = 'fetch', "
        f"reason_code = '{REASON}', reason_text = '{TEXT}' "
        "where run_id is null and status = 'pending' and reason_code = ''"
    )


def downgrade() -> None:
    # The column default is restored, not the old rows: "pending" was never a
    # fact about them, only an unset column.
    op.execute(
        "update raw_items set status = 'pending', stage = 'fetch', "
        "reason_code = '', reason_text = '' "
        f"where run_id is null and reason_code = '{REASON}'"
    )
