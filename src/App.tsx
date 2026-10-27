import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Confidence, FilterOption, TimelineItem } from "./types";
import { CATEGORY_ORDER } from "./lib/format";
import { readEventSlug, writeEventSlug } from "./lib/permalink";
import { trackPageView } from "./lib/track";
import { useTimeline } from "./hooks/useTimeline";
import { useSync } from "./hooks/useSync";
import { SiteNav } from "./components/SiteNav";
import { SiteFooter } from "./components/SiteFooter";
import { CtaBand } from "./components/CtaBand";
import { Masthead } from "./components/Masthead";
import { FilterBar } from "./components/FilterBar";
import { YearScrubber } from "./components/YearScrubber";
import { TimelineYear } from "./components/TimelineYear";
import { SideRail } from "./components/SideRail";
import { SyncPanel } from "./components/SyncPanel";
import { StandardDialog } from "./components/StandardDialog";
import { EmptyState, ErrorState, LoadingState } from "./components/States";

function sortOptions(counts: Map<string, number>): FilterOption[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .map(([value, count]) => ({ value, label: value, count }));
}

function keywordOptionsFor(items: TimelineItem[]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return sortOptions(counts);
}

function fieldOptionsFor(
  items: TimelineItem[],
  pick: (item: TimelineItem) => string | null | undefined
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return sortOptions(counts);
}

