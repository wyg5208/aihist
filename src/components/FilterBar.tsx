import type { Category, Confidence, FilterOption } from "../types";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  CONFIDENCE_META,
  formatCount,
} from "../lib/format";

interface Props {
  query: string;
  category: Category | "all";
  confidence: Confidence | "all";
  keyword: string;
  vendor: string;
  series: string;
  categoryCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  keywordOptions: FilterOption[];
  vendorOptions: FilterOption[];
  seriesOptions: FilterOption[];
  total: number;
  shown: number;
  onQuery: (value: string) => void;
  onCategory: (value: Category | "all") => void;
  onConfidence: (value: Confidence | "all") => void;
  onKeyword: (value: string) => void;
  onVendor: (value: string) => void;
  onSeries: (value: string) => void;
  onClear: () => void;
}

const CONFIDENCES: Confidence[] = ["verified", "likely", "single"];

export function FilterBar({
  query,
  category,
  confidence,
  keyword,
  vendor,
  series,
  categoryCounts,
  confidenceCounts,
  keywordOptions,
  vendorOptions,
  seriesOptions,
  total,
  shown,
  onQuery,
  onCategory,
  onConfidence,
  onKeyword,
  onVendor,
  onSeries,
  onClear,
}: Props) {
  const filtered =
    category !== "all" ||
    confidence !== "all" ||
    keyword !== "all" ||
    vendor !== "all" ||
    series !== "all" ||
    query.trim() !== "";

  return (
    <section aria-label="筛选档案" className="mt-9 border-y border-[var(--ink)] py-3">
      <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="search-field">
          <label
            htmlFor="archive-search"
            className="shrink-0 font-mono text-[11.5px] uppercase tracking-[0.16em] text-[var(--muted)]"
          >
            检索
          </label>
          <input
            id="archive-search"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="标题、英文名、机构、模型或标签"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="archive-count"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="清除搜索词"
              className="shrink-0 px-1 font-mono text-sm text-[var(--muted)] transition-colors motion-safe:hover:text-[var(--accent)]"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-4 lg:justify-end">
          <p
            id="archive-count"
            role="status"
            aria-live="polite"
            className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-[var(--muted)]"
          >
            <span className="text-[var(--ink)]">{formatCount(shown)}</span>
            {" / "}
            {formatCount(total)} 条
            {filtered ? " · 已筛选" : ""}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-[var(--accent)] underline decoration-[var(--accent)] underline-offset-4"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Category and confidence share one wrapping row: they are the same kind
          of control, and a second row cost 40px above the first entry. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={category === "all"}
          onClick={() => onCategory("all")}
        >
          全部类别
          <span className="chip-count">{formatCount(categoryCounts.all ?? total)}</span>
        </button>
        {CATEGORY_ORDER.map((key) => {
          const meta = CATEGORY_META[key];
          return (
            <button
              key={key}
              type="button"
              className="filter-chip"
              aria-pressed={category === key}
              onClick={() => onCategory(category === key ? "all" : key)}
            >
              <span className="chip-mark" aria-hidden="true">
                {meta.mark}
              </span>
              {meta.label}
              <span className="chip-count">{formatCount(categoryCounts[key] ?? 0)}</span>
            </button>
          );
        })}
        <span
          className="mx-1 h-4 w-px bg-[var(--rule)]"
          aria-hidden="true"
        />
        <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
          可信度
        </span>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={confidence === "all"}
          onClick={() => onConfidence("all")}
        >
          全部
        </button>
        {CONFIDENCES.map((key) => (
          <button
            key={key}
            type="button"
            className="filter-chip"
            aria-pressed={confidence === key}
            onClick={() => onConfidence(confidence === key ? "all" : key)}
            title={CONFIDENCE_META[key].hint}
          >
            {CONFIDENCE_META[key].label}
            <span className="chip-count">{formatCount(confidenceCounts[key] ?? 0)}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 border-t border-dashed border-[var(--rule)] pt-3 sm:grid-cols-3">
        <FilterSelect
          id="filter-keyword"
          label="关键词"
          allLabel="全部关键词"
          value={keyword}
          options={keywordOptions}
          onChange={onKeyword}
        />
        <FilterSelect
          id="filter-vendor"
          label="厂商"
          allLabel="全部厂商"
          value={vendor}
          options={vendorOptions}
          onChange={onVendor}
        />
        <FilterSelect
          id="filter-series"
          label="模型系列"
          allLabel="全部系列"
          value={series}
          options={seriesOptions}
          onChange={onSeries}
        />
      </div>
    </section>
  );
}

interface SelectProps {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

function FilterSelect({ id, label, allLabel, value, options, onChange }: SelectProps) {
  return (
    <label className="filter-field" htmlFor={id} data-active={value !== "all"}>
      <span className="filter-field-label">{label}</span>
      <select
        id={id}
        className="filter-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}（{option.count}）
          </option>
        ))}
      </select>
    </label>
  );
}
