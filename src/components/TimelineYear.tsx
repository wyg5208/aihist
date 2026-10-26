import type { TimelineItem } from "../types";
import { eraFor } from "../lib/eras";
import { EventRow } from "./EventRow";

interface Props {
  year: number;
  items: TimelineItem[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onKeyword?: (keyword: string) => void;
}

export function TimelineYear({ year, items, expandedId, onToggle, onKeyword }: Props) {
  const era = eraFor(year);

  return (
    <section
      id={`year-${year}`}
      data-year={year}
      className="year-section mt-10 first:mt-6"
      aria-labelledby={`year-heading-${year}`}
    >
      <div className="sticky top-0 z-20 flex items-baseline justify-between gap-4 border-b border-[var(--ink)] bg-[var(--paper)] px-0.5 py-2">
        <h2
          id={`year-heading-${year}`}
          className="flex items-baseline gap-2 font-serif text-[1.7rem] leading-none tracking-[-0.02em] text-[var(--ink)]"
        >
          {year}
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-[var(--muted)]">
            {items.length} 条
          </span>
        </h2>
        <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
          {era.kind === "winter" ? `低谷 · ${era.title}` : era.title}
        </p>
      </div>

      <div>
        {items.map((item) => (
          <EventRow
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={onToggle}
            onKeyword={onKeyword}
          />
        ))}
      </div>
    </section>
  );
}
