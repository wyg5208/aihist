import { formatCount } from "../format";

/**
 * Page arithmetic and nothing else.
 *
 * The window is five buttons wide and shifts to keep the current page inside it;
 * with 148 rows and 25 per page that is six pages today, but the seed will keep
 * growing and a row of 200 buttons is not a control.
 */

export interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, size, total, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / Math.max(size, 1)));
  const current = Math.min(Math.max(page, 1), pages);
  const start = Math.max(1, Math.min(current - 2, pages - 4));
  const window = Array.from({ length: Math.min(5, pages) }, (_, index) => start + index);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--c-line)] px-3 py-2">
      <p className="num text-[10px] text-[var(--c-text-mute)]">
        {formatCount(from)}–{formatCount(to)} / {formatCount(total)}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(current - 1)}
          disabled={current <= 1}
          className="rounded-[var(--c-radius)] border border-[var(--c-line)] px-2 py-1 font-mono text-[10px] text-[var(--c-text-dim)] disabled:opacity-35 hover:enabled:border-[var(--c-line-strong)]"
        >
          上一页
        </button>
        {window.map((index) => (
          <button
            key={index}
            type="button"
            onClick={() => onChange(index)}
            aria-current={index === current ? "page" : undefined}
            className={`num rounded-[var(--c-radius)] border px-2 py-1 text-[10px] ${
              index === current
                ? "border-[var(--c-accent)] text-[var(--c-accent)]"
                : "border-[var(--c-line)] text-[var(--c-text-dim)] hover:border-[var(--c-line-strong)]"
            }`}
          >
            {index}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(current + 1)}
          disabled={current >= pages}
          className="rounded-[var(--c-radius)] border border-[var(--c-line)] px-2 py-1 font-mono text-[10px] text-[var(--c-text-dim)] disabled:opacity-35 hover:enabled:border-[var(--c-line-strong)]"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
