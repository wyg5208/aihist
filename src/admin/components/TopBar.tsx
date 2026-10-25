import { useEffect, useState } from "react";
import { ApiError } from "../../api";
import { syncApi, type OverviewResponse, type Role } from "../api";
import { relativeTime } from "../format";
import { useSession } from "../session";
import { currentTheme, toggleTheme, type Theme } from "../theme";
import { Button } from "./Field";
import { StatusPill } from "./StatusPill";

/**
 * The always-on strip: is the pipeline healthy, and can I kick it.
 *
 * It polls `/admin/overview` rather than the public `/status`, because the lamp
 * has to reflect the same source of truth as the dashboard behind it — and
 * because the public endpoint must not grow operator-shaped fields.
 */

export interface TopBarProps {
  overview: OverviewResponse | null;
  refreshedAt: number;
  onRefreshed: () => void;
  notify: (tone: "ok" | "warn" | "danger" | "info", text: string) => void;
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "所有者",
  editor: "编辑",
  analyst: "分析员",
};

type Lamp = { tone: "ok" | "warn" | "danger" | "info"; text: string };

function lampFor(overview: OverviewResponse | null): Lamp {
  if (!overview) return { tone: "warn", text: "状态未知" };
  const codes = new Set(overview.alerts.map((alert) => alert.code));
  if (codes.has("sync_running")) return { tone: "info", text: "采集中" };
  if (codes.has("never_succeeded")) return { tone: "danger", text: "从未成功" };
  if (codes.has("stale")) {
    const alert = overview.alerts.find((item) => item.code === "stale");
    return { tone: "warn", text: alert?.message ?? "采集滞后" };
  }
  return { tone: "ok", text: "采集正常" };
}

export function TopBar({ overview, refreshedAt, onRefreshed, notify }: TopBarProps) {
  const { user, role, can, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  const [, setTick] = useState(0);

  // The relative time only stays true if something re-renders it.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const lamp = lampFor(overview);
  const lastSuccess =
    overview?.alerts.some((alert) => alert.code === "never_succeeded") === false
      ? overview?.runs.find((run) => run.status === "succeeded")?.finishedAt ?? null
      : null;

  const trigger = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ticket = await syncApi.start("manual");
      notify(
        "ok",
        ticket.triggered === false ? "已有采集在运行，已跳过本次触发。" : "已触发采集，进度见运行列表。",
      );
      onRefreshed();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "unknown";
      notify("danger", `触发失败：${code}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="flex flex-none items-center justify-between gap-4 border-b border-[var(--c-line)] bg-[var(--c-surface)] px-4 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <StatusPill tone={lamp.tone} dot>
          {lamp.text}
        </StatusPill>
        <span className="hidden text-[10px] text-[var(--c-text-mute)] sm:inline">
          上次成功 {relativeTime(lastSuccess)}
        </span>
        {refreshedAt > 0 && (
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--c-text-mute)] md:inline">
            15s 自动刷新
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {can("sync") && (
          <Button tone="default" onClick={trigger} disabled={busy}>
            {busy ? "触发中…" : "手动触发采集"}
          </Button>
        )}
        <span className="hidden items-center gap-1.5 border-l border-[var(--c-line)] pl-3 sm:flex">
          <span className="text-[11px] text-[var(--c-text-dim)]">{user}</span>
          {role && (
            <span className="rounded-full border border-[var(--c-line-strong)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-[var(--c-text-mute)]">
              {ROLE_LABEL[role]}
            </span>
          )}
        </span>
        <Button
          tone="ghost"
          onClick={() => setTheme(toggleTheme())}
          title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        >
          {theme === "dark" ? "浅色" : "深色"}
        </Button>
        <Button tone="ghost" onClick={() => void signOut()}>
          退出
        </Button>
      </div>
    </header>
  );
}
