import { ApiError } from "../../api";
import { runsApi, type SourceHealthRow } from "../api";
import { Button, Card } from "../components/Field";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import { useShell } from "../components/AppShell";
import { useResource } from "../hooks/useResource";
import { duration, formatCount, ratio, relativeTime } from "../format";

/**
 * Source registry left-joined with live state.
 *
 * A source that has never run is a first-class row here, not a missing one: "we
 * never tried" and "we tried and it worked" are different answers, and only one
 * of them means the feed is healthy. `consecutiveFailures` drives the verdict —
 * one flake is noise, three in a row is a broken endpoint.
 */

function verdict(source: SourceHealthRow): { status: string; text: string } {
  if (source.totalRuns === 0) return { status: "paused", text: "未运行过" };
  if (source.consecutiveFailures >= 3) return { status: "failed", text: `连续失败 ${source.consecutiveFailures} 次` };
  if (source.consecutiveFailures > 0) return { status: "partial", text: `失败 ${source.consecutiveFailures} 次` };
  return { status: "succeeded", text: "正常" };
}

export function Sources() {
  const { reload } = useShell();
  const resource = useResource((signal) => runsApi.sources(signal), [reload]);
  const rows = resource.data?.items ?? [];

  const failing = rows.filter((row) => row.consecutiveFailures >= 3);
  const neverRun = rows.filter((row) => row.totalRuns === 0);
  const totalItems = rows.reduce((sum, row) => sum + row.lastItemCount, 0);

  const columns: Column<SourceHealthRow>[] = [
    {
      key: "name",
      header: "来源",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[var(--c-text)]">{row.name}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
            {row.key} · {row.family || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "state",
      header: "状态",
      width: "9rem",
      render: (row) => {
        const state = verdict(row);
        return (
          <StatusPill status={state.status} title={row.lastError || undefined}>
            {state.text}
          </StatusPill>
        );
      },
    },
    {
      key: "items",
      header: "上次条目",
      width: "5rem",
      align: "right",
      hideBelow: "sm",
      render: (row) => formatCount(row.lastItemCount),
    },
    {
      key: "ms",
      header: "上次耗时",
      width: "6rem",
      align: "right",
      hideBelow: "md",
      render: (row) => duration(row.lastMs),
    },
    {
      key: "runs",
      header: "成功率",
      width: "6rem",
      align: "right",
      hideBelow: "md",
      render: (row) =>
        row.totalRuns === 0 ? (
          <span className="text-[var(--c-text-mute)]">—</span>
        ) : (
          ratio(row.totalRuns - row.totalFailures, row.totalRuns, 0)
        ),
    },
    {
      key: "lastOk",
      header: "上次成功",
      width: "7rem",
      hideBelow: "lg",
      render: (row) => (
        <span className={row.lastOkAt ? "" : "text-[var(--c-warn)]"}>
          {row.lastOkAt ? relativeTime(row.lastOkAt) : "从未成功"}
        </span>
      ),
    },
    {
      key: "error",
      header: "最近错误",
      hideBelow: "lg",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">{row.lastError || "—"}</span>
      ),
    },
  ];

  if (resource.error && !resource.data) {
    return (
      <ErrorState
        title="来源健康加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "注册来源", value: `${rows.length}`, hint: "来源清单的唯一出处" },
          { label: "连续失败", value: `${failing.length}`, hint: "≥3 次视为端点故障", tone: failing.length > 0 },
          { label: "从未运行", value: `${neverRun.length}`, hint: "新加入或已下线的来源" },
          { label: "上次条目合计", value: formatCount(totalItems), hint: "各来源最近一次产出之和" },
        ].map((item) => (
          <Card key={item.label}>
            <p className="label">{item.label}</p>
            <p
              className={`num mt-1 text-[20px] ${
                item.tone ? "text-[var(--c-warn)]" : "text-[var(--c-text)]"
              }`}
            >
              {item.value}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--c-text-mute)]">{item.hint}</p>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--c-text-dim)]">
          连续失败 3 次以上会在总览页报警；单次失败只记录，不改收录判定。
        </p>
        <Button tone="ghost" onClick={() => void resource.refresh()} disabled={resource.loading}>
          {resource.loading ? "刷新中…" : "刷新"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={[...rows].sort(
          (a, b) => b.consecutiveFailures - a.consecutiveFailures || a.name.localeCompare(b.name),
        )}
        rowKey={(row) => row.key}
        loading={resource.loading}
        emptyTitle="没有已注册的来源"
        emptyDetail="来源清单来自 app/ingest/sources.py 的 SOURCES 常量。"
      />
    </div>
  );
}
