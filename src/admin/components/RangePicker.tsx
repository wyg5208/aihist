/**
 * The date-window control. Every page that shows a time series uses the same
 * seven choices, so a reader learns the control once and the pages stay
 * comparable — "近 7 日" means the same thing on Overview and in Traffic.
 */

export const RANGE_OPTIONS = [1, 7, 14, 30, 90] as const;

export interface RangePickerProps {
  value: number;
  onChange: (days: number) => void;
  options?: readonly number[];
  /** Right-hand caption, e.g. the definition of the metric below. */
  hint?: string;
}

export function RangePicker({
  value,
  onChange,
  options = RANGE_OPTIONS,
  hint,
}: RangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="时间范围"
        className="inline-flex overflow-hidden rounded-[var(--c-radius)] border border-[var(--c-line)]"
      >
        {options.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onChange(days)}
            aria-pressed={days === value}
            className={`px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] transition-colors ${
              days === value
                ? "bg-[var(--c-surface-2)] text-[var(--c-text)]"
                : "text-[var(--c-text-mute)] hover:text-[var(--c-text-dim)]"
            }`}
          >
            {days === 1 ? "今日" : `近${days}日`}
          </button>
        ))}
      </div>
      {hint && <span className="text-[10px] text-[var(--c-text-mute)]">{hint}</span>}
    </div>
  );
}
