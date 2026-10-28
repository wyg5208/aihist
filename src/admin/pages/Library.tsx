import { useState } from "react";
import { ApiError } from "../../api";
import {
  libraryApi,
  type LibraryFunnel,
  type LibraryItem,
  type LibraryQuery,
  type LibraryVerdict,
} from "../api";
import { Drawer } from "../components/Drawer";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState, TableSkeleton } from "../components/EmptyState";
import { Button, Card, Field, Select, TextInput } from "../components/Field";
import { Pagination } from "../components/Pagination";
import { StatusPill } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";
import { formatCount, stamp } from "../format";
import { navigate, useHashRoute } from "../router";

/**
 * The collection ledger: every fetched item, what happened to it, and why.
 *
 * Read-only on purpose. The decisions live on `#/content`, where each action
 * already writes an audit row; a second write surface here would fork that
 * vocabulary. So the drawer answers "why is this missing" and then hands the
 * operator off to the entry — the library's job is to make the question
 * answerable, not to become a second queue.
 */

const STATUS_OPTIONS = [
  { value: "admitted", label: "已纳入" },
  { value: "excluded", label: "已排除" },
  { value: "held", label: "待定" },
  { value: "dropped", label: "已丢弃" },
  { value: "pending", label: "待裁决" },
];

const STAGE_OPTIONS = [
  { value: "fetch", label: "抓取" },
  { value: "normalize", label: "标准化" },
  { value: "cap", label: "上限截断" },
  { value: "cluster", label: "聚类" },
  { value: "rule", label: "规则" },
  { value: "panel", label: "面板" },
  { value: "manual", label: "人工" },
];

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  STAGE_OPTIONS.map((option) => [option.value, option.label]),
);

const STATUS_TEXT: Record<string, string> = {
  admitted: "已纳入",
  excluded: "已排除",
  held: "待定",
  dropped: "已丢弃",
  pending: "待裁决",
};

const SORT_OPTIONS = [
  { value: "recent", label: "按采集时间" },
  { value: "oldest", label: "最早在前" },
  { value: "published", label: "按发布时间" },
  { value: "score", label: "按分数" },
  { value: "title", label: "按标题" },
];

const RANGE_OPTIONS = [
  { value: "1", label: "近 1 天" },
  { value: "7", label: "近 7 天" },
  { value: "30", label: "近 30 天" },
  { value: "90", label: "近 90 天" },
];

const SIZE_OPTIONS = [
  { value: "50", label: "50 / 页" },
  { value: "100", label: "100 / 页" },
];

function stageLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return STAGE_LABELS[value] ?? value;
}

function statusText(value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS_TEXT[value] ?? value;
}

