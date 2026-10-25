import type { ReactNode } from "react";

/**
 * One vocabulary for every state in the console: run status, editorial status,
 * alert level, source health. Colour alone is never the signal — the label is
 * always there, which is what makes it readable in a screenshot with no legend.
 */

export type PillTone = "ok" | "warn" | "danger" | "info" | "muted";

const TONES: Record<PillTone, string> = {
  ok: "border-[#2b4a35] bg-[#16241b] text-[var(--c-ok)]",
  warn: "border-[#4a3d22] bg-[#241d12] text-[var(--c-warn)]",
  danger: "border-[#4a2a25] bg-[#241514] text-[var(--c-danger)]",
  info: "border-[#25384f] bg-[#131c26] text-[var(--c-info)]",
  muted: "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]",
};

const STATUS_TONE: Record<string, PillTone> = {
  admitted: "ok",
  succeeded: "ok",
  active: "ok",
  confirmed: "ok",
  running: "info",
  pending: "warn",
  hold: "warn",
  partial: "warn",
  prospect: "muted",
  paused: "muted",
  ended: "muted",
  expired: "danger",
  disabled: "muted",
  locked: "danger",
  excluded: "danger",
  failed: "danger",
  revoked: "danger",
  unsubscribed: "danger",
  legacy: "muted",
};

const STATUS_TEXT: Record<string, string> = {
  admitted: "已入档",
  hold: "暂缓",
  excluded: "已下架",
  legacy: "历史遗留",
  running: "运行中",
  succeeded: "成功",
  partial: "部分失败",
  failed: "失败",
  active: "生效中",
  paused: "已暂停",
  revoked: "已吊销",
  pending: "待确认",
  confirmed: "已确认",
  unsubscribed: "已退订",
  prospect: "洽谈中",
  ended: "已结束",
  expired: "已过期",
  disabled: "已停用",
  locked: "已锁定",
};

export function toneForStatus(status: string | null | undefined): PillTone {
  if (!status) return "muted";
  return STATUS_TONE[status] ?? "muted";
}

export function textForStatus(status: string | null | undefined): string {
  if (!status) return "未标记";
  return STATUS_TEXT[status] ?? status;
}

export function StatusPill({
  status,
  tone,
  children,
  dot = false,
  title,
}: {
  status?: string | null;
  tone?: PillTone;
  children?: ReactNode;
  dot?: boolean;
  title?: string;
}) {
  const resolved = tone ?? toneForStatus(status);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] ${TONES[resolved]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full bg-current ${resolved === "info" ? "live-dot" : ""}`} />}
      {children ?? textForStatus(status)}
    </span>
  );
}
