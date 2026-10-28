"""Serialisers for the collection library (read-only audit surface).

Every label comes from `app.ingest.reasons`, the same module the pipeline uses to
write the codes. That is deliberate: a label typed twice drifts, and the whole
point of the library is that the console can explain a verdict without
re-deriving the rules.
"""

from __future__ import annotations

from typing import Any

from app.ingest import reasons
from app.schemas.admin import timestamp


def _event_link(link: dict[str, Any] | None) -> dict[str, Any]:
    if not link:
        return {"eventId": None, "eventSlug": None, "eventTitle": None}
    return {
        "eventId": link.get("id"),
        "eventSlug": link.get("slug"),
        "eventTitle": link.get("title"),
    }


def library_item_record(row: Any, event: dict[str, Any] | None = None) -> dict[str, Any]:
    """One `raw_items` row as the console sees it.

    `reasonLabel` is resolved here rather than in the browser so the API stays
    the single place that knows the vocabulary version.
    """
    code = str(getattr(row, "reason_code", "") or "")
    return {
        "id": str(row.id),
        "sourceKey": str(getattr(row, "source_key", "") or ""),
        "sourceName": row.source_name or "",
        "sourceFamily": row.source_family or "",
        "externalId": row.external_id or "",
        "title": row.title or "",
        "url": row.url or "",
        "publishedAt": row.published_at,
        "fetchedAt": timestamp(getattr(row, "fetched_at", None)),
        "firstSeenAt": timestamp(getattr(row, "first_seen_at", None)),
        "lastSeenAt": timestamp(getattr(row, "last_seen_at", None)),
        "seenCount": int(getattr(row, "seen_count", 1) or 0),
        "status": str(getattr(row, "status", "") or "pending"),
        "stage": str(getattr(row, "stage", "") or ""),
        "reasonCode": code,
        "reasonLabel": reasons.label_of(code) if code else "",
        "reasonText": str(getattr(row, "reason_text", "") or ""),
        "score": int(getattr(row, "score", 0) or 0),
        "decidedAt": timestamp(getattr(row, "decided_at", None)),
        "eventFingerprint": getattr(row, "event_fingerprint", None),
        "runId": str(row.run_id) if getattr(row, "run_id", None) else None,
        **_event_link(event),
    }


def verdict_record(row: Any) -> dict[str, Any]:
    code = str(row.reason_code or "")
    return {
        "id": str(row.id),
        "at": timestamp(row.at),
        "runId": str(row.run_id) if row.run_id else None,
        "stage": row.stage or "",
        "status": row.status or "",
        "reasonCode": code,
        "reasonLabel": reasons.label_of(code) if code else "",
        "reasonText": row.reason_text or "",
        "score": int(row.score or 0),
        "eventFingerprint": row.event_fingerprint,
    }


def review_record(row: Any) -> dict[str, Any] | None:
    """The panel ballot behind a decision, shaped like `Editorial.tsx` expects.

    `votes` is passed through untouched: the five seats, their models, their
    scores and their reasons are the evidence the library exists to show.
    """
    if row is None:
        return None
    return {
        "rubricVersion": row.rubric_version or "",
        "decision": row.decision or "",
        "score": int(row.score or 0),
        "includeVotes": int(row.include_votes or 0),
        "validVotes": int(row.valid_votes or 0),
        "sourceCount": int(getattr(row, "source_count", 0) or 0),
        "decisionSource": getattr(row, "decision_source", "") or "",
        "votes": list(row.votes) if isinstance(row.votes, list) else [],
        "at": timestamp(row.decided_at),
    }


def event_record(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": str(row.id),
        "slug": row.slug,
        "title": row.title,
        "category": row.category,
        "editorialStatus": row.editorial_status,
        "eventDate": row.event_date,
    }


def reason_option(code: str, count: int) -> dict[str, Any]:
    return {
        "code": code,
        "label": reasons.label_of(code),
        "stage": reasons.stage_of(code),
        "count": int(count),
    }
