import { useState } from "react";
import { ApiError } from "../../api";
import { auditApi, type AuditEntry } from "../api";
import { useShell } from "../components/AppShell";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, TextInput } from "../components/Field";
import { Pagination } from "../components/Pagination";
import { formatCount, stamp } from "../format";
import { useResource } from "../hooks/useResource";

/**
 * The audit trail: append-only, owner-only, and the reason a second person can be
 * trusted with the console at all.
 *
 * The table is deliberately boring — time, who, what, on what — because the useful
 * information is usually in `detail`, which is why a row opens a drawer rather than
 * a tooltip. Filters are free text, not a fixed list of actions: a closed enum
 * would silently hide every new action until someone remembered to extend it.
 */

const SIZE = 50;

export function Audit() {
  const { reload } = useShell();

  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState({ action: "", actor: "", q: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const trail = useResource(
    (signal) => auditApi.list({ action, actor, q, page, size: SIZE }, signal),
    [action, actor, q, page, reload],
  );

  const rows = trail.data?.items ?? [];
  const total = trail.data?.total ?? 0;
  const filtered = Boolean(action || actor || q);

  const apply = () => {
    setAction(drafts.action.trim());
    setActor(drafts.actor.trim());
    setQ(drafts.q.trim());
    setPage(1);
  };

  const clear = () => {
    setDrafts({ action: "", actor: "", q: "" });
    setAction("");
    setActor("");
    setQ("");
    setPage(1);
  };

  const columns: Column<AuditEntry>[] = [
    {
      key: "at",
      header: "时间",
      width: "8rem",
      render: (row) => (
        <span className="num" title={row.at}>
          {stamp(row.at)}
        </span>
      ),
    },
    {
      key: "actor",
      header: "操作者",
      width: "9rem",
      render: (row) => (
        <span className="block">
          <span className="block font-mono text-[11px] text-[var(--c-text)]">{row.actor}</span>
          <span className="block text-[10px] text-[var(--c-text-mute)]">{row.role || "—"}</span>
        </span>
      ),
    },
    {
      key: "action",
      header: "动作",
      width: "10rem",
      render: (row) => (
        <span className="font-mono text-[11px] text-[var(--c-info)]">{row.action}</span>
      ),
    },
    {
      key: "target",
      header: "对象",
      width: "10rem",
      hideBelow: "md",
      render: (row) => (
        <span className="block min-w-0">
          <span className="block text-[10px] text-[var(--c-text-mute)]">{row.targetType || "—"}</span>
          <span className="block truncate font-mono text-[10px] text-[var(--c-text-dim)]">
            {row.targetId || "—"}
          </span>
        </span>
      ),
    },
    {
      key: "summary",
      header: "摘要",
      render: (row) => (
        <span className="text-[11px] text-[var(--c-text-dim)]">{row.summary || "—"}</span>
      ),
    },
  ];

  if (trail.error && !trail.data) {
    return (
      <ErrorState
        title="审计日志加载失败"
        detail={trail.error instanceof ApiError ? trail.error.code : undefined}
        action={<Button onClick={() => void trail.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label className="block">
            <span className="label">动作</span>
            <TextInput
              value={drafts.action}
              onChange={(value) => setDrafts((current) => ({ ...current, action: value }))}
              placeholder="如 key.create"
            />
          </label>
          <label className="block">
            <span className="label">操作者</span>
            <TextInput
              value={drafts.actor}
              onChange={(value) => setDrafts((current) => ({ ...current, actor: value }))}
              placeholder="用户名"
            />
          </label>
          <label className="block">
            <span className="label">关键词</span>
            <TextInput
              value={drafts.q}
              onChange={(value) => setDrafts((current) => ({ ...current, q: value }))}
              placeholder="摘要或对象里包含…"
            />
          </label>
          <Button type="submit" tone="ghost">
            查询
          </Button>
          {filtered && (
            <Button tone="ghost" onClick={clear}>
              清除
            </Button>
          )}
        </form>
        <Button tone="ghost" onClick={() => void trail.refresh()} disabled={trail.loading}>
          {trail.loading ? "刷新中…" : "刷新"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={trail.loading && rows.length === 0}
        activeKey={open?.id ?? null}
        onRowClick={(row) => setOpen(row)}
        emptyTitle={filtered ? "没有符合条件的记录" : "还没有审计记录"}
        emptyDetail={
          filtered
            ? "调整关键词再试；动作与操作者是前缀匹配之外的精确包含匹配。"
            : "第一次登录之后，每个写操作都会在这里留一行：谁、什么时候、对什么、改成了什么。"
        }
        footer={<Pagination page={page} size={SIZE} total={total} onChange={setPage} />}
      />

      <Card title="关于这份日志">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          <li>
            <span className="text-[var(--c-text-mute)]">只增不改</span> — 代码里没有任何
            UPDATE 或 DELETE 语句针对 audit_log；删除记录本身就不该是后台的能力。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">不含密钥</span> — 写日志前会剔除
            password / secret / token / key 一类的字段，只留名称与前缀。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">IP 只存哈希</span> — 入库的是
            sha256(ip + ANALYTICS_SALT)，无法反查，只用于识别异常来源。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">共 {formatCount(total)} 条</span> —
            prune 每周清理超过保留期的记录（默认 730 天）。
          </li>
        </ul>
      </Card>

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.action ?? "审计详情"}
        subtitle={open ? `${open.actor} · ${open.role || "—"} · ${stamp(open.at)}` : undefined}
        width="34rem"
      >
        {open && (
          <div className="space-y-3">
            <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1.5 text-[11px]">
              <dt className="text-[var(--c-text-mute)]">摘要</dt>
              <dd className="text-[var(--c-text-dim)]">{open.summary || "—"}</dd>
              <dt className="text-[var(--c-text-mute)]">对象类型</dt>
              <dd className="font-mono text-[var(--c-text-dim)]">{open.targetType || "—"}</dd>
              <dt className="text-[var(--c-text-mute)]">对象 ID</dt>
              <dd className="break-all font-mono text-[10px] text-[var(--c-text-dim)]">
                {open.targetId || "—"}
              </dd>
              <dt className="text-[var(--c-text-mute)]">IP 哈希</dt>
              <dd className="break-all font-mono text-[10px] text-[var(--c-text-mute)]">
                {open.ipHash || "—"}
              </dd>
            </dl>
            <div>
              <p className="label">detail</p>
              <pre className="mt-1 max-h-[22rem] overflow-auto rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--c-text-dim)]">
                {JSON.stringify(open.detail ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
