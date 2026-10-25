import { useState } from "react";
import { ApiError } from "../../api";
import { runsApi, type AdminRunRecord } from "../api";
import { DataTable, type Column } from "../components/DataTable";
import { Button } from "../components/Field";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import { useShell } from "../components/AppShell";
import { useResource } from "../hooks/useResource";
import { navigate, useHashRoute } from "../router";
import { duration, formatCount, relativeTime, stamp } from "../format";
import { RunDetail } from "./RunDetail";

/**
 * Run history. The list answers "did tonight's collection work"; the drawer
 * answers "which source was slow and what did it say".
 *
 * The row is addressable (`#/runs?id=…`) so a link from an alert or a note lands
 * on the same run in a new tab.
 */

function verdicts(run: AdminRunRecord) {
  if (run.reviewedCount === 0) return "—";
  return `${run.admittedCount} / ${run.heldCount} / ${run.excludedCount}`;
}

export function Runs() {
  const { reload } = useShell();
  const route = useHashRoute();
  const selected = route.query.get("id");
  const [expanded, setExpanded] = useState<string | null>(null);

  const resource = useResource((signal) => runsApi.feed(50, signal), [reload]);
  const runs = resource.data?.runs ?? [];

  const columns: Column<AdminRunRecord>[] = [
    {
      key: "status",
      header: "状态",
      width: "7rem",
      render: (run) => (
        <span className="flex items-center gap-1.5">
          <StatusPill status={run.status} dot={run.status === "running"} />
          <span className="text-[10px] text-[var(--c-text-mute)]">
            {run.trigger === "manual" ? "手动" : "定时"}
          </span>
        </span>
      ),
    },
    {
      key: "started",
      header: "开始",
      width: "8rem",
      render: (run) => (
        <span className="num" title={run.startedAt}>
          {stamp(run.startedAt)}
        </span>
      ),
    },
    {
      key: "counts",
      header: "原始 / 新增 / 合并",
      width: "9rem",
      align: "right",
      hideBelow: "md",
      render: (run) => `${run.rawCount} / ${run.createdCount} / ${run.mergedCount}`,
    },
    {
      key: "review",
      header: "入档 / 暂缓 / 下架",
      width: "9rem",
      align: "right",
      hideBelow: "sm",
      render: (run) => <span title={`评审 ${run.reviewedCount} 条`}>{verdicts(run)}</span>,
    },
    {
      key: "failures",
      header: "失败来源",
      width: "7rem",
      hideBelow: "lg",
      render: (run) =>
        run.failedSources.length === 0 ? (
          <span className="text-[var(--c-text-mute)]">无</span>
        ) : (
          <span className="text-[var(--c-warn)]">{run.failedSources.join(", ")}</span>
        ),
    },
    {
      key: "duration",
      header: "耗时",
      width: "6rem",
      align: "right",
      render: (run) => duration(run.durationMs),
    },
    {
      key: "panel",
      header: "面板",
      width: "5rem",
      hideBelow: "lg",
      render: (run) => (
        <span className={run.panelConfigured ? "text-[var(--c-ok)]" : "text-[var(--c-text-mute)]"}>
          {run.panelConfigured ? "已配置" : "未配置"}
        </span>
      ),
    },
  ];

  if (resource.error && !resource.data) {
    return (
      <ErrorState
        title="运行记录加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  const lastOk = runs.find((run) => run.status === "succeeded") ?? null;
  const lastRun = runs[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <p className="text-[11px] text-[var(--c-text-dim)]">
          共 {formatCount(runs.length)} 次运行 · 最近一次 {relativeTime(lastRun?.startedAt)}
          {lastOk && ` · 最近成功 ${relativeTime(lastOk.finishedAt ?? lastOk.startedAt)}`}
        </p>
        <Button tone="ghost" onClick={() => void resource.refresh()} disabled={resource.loading}>
          {resource.loading ? "刷新中…" : "刷新"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={runs}
        rowKey={(run) => run.id}
        loading={resource.loading}
        activeKey={selected ?? expanded}
        onRowClick={(run) => {
          setExpanded(run.id);
          navigate("runs", { query: { id: run.id } });
        }}
        emptyTitle="还没有运行记录"
        emptyDetail="顶部「手动触发采集」可以立即跑一次；定时任务按 deploy/cron.d 里的计划执行。"
      />

      <Drawer
        open={Boolean(selected ?? expanded)}
        onClose={() => {
          setExpanded(null);
          navigate("runs", { replace: true });
        }}
        title="采集运行详情"
        subtitle={
          selected
            ? `运行 ${selected.slice(0, 8)} · 每条来源的耗时与失败原因`
            : "每条来源的耗时与失败原因"
        }
      >
        <RunDetail runId={(selected ?? expanded) ?? ""} />
      </Drawer>
    </div>
  );
}
