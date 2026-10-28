import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineItem } from "../types";
import {
  boundsOf,
  filterByRange,
  monthSerial,
  orderRange,
  parseRangeQuery,
  presetRange,
  rangeQuery,
  type MonthBounds,
  type RangePreset,
  type ShowRange,
  type YearMonth,
} from "../lib/period";
import { readShowQuery, writeShowQuery } from "../lib/showLink";

export type ShowPhase = "closed" | "setup" | "stage";
export type ShowPace = 6 | 8 | 12;
export type ShowOrder = "chrono" | "reverse";

export interface ShowOptions {
  pace: ShowPace;
  order: ShowOrder;
  loop: boolean;
}

const DEFAULT_OPTIONS: ShowOptions = { pace: 8, order: "chrono", loop: true };

function sortChronologically(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort(
    (left, right) =>
      left.sortDate.localeCompare(right.sortDate) || left.title.localeCompare(right.title, "zh-Hans-CN")
  );
}

/**
 * 放映的全部状态：开没开、播哪一段、第几屏、播不播。
 *
 * 队列只由「区间 + 顺序」决定，跟列表页的筛选无关——演示要讲的是完整的
 * 那一段历史，不是读者手里恰好勾着的类别。设定页与分享链接共用同一个
 * `range`，所以复制地址的人看到的就是同一个故事。
 */
export function useShow(items: TimelineItem[]) {
  const bounds = useMemo(() => boundsOf(items), [items]);
  const [phase, setPhase] = useState<ShowPhase>("closed");
  const [range, setRange] = useState<ShowRange>({ kind: "all" });
  const [preset, setPreset] = useState<RangePreset>("all");
  const [options, setOptions] = useState<ShowOptions>(DEFAULT_OPTIONS);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const linkOpened = useRef(false);

  const queue = useMemo(() => {
    const rows = sortChronologically(filterByRange(items, range));
    return options.order === "chrono" ? rows : rows.reverse();
  }, [items, range, options.order]);

  // 一份分享链接在数据到达之后才解得开：时间轴还没回来时算不出全程范围。
  useEffect(() => {
    if (linkOpened.current || !bounds || !items.length) return;
    linkOpened.current = true;
    const raw = readShowQuery();
    if (!raw) return;
    const parsed = parseRangeQuery(raw, bounds);
    if (!parsed) {
      // 一条读不懂的分享链接不该默默留在地址栏里。
      writeShowQuery(null);
      return;
    }
    setRange(parsed);
    setPreset(parsed.kind === "all" ? "all" : "custom");
    setPhase("setup");
  }, [bounds, items.length]);

  useEffect(() => {
    if (index >= queue.length) setIndex(0);
  }, [index, queue.length]);

  useEffect(() => {
    if (phase !== "stage" || !playing || queue.length < 2) return;
    const atEnd = index + 1 >= queue.length;
    const timer = window.setTimeout(() => {
      if (atEnd) {
        if (options.loop) setIndex(0);
        else setPlaying(false);
        return;
      }
      setIndex(index + 1);
    }, options.pace * 1000);
    return () => window.clearTimeout(timer);
  }, [phase, playing, index, queue.length, options.pace, options.loop]);

  const open = useCallback(() => {
    if (!items.length) return;
    setPhase("setup");
    writeShowQuery(rangeQuery(range));
  }, [items.length, range]);

  const close = useCallback(() => {
    setPhase("closed");
    setPlaying(false);
    writeShowQuery(null);
  }, []);

  const start = useCallback(() => {
    if (!queue.length) return;
    setIndex(0);
    setPhase("stage");
    setPlaying(true);
    writeShowQuery(rangeQuery(range));
  }, [queue.length, range]);

  const next = useCallback(() => {
    setIndex((current) => {
      if (current + 1 < queue.length) return current + 1;
      return options.loop ? 0 : current;
    });
  }, [queue.length, options.loop]);

  const prev = useCallback(() => {
    setIndex((current) => {
      if (current > 0) return current - 1;
      return options.loop ? Math.max(0, queue.length - 1) : current;
    });
  }, [queue.length, options.loop]);

  const goTo = useCallback((target: number) => {
    setIndex((current) => (target === current ? current : target));
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((current) => !current);
  }, []);

  const applyPreset = useCallback(
    (value: RangePreset) => {
      if (!bounds) return;
      setPreset(value);
      if (value === "custom") return;
      const nextRange = presetRange(value, bounds);
      setRange(nextRange);
      writeShowQuery(rangeQuery(nextRange));
    },
    [bounds]
  );

  const applyCustom = useCallback((from: YearMonth, to: YearMonth) => {
    const ordered = orderRange(from, to);
    const nextRange: ShowRange = { kind: "period", ...ordered };
    setPreset("custom");
    setRange(nextRange);
    writeShowQuery(rangeQuery(nextRange));
  }, []);

  const setPace = useCallback((pace: ShowPace) => {
    setOptions((current) => ({ ...current, pace }));
  }, []);

  const setOrder = useCallback((order: ShowOrder) => {
    setOptions((current) => ({ ...current, order }));
  }, []);

  const toggleLoop = useCallback(() => {
    setOptions((current) => ({ ...current, loop: !current.loop }));
  }, []);

  const active = queue[index] ?? null;
  const upcoming = queue[index + 1] ?? null;

  return {
    phase,
    bounds: bounds as MonthBounds | null,
    range,
    preset,
    options,
    queue,
    index,
    playing,
    active,
    upcoming,
    count: queue.length,
    open,
    close,
    start,
    next,
    prev,
    goTo,
    togglePlay,
    applyPreset,
    applyCustom,
    setPace,
    setOrder,
    toggleLoop,
    monthSerial,
  };
}

export type ShowController = ReturnType<typeof useShow>;
