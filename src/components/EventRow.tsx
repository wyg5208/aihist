import { useCallback, useEffect, useState } from "react";
import type { EventDetail as Detail, TimelineItem } from "../types";
import { ApiError, fetchEvent } from "../api";
import { CATEGORY_META, formatRowDate } from "../lib/format";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { EventDetail } from "./EventDetail";

interface Props {
  item: TimelineItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onKeyword?: (keyword: string) => void;
}

const MARKER_CLASS: Record<string, string> = {
  milestone: "border-[var(--accent)] bg-[var(--accent)]",
  model: "border-[var(--ink)] bg-[var(--ink)]",
  research: "border-[var(--ink)] bg-[var(--paper)]",
  opinion: "border-[var(--rule-strong)] bg-[var(--paper)] rounded-full",
  policy: "border-[var(--rule-strong)] bg-[var(--paper)]",
};

export function EventRow({ item, expanded, onToggle, onKeyword }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchEvent(item.id, signal);
        if (signal?.aborted) return;
        setDetail(data.event);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof ApiError ? err.code : "unknown");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [item.id]
  );

  useEffect(() => {
    if (!expanded || detail) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [expanded, detail, load]);

  const meta = CATEGORY_META[item.category] || CATEGORY_META.milestone;
  const detailId = `entry-detail-${item.id}`;

  return (
    <article
      id={`entry-${item.slug || item.id}`}
      className="entry-row relative border-b border-[var(--rule)]"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => onToggle(item.id)}
        className="grid w-full grid-cols-[2.7rem_0.9rem_minmax(0,1fr)] items-start gap-x-2 py-3.5 text-left sm:grid-cols-[5.2rem_1rem_minmax(0,1fr)] sm:gap-x-3 sm:py-4"
      >
        <span className="pt-0.5 font-mono text-[10px] leading-5 tracking-[0.04em] text-[var(--muted)] tabular-nums sm:text-[11px]">
          {formatRowDate(item.eventDate, item.datePrecision)}
        </span>

        <span className="relative flex h-full min-h-6 justify-center" aria-hidden="true">
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--rule)]" />
          <span
            className={`relative mt-1.5 h-[7px] w-[7px] rotate-45 border ${
              MARKER_CLASS[item.category] || MARKER_CLASS.milestone
            }`}
          />
        </span>

        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
                item.category === "milestone" ? "text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
            >
              <span aria-hidden="true" className="mr-1">
                {meta.mark}
              </span>
              {meta.label}
            </span>
            <span className="ml-auto">
              <ConfidenceBadge confidence={item.confidence} />
            </span>
          </span>

          <span className="entry-title mt-1 block font-serif text-[15.5px] leading-[1.4] text-[var(--ink)] sm:text-[17px]">
            {item.title}
          </span>

          {item.titleEn && item.titleEn !== item.title && (
            <span className="mt-0.5 block font-sans text-[11px] leading-4 text-[var(--muted)]">
              {item.titleEn}
            </span>
          )}

          <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[9.5px] tracking-[0.03em] text-[var(--muted)]">
            {item.organization && <span>{item.organization}</span>}
            {item.modelName && item.modelName !== item.organization && (
              <span>· {item.modelName}</span>
            )}
            <span>· {item.sourceCount} 条证据</span>
            {item.tags?.length > 0 && (
              <span className="row-keywords">· {item.tags.slice(0, 3).join(" / ")}</span>
            )}
            <span className="text-[var(--ink-soft)]" aria-hidden="true">
              {expanded ? "−" : "+"}
            </span>
          </span>
        </span>
      </button>

      {expanded && (
        <div
          id={detailId}
          className="ml-[3.6rem] border-t border-dashed border-[var(--rule)] pt-3 sm:ml-[6.2rem]"
        >
          <EventDetail
            detail={detail}
            loading={loading}
            error={error}
            onRetry={() => load()}
            onKeyword={onKeyword}
          />
        </div>
      )}
    </article>
  );
}
