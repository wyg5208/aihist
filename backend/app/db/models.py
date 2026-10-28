"""SQLAlchemy models: the five editorial tables plus the admin console tables.

Dates are stored as text on purpose: curated seeds carry month-level precision
(`1950-10`) which a `date` column would silently coerce to the first day.

Uniqueness is expressed as named `Index(..., unique=True)` rather than
`unique=True` on the column, because SQLite hides column-level UNIQUE
constraints behind `sqlite_autoindex_*` names. Named indexes survive the
`test_sqlite_schema.py::test_migration_and_models_agree` comparison, which is
the only thing keeping the migration and these models in lockstep.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# PostgreSQL native types with a SQLite fallback so the test suite runs without
# a database server while production keeps array/JSONB semantics.
StringList = ARRAY(String).with_variant(JSON, "sqlite")
JSONDoc = JSONB().with_variant(JSON, "sqlite")

STATE_ID = "global"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    slug: Mapped[str | None] = mapped_column(String(120), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    event_date: Mapped[str] = mapped_column(String(20), nullable=False)
    date_precision: Mapped[str] = mapped_column(String(10), nullable=False, default="day")
    sort_date: Mapped[str] = mapped_column(String(10), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    title_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="excerpt")
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    organization: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    importance: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    confidence: Mapped[str] = mapped_column(String(12), nullable=False, default="single")
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_families: Mapped[list] = mapped_column(StringList, nullable=False, default=list)
    sources: Mapped[list] = mapped_column(JSONDoc, nullable=False, default=list)
    tags: Mapped[list] = mapped_column(StringList, nullable=False, default=list)
    meta: Mapped[dict] = mapped_column(JSONDoc, nullable=False, default=dict)
    origin: Mapped[str] = mapped_column(String(12), nullable=False, default="auto")
    editorial_status: Mapped[str | None] = mapped_column(String(12), nullable=True)
    editorial_review: Mapped[dict | None] = mapped_column(JSONDoc, nullable=True)
    # Operator-only memo (why a row was admitted or retracted by hand). Never
    # part of the public payload: `schemas/event.py` does not read this column.
    ops_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    __table_args__ = (
        Index("ux_events_fingerprint", "fingerprint", unique=True),
        Index(
            "ux_events_slug",
            "slug",
            unique=True,
            postgresql_where=text("slug IS NOT NULL"),
            sqlite_where=text("slug IS NOT NULL"),
        ),
        Index("ix_events_timeline", "sort_date", "importance"),
        Index("ix_events_year", "year"),
        Index("ix_events_category", "category"),
        Index("ix_events_confidence", "confidence"),
        Index("ix_events_editorial_status", "editorial_status"),
        Index("ix_events_origin", "origin"),
    )


class RawItem(Base):
    """One collected entry, with its current disposition.

    The row is keyed by `fingerprint` = sha256(sourceName|externalId), which is
    frozen: changing it would duplicate the whole table on upgrade. The columns
    added by 0004 turn a write-only staging table into the collection ledger —
    `status`/`stage`/`reason_*` say where the item stands *now*, while the
    append-only `collect_verdicts` table keeps how it got there.
    """

    __tablename__ = "raw_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    source_family: Mapped[str] = mapped_column(String(20), nullable=False, default="official")
    source_name: Mapped[str] = mapped_column(Text, nullable=False, default="Unknown")
    external_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    published_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONDoc, nullable=False, default=dict)
    # Kept as "first time we ever fetched it", so the ledger's first_seen_at and
    # this column agree on rows that predate 0004.
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    # ----- ledger state (0004) ----------------------------------------------
    source_key: Mapped[str] = mapped_column(
        String(48), nullable=False, default="", server_default=""
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default="pending", server_default="pending"
    )
    stage: Mapped[str] = mapped_column(
        String(16), nullable=False, default="fetch", server_default="fetch"
    )
    reason_code: Mapped[str] = mapped_column(
        String(40), nullable=False, default="", server_default=""
    )
    reason_text: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    score: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    event_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    seen_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ux_raw_items_fingerprint", "fingerprint", unique=True),
        Index("ix_raw_items_fetched_at", "fetched_at"),
        Index("ix_raw_items_family", "source_family"),
        Index("ix_raw_items_status_seen", "status", "last_seen_at"),
        Index("ix_raw_items_source_seen", "source_key", "last_seen_at"),
        Index("ix_raw_items_event_fp", "event_fingerprint"),
        Index("ix_raw_items_run", "run_id"),
    )


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    trigger: Mapped[str] = mapped_column(String(12), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="running")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    merged_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_sources: Mapped[list] = mapped_column(StringList, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Counters the pipeline already computes but used to drop on the floor; the
    # console is the only consumer, so the public run contract is unchanged.
    reviewed_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    admitted_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    excluded_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    held_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    panel_configured: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    duration_ms: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    detail: Mapped[dict] = mapped_column(
        JSONDoc, nullable=False, default=dict, server_default=text("'{}'")
    )

    __table_args__ = (Index("ix_sync_runs_started_at", "started_at"),)


class SyncState(Base):
    __tablename__ = "sync_state"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=STATE_ID)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_status: Mapped[str | None] = mapped_column(String(12), nullable=True)
    seed_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class ReviewDecision(Base):
    __tablename__ = "review_decisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    rubric_version: Mapped[str] = mapped_column(String(32), nullable=False)
    decision: Mapped[str] = mapped_column(String(12), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    include_votes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_votes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    votes: Mapped[list] = mapped_column(JSONDoc, nullable=False, default=list)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="policy")
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    decision_source: Mapped[str] = mapped_column(String(12), nullable=False, default="panel")
    run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    __table_args__ = (
        Index("ix_review_decisions_rubric", "rubric_version"),
        Index("ix_review_decisions_decision", "decision"),
    )


# ---------------------------------------------------------------------------
# Admin console tables (migration 0002_admin_console)
#
# Everything below is additive. The five tables above keep their exact shape so
# the public API contract tests and the 158-row curated seed stay valid.
# ---------------------------------------------------------------------------


def _server(value: str) -> str:
    """A literal default that both Postgres and SQLite accept verbatim."""
    return text(value)


class AdminUser(Base):
    """A console account. The env-configured admin is bootstrapped into row one."""

    __tablename__ = "admin_users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(40), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(
        String(12), nullable=False, default="analyst", server_default="analyst"
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=_server("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failed_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (Index("ux_admin_users_username", "username", unique=True),)


class AuditLog(Base):
    """Append-only trail. Rows are inserted, never updated or deleted."""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    actor: Mapped[str] = mapped_column(String(40), nullable=False)
    role: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    target_type: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    target_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    detail: Mapped[dict] = mapped_column(
        JSONDoc, nullable=False, default=dict, server_default=_server("'{}'")
    )
    # sha256(ip + salt): the raw address never reaches the database.
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    __table_args__ = (
        Index("ix_audit_log_at", "at"),
        Index("ix_audit_log_action", "action"),
        Index("ix_audit_log_target", "target_type", "target_id"),
    )


class PageView(Base):
    """One beacon from the SPA. No cookie, no raw IP, no cross-day identity."""

    __tablename__ = "page_views"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    # Pre-truncated to the UTC+8 calendar day so every aggregate is a GROUP BY.
    day: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    page_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    referrer_host: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    channel: Mapped[str] = mapped_column(String(16), nullable=False, default="direct")
    visitor_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    session_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ua_family: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    is_bot: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=_server("false")
    )
    device: Mapped[str] = mapped_column(String(12), nullable=False, default="desktop")
    lang: Mapped[str] = mapped_column(String(16), nullable=False, default="")

    __table_args__ = (
        Index("ix_page_views_day", "day"),
        Index("ix_page_views_visitor", "visitor_hash", "day"),
    )


class CrawlHit(Base):
    """A document request lifted out of the reverse proxy's access log.

    This is the only signal that covers the static reference pages, which are
    deliberately JavaScript-free and therefore cannot carry a beacon.
    """

    __tablename__ = "crawl_hits"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    day: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    ua_family: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    bot_name: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    is_ai: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=_server("false")
    )
    bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        Index("ix_crawl_hits_day", "day"),
        Index("ix_crawl_hits_ai", "is_ai", "day"),
    )


class LogIngestState(Base):
    """Byte offset per log file, so each ingest pass reads only new lines."""

    __tablename__ = "log_ingest_state"

    path: Mapped[str] = mapped_column(String(300), primary_key=True)
    offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class SourceHealth(Base):
    """Per-source liveness, refreshed at the end of every collection run."""

    __tablename__ = "source_health"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    family: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    last_run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    last_ok_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_item_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    total_runs: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    total_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class Subscriber(Base):
    """Mailing list entry. Consent is recorded here; delivery in `digest_sends`."""

    __tablename__ = "subscribers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default="pending", server_default="pending"
    )
    token: Mapped[str] = mapped_column(String(48), nullable=False)
    source_path: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    source_channel: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    consented_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    unsubscribed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ux_subscribers_email", "email", unique=True),
        Index("ux_subscribers_token", "token", unique=True),
    )


class ApiKey(Base):
    """Open-data credential. Only the sha256 digest is stored."""

    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    prefix: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scopes: Mapped[list] = mapped_column(
        JSONDoc, nullable=False, default=lambda: ["read"], server_default=_server("'[\"read\"]'")
    )
    monthly_quota: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1000, server_default="1000"
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=_server("true")
    )
    created_by: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ux_api_keys_key_hash", "key_hash", unique=True),
        Index("ix_api_keys_prefix", "prefix"),
    )


class ApiKeyUsage(Base):
    """One row per key per day. Upserted on every open-API call."""

    __tablename__ = "api_key_usage"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    key_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    day: Mapped[str] = mapped_column(String(10), nullable=False)
    requests: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    __table_args__ = (Index("ux_api_key_usage_key_day", "key_id", "day", unique=True),)


class ApiApplication(Base):
    """A request for an open-data key, decided by a person on the console.

    The row outlives the decision: an approved row points at the key it produced
    (`key_id`), a rejected one keeps the reason in `note`. Nothing is deleted, so
    "why did this address get a key in March" stays answerable after the key
    itself is revoked.

    No token column here on purpose. The only proof the applicant controls the
    address is the approval mail itself, which carries the key's single
    plaintext — there is no confirm link to replay and no second secret to
    store.
    """

    __tablename__ = "api_applications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="")
    site_url: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    monthly_quota: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1000, server_default="1000"
    )
    key_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by: Mapped[str] = mapped_column(String(40), nullable=False, default="")

    __table_args__ = (
        Index("ix_api_applications_status", "status", "created_at"),
        Index("ix_api_applications_email", "email"),
    )


class Partner(Base):
    """Sponsorship ledger. A row here never influences admission or ranking."""

    __tablename__ = "partners"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="sponsor", server_default="sponsor"
    )
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default="prospect", server_default="prospect"
    )
    code: Mapped[str] = mapped_column(String(24), nullable=False)
    target_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    contact: Mapped[str] = mapped_column(Text, nullable=False, default="")
    terms_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    starts_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    ends_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    __table_args__ = (Index("ux_partners_code", "code", unique=True),)


class PartnerClick(Base):
    """A hit on `/go/<code>`. Counted, never joined to a person."""

    __tablename__ = "partner_clicks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    partner_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    day: Mapped[str] = mapped_column(String(10), nullable=False)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    referrer_host: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    ua_family: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    is_bot: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=_server("false")
    )

    __table_args__ = (Index("ix_partner_clicks_partner_day", "partner_id", "day"),)


class DigestSend(Base):
    """One address's copy of one weekly digest (migration 0006_weekly_digest).

    This is the delivery ledger, not the mailing list: `subscribers` says who
    consented, this says what actually left the building. One row per address
    per issue, so the unique index on (`issue`, `email`) is the promise "nobody
    gets the same issue twice" — a re-run updates its row instead of mailing
    again. `status='queued'` is written before the SMTP call and overwritten
    with the answer, which is the only way a run killed mid-list leaves an
    honest trace of who was already mailed.
    """

    __tablename__ = "digest_sends"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # The issue's UTC date (`YYYY-MM-DD`), not the send time: a retry the same
    # day belongs to the same issue, next Monday's does not.
    issue: Mapped[str] = mapped_column(
        String(10), nullable=False, default="", server_default=""
    )
    subscriber_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    # Snapshot of the address at send time: the row must still explain itself
    # if the subscriber row is ever corrected in place.
    email: Mapped[str] = mapped_column(
        String(254), nullable=False, default="", server_default=""
    )
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default="queued", server_default="queued"
    )
    # `smtp_not_configured` / `smtp_failed`, or empty when it went out.
    error: Mapped[str] = mapped_column(
        String(64), nullable=False, default="", server_default=""
    )
    item_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    __table_args__ = (
        Index("ux_digest_sends_issue_email", "issue", "email", unique=True),
        Index("ix_digest_sends_at", "at"),
    )


# ---------------------------------------------------------------------------
# Collection ledger tables (migration 0004_ingest_catalog_and_ledger)
#
# `ingest_sources` is both the registry and the configuration: adding a feed is
# an INSERT, not a release. `collect_verdicts` is the append-only trail that
# explains every row of `raw_items` — it is inserted into and never updated, so
# a re-decision reads as a second line rather than an overwrite.
# ---------------------------------------------------------------------------


class IngestSource(Base):
    """One configured source. Also the allow-list for redirect hosts."""

    __tablename__ = "ingest_sources"

    key: Mapped[str] = mapped_column(String(48), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    family: Mapped[str] = mapped_column(String(20), nullable=False, default="official")
    kind: Mapped[str] = mapped_column(String(12), nullable=False, default="feed")
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    path_pattern: Mapped[str] = mapped_column(
        String(80), nullable=False, default="/news/", server_default="/news/"
    )
    domestic: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=_server("false")
    )
    ai_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=_server("false")
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=_server("true")
    )
    # Ordering and human reading only. Never participates in scoring.
    weight: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )
    timeout_ms: Mapped[int] = mapped_column(
        Integer, nullable=False, default=12000, server_default="12000"
    )
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # NULL means "never probed"; enabling requires a non-null value.
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    __table_args__ = (
        Index("ix_ingest_sources_family", "family"),
        Index("ix_ingest_sources_enabled", "enabled"),
    )


class CollectVerdict(Base):
    """Append-only decision trail for one collected item.

    `item_fingerprint` points at `raw_items.fingerprint`; `event_fingerprint`
    bridges to `review_decisions.id` / `events.fingerprint` so the console can
    join the five-judge vote straight onto the collected item.
    """

    __tablename__ = "collect_verdicts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    item_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="fetch")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    reason_code: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    reason_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    score: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    event_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    __table_args__ = (
        Index("ix_collect_verdicts_item", "item_fingerprint", "at"),
        Index("ix_collect_verdicts_at", "at"),
        Index("ix_collect_verdicts_run", "run_id"),
        Index("ix_collect_verdicts_status", "status", "at"),
    )
