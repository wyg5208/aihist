"""The collection ledger: one place that knows where every item went.

The pipeline has always thrown items away — in `normalize` (silent `continue`),
in `interleave_candidates` (the raw cap), in `cluster_candidates` (`should_keep`),
in the two batch caps. Individually defensible, together unauditable: "why is
this story missing" had no answer short of re-running the pipeline by hand.

This module is deliberately dumb. It accumulates rows, and the pipeline decides
what to persist. Two properties matter:

* **Current state is keyed by item fingerprint** (the same sha256 the raw table
  uses), so a second sighting updates one row instead of adding a second.
* **The trail only records changes.** `verdict_rows()` emits a line when an item
  first arrives and whenever its (status, stage, reason) tuple moves. A feed
  that re-serves the same twenty items every day would otherwise write twenty
  duplicate lines a day per item.
"""

from __future__ import annotations

import hashlib
import uuid
from collections import Counter
from datetime import datetime
from typing import Any

from app.ingest import reasons


def fingerprint_of_item(source_name: object, external_id: object) -> str:
    """sha256(sourceName|externalId) — identical to `pipeline.raw_rows`.

    Frozen on purpose: `raw_items.fingerprint` has a unique index, and a new
    formula would duplicate the table on the first run after the upgrade.
    """
    name = source_name if isinstance(source_name, str) else ""
    ident = external_id if isinstance(external_id, str) else str(external_id or "")
    return hashlib.sha256(f"{name}|{ident}".encode("utf-8")).hexdigest()


def evidence_identity(evidence: dict[str, Any]) -> tuple[str, str]:
    """The (sourceName, externalId) pair a fingerprint is built from.

    Clustering rewrites evidence: `merge_sources` renames `sourceName` to `name`
    and drops the original key so two producers cannot disagree. The ledger sees
    both shapes — the intake rows come from normalize candidates, the verdicts
    from finalized ones — so the lookup has to resolve the same identity from
    either, or a verdict silently lands on no row at all.
    """
    name = evidence.get("sourceName") or evidence.get("name") or ""
    ident = evidence.get("externalId") or evidence.get("url") or ""
    return str(name), str(ident)


def human_summary(outcome: dict[str, Any]) -> str:
    """One line an operator can read without opening the vote table."""
    parts: list[str] = []
    include = outcome.get("includeVotes")
    valid = outcome.get("validVotes")
    if isinstance(include, int) and isinstance(valid, int) and valid:
        parts.append(f"{include}/{valid} 同意")
    score = outcome.get("score")
    if isinstance(score, int):
        parts.append(f"均分 {score}")
    flags: list[str] = []
    for vote in outcome.get("votes") or []:
        if not isinstance(vote, dict) or vote.get("vote") != "exclude":
            continue
        for reason in [*(vote.get("flags") or []), vote.get("reason") or ""]:
            label = reasons.label_of(f"rule:{reason}")
            text = label if label != f"rule:{reason}" else str(reason)
            if text and text not in flags:
                flags.append(text)
    if flags:
        parts.append("反对：" + "、".join(flags[:4]))
    return " · ".join(parts)


