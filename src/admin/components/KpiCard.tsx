import type { ReactNode } from "react";
import { Sparkline } from "./charts";

/**
 * One number, its definition, and optionally a trend.
 *
 * The `hint` is not decoration: PV, UV, 入档率 and 抓取量 each have exactly one
 * meaning in this console (`repo_ops`), and the card is where that meaning is
 * stated so nobody has to go read the code to interpret a number.
 */

export interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  delta?: { text: string; tone: "up" | "down" | "flat" };
  spark?: number[];
  href?: string;
  footer?: ReactNode;
}

const DELTA_TONE = {
  up: "text-[var(--c-ok)]",
  down: "text-[var(--c-danger)]",
  flat: "text-[var(--c-text-mute)]",
} as const;

export function KpiCard({
  label,
  value,
  unit,
  hint,
  delta,
  spark,
  href,
  footer,
}: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">{label}</span>
        {delta && (
          <span className={`num text-[10px] ${DELTA_TONE[delta.tone]}`}>{delta.text}</span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="num text-[26px] leading-none text-[var(--c-text)]">{value}</span>
        {unit && <span className="text-[11px] text-[var(--c-text-mute)]">{unit}</span>}
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-2 opacity-70">
          <Sparkline values={spark} height={26} />
        </div>
      )}
      {hint && <p className="mt-2 text-[10px] leading-4 text-[var(--c-text-mute)]">{hint}</p>}
      {footer}
    </>
  );

  const shell =
    "block rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3.5 py-3 transition-colors";

  if (href) {
    return (
      <a href={href} className={`${shell} hover:border-[var(--c-line-strong)]`}>
        {body}
      </a>
    );
  }
  return <div className={shell}>{body}</div>;
}
