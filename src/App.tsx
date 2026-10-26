import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Confidence, FilterOption, TimelineItem } from "./types";
import { CATEGORY_ORDER } from "./lib/format";
import { ARCHIVE_START_YEAR } from "./lib/eras";
import { readEventSlug, writeEventSlug } from "./lib/permalink";
import { trackPageView } from "./lib/track";
import { useTimeline } from "./hooks/useTimeline";
import { useSync } from "./hooks/useSync";
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

      <div className="mx-auto max-w-[1180px] px-4 pb-14 sm:px-6 lg:px-8">
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
            <p className="text-[12px] leading-5 text-[var(--ink-soft)]">
              地址中的条目「{missingSlug}」没有找到，可能已被合并，或尚未同步到本页。
            </p>
            <button
              type="button"
              onClick={dismissMissingSlug}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)] underline underline-offset-4"
            >
              回到时间轴
            </button>
          </div>
        )}

        <div className="mt-2 grid gap-10 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:gap-12">
          <main id="main" className="min-w-0">
            <YearScrubber years={years} activeYear={activeYear} onJump={jumpTo} />

            {timeline.truncated && (
              <p className="mt-3 border-l-2 border-[var(--accent)] pl-3 text-[11px] leading-5 text-[var(--ink-soft)]">
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
                <p className="mt-8 border-t border-[var(--rule)] pt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                  档案到此为止 · 共 {filtered.length} 条
                  {filtered.length !== timeline.items.length
                    ? `（全档 ${timeline.items.length} 条）`
                    : ""}
                </p>
              </div>
            )}
          </main>

          <div className="min-w-0 lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:py-6 scrollbar-thin">
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

        <footer className="mt-16 border-t border-[var(--ink)] pt-5">
          <div className="grid gap-7 sm:grid-cols-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                关于
              </p>
              <p className="prose-note mt-2">
                AI 纪年按年份编排人工智能的关键事件、模型发布与重要研究，从 {ARCHIVE_START_YEAR} 年的早期自动机
                延伸到当前模型发布。经典阶段参考{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Timeline_of_artificial_intelligence"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-[var(--rule)] underline-offset-2"
                >
                  维基百科 AI 年表
                </a>
                ，再以原始论文或机构页面核对；近期条目由公开接口持续补充。
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                采集
              </p>
              <p className="prose-note mt-2">
                OpenRouter、Hugging Face、arXiv、Hacker News、OpenAI 与 Google 官方博客、
                Anthropic 站点地图，以及 TechCrunch、The Verge、MIT Technology Review；
                中文侧采集量子位、InfoQ 中国、钛媒体与雷峰网。
                同一来源只计一次，跨类别命中才升级为「已证实」。
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                边界
              </p>
              <p className="prose-note mt-2">
                采集与访问完全解耦：后台定时任务每 6 小时运行一次，管理台可手动触发，
                浏览页面不会发起任何同步。
                自动条目先经规则预筛，再由三个独立模型分别打分；至少两票同意且达到入档线才收录。
                票型分裂、评审不可用或未配置评审模型时，条目暂缓并隐藏，不进入公开时间轴。
                摘要明确标注人工校订、模型生成或来源摘录；新闻与论文只保留标题、短摘录与原链。
                种子条目另有静态引用页（/e/…），不依赖接口即可打开；自动条目只提供 ?e= 深链。
              </p>
            </div>
          </div>

          <p className="mt-7 flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--rule)] pt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <span>AI Chronicle · Vol. I · 公开档案</span>
            <span className="flex flex-wrap items-baseline gap-4">
              <button
                type="button"
                onClick={() => setStandardOpen(true)}
                className="underline decoration-[var(--rule-strong)] underline-offset-4 hover:text-[var(--accent)]"
              >
                收录标准
              </button>
              <a
                href="/api/v1/open/apply"
                className="underline decoration-[var(--rule-strong)] underline-offset-4 hover:text-[var(--accent)]"
              >
                API 申请
              </a>
              <span>数据来自公开接口 · 观点与事实以原链为准</span>
            </span>
          </p>
        </footer>
      </div>

      <StandardDialog
        open={standardOpen}
        onClose={() => setStandardOpen(false)}
        panel={sync.snapshot?.panel ?? null}
      />
    </>
  );
}
