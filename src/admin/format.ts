import { formatCount, relativeTime } from "../lib/format";

/**
 * Console formatters. Thin on purpose: the editorial vocabulary already lives in
 * `../lib/format`, and duplicating it here would let the two drift.
 */

export { formatCount, relativeTime };

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function ratio(part: number, whole: number, digits = 1): string {
  if (!whole) return "—";
  return pct(part / whole, digits);
}

/** `840` → `840ms`, `12_400` → `12.4s`. */
export function duration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

/** `2026-02-14` → `02.14`; the year lives in the column heading. */
export function dayShort(day: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(day) ? day.slice(5, 10).replace("-", ".") : day || "—";
}

export function dayFull(day: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(day)
    ? day.slice(0, 10).replace(/-/g, ".")
    : day || "—";
}

/** ISO timestamp → `02.14 09:31`. */
export function stamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function clock(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Percentage change between two-day windows, signed for the delta arrow. */
export function delta(current: number, previous: number): string {
  if (!previous) return current ? "新增" : "持平";
  const change = (current - previous) / previous;
  const sign = change > 0 ? "+" : "";
  return `${sign}${(change * 100).toFixed(0)}%`;
}

export const STATUS_LABELS: Record<string, string> = {
  admitted: "已入档",
  hold: "暂缓",
  excluded: "已下架",
  legacy: "历史遗留",
  running: "运行中",
  succeeded: "成功",
  partial: "部分失败",
  failed: "失败",
};

export function statusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS_LABELS[value] ?? value;
}

export const ORIGIN_LABELS: Record<string, string> = {
  seed: "种子",
  auto: "自动采集",
  manual: "人工入档",
  pipeline: "采集管线",
};

export function originLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return ORIGIN_LABELS[value] ?? value;
}

/** How a run was started. `backfill` is the manual sweep over past years. */
export const TRIGGER_LABELS: Record<string, string> = {
  auto: "定时",
  manual: "手动",
  backfill: "回补",
};

export function triggerLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return TRIGGER_LABELS[value] ?? value;
}

/**
 * The traffic buckets, spelled the same way everywhere: `repo_ops` returns keys
 * (`ai`, `event`, `mobile`), the console shows words. An unknown key falls
 * through unchanged rather than becoming `—`, because a new bucket appearing in
 * the data should be visible, not swallowed.
 */
const pick = (labels: Record<string, string>, value: string | null | undefined): string =>
  value ? labels[value] ?? value : "未标注";

const CHANNEL_LABELS: Record<string, string> = {
  direct: "直接访问",
  internal: "站内跳转",
  ai: "AI 助手",
  search: "搜索引擎",
  social: "社交平台",
  other: "其他来源",
};

const PAGE_KIND_LABELS: Record<string, string> = {
  home: "首页",
  event: "条目页",
  admin: "控制台",
  other: "其他路径",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "桌面",
  mobile: "手机",
  tablet: "平板",
  bot: "爬虫",
};

export const channelLabel = (value: string | null | undefined): string =>
  pick(CHANNEL_LABELS, value);
export const pageKindLabel = (value: string | null | undefined): string =>
  pick(PAGE_KIND_LABELS, value);
export const deviceLabel = (value: string | null | undefined): string =>
  pick(DEVICE_LABELS, value);

/** The partner vocabulary, spelled once so the ledger and the ledger's filter agree. */
const PARTNER_KIND_LABELS: Record<string, string> = {
  sponsor: "赞助商",
  partner: "合作方",
  mirror: "镜像站",
};

export const partnerKindLabel = (value: string | null | undefined): string =>
  value ? PARTNER_KIND_LABELS[value] ?? value : "—";
