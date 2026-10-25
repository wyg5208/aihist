import { useState } from "react";
import { ApiError } from "../../api";
import { growthApi, type SubscriberRow } from "../api";
import { useShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, Select, TextInput } from "../components/Field";
import { Pagination } from "../components/Pagination";
import { StatusPill, textForStatus } from "../components/StatusPill";
import { formatCount, stamp } from "../format";
import { useResource } from "../hooks/useResource";

/**
 * The mailing list, as a list.
 *
 * There is no compose box and no send button: this application does not send
 * email (deliverability, bounces and complaints are a different system's job).
 * What it does have is the part that has to be right before anyone sends
 * anything — a consent timestamp per address, a confirmed status that only the
 * reader can grant, and an export that drops straight into whatever mail tool
 * the operator actually uses.
 *
 * The two writes here are `confirmed` and `unsubscribed`. Both are corrections
 * for cases the links cannot cover (a reader who replies by email, a bounce that
 * must be suppressed), and both require a reason that lands in the audit trail.
 */

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "pending", label: "待确认" },
  { value: "confirmed", label: "已确认" },
  { value: "unsubscribed", label: "已退订" },
];

const SIZE = 50;

/** What each manual move means, so the dialog is not a bare select. */
const MOVE_COPY: Record<string, { title: string; detail: string; confirm: string; tone: "primary" | "danger" }> = {
  confirmed: {
    title: "标记为已确认",
    detail:
      "用于读者通过邮件或其他渠道明确表示同意，但没有走确认链接的情况。确认时间只在第一次写入，之后不再改写。",
    confirm: "标记已确认",
    tone: "primary",
  },
  unsubscribed: {
    title: "标记为已退订",
    detail:
      "用于退信、投诉或读者直接回复要求离开。记录会保留为抑制名单，不会被重新加入，也不会被删除。",
    confirm: "标记已退订",
    tone: "danger",
  },
};

export function Subscribers() {
  const { notify, refreshOverview, reload } = useShell();

  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ row: SubscriberRow; next: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const resource = useResource(
    (signal) => growthApi.subscribers({ status, q, page, size: SIZE }, signal),
    [status, q, page, reload],
  );

  const rows = resource.data?.items ?? [];
  const counts = resource.data?.counts ?? {};
  const total = resource.data?.total ?? 0;

  const move = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    try {
      await growthApi.setSubscriberStatus(pending.row.id, pending.next, reason);
      notify(
        "ok",
        `已将 ${pending.row.email} 标为「${textForStatus(pending.next)}」，并写入审计记录`,
      );
      setPending(null);
      await resource.refresh();
      refreshOverview();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "unknown";
      notify("danger", `操作失败：${code}`);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<SubscriberRow>[] = [
    {
      key: "email",
      header: "邮箱",
      render: (row) => (
        <span className="font-mono text-[11px] text-[var(--c-text)]">{row.email}</span>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "6rem",
      render: (row) => <StatusPill status={row.status} />,
    },
    {
      key: "source",
      header: "来源",
      width: "10rem",
      hideBelow: "md",
      render: (row) => (
        <span className="text-[10px] text-[var(--c-text-mute)]">
          {row.sourcePath ?? "—"}
          {row.sourceChannel ? ` · ${row.sourceChannel}` : ""}
        </span>
      ),
    },
    {
      key: "consented",
      header: "同意时间",
      width: "7rem",
      hideBelow: "lg",
      align: "right",
      render: (row) => (
        <span className="num" title={row.consentedAt ?? ""}>
          {stamp(row.consentedAt)}
        </span>
      ),
    },
    {
      key: "confirmed",
      header: "确认时间",
      width: "7rem",
      hideBelow: "lg",
      align: "right",
      render: (row) => (
        <span className="num" title={row.confirmedAt ?? ""}>
          {row.confirmedAt ? stamp(row.confirmedAt) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "11rem",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          {row.status !== "confirmed" && (
            <Button tone="ghost" onClick={() => setPending({ row, next: "confirmed" })}>
              标记确认
            </Button>
          )}
          {row.status !== "unsubscribed" && (
            <Button tone="ghost" onClick={() => setPending({ row, next: "unsubscribed" })}>
              标记退订
            </Button>
          )}
        </span>
      ),
    },
  ];

  if (resource.error && !resource.data) {
    return (
      <ErrorState
        title="订阅名单加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUS_TABS.slice(1).map((tab) => ({
              value: tab.value,
              label: `${tab.label} · ${formatCount(counts[tab.value] ?? 0)}`,
            }))}
            includeEmpty
            emptyLabel={`全部 · ${formatCount(
              STATUS_TABS.slice(1).reduce((sum, tab) => sum + (counts[tab.value] ?? 0), 0),
            )}`}
          />
          <form
            className="flex items-end gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              setQ(draft.trim());
              setPage(1);
            }}
          >
            <label className="block">
              <span className="label">邮箱</span>
              <TextInput value={draft} onChange={setDraft} placeholder="按地址搜索" />
            </label>
            <Button type="submit" tone="ghost">
              查询
            </Button>
            {q && (
              <Button
                tone="ghost"
                onClick={() => {
                  setDraft("");
                  setQ("");
                  setPage(1);
                }}
              >
                清除
              </Button>
            )}
          </form>
        </div>

        <div className="flex items-center gap-2">
          <Button
            tone="default"
            onClick={() => {
              // A download, not a fetch: the browser handles the CSV without the
              // console having to hold a blob in memory.
              window.location.href = growthApi.exportUrl(status);
              notify("info", "已开始导出 CSV：可在自己的邮件工具里导入发送");
            }}
          >
            导出 CSV
          </Button>
          <Button tone="ghost" onClick={() => void resource.refresh()} disabled={resource.loading}>
            {resource.loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={resource.loading && rows.length === 0}
        skeletonRows={6}
        emptyTitle={q || status ? "没有符合条件的订阅者" : "还没有人订阅"}
        emptyDetail="订阅入口是站点上的订阅表单；提交后状态为「待确认」，读者点开确认链接才变成「已确认」。"
        footer={<Pagination page={page} size={SIZE} total={total} onChange={setPage} />}
      />

      <Card title="关于这块数据">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          <li>
            <span className="text-[var(--c-text-mute)]">同意留痕</span> — 每行都有 consented_at，是提交表单的那一刻，不会被后续编辑覆盖。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">确认</span> — 「已确认」只能由读者点开确认链接产生，或由这里的人工标记产生；两者都写审计。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">退订</span> — 不删除记录，改为抑制状态，保留「不要再发」这件事本身。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">发信</span> — 本后台不发送邮件。邮件通道未配置，导出 CSV 后在自己的邮件工具里发送。
          </li>
        </ul>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? MOVE_COPY[pending.next].title : ""}
        detail={
          pending && (
            <>
              <p>{MOVE_COPY[pending.next].detail}</p>
              <p className="mt-2 font-mono text-[11px] text-[var(--c-text)]">{pending.row.email}</p>
            </>
          )
        }
        confirmLabel={pending ? MOVE_COPY[pending.next].confirm : "确认"}
        tone={pending ? MOVE_COPY[pending.next].tone : "primary"}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void move(reason)}
      />
    </div>
  );
}
