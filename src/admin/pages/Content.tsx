import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api";
import { contentApi, type AdminEventRow, type ContentQuery } from "../api";
import { useShell } from "../components/AppShell";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Button, Field, Select, TextInput } from "../components/Field";
import { ErrorState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { StatusPill } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";
import { formatCount, originLabel } from "../format";
import { navigate, useHashRoute } from "../router";
import { ContentDetail } from "./ContentDetail";

/**
 * The archive, unfiltered by what readers can see.
 *
 * This is the page that decides whether an entry is citable: `missing` is the
 * same predicate `data_health` counts, so an Overview alert claiming "3 rows
 * have no slug" opens a list of exactly those three. The drawer is addressed
 * by `?id=` rather than a nested route so the alert links and the list share
 * one shape.
 */

const STATUS_OPTIONS = [
  { value: "live", label: "公开可见" },
  { value: "admitted", label: "已入档" },
  { value: "hold", label: "暂缓" },
  { value: "excluded", label: "已下架" },
  { value: "legacy", label: "历史遗留" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "按事件日期" },
  { value: "importance", label: "按重要度" },
  { value: "newest", label: "按录入时间" },
  { value: "updated", label: "按更新时间" },
];

const SIZE_OPTIONS = [
  { value: "25", label: "25 / 页" },
  { value: "50", label: "50 / 页" },
  { value: "100", label: "100 / 页" },
];

const MISSING_LABELS: Record<string, string> = {
  unslugged: "缺少 slug",
  sourceless: "没有来源",
  ungated: "未经评审",
  uncategorized: "没有分类",
};

export function Content() {
  const route = useHashRoute();
  const { reload, overview } = useShell();
  const selected = route.query.get("id");

  const [filters, setFilters] = useState<ContentQuery>(() => ({
    q: "",
    status: route.query.get("status") ?? "",
    missing: route.query.get("filter") ?? "",
    category: "",
    confidence: "",
    origin: "",
    sort: "recent",
    page: 1,
    size: 25,
  }));
  const [draft, setDraft] = useState("");

  // Filters start from the address, and follow it afterwards. Without this an
  // alert saying "3 rows cannot be cited" would land on a page still showing the
  // previous filter, because the component never unmounts between hash changes.
  const routeKey = `${route.query.get("status") ?? ""}|${route.query.get("filter") ?? ""}`;
  const appliedRoute = useRef(routeKey);
  useEffect(() => {
    if (appliedRoute.current === routeKey) return;
    appliedRoute.current = routeKey;
    setFilters((current) => ({
      ...current,
      status: route.query.get("status") ?? "",
      missing: route.query.get("filter") ?? "",
      page: 1,
    }));
    // `routeKey` is the whole contract; the raw query object changes identity
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const patch = (next: Partial<ContentQuery>) =>
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));

  const resource = useResource(
    (signal) => contentApi.list(filters, signal),
    [
      reload,
      filters.q,
      filters.status,
      filters.missing,
      filters.category,
      filters.confidence,
      filters.origin,
      filters.sort,
      filters.page,
      filters.size,
    ],
  );

  const rows = resource.data?.items ?? [];
  const total = resource.data?.total ?? 0;
  const page = resource.data?.page ?? Number(filters.page ?? 1);
  const size = resource.data?.size ?? Number(filters.size ?? 25);
  const missingLabel = filters.missing ? MISSING_LABELS[filters.missing] ?? filters.missing : "";

  // Option lists come from the snapshot the shell already polls: one taxonomy,
  // read from the data, never a second hard-coded list that can drift.
  const categories = (overview?.content.byCategory ?? []).map((group) => ({
    value: group.key,
    label: group.key ? `${group.key} · ${group.count}` : `未分类 · ${group.count}`,
  }));
  const confidences = (overview?.content.byConfidence ?? []).map((group) => ({
    value: group.key,
    label: `${group.key} · ${group.count}`,
  }));
  const origins = (overview?.content.byOrigin ?? []).map((group) => ({
    value: group.key,
    label: `${originLabel(group.key)} · ${group.count}`,
  }));

  const columns: Column<AdminEventRow>[] = [
    {
      key: "title",
      header: "条目",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[12px] text-[var(--c-text)]">{row.title}</p>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
            {row.slug ?? `无 slug · ${row.id.slice(0, 8)}`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "7rem",
      // `null` is the pre-gating seed: visible, but never reviewed.
      render: (row) => <StatusPill status={row.editorialStatus ?? "legacy"} />,
    },
    {
      key: "category",
      header: "分类",
      width: "7rem",
      hideBelow: "md",
      render: (row) => row.category || <span className="text-[var(--c-text-mute)]">—</span>,
    },
    {
      key: "confidence",
      header: "置信 / 来源",
      width: "7rem",
      align: "right",
      hideBelow: "sm",
      render: (row) => (
        <span title={`${row.confidence} · ${row.sourceCount} 个来源`}>
          {row.confidence} / {row.sourceCount}
        </span>
      ),
    },
    {
      key: "importance",
      header: "重要度",
      width: "5rem",
      align: "right",
      hideBelow: "sm",
      render: (row) => row.importance,
    },
    {
      key: "date",
      header: "事件日期",
      width: "6.5rem",
      render: (row) => <span className="num">{row.sortDate}</span>,
    },
    {
      key: "origin",
      header: "来源",
      width: "6rem",
      hideBelow: "lg",
      render: (row) => (
        <span className="text-[10px] text-[var(--c-text-mute)]">{originLabel(row.origin)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: draft.trim() });
        }}
        className="rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2.5"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="关键词">
            <TextInput
              value={draft}
              onChange={setDraft}
              placeholder="标题 / 摘要 / slug"
            />
          </Field>
          <Field label="状态">
            <Select
              value={filters.status ?? ""}
              onChange={(value) => patch({ status: value })}
              options={STATUS_OPTIONS}
              includeEmpty
              emptyLabel="全部（含暂缓与下架）"
            />
          </Field>
          <Field label="分类">
            <Select
              value={filters.category ?? ""}
              onChange={(value) => patch({ category: value })}
              options={categories}
              includeEmpty
            />
          </Field>
          <Field label="置信">
            <Select
              value={filters.confidence ?? ""}
              onChange={(value) => patch({ confidence: value })}
              options={confidences}
              includeEmpty
            />
          </Field>
          <Field label="来源">
            <Select
              value={filters.origin ?? ""}
              onChange={(value) => patch({ origin: value })}
              options={origins}
              includeEmpty
            />
          </Field>
          <Field label="排序 / 每页">
            <div className="flex gap-1.5">
              <Select
                value={filters.sort ?? "recent"}
                onChange={(value) => patch({ sort: value })}
                options={SORT_OPTIONS}
              />
              <Select
                value={String(filters.size ?? 25)}
                onChange={(value) => patch({ size: Number(value) })}
                options={SIZE_OPTIONS}
              />
            </div>
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
                setFilters({
                  q: "",
                  status: "",
                  missing: "",
                  category: "",
                  confidence: "",
                  origin: "",
                  sort: "recent",
                  page: 1,
                  size: 25,
                });
              }}
            >
              重置
            </Button>
            {missingLabel && (
              <button
                type="button"
                onClick={() => patch({ missing: "" })}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-warn)] px-2 py-0.5 font-mono text-[10px] text-[var(--c-warn)]"
              >
                体检筛选：{missingLabel} ✕
              </button>
            )}
          </div>
          <p className="num text-[10px] text-[var(--c-text-mute)]">
            {formatCount(total)} 条匹配 · 第 {page} 页
          </p>
        </div>
      </form>

      {resource.error && !resource.data ? (
        <ErrorState
          title="条目加载失败"
          detail={resource.error instanceof ApiError ? resource.error.code : undefined}
          action={<Button onClick={() => void resource.refresh()}>重试</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={resource.loading}
          activeKey={selected}
          onRowClick={(row) => navigate("content", { keep: true, query: { id: row.id } })}
          emptyTitle="没有符合条件的条目"
          emptyDetail="放宽状态或关键词；「暂缓」的候选在「评审一致性」里可以逐条处置。"
          footer={
            <Pagination
              page={page}
              size={size}
              total={total}
              onChange={(next) => setFilters((current) => ({ ...current, page: next }))}
            />
          }
        />
      )}

      <Drawer
        open={Boolean(selected)}
        onClose={() => navigate("content", { keep: true, replace: true, query: { id: null } })}
        title="条目详情"
        subtitle="来源、评审票型、内部按语与处置历史"
        width="46rem"
      >
        {selected && (
          <ContentDetail
            eventId={selected}
            onChanged={() => {
              void resource.refresh();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