class Ledger:
    """Accumulates the current disposition of this run's items plus its trail."""

    def __init__(self, *, run_id: uuid.UUID | None, now: datetime) -> None:
        self.run_id = run_id
        self.now = now
        # fingerprint -> row (last write wins; `seen_count` is bumped in SQL)
        self.pending: dict[str, dict[str, Any]] = {}
        # fingerprint -> (status, stage, reason_code) of the last recorded line
        self._marks: dict[str, tuple[str, str, str]] = {}
        self.trail: list[dict[str, Any]] = []
        # Coarse run-level numbers that are not item rows.
        self.stats: dict[str, int] = {}

    # ----- counters ---------------------------------------------------------
    def bump(self, key: str, amount: int = 1) -> None:
        self.stats[key] = self.stats.get(key, 0) + amount

    # ----- rows -------------------------------------------------------------
    def _row(
        self,
        *,
        fingerprint: str,
        source_key: str,
        source_name: str,
        source_family: str,
        external_id: str,
        title: str,
        url: str,
        published_at: str | None,
        status: str,
        stage: str,
        reason_code: str,
        reason_text: str,
        score: int,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "id": uuid.uuid4(),
            "fingerprint": fingerprint,
            "source_family": source_family or "official",
            "source_name": source_name or "Unknown",
            "external_id": external_id,
            "title": (title or "")[:500],
            "url": url or "",
            "published_at": published_at,
            "payload": payload or {},
            "fetched_at": self.now,
            "source_key": source_key,
            "run_id": self.run_id,
            "status": status,
            "stage": stage,
            "reason_code": reason_code,
            "reason_text": reason_text[:2000],
            "score": int(score or 0),
            "event_id": None,
            "event_fingerprint": None,
            "first_seen_at": self.now,
            "last_seen_at": self.now,
            "seen_count": 1,
            "decided_at": None if status == "pending" else self.now,
        }

    def _record(self, row: dict[str, Any]) -> None:
        """Store the current state and, if it changed, append a trail line."""
        fingerprint = row["fingerprint"]
        self.pending[fingerprint] = row
        mark = (row["status"], row["stage"], row["reason_code"])
        if self._marks.get(fingerprint) == mark:
            return
        self._marks[fingerprint] = mark
        self.trail.append(
            {
                "id": uuid.uuid4(),
                "item_fingerprint": fingerprint,
                "run_id": self.run_id,
                "stage": row["stage"],
                "status": row["status"],
                "reason_code": row["reason_code"],
                "reason_text": row["reason_text"],
                "score": row["score"],
                "event_fingerprint": row["event_fingerprint"],
                "at": self.now,
            }
        )

    # ----- public recording API --------------------------------------------
    def note_drop(
        self, drop: dict[str, Any], *, stage: str = "normalize", status: str = "dropped"
    ) -> None:
        """An item that never became a candidate (normalize, cap, cluster)."""
        code = drop.get("reasonCode") or drop.get("reason") or ""
        external_id = drop.get("externalId") or drop.get("url") or drop.get("title") or ""
        source_name = drop.get("sourceName") or ""
        self._record(
            self._row(
                fingerprint=fingerprint_of_item(source_name, external_id),
                source_key=drop.get("sourceKey") or "",
                source_name=source_name,
                source_family=drop.get("sourceFamily") or "",
                external_id=str(external_id),
                title=drop.get("title") or "",
                url=drop.get("url") or "",
                published_at=drop.get("publishedAt"),
                status=status,
                stage=reasons.stage_of(code) or stage,
                reason_code=code,
                reason_text=reasons.label_of(code),
                score=0,
            )
        )

    def note_candidate(
        self,
        candidate: dict[str, Any],
        *,
        stage: str = "cluster",
        status: str = "pending",
        reason_code: str = "",
        reason_text: str = "",
        score: int = 0,
    ) -> None:
        """One row per evidence item of a candidate.

        Evidence, not candidate: that is the grain of the raw table, and it is
        what lets the console link a single article to the event it fed.
        """
        payload = {
            "category": candidate.get("category"),
            "titleEn": candidate.get("titleEn") or None,
            "modelKey": candidate.get("modelKey") or None,
        }
        for evidence in candidate.get("evidence") or []:
            if not isinstance(evidence, dict) or not evidence.get("url"):
                continue
            source_name, external_id = evidence_identity(evidence)
            self._record(
                self._row(
                    fingerprint=fingerprint_of_item(source_name, external_id),
                    source_key=evidence.get("sourceKey") or "",
                    source_name=source_name,
                    source_family=evidence.get("sourceFamily")
                    or evidence.get("family")
                    or "",
                    external_id=str(external_id),
                    title=evidence.get("title") or candidate.get("title") or "",
                    url=evidence["url"],
                    published_at=evidence.get("publishedAt"),
                    status=status,
                    stage=stage,
                    reason_code=reason_code,
                    reason_text=reason_text,
                    score=score,
                    payload=payload,
                )
            )

    def set_verdict(
        self,
        candidate: dict[str, Any],
        *,
        status: str,
        stage: str,
        reason_code: str,
        reason_text: str = "",
        score: int = 0,
        event_fingerprint: str | None = None,
    ) -> None:
        """Final (or interim) disposition for every evidence item of a candidate.

        Items this run never collected are ignored on purpose: re-reviewing an
        old held row must not rewrite the history of a run that did not see it.
        """
        for evidence in candidate.get("evidence") or []:
            if not isinstance(evidence, dict) or not evidence.get("url"):
                continue
            source_name, external_id = evidence_identity(evidence)
            fingerprint = fingerprint_of_item(source_name, external_id)
            row = self.pending.get(fingerprint)
            if row is None:
                continue
            row.update(
                {
                    "status": status,
                    "stage": stage,
                    "reason_code": reason_code,
                    "reason_text": reason_text or reasons.label_of(reason_code),
                    "score": int(score or 0),
                    "event_fingerprint": event_fingerprint
                    or candidate.get("fingerprint"),
                    "last_seen_at": self.now,
                    "decided_at": self.now,
                }
            )
            self._record(row)

    # ----- persistence helpers ---------------------------------------------
    def pending_rows(self) -> list[dict[str, Any]]:
        return list(self.pending.values())

    def verdict_rows(self) -> list[dict[str, Any]]:
        return list(self.trail)

    def funnel(self) -> dict[str, Any]:
        """Where this run's items stand. `parsed` must equal the four buckets."""
        statuses = Counter(row["status"] for row in self.pending.values())
        dropped = Counter(
            row["reason_code"]
            for row in self.pending.values()
            if row["status"] == "dropped"
        )
        funnel: dict[str, Any] = {
            "fetched": self.stats.get("fetched", 0),
            "parsed": len(self.pending),
            "dropped": dict(sorted(dropped.items(), key=lambda kv: (-kv[1], kv[0]))),
            "capped": self.stats.get("capped", 0),
            "clustered": self.stats.get("clustered", 0),
            "clusterDropped": self.stats.get("clusterDropped", 0),
            "deduped": self.stats.get("deduped", 0),
            "reviewed": self.stats.get("reviewed", 0),
            "admitted": statuses.get("admitted", 0),
            "excluded": statuses.get("excluded", 0),
            "held": statuses.get("held", 0),
            "overEventCap": self.stats.get("overEventCap", 0),
            "pending": statuses.get("pending", 0),
        }
        funnel["droppedTotal"] = statuses.get("dropped", 0)
        return funnel

    def verdict_counts(self) -> dict[str, int]:
        """Reason-code histogram for the run row's `detail.verdicts`."""
        counts = Counter(row["reason_code"] for row in self.pending.values() if row["reason_code"])
        return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
