import type { TimelineItem } from "../types";

/**
 * 演示区间。
 *
 * 档案里并存三种日期精度（年 / 月 / 日），而演示要说的是一段「2023 年 1 月
 * 到 2026 年 4 月」。区间统一落到月，比较用「年 × 12 + 月」的序号而不是字符串，
 * 免得 1912-12 → 1913-01 这种跨年被字典序骗过去。年精度条目没有月份可比，
 * 只要年份落在区间内就算命中——它本来代表的是「那一年」。
 */
export interface YearMonth {
  year: number;
  month: number;
}

export type ShowRange =
  | { kind: "all" }
  | { kind: "period"; from: YearMonth; to: YearMonth };

export type RangePreset = "all" | "year" | "three" | "since2020" | "custom";

export const MONTH_LABELS = [
  "1 月",
  "2 月",
  "3 月",
  "4 月",
  "5 月",
  "6 月",
  "7 月",
  "8 月",
  "9 月",
  "10 月",
  "11 月",
  "12 月",
];

export function monthSerial(value: YearMonth): number {
  return value.year * 12 + (value.month - 1);
}

export function shiftMonth(value: YearMonth, delta: number): YearMonth {
  const serial = monthSerial(value) + delta;
  const year = Math.floor(serial / 12);
  return { year, month: serial - year * 12 + 1 };
}

export function monthKey(value: YearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

export function monthLabel(value: YearMonth): string {
  return `${value.year} 年 ${value.month} 月`;
}

export function parseMonthKey(text: string): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** `sortDate` is always a full ISO date, whatever the display precision is. */
export function monthOf(item: TimelineItem): YearMonth {
  const [year, month] = (item.sortDate || "").split("-");
  const resolvedYear = Number(year);
  const resolvedMonth = Number(month);
  return {
    year: Number.isFinite(resolvedYear) && resolvedYear > 0 ? resolvedYear : item.year,
    month: resolvedMonth >= 1 && resolvedMonth <= 12 ? resolvedMonth : 1,
  };
}

export interface MonthBounds {
  first: YearMonth;
  last: YearMonth;
}

export function boundsOf(items: TimelineItem[]): MonthBounds | null {
  if (!items.length) return null;
  let low = monthSerial(monthOf(items[0]));
  let high = low;
  for (const item of items) {
    const serial = monthSerial(monthOf(item));
    if (serial < low) low = serial;
    if (serial > high) high = serial;
  }
  return {
    first: { year: Math.floor(low / 12), month: (low % 12) + 1 },
    last: { year: Math.floor(high / 12), month: (high % 12) + 1 },
  };
}

export function inRange(item: TimelineItem, range: ShowRange): boolean {
  if (range.kind === "all") return true;
  if (item.datePrecision === "year") {
    return item.year >= range.from.year && item.year <= range.to.year;
  }
  const serial = monthSerial(monthOf(item));
  return serial >= monthSerial(range.from) && serial <= monthSerial(range.to);
}

export function filterByRange(items: TimelineItem[], range: ShowRange): TimelineItem[] {
  return range.kind === "all" ? items.slice() : items.filter((item) => inRange(item, range));
}

/** A range typed backwards is the range the reader meant, not an error. */
export function orderRange(from: YearMonth, to: YearMonth): { from: YearMonth; to: YearMonth } {
  return monthSerial(from) <= monthSerial(to) ? { from, to } : { from: to, to: from };
}

export function presetRange(preset: RangePreset, bounds: MonthBounds): ShowRange {
  if (preset === "year") {
    return { kind: "period", ...orderRange(shiftMonth(bounds.last, -11), bounds.last) };
  }
  if (preset === "three") {
    return { kind: "period", ...orderRange(shiftMonth(bounds.last, -35), bounds.last) };
  }
  if (preset === "since2020") {
    return { kind: "period", ...orderRange({ year: 2020, month: 1 }, bounds.last) };
  }
  return { kind: "all" };
}

export function rangeQuery(range: ShowRange): string {
  if (range.kind === "all") return "all";
  return `${monthKey(range.from)}..${monthKey(range.to)}`;
}

/**
 * Tolerant on the way in: `all`, `2023-01..2026-04`, and a bare `2023` (which a
 * reader will type and a colleague will paste) all land on a real range.
 */
export function parseRangeQuery(raw: string | null, bounds: MonthBounds): ShowRange | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "all" || value === "full") return { kind: "all" };
  if (/^\d{4}$/.test(value)) {
    const year = Number(value);
    if (year >= 1900 && year <= 2100) {
      return { kind: "period", from: { year, month: 1 }, to: { year, month: 12 } };
    }
    return null;
  }
  const [fromText, toText] = value.split("..");
  const from = parseMonthKey(fromText || "");
  const to = parseMonthKey(toText || "");
  if (!from || !to) return null;
  return { kind: "period", ...orderRange(from, to) };
}

export function rangeLabel(range: ShowRange, bounds: MonthBounds | null): string {
  if (range.kind === "all") {
    return bounds ? `全程 ${bounds.first.year} — ${bounds.last.year}` : "全程";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  const tail = bounds ? ` · 全程至 ${bounds.last.year}` : "";
  return `${range.from.year}.${pad(range.from.month)} — ${range.to.year}.${pad(range.to.month)}${tail}`;
}

/** How long a full pass will take, for the setup screen. */
export function durationLabel(count: number, paceSeconds: number): string {
  const total = Math.max(0, count) * paceSeconds;
  if (total < 60) return `${total} 秒`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `约 ${hours} 小时 ${minutes % 60} 分`;
}