export default function App() {
  const timeline = useTimeline();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [confidence, setConfidence] = useState<Confidence | "all">("all");
  const [keyword, setKeyword] = useState("all");
  const [vendor, setVendor] = useState("all");
  const [series, setSeries] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [missingSlug, setMissingSlug] = useState<string | null>(null);
  const [standardOpen, setStandardOpen] = useState(false);
  const permalinkHandled = useRef(false);

  const reload = timeline.reload;
  const handleChanged = useCallback(() => {
    void reload();
  }, [reload]);

  const sync = useSync({ ready: timeline.phase === "ready" });

  // A background run finishing upstream does not notify the page, so a poll
  // that observes the end of a run asks the timeline for a fresh read.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (sync.running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      handleChanged();
    }
  }, [sync.running, handleChanged]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return timeline.items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (confidence !== "all" && item.confidence !== confidence) return false;
      if (keyword !== "all" && !(item.tags || []).includes(keyword)) return false;
      if (vendor !== "all" && item.vendor !== vendor) return false;
      if (series !== "all" && item.series !== series) return false;
      if (!needle) return true;
      const haystack = [
        item.title,
        item.titleEn || "",
        item.organization || "",
        item.modelName || "",
        String(item.year),
        ...(item.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [timeline.items, query, category, confidence, keyword, vendor, series]);

  const groups = useMemo(() => {
    const map = new Map<number, typeof filtered>();
    for (const item of filtered) {
      const bucket = map.get(item.year);
      if (bucket) bucket.push(item);
      else map.set(item.year, [item]);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({ year, items }));
  }, [filtered]);

  const yearKey = groups.map((group) => group.year).join(",");

  const years = useMemo(
    () => groups.map((group) => ({ year: group.year, count: group.items.length })),
    [groups]
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: timeline.items.length };
    for (const key of CATEGORY_ORDER) counts[key] = 0;
    for (const item of timeline.items) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [timeline.items]);

  const confidenceCounts = useMemo(() => {
    const counts: Record<string, number> = { verified: 0, likely: 0, single: 0 };
    for (const item of timeline.items) {
      counts[item.confidence] = (counts[item.confidence] || 0) + 1;
    }
    return counts;
  }, [timeline.items]);

  const keywordOptions = useMemo(
    () => keywordOptionsFor(timeline.items),
    [timeline.items]
  );

  const vendorOptions = useMemo(
    () => fieldOptionsFor(timeline.items, (item) => item.vendor),
    [timeline.items]
  );

  const seriesOptions = useMemo(
    () => fieldOptionsFor(timeline.items, (item) => item.series),
    [timeline.items]
  );

  const modelCount = useMemo(
    () => timeline.items.filter((item) => item.category === "model").length,
    [timeline.items]
  );

  const familyCount = useMemo(() => {
    const families = new Set<string>();
    for (const item of timeline.items) {
      for (const family of item.sourceFamilies || []) families.add(family);
    }
    return families.size;
  }, [timeline.items]);

  useEffect(() => {
    if (!groups.length) {
      setActiveYear(null);
      return;
    }
    if (!groups.some((group) => group.year === activeYear)) {
      setActiveYear(groups[0].year);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearKey]);

  useEffect(() => {
    if (!yearKey) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-year]"));
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveYear(Number(visible[0].target.getAttribute("data-year")));
        }
      },
      { rootMargin: "-8% 0px -72% 0px", threshold: 0 }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [yearKey]);

  useEffect(() => {
    if (timeline.phase !== "ready" || permalinkHandled.current) return;
    const slug = readEventSlug();
    if (!slug) {
      permalinkHandled.current = true;
      return;
    }
    const item = timeline.items.find((entry) => entry.slug === slug);
    if (!item) {
      // A cold-start sync can finish after the first read; keep the address
      // pending and retry when the refreshed items arrive.
      if (timeline.items.length > 0) setMissingSlug(slug);
      return;
    }
    permalinkHandled.current = true;
    setExpandedId(item.id);
    setMissingSlug(null);
    requestAnimationFrame(() => {
      const element = document.getElementById(
        `entry-${item.slug || item.id}`
      );
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: "auto" });
      element
        .querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
    });
  }, [timeline.phase, timeline.items]);

  // The only analytics call in the app. `?e=` is the single query this site
  // uses, so the address changing and the reader opening another entry are the
  // same event; `trackPageView` dedupes identical addresses so an expand /
  // collapse cycle is not counted as a new page view.
  useEffect(() => {
    trackPageView();
  }, [expandedId, timeline.phase]);

  const jumpTo = (year: number) => {
    setActiveYear(year);
    const target = document.getElementById(`year-${year}`);
    if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
  };

  const toggleRow = (id: string) => {
    const next = expandedId === id ? null : id;
    const item = timeline.items.find((entry) => entry.id === id);
    setExpandedId(next);
    setMissingSlug(null);
    writeEventSlug(next ? item?.slug ?? null : null);
  };

  const dismissMissingSlug = () => {
    setMissingSlug(null);
    writeEventSlug(null);
  };

  const clearFilters = () => {
    setQuery("");
    setCategory("all");
    setConfidence("all");
    setKeyword("all");
    setVendor("all");
    setSeries("all");
  };

  const focusKeyword = useCallback((tag: string) => {
    setQuery("");
    setCategory("all");
    setConfidence("all");
    setVendor("all");
    setSeries("all");
    setKeyword(tag);
  }, []);

  const lastSuccessAt =
    sync.snapshot?.sync.lastSuccessAt ?? timeline.sync?.lastSuccessAt ?? null;
  const stale = sync.snapshot?.sync.stale ?? timeline.sync?.stale ?? true;
  const hasArchive = timeline.items.length > 0;
  const showLoading = timeline.phase === "loading";
  const showError = timeline.phase === "error";

  return (
    <>
      <a className="skip-link" href="#main">
        跳到时间轴
      </a>

      <SiteNav onStandard={() => setStandardOpen(true)} />

      <div className="mx-auto w-full max-w-[1180px] px-4 pb-0 sm:px-6 lg:max-w-[1480px] lg:px-8 2xl:max-w-[1760px] 2xl:px-10">
        <Masthead
          total={timeline.total || timeline.items.length}
          modelCount={modelCount}
          familyCount={familyCount}
          lastSuccessAt={lastSuccessAt}
          stale={stale}
          running={sync.running}
          notice={sync.notice}
          onStandard={() => setStandardOpen(true)}
        />

        <FilterBar
          query={query}
          category={category}
          confidence={confidence}
          keyword={keyword}
          vendor={vendor}
          series={series}
          categoryCounts={categoryCounts}
          confidenceCounts={confidenceCounts}
          keywordOptions={keywordOptions}
          vendorOptions={vendorOptions}
          seriesOptions={seriesOptions}
          total={timeline.items.length}
          shown={filtered.length}
          onQuery={setQuery}
          onCategory={setCategory}
          onConfidence={setConfidence}
          onKeyword={setKeyword}
          onVendor={setVendor}
          onSeries={setSeries}
          onClear={clearFilters}
        />

        {missingSlug && (
          <div
            role="status"
            className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-l-2 border-[var(--accent)] pl-3"
          >
            <p className="text-[13.5px] leading-6 text-[var(--ink-soft)]">
              地址中的条目「{missingSlug}」没有找到，可能已被合并，或尚未同步到本页。
            </p>
            <button
              type="button"
              onClick={dismissMissingSlug}
              className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[var(--accent)] underline underline-offset-4"
            >
              回到时间轴
            </button>
          </div>
        )}

        <div className="mt-2 grid gap-10 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10 2xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:gap-12">
          <main id="main" className="min-w-0">
            <YearScrubber years={years} activeYear={activeYear} onJump={jumpTo} />

            {timeline.truncated && (
              <p className="mt-3 border-l-2 border-[var(--accent)] pl-3 text-[12.5px] leading-6 text-[var(--ink-soft)]">
                档案较大，当前只载入最近 1200 条；更早的条目仍保存在数据库中。
              </p>
            )}

            {showLoading && <LoadingState />}
            {showError && (
              <ErrorState code={timeline.error} onRetry={() => void reload()} />
            )}

            {!showLoading && !showError && !hasArchive && (
              <div className="mt-6">
                <EmptyState reason="archive" />
              </div>
            )}

            {!showLoading && !showError && hasArchive && filtered.length === 0 && (
              <div className="mt-6">
                <EmptyState reason="filter" onClear={clearFilters} />
              </div>
            )}

            {!showLoading && filtered.length > 0 && (
              <div className={timeline.refreshing ? "opacity-70" : undefined}>
                {groups.map((group) => (
                  <TimelineYear
                    key={group.year}
                    year={group.year}
                    items={group.items}
                    expandedId={expandedId}
                    onToggle={toggleRow}
                    onKeyword={focusKeyword}
                  />
                ))}
                <p className="mt-8 border-t border-[var(--rule)] pt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  档案到此为止 · 共 {filtered.length} 条
                  {filtered.length !== timeline.items.length
                    ? `（全档 ${timeline.items.length} 条）`
                    : ""}
                </p>
              </div>
            )}
          </main>

          <div className="min-w-0 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:py-6 scrollbar-thin">
            <SideRail
              items={timeline.items}
              activeYear={activeYear}
              activeKeyword={keyword === "all" ? undefined : keyword}
              onKeyword={focusKeyword}
            >
              <SyncPanel
                snapshot={sync.snapshot}
                phase={sync.phase}
                notice={sync.notice}
                panel={sync.snapshot?.panel ?? null}
                onRefresh={() => void sync.refreshStatus().catch(() => undefined)}
                onStandard={() => setStandardOpen(true)}
              />
            </SideRail>
          </div>
        </div>

        <CtaBand />
      </div>

      <SiteFooter onStandard={() => setStandardOpen(true)} />

      <StandardDialog
        open={standardOpen}
        onClose={() => setStandardOpen(false)}
        panel={sync.snapshot?.panel ?? null}
      />
    </>
  );
}
