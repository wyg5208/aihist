import { ERAS, eraFor } from "../lib/eras";
import type { Era } from "../lib/eras";

export type EraBriefVariant = "editorial" | "aurora" | "museum";

/**
 * The era card the archive opened with: the band a year belongs to, its span,
 * and the paragraph that explains what was happening. The year heading keeps
 * the one-line title; this rail is where the paragraph still lives.
 */
export function eraSpan(era: Era): string {
  const index = ERAS.findIndex((entry) => entry.from === era.from);
  if (index <= 0) return `${era.from} 年至今`;
  const upper = ERAS[index - 1].from - 1;
  return upper > era.from ? `${era.from}—${upper}` : `${era.from} 年`;
}

const LABEL: Record<EraBriefVariant, string> = {
  editorial: "font-mono text-[11px] font-bold uppercase tracking-[0.18em]",
  aurora: "font-mono text-[11px] font-bold uppercase tracking-[0.18em]",
  museum: "font-serif text-[16px] tracking-[0.02em]",
};

export function EraBrief({
  year,
  variant,
}: {
  year: number;
  variant: EraBriefVariant;
}) {
  const era = eraFor(year);
  const heading = era.kind === "winter" ? "低谷期" : "时代摘要";

  const shell =
    variant === "aurora"
      ? "au-cell p-4"
      : variant === "museum"
        ? "rounded-[8px] border border-[var(--rule)] bg-[#fffdf7] overflow-hidden"
        : "border border-[var(--rule)] border-t-[3px] border-t-[var(--ink)] bg-[var(--surface)]";

  const head =
    variant === "aurora"
      ? "flex items-baseline justify-between gap-3"
      : "flex items-baseline justify-between gap-3 border-b border-[var(--rule)] px-4 py-3";

  const body = variant === "aurora" ? "mt-2.5" : "px-4 py-4";

  return (
    <aside className={shell} aria-label="时代摘要">
      <div className={head}>
        <h2
          className={`${LABEL[variant]} ${
            era.kind === "winter" ? "text-[var(--muted)]" : "text-[var(--accent-mark)]"
          }`}
        >
          {heading}
        </h2>
        <span className="shrink-0 font-mono text-[11px] tabular-nums tracking-[0.08em] text-[var(--muted)]">
          {eraSpan(era)}
        </span>
      </div>

      <div className={body}>
        <p
          className={
            variant === "aurora"
              ? "text-[15px] font-semibold leading-[1.5] text-[var(--ink)]"
              : "font-serif text-[18.5px] leading-[1.45] text-[var(--ink)]"
          }
        >
          {era.title}
        </p>
        <p
          className={`mt-2 text-[12.8px] leading-[1.9] text-[var(--ink-soft)] ${
            era.kind === "winter" ? "border-l-2 border-dashed border-[var(--rule-strong)] pl-3" : ""
          }`}
        >
          {era.text}
        </p>
        <p className="mt-3 border-t border-dashed border-[var(--rule)] pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--muted)]">
          当前年份 · {year}
        </p>
      </div>
    </aside>
  );
}

/** Narrow screens have no rail, so each year carries the paragraph collapsed. */
export function EraNote({ year }: { year: number }) {
  const era = eraFor(year);

  return (
    <details className="group mt-2 lg:hidden">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent-mark)]">
          时代特征
        </span>
        <span className="truncate font-mono text-[11px] text-[var(--muted)]">
          {eraSpan(era)} · {era.title}
        </span>
        <span
          aria-hidden="true"
          className="ml-auto shrink-0 font-mono text-[13px] text-[var(--muted)] transition-transform group-open:rotate-45"
        >
          ＋
        </span>
      </summary>
      <p className="mt-2 border-l-2 border-[var(--rule-strong)] pl-3 text-[12.5px] leading-[1.9] text-[var(--ink-soft)]">
        {era.text}
      </p>
    </details>
  );
}
