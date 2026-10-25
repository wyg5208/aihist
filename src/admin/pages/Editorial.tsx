import { useState } from "react";
import { ApiError } from "../../api";
import {
  contentApi,
  editorialApi,
  type DecisionAction,
  type HoldRow,
  type JudgeRow,
} from "../api";
import { useShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { Button, Card } from "../components/Field";
import { RangePicker } from "../components/RangePicker";
import { StatusPill } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";
import { navigate } from "../router";
import { formatCount, pct, ratio } from "../format";

/**
 * The review panel, from the operator's side.
 *
 * Two questions live here and they are different: "what is waiting for a human"
 * (the hold queue) and "is the panel itself trustworthy" (per-judge include
 * rate). A judge that agrees with nobody is not a stricter judge, it is a
 * misconfigured prompt — and that only shows up when the rates are side by side.
 */

const HOLD_ACTIONS: Partial<Record<DecisionAction, { title: string; confirm: string; tone: "primary" | "danger"; detail: string }>> = {
  admit: {
    title: "人工入档",
    confirm: "确认入档",
    tone: "primary",
    detail: "跳过面板判定，直接把这条放进公开列表。评审记录会标记为 manual。",
  },
  "re-review": {
    title: "清票重判",
    confirm: "清票重判",
    tone: "danger",
    detail: "删除既有评审票，下次采集重新判定。适合怀疑上次投票被错误的 prompt 影响时。",
  },
};

/** A judge whose include rate sits this far from the field is worth a look. */
const OUTLIER_PP = 0.25;

export function Editorial() {
  const { reload, overview, notify, refreshOverview } = useShell();
  const [days, setDays] = useState(30);
  const [pending, setPending] = useState<{ row: HoldRow; action: DecisionAction } | null>(null);
  const [busy, setBusy] = useState(false);

  const holds = useResource((signal) => editorialApi.holds(80, signal), [reload]);
  const judges = useResource((signal) => editorialApi.judges(days, signal), [days, reload]);

  const holdRows = holds.data?.items ?? [];
  const judgeRows = judges.data?.items ?? [];
  const panel = overview?.panel;
  const totalBallots = judgeRows.reduce((sum, row) => sum + row.ballots, 0);
  const totalInclude = judgeRows.reduce((sum, row) => sum + row.include, 0);
  const meanRate =
    judgeRows.length === 0
      ? null
      : judgeRows.reduce((sum, row) => sum + row.includeRate, 0) / judgeRows.length;

  const submit = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    try {
      await contentApi.decide(pending.row.id, { action: pending.action, reason });
      notify("ok", `已对「${pending.row.title.slice(0, 16)}」执行${HOLD_ACTIONS[pending.action]?.title ?? pending.action}`);
      setPending(null);
      await holds.refresh();
      refreshOverview();
    } catch (error) {
      notify("danger", error instanceof ApiError ? `处置失败：${error.code}` : "处置失败");
    } finally {
      setBusy(false);
    }
  };

  const holdColumns: Column<HoldRow>[] = [
    {
      key: "title",
      header: "条目",
      render: (row) => (
        <button
          type="button"
          onClick={() => navigate("content", { query: { id: row.id } })}
          className="min-w-0 text-left"
        >
          <p className="truncate text-[12px] text-[var(--c-text)] hover:text-[var(--c-info)]">
            {row.title}
          </p>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
            {row.category} · {row.sourceCount} 来源 · {row.sortDate}
          </p>
        </button>
      ),
    },
    {
      key: "votes",
      header: "面板判定",
      width: "9rem",
      hideBelow: "md",
      render: (row) => (
        <div className="space-y-0.5">
          <StatusPill status={row.decision ?? "hold"} />
          <p className="num text-[10px] text-[var(--c-text-mute)]">
            {row.score == null ? "无分数" : `分数 ${row.score}`} · {row.votes.length} 票
          </p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "暂缓原因",
      hideBelow: "lg",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">{row.notes || "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "处置",
      width: "10rem",
      render: (row) => (
        <div className="flex gap-1.5">
          <Button tone="primary" onClick={() => setPending({ row, action: "admit" })}>
            入档
          </Button>
          <Button tone="danger" onClick={() => setPending({ row, action: "re-review" })}>
            重判
          </Button>
        </div>
      ),
    },
  ];

  const judgeColumns: Column<JudgeRow>[] = [
    {
      key: "judge",
      header: "评委位",
      width: "6rem",
      render: (row) => <span className="font-mono text-[11px] text-[var(--c-text)]">{row.judge}</span>,
    },
    {
      key: "models",
      header: "模型",
      hideBelow: "md",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
          {row.models.length === 0 ? "—" : row.models.join(", ")}
        </span>
      ),
    },
    {
      key: "ballots",
      header: "票数",
      width: "4.5rem",
      align: "right",
      render: (row) => formatCount(row.ballots),
    },
    {
      key: "rate",
      header: "include 率",
      width: "6.5rem",
      align: "right",
      render: (row) => {
        const off = meanRate !== null && Math.abs(row.includeRate - meanRate) >= OUTLIER_PP;
        return (
          <span className={off ? "text-[var(--c-warn)]" : ""} title={off ? "与面板均值相差 ≥25pp" : undefined}>
            {pct(row.includeRate)}
          </span>
        );
      },
    },
    {
      key: "score",
      header: "均分",
      width: "4.5rem",
      align: "right",
      hideBelow: "sm",
      render: (row) => row.meanScore.toFixed(1),
    },
    {
      key: "flags",
      header: "高频标记",
      hideBelow: "lg",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
          {row.topFlags.length === 0 ? "—" : row.topFlags.join(", ")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker value={days} onChange={setDays} hint="评委统计窗口" />
          <span className="num text-[10px] text-[var(--c-text-mute)]">
            {formatCount(totalBallots)} 票 · 合计 include 率 {ratio(totalInclude, totalBallots)}
            {meanRate !== null && ` · 面板均值 ${pct(meanRate)}`}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
          {panel?.configured
            ? `${panel.models.length} 模型 · 阈值 ${panel.includeScore} · 最少 ${panel.minVotes} 票 · ${panel.rubricVersion}`
            : "面板未配置，所有候选都会暂缓"}
        </span>
      </div>

      <Card
        title="暂缓队列"
        action={
          <span className="num text-[10px] text-[var(--c-text-mute)]">
            {formatCount(holdRows.length)} 条待处置
          </span>
        }
        padded={false}
      >
        {holds.error && !holds.data ? (
          <ErrorState
            title="暂缓队列加载失败"
            detail={holds.error instanceof ApiError ? holds.error.code : undefined}
            action={<Button onClick={() => void holds.refresh()}>重试</Button>}
          />
        ) : (
          <DataTable
            columns={holdColumns}
            rows={holdRows}
            rowKey={(row) => row.id}
            loading={holds.loading}
            skeletonRows={5}
            emptyTitle="暂缓队列是空的"
            emptyDetail="面板判定通过的条目会直接入档；只有票数不足或分数不够的候选会停在这里。"
          />
        )}
      </Card>

      <Card
        title="评委一致性"
        action={
          <span className="text-[10px] text-[var(--c-text-mute)]">
            include 率偏离面板均值 ≥25pp 会标黄
          </span>
        }
        padded={false}
      >
        {judges.error && !judges.data ? (
          <ErrorState
            title="评委统计加载失败"
            detail={judges.error instanceof ApiError ? judges.error.code : undefined}
            action={<Button onClick={() => void judges.refresh()}>重试</Button>}
          />
        ) : (
          <DataTable
            columns={judgeColumns}
            rows={judgeRows}
            rowKey={(row) => row.judge}
            loading={judges.loading}
            skeletonRows={4}
            emptyTitle="窗口内没有评审票"
            emptyDetail="面板未配置，或近 N 天没有走过自动判定。"
          />
        )}
      </Card>

      <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
        数据来源：<span className="font-mono">review_decisions.votes</span>（近 {days} 天）。
        每次同步的判定结果按 fingerprint 缓存，同一 fingerprint 不会重复投票，除非人工「清票重判」。
      </p>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending ? `${HOLD_ACTIONS[pending.action]?.title ?? ""} · ${pending.row.title.slice(0, 24)}` : ""
        }
        detail={pending ? HOLD_ACTIONS[pending.action]?.detail : undefined}
        confirmLabel={pending ? HOLD_ACTIONS[pending.action]?.confirm : undefined}
        tone={pending ? HOLD_ACTIONS[pending.action]?.tone : "primary"}
        busy={busy}
        onCancel={() => (busy ? undefined : setPending(null))}
        onConfirm={(reason) => void submit(reason)}
      />
    </div>
  );
}
