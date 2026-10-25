"""Wire contract for the public API.

Field names are camelCase and match `src/types.ts` one for one. The mapping is
explicit rather than automatic: `source_families → sourceFamilies` is the only
regular case, and a generic snake→camel converter would mangle `title_en →
titleEn` versus `titleEN` inconsistently.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.keywords import keywords_for
from app.domain.taxonomy import series_for, vendor_for

Category = Literal["milestone", "model", "research", "opinion", "policy"]
Confidence = Literal["verified", "likely", "single"]
DatePrecision = Literal["year", "month", "day"]
EditorialStatus = Literal["admitted", "excluded", "hold"]


def iso(value: Any) -> str | None:
    """Render a timestamp the way the previous deployment did (ms + `Z`)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        from app.domain.text import format_iso

        return format_iso(value)
    return str(value)


class SyncSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    last_success_at: str | None = Field(default=None, alias="lastSuccessAt")
    last_attempt_at: str | None = Field(default=None, alias="lastAttemptAt")
    last_status: str | None = Field(default=None, alias="lastStatus")
    running: bool = False
    stale: bool = True
    seed_version: str | None = Field(default=None, alias="seedVersion")
    event_count: int | None = Field(default=None, alias="eventCount")


class TimelineItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    slug: str | None = None
    event_date: str = Field(alias="eventDate")
    date_precision: str = Field(alias="datePrecision")
    sort_date: str = Field(alias="sortDate")
    year: int
    title: str
    title_en: str | None = Field(default=None, alias="titleEn")
    category: str
    organization: str | None = None
    model_name: str | None = Field(default=None, alias="modelName")
    vendor: str | None = None
    series: str | None = None
    importance: int
    confidence: str
    source_count: int = Field(alias="sourceCount")
    source_families: list[str] = Field(alias="sourceFamilies")
    tags: list[str]
    origin: str
    editorial_status: str | None = Field(default=None, alias="editorialStatus")
    first_seen_at: str = Field(alias="firstSeenAt")
    updated_at: str = Field(alias="updatedAt")


class EvidenceSource(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    family: str = ""
    title: str = ""
    url: str = ""
    published_at: str | None = Field(default=None, alias="publishedAt")
    external_id: str | None = Field(default=None, alias="externalId")


class EditorialVote(BaseModel):
    model_config = ConfigDict(extra="allow")

    judge: int | str
    model: str = ""
    score: int = 0
    vote: str = "exclude"
    flags: list[str] = Field(default_factory=list)
    reason: str = ""


class EditorialReview(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: str = ""
    source: str = ""
    decision: str = "hold"
    score: int = 0
    include_votes: int = Field(default=0, alias="includeVotes")
    valid_votes: int = Field(default=0, alias="validVotes")
    votes: list[EditorialVote] = Field(default_factory=list)
    at: str | None = None


class EventDetail(TimelineItem):
    fingerprint: str
    summary: str = ""
    summary_kind: str = Field(default="excerpt", alias="summaryKind")
    sources: list[dict[str, Any]] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    editorial_review: EditorialReview | None = Field(default=None, alias="editorialReview")


class TimelineResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ok: bool = True
    items: list[TimelineItem]
    total: int
    truncated: bool
    sync: SyncSummary


class EventResponse(BaseModel):
    ok: bool = True
    event: EventDetail


class RunRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    trigger: str
    status: str
    started_at: str = Field(alias="startedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")
    raw_count: int = Field(alias="rawCount")
    created_count: int = Field(alias="createdCount")
    merged_count: int = Field(alias="mergedCount")
    failed_sources: list[str] = Field(alias="failedSources")
    notes: str | None = None


class PanelInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    configured: bool
    models: list[str]
    reason: str | None = None
    rubric_version: str = Field(alias="rubricVersion")
    include_score: int = Field(alias="includeScore")
    min_votes: int = Field(alias="minVotes")


class StatusResponse(BaseModel):
    ok: bool = True
    sync: SyncSummary
    panel: PanelInfo
    runs: list[RunRecord]


class StandardResponse(BaseModel):
    ok: bool = True
    standard: dict[str, Any]


def timeline_item(row: Any, *, with_summary: bool = False) -> dict[str, Any]:
    tags = keywords_for(
        {
            "tags": row.tags,
            "title": row.title,
            "titleEn": row.title_en,
            "summary": row.summary if with_summary else None,
            "organization": row.organization,
            "modelName": row.model_name,
            "category": row.category,
        }
    )
    entry = {
        "category": row.category,
        "organization": row.organization,
        "modelName": row.model_name,
        "title": row.title,
        "titleEn": row.title_en,
        "tags": row.tags,
    }
    return {
        "id": str(row.id),
        "slug": row.slug or None,
        "eventDate": row.event_date,
        "datePrecision": row.date_precision,
        "sortDate": row.sort_date,
        "year": row.year,
        "title": row.title,
        "titleEn": row.title_en or None,
        "category": row.category,
        "organization": row.organization or None,
        "modelName": row.model_name or None,
        "vendor": vendor_for(entry),
        "series": series_for(entry),
        "importance": row.importance,
        "confidence": row.confidence,
        "sourceCount": row.source_count,
        "sourceFamilies": list(row.source_families) if isinstance(row.source_families, list) else [],
        "tags": tags,
        "origin": row.origin,
        "editorialStatus": row.editorial_status or None,
        "firstSeenAt": iso(row.first_seen_at),
        "updatedAt": iso(row.updated_at),
    }


def event_detail(row: Any) -> dict[str, Any]:
    payload = timeline_item(row, with_summary=True)
    payload.update(
        {
            "fingerprint": row.fingerprint,
            "summary": row.summary,
            "summaryKind": row.summary_kind,
            "sources": list(row.sources) if isinstance(row.sources, list) else [],
            "meta": row.meta if isinstance(row.meta, dict) else {},
            "editorialStatus": row.editorial_status or None,
            "editorialReview": row.editorial_review
            if isinstance(row.editorial_review, dict)
            else None,
        }
    )
    return payload


def run_record(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "trigger": row.trigger,
        "status": row.status,
        "startedAt": iso(row.started_at),
        "finishedAt": iso(row.finished_at),
        "rawCount": row.raw_count or 0,
        "createdCount": row.created_count or 0,
        "mergedCount": row.merged_count or 0,
        "failedSources": list(row.failed_sources) if isinstance(row.failed_sources, list) else [],
        "notes": row.notes or None,
    }
