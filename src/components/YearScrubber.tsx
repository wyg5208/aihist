interface Props {
  years: { year: number; count: number }[];
  activeYear: number | null;
  onJump: (year: number) => void;
}

export function YearScrubber({ years, activeYear, onJump }: Props) {
  return (
    <nav aria-label="年份快速跳转" className="mt-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
          年份索引
        </span>
        <span className="font-mono text-[9px] tracking-[0.08em] text-[var(--muted)]">
          {years.length ? `${years[years.length - 1].year} → ${years[0].year}` : "—"}
        </span>
      </div>
      <div className="scrubber mt-1.5 border-y border-[var(--rule)] py-1">
        {years.map((entry) => (
          <button
            key={entry.year}
            type="button"
            data-active={activeYear === entry.year}
            data-empty={entry.count === 0}
            aria-current={activeYear === entry.year ? "true" : undefined}
            onClick={() => onJump(entry.year)}
          >
            {entry.year}
          </button>
        ))}
        {years.length === 0 && (
          <span className="py-1 font-mono text-[10px] text-[var(--muted)]">暂无年份</span>
        )}
      </div>
    </nav>
  );
}