function Meta({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className={`mt-0.5 truncate text-[11px] text-[var(--c-text-dim)] ${mono ? "num" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}

/** `fetched → parsed → … → admitted`, straight from the last run's `detail.funnel`. */
function FunnelBar({ funnel }: { funnel: LibraryFunnel }) {
  const latest = funnel.latest.funnel ?? {};
  const number = (key: string): number => {
    const value = latest[key];
    return typeof value === "number" ? value : 0;
  };
  const dropped = (latest.dropped ?? {}) as Record<string, number>;
  const dropTotal = Object.values(dropped).reduce((sum, count) => sum + count, 0);

  const steps = [
    { label: "抓取", value: number("fetched"), note: "原始条目" },
    { label: "标准化", value: number("parsed"), note: `丢弃 ${formatCount(dropTotal)}` },
    { label: "截断", value: number("capped"), note: "超出单次上限" },
    { label: "聚类", value: number("clustered"), note: `低于门槛 ${formatCount(number("clusterDropped"))}` },
    { label: "评审", value: number("reviewed"), note: `顺延 ${formatCount(number("overEventCap"))}` },
    { label: "纳入", value: number("admitted"), note: `排除 ${formatCount(number("excluded"))} · 待定 ${formatCount(number("held"))}` },
  ];

  if (!funnel.latest.runId) {
    return (
      <Card>
        <p className="text-[11px] leading-5 text-[var(--c-text-mute)]">
          还没有任何采集运行，所以没有漏斗可比。先到「采集运行」手动触发一次。
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="上次运行漏斗"
      action={
        <button
          type="button"
          onClick={() => navigate("runs", { query: { id: funnel.latest.runId } })}
          className="font-mono text-[10px] text-[var(--c-info)] hover:underline"
        >
          {stamp(funnel.latest.startedAt)} ↗
        </button>
      }
    >
      <ol className="flex flex-wrap items-stretch gap-1.5">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="min-w-[7rem] flex-1 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-bg)] px-2 py-1.5"
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
              {index + 1} · {step.label}
            </p>
            <p className="num mt-0.5 text-[15px] text-[var(--c-text)]">{formatCount(step.value)}</p>
            <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">{step.note}</p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] leading-4 text-[var(--c-text-mute)]">
        数字来自 <span className="font-mono">sync_runs.detail.funnel</span>；窗口内的逐条记录在下方表格，可按来源与理由筛。
      </p>
    </Card>
  );
}

function VoteTable({ votes }: { votes: Array<Record<string, unknown>> }) {
  if (votes.length === 0) {
    return <p className="text-[11px] text-[var(--c-text-mute)]">这条没有留下逐席明细。</p>;
  }
  return (
    <table className="w-full border-collapse text-left text-[11px]">
      <thead>
        <tr className="bg-[var(--c-surface-2)]">
          {["席位", "模型", "票", "分数", "理由 / 标记"].map((header) => (
            <th
              key={header}
              className="px-2 py-1.5 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--c-text-mute)]"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {votes.map((vote, index) => {
          const include = String(vote.vote ?? "").toLowerCase() === "include";
          const flags = Array.isArray(vote.flags) ? (vote.flags as string[]) : [];
          return (
            <tr key={index} className="border-b border-[var(--c-line)] last:border-b-0">
              <td className="num px-2 py-1.5">{String(vote.judge ?? "—")}</td>
              <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--c-text-mute)]">
                {String(vote.model ?? "—")}
              </td>
              <td className="px-2 py-1.5">
                <span className={include ? "text-[var(--c-ok)]" : "text-[var(--c-danger)]"}>
                  {include ? "include" : "exclude"}
                </span>
              </td>
              <td className="num px-2 py-1.5 text-right">{String(vote.score ?? "—")}</td>
              <td className="px-2 py-1.5 text-[10px] text-[var(--c-text-mute)]">
                {String(vote.reason ?? "") || flags.join(", ") || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Timeline({ verdicts }: { verdicts: LibraryVerdict[] }) {
  if (verdicts.length === 0) {
    return <p className="text-[11px] text-[var(--c-text-mute)]">还没有留下轨迹（本次运行刚写入时可能出现）。</p>;
  }
  return (
    <ol className="space-y-1.5">
      {verdicts.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-[11px]">
          <span className="num text-[10px] text-[var(--c-text-mute)]">{stamp(entry.at)}</span>
          <span className="font-mono text-[10px] text-[var(--c-info)]">{stageLabel(entry.stage)}</span>
          <span className="text-[var(--c-text-dim)]">{statusText(entry.status)}</span>
          <span className="min-w-0 flex-1 truncate text-[var(--c-text-mute)]" title={entry.reasonText}>
            {entry.reasonLabel || entry.reasonCode || "—"}
            {entry.reasonText && entry.reasonText !== entry.reasonLabel ? ` · ${entry.reasonText}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The drawer body: item facts, its trail, the ballot that decided it. */
function LibraryDetailView({ itemId }: { itemId: string }) {
  const resource = useResource((signal) => libraryApi.detail(itemId, signal), [itemId]);

  if (resource.error) {
    return (
      <ErrorState
        title="采集详情加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }
  if (!resource.data) return <TableSkeleton rows={8} columns={2} />;

  const { item, verdicts, review, event } = resource.data;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={item.status} tone={item.status === "admitted" ? "ok" : undefined}>
            {statusText(item.status)}
          </StatusPill>
          <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
            {stageLabel(item.stage)} · {item.reasonLabel || "—"}
          </span>
        </div>
        <h3 className="mt-1.5 text-[14px] leading-6 text-[var(--c-text)]">{item.title || "（无标题）"}</h3>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate font-mono text-[10px] text-[var(--c-info)] hover:underline"
            title={item.url}
          >
            {item.url} ↗
          </a>
        )}
      </div>

      {item.reasonText && (
        <p className="rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2.5 py-2 text-[11px] leading-5 text-[var(--c-text-dim)]">
          {item.reasonText}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2.5 sm:grid-cols-3">
        <Meta label="来源" value={`${item.sourceName || "—"}${item.sourceFamily ? ` · ${item.sourceFamily}` : ""}`} mono={false} />
        <Meta label="sourceKey" value={item.sourceKey || "—"} />
        <Meta label="externalId" value={item.externalId || "—"} />
        <Meta label="发布时间" value={item.publishedAt || "—"} />
        <Meta label="首次采集" value={item.firstSeenAt ? stamp(item.firstSeenAt) : "—"} />
        <Meta label="最近采集" value={item.lastSeenAt ? stamp(item.lastSeenAt) : "—"} />
        <Meta label="出现次数" value={String(item.seenCount)} />
        <Meta label="规则 / 面板分" value={item.score ? String(item.score) : "—"} />
        <Meta label="裁决时间" value={item.decidedAt ? stamp(item.decidedAt) : "—"} />
      </div>

      <Card
        title="去向时间轴"
        action={<span className="num text-[10px] text-[var(--c-text-mute)]">{verdicts.length} 条</span>}
      >
        <Timeline verdicts={verdicts} />
      </Card>

      <Card
        title="裁决证据"
        action={
          review ? (
            <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
              {review.rubricVersion} · {review.includeVotes}/{review.validVotes}
            </span>
          ) : undefined
        }
      >
        {review ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Meta label="判定" value={review.decision || "—"} mono={false} />
              <Meta label="均分" value={String(review.score)} />
              <Meta label="有效票" value={`${review.includeVotes} / ${review.validVotes}`} />
              <Meta label="票源" value={review.decisionSource || "—"} mono={false} />
            </div>
            <p className="text-[10px] text-[var(--c-text-mute)]">
              {review.sourceCount} 条来源证据 · {review.at ? stamp(review.at) : "—"}
            </p>
            <VoteTable votes={review.votes as Array<Record<string, unknown>>} />
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-[var(--c-text-mute)]">
            没有面板票：这条被确定性规则（或上限截断）在面板之前就决定了。
            {item.reasonText ? `原因：${item.reasonText}` : ""}
          </p>
        )}
      </Card>

      <Card title="跳转">
        <div className="flex flex-wrap gap-1.5">
          {event ? (
            <Button
              tone="primary"
              onClick={() => navigate("content", { keep: true, query: { id: event.id } })}
            >
              跳转到条目
            </Button>
          ) : (
            <span className="text-[11px] text-[var(--c-text-mute)]">这条没有成为条目，无法跳转改判。</span>
          )}
          {item.runId && (
            <Button onClick={() => navigate("runs", { query: { id: item.runId } })}>查看运行</Button>
          )}
        </div>
        {event && (
          <p className="mt-2 text-[10px] leading-4 text-[var(--c-text-mute)]">
            条目「{event.title}」当前状态 {statusText(event.editorialStatus ?? "legacy")}。改判入口在条目详情页，决策会写入审计日志。
          </p>
        )}
      </Card>
    </div>
  );
}

export function Library() {
  const route = useHashRoute();
  const selected = route.query.get("id");

  const [filters, setFilters] = useState<LibraryQuery>(() => ({
    q: route.query.get("q") ?? "",
    status: route.query.get("status") ?? "",
    stage: route.query.get("stage") ?? "",
    reason: route.query.get("reason") ?? "",
    sourceKey: route.query.get("sourceKey") ?? "",
    days: Number(route.query.get("days") ?? 7),
    page: Number(route.query.get("page") ?? 1),
    size: 50,
    sort: route.query.get("sort") ?? "recent",
  }));
  const [draft, setDraft] = useState(filters.q ?? "");

  const days = Number(filters.days ?? 7);
  const page = Number(filters.page ?? 1);
  const size = Number(filters.size ?? 50);

  const list = useResource((signal) => libraryApi.list(filters, signal), [
    filters.q,
    filters.status,
    filters.stage,
    filters.reason,
    filters.sourceKey,
    filters.days,
    filters.page,
    filters.size,
    filters.sort,
  ]);
  const funnel = useResource((signal) => libraryApi.funnel(days, signal), [days]);
  const reasons = useResource((signal) => libraryApi.reasons(30, signal), []);

  const rows = list.data?.items ?? [];
  const summary = list.data?.summary;
  const total = list.data?.total ?? 0;

  /** Filters are address state: a refresh, a shared link and a back button agree. */
  const apply = (next: Partial<LibraryQuery>) => {
    const merged: LibraryQuery = { ...filters, ...next, page: next.page ?? 1 };
    setFilters(merged);
    navigate("library", {
      keep: true,
      replace: true,
      query: {
        q: merged.q,
        status: merged.status,
        stage: merged.stage,
        reason: merged.reason,
        sourceKey: merged.sourceKey,
        days: merged.days,
        page: merged.page,
        sort: merged.sort,
      },
    });
  };

  const reasonOptions = (reasons.data?.items ?? []).map((row) => ({
    value: row.code,
    label: `${row.label} · ${formatCount(row.count)}`,
  }));
  const sourceOptions = (funnel.data?.bySource ?? []).map((row) => ({
    value: row.key,
    label: `${row.name || row.key} · ${formatCount(row.total)}`,
  }));

  const columns: Column<LibraryItem>[] = [
    {
      key: "status",
      header: "状态",
      width: "6.5rem",
      render: (row) => (
        <div className="space-y-0.5">
          <StatusPill status={row.status}>{statusText(row.status)}</StatusPill>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--c-text-mute)]">
            {stageLabel(row.stage)}
          </p>
        </div>
      ),
    },
    {
      key: "title",
      header: "条目",
      render: (row) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-[12px] leading-5 text-[var(--c-text)]">{row.title || "（无标题）"}</p>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
            {row.sourceName || row.sourceKey || "—"}
            {row.sourceFamily ? ` · ${row.sourceFamily}` : ""}
            {row.seenCount > 1 ? ` · 出现 ${row.seenCount} 次` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "理由",
      width: "13rem",
      hideBelow: "md",
      render: (row) => (
        <div className="min-w-0" title={row.reasonText || row.reasonCode}>
          <p className="truncate text-[11px] text-[var(--c-text-dim)]">{row.reasonLabel || row.reasonCode || "—"}</p>
          <p className="truncate font-mono text-[9px] text-[var(--c-text-mute)]">{row.reasonCode || "—"}</p>
        </div>
      ),
    },
    {
      key: "published",
      header: "发布时间",
      width: "6.5rem",
      hideBelow: "sm",
      render: (row) => <span className="num text-[11px]">{row.publishedAt || "—"}</span>,
    },
    {
      key: "seen",
      header: "采集时间",
      width: "7rem",
      hideBelow: "lg",
      render: (row) => <span className="num text-[10px]">{stamp(row.lastSeenAt)}</span>,
    },
    {
      key: "score",
      header: "分数",
      width: "4.5rem",
      align: "right",
      hideBelow: "lg",
      render: (row) => (row.score ? row.score : <span className="text-[var(--c-text-mute)]">—</span>),
    },
    {
      key: "link",
      header: "关联",
      width: "8rem",
      hideBelow: "md",
      render: (row) =>
        row.eventSlug ? (
          <span className="font-mono text-[10px] text-[var(--c-info)]" title={row.eventTitle ?? undefined}>
            {row.eventSlug.slice(0, 14)}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--c-text-mute)]">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          {
            label: "采集条数",
            value: formatCount(summary?.total ?? 0),
            hint: `近 ${days} 天写入采集库的条目`,
          },
          {
            label: "已纳入",
            value: formatCount(summary?.byStatus.admitted ?? 0),
            hint: "通过规则或面板进入公开列表",
          },
          {
            label: "已排除",
            value: formatCount(summary?.byStatus.excluded ?? 0),
            hint: "规则硬性排除或面板否决",
          },
          {
            label: "待定 / 丢弃",
            value: `${formatCount(summary?.byStatus.held ?? 0)} / ${formatCount(summary?.byStatus.dropped ?? 0)}`,
            hint: "待定需人工复核；丢弃多为时限与主题门槛",
          },
        ].map((item) => (
          <Card key={item.label}>
            <p className="label">{item.label}</p>
            <p className="num mt-1 text-[20px] text-[var(--c-text)]">{item.value}</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--c-text-mute)]">{item.hint}</p>
          </Card>
        ))}
      </div>

      {funnel.data ? <FunnelBar funnel={funnel.data} /> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: draft.trim() });
        }}
        className="rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2.5"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="关键词">
            <TextInput value={draft} onChange={setDraft} placeholder="标题 / 链接 / 理由" />
          </Field>
          <Field label="窗口">
            <Select
              value={String(days)}
              onChange={(value) => apply({ days: Number(value) })}
              options={RANGE_OPTIONS}
            />
          </Field>
          <Field label="状态">
            <Select
              value={filters.status ?? ""}
              onChange={(value) => apply({ status: value })}
              options={STATUS_OPTIONS}
              includeEmpty
            />
          </Field>
          <Field label="环节">
            <Select
              value={filters.stage ?? ""}
              onChange={(value) => apply({ stage: value })}
              options={STAGE_OPTIONS}
              includeEmpty
            />
          </Field>
          <Field label="理由">
            <Select
              value={filters.reason ?? ""}
              onChange={(value) => apply({ reason: value })}
              options={reasonOptions}
              includeEmpty
              emptyLabel="全部理由"
            />
          </Field>
          <Field label="来源">
            <Select
              value={filters.sourceKey ?? ""}
              onChange={(value) => apply({ sourceKey: value })}
              options={sourceOptions}
              includeEmpty
              emptyLabel="全部来源"
            />
          </Field>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" tone="primary">
              查询
            </Button>
            <Button
              tone="ghost"
              onClick={() => {
                setDraft("");
                apply({ q: "", status: "", stage: "", reason: "", sourceKey: "" });
              }}
            >
              重置
            </Button>
            <Select
              value={String(size)}
              onChange={(value) => apply({ size: Number(value) })}
              options={SIZE_OPTIONS}
            />
            <Select
              value={filters.sort ?? "recent"}
              onChange={(value) => apply({ sort: value })}
              options={SORT_OPTIONS}
            />
          </div>
          <p className="num text-[10px] text-[var(--c-text-mute)]">
            {formatCount(total)} 条匹配 · 第 {page} 页 · 窗口 {days} 天
          </p>
        </div>
      </form>

      {list.error && !list.data ? (
        <ErrorState
          title="采集库加载失败"
          detail={list.error instanceof ApiError ? list.error.code : undefined}
          action={<Button onClick={() => void list.refresh()}>重试</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={list.loading}
          activeKey={selected}
          onRowClick={(row) => navigate("library", { keep: true, query: { id: row.id } })}
          emptyTitle="本窗口内没有采集记录"
          emptyDetail="先到「采集运行」手动触发一次；若已运行，放宽状态、环节或窗口再看。"
          footer={
            <Pagination
              page={page}
              size={size}
              total={total}
              onChange={(next) => apply({ page: next })}
            />
          }
        />
      )}

      {funnel.data && funnel.data.bySource.length > 0 && (
        <Card
          title="窗口内各来源去向"
          action={<span className="text-[10px] text-[var(--c-text-mute)]">点击一行按来源筛选</span>}
          padded={false}
        >
          <div className="max-h-[16rem] overflow-auto">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-[var(--c-surface-2)]">
                <tr>
                  {["来源", "纳入", "排除", "待定", "丢弃", "合计"].map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap border-b border-[var(--c-line)] px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-[var(--c-text-mute)]"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funnel.data.bySource.map((row) => (
                  <tr
                    key={row.key}
                    onClick={() => apply({ sourceKey: row.key, page: 1 })}
                    className="cursor-pointer border-b border-[var(--c-line)] last:border-b-0 hover:bg-[var(--c-surface-2)]/60"
                  >
                    <td className="px-3 py-1.5">
                      <span className="text-[var(--c-text)]">{row.name || row.key}</span>
                      <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--c-text-mute)]">
                        {row.family || "—"}
                      </span>
                    </td>
                    <td className="num px-3 py-1.5 text-[var(--c-ok)]">{row.admitted || "—"}</td>
                    <td className="num px-3 py-1.5 text-[var(--c-danger)]">{row.excluded || "—"}</td>
                    <td className="num px-3 py-1.5 text-[var(--c-warn)]">{row.held || "—"}</td>
                    <td className="num px-3 py-1.5 text-[var(--c-text-mute)]">{row.dropped || "—"}</td>
                    <td className="num px-3 py-1.5">{formatCount(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
        采集库只读：处置仍然在「条目库」里做，每次处置都会写入审计日志。表内每个条目都能回答「为什么没进来」——
        规则硬性排除、规则分不足、五厂商逐席票型、批次上限顺延都在这条记录的详情里。
      </p>

      <Drawer
        open={Boolean(selected)}
        onClose={() => navigate("library", { keep: true, replace: true, query: { id: null } })}
        title="采集详情"
        subtitle="去向时间轴 · 裁决证据 · 关联条目"
        width="44rem"
      >
        {selected && <LibraryDetailView itemId={selected} />}
      </Drawer>
    </div>
  );
}
