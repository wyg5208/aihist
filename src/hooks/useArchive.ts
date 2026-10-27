import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Confidence, FilterOption, TimelineItem } from "../types";
import { CATEGORY_ORDER } from "../lib/format";
import { readEventSlug, writeEventSlug } from "../lib/permalink";
import { trackPageView } from "../lib/track";
import { useTimeline } from "./useTimeline";
import { useSync } from "./useSync";

export interface YearGroup {
  year: number;
  items: TimelineItem[];
}

function sortOptions(counts: Map<string, number>): FilterOption[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .map(([value, count]) => ({ value, label: value, count }));
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

/**
 * Everything the three layouts share: one read of the archive, one set of
 * filters, one open entry, one sync snapshot. The views only decide how that
 * state is drawn — the archive must not be fetched or filtered three different
 * ways, or switching view would change the answer.
 */
export function useArchive() {
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

  const groups = useMemo<YearGroup[]>(() => {
    const map = new Map<number, TimelineItem[]>();
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

  const vendorOptions = useMemo(
    () => fieldOptionsFor(timeline.items, (item) => item.vendor),
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

  const evidenceCount = useMemo(
    () => timeline.items.reduce((sum, item) => sum + (item.sourceCount || 0), 0),
    [timeline.items]
  );

  /** The four newest entries, and the month they belong to. */
  const recent = useMemo(() => timeline.items.slice(0, 4), [timeline.items]);
  const recentMonth = useMemo(() => {
    const newest = timeline.items[0];
    if (!newest) return "";
    const date = newest.sortDate || newest.eventDate;
    if (!/^\d{4}-\d{2}/.test(date)) return "";
    return `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月`;
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
      const element = document.getElementById(`entry-${item.slug || item.id}`);
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: "auto" });
      element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
  }, [timeline.phase, timeline.items]);

  // The only analytics call in the app. `?e=` is the single query this site
  // uses, so the address changing and the reader opening another entry are the
  // same event; `trackPageView` dedupes identical addresses so an expand /
  // collapse cycle is not counted as a new page view.
  useEffect(() => {
    trackPageView();
  }, [expandedId, timeline.phase]);

  const jumpTo = useCallback((year: number) => {
    setActiveYear(year);
    const target = document.getElementById(`year-${year}`);
    if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

  const toggleRow = useCallback(
    (id: string) => {
      const next = expandedId === id ? null : id;
      const item = timeline.items.find((entry) => entry.id === id);
      setExpandedId(next);
      setMissingSlug(null);
      writeEventSlug(next ? item?.slug ?? null : null);
    },
    [expandedId, timeline.items]
  );

  const dismissMissingSlug = useCallback(() => {
    setMissingSlug(null);
    writeEventSlug(null);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setCategory("all");
    setConfidence("all");
    setKeyword("all");
    setVendor("all");
    setSeries("all");
  }, []);

  const clearExtras = useCallback(() => {
    setConfidence("all");
    setKeyword("all");
    setVendor("all");
    setSeries("all");
  }, []);

  /** A tag click narrows to that keyword; clicking it again releases it. */
  const focusKeyword = useCallback((tag: string) => {
    setQuery("");
    setCategory("all");
    setConfidence("all");
    setVendor("all");
    setSeries("all");
    setKeyword((current) => (current === tag ? "all" : tag));
  }, []);

  const openStandard = useCallback(() => setStandardOpen(true), []);
  const closeStandard = useCallback(() => setStandardOpen(false), []);

  const hasHiddenFilters =
    confidence !== "all" || keyword !== "all" || vendor !== "all" || series !== "all";

  const lastSuccessAt =
    sync.snapshot?.sync.lastSuccessAt ?? timeline.sync?.lastSuccessAt ?? null;

  return {
    phase: timeline.phase,
    error: timeline.error,
    items: timeline.items,
    total: timeline.total || timeline.items.length,
    truncated: timeline.truncated,
    refreshing: timeline.refreshing,
    reload,

    filtered,
    groups,
    years,
    activeYear,
    jumpTo,

    query,
    category,
    confidence,
    keyword,
    vendor,
    series,
    setQuery,
    setCategory,
    setConfidence,
    setKeyword,
    setVendor,
    setSeries,
    clearFilters,
    clearExtras,
    focusKeyword,
    hasHiddenFilters,

    categoryCounts,
    vendorOptions,

    expandedId,
    toggleRow,
    missingSlug,
    dismissMissingSlug,

    lastSuccessAt,
    running: sync.running,
    notice: sync.notice,
    panel: sync.snapshot?.panel ?? null,

    modelCount,
    familyCount,
    evidenceCount,
    panelSeats: sync.snapshot?.panel?.models.length ?? 0,

    recent,
    recentMonth,

    standardOpen,
    openStandard,
    closeStandard,
  };
}

export type ArchiveController = ReturnType<typeof useArchive>;
