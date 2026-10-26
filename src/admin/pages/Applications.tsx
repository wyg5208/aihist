import { useState } from "react";
import { ApiError } from "../../api";
import {
  applicationsApi,
  type ApiKeyRow,
  type ApplicationRow,
} from "../api";
import { useShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, Field, INPUT_CLASS, Select, TextInput } from "../components/Field";
import { KpiCard } from "../components/KpiCard";
import { Pagination } from "../components/Pagination";
import { StatusPill, type PillTone } from "../components/StatusPill";
import { formatCount, relativeTime, stamp } from "../format";
import { useResource } from "../hooks/useResource";

/**
 * The application queue: the only place a stranger's words reach the console.
 *
 * Approval is the page's one irreversible act — it mints a credential — so the
 * flow is deliberately two-step: read the application in a drawer, then confirm
 * through the dialog that already carries the reason into the audit trail. The
 * quota input lives in that dialog because the default is a guess (`1000`), and
 * the person reading the purpose is the only one who can replace it.
 *
 * What comes back is the same copy-once contract as the keys page: the plaintext
 * exists in exactly one response. The drawer then shows where the key went — the
 * mailbox, or the operator's clipboard when SMTP is not configured.
 */

const DEFAULT_QUOTA = 1000;
const SIZE = 50;

const TABS = [
  { value: "", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
] as const;

const STATUS_TONE: Record<string, PillTone> = {
  pending: "warn",
  approved: "ok",
  rejected: "danger",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

const ERROR_TEXT: Record<string, string> = {
  application_not_found: "申请不存在",
  application_already_decided: "这条申请已经处置过了，刷新后再看",
  invalid_application_id: "申请编号不合法",
  forbidden: "当前角色无权管理申请",
};

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "未知错误";
  return ERROR_TEXT[error.code] ?? error.code;
}

function statusPill(status: string) {
  return (
    <StatusPill status={status} tone={STATUS_TONE[status] ?? "muted"}>
      {STATUS_TEXT[status] ?? status}
    </StatusPill>
  );
}

type Panel =
  | { mode: "detail"; row: ApplicationRow }
  | {
      mode: "secret";
      row: ApplicationRow;
      key: ApiKeyRow | null;
      plaintext: string;
      email: { configured: boolean; sent: boolean; error: string | null } | null;
    }
  | null;

type Decision = { row: ApplicationRow; next: "approve" | "reject" } | null;

export function Applications() {
  const { notify, refreshOverview, reload } = useShell();

  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [quota, setQuota] = useState(String(DEFAULT_QUOTA));
  const [busy, setBusy] = useState(false);

  const resource = useResource(
    (signal) => applicationsApi.list({ status, page, size: SIZE }, signal),
    [status, page, reload],
  );

  const rows = resource.data?.applications ?? [];
  const counts = resource.data?.counts ?? {};
  const total = resource.data?.total ?? 0;

  const openDecision = (row: ApplicationRow, next: "approve" | "reject") => {
    setQuota(String(row.monthlyQuota || DEFAULT_QUOTA));
    setDecision({ row, next });
  };

  const decide = async (reason: string) => {
    if (!decision) return;
    const { row, next } = decision;
    setBusy(true);
    try {
      if (next === "reject") {
        await applicationsApi.reject(row.id, { note: reason });
        notify("ok", `已拒绝 ${row.email}，理由已写入审计`);
        setDecision(null);
        setPanel(null);
      } else {
        const parsed = Number.parseInt(quota || "0", 10);
        const response = await applicationsApi.approve(row.id, {
          monthlyQuota: Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_QUOTA,
          note: reason,
        });
        setDecision(null);
        if (response.key && response.plaintext) {
          setPanel({
            mode: "secret",
            row: response.application,
            key: response.key,
            plaintext: response.plaintext,
            email: response.email ?? null,
          });
        } else {
          setPanel(null);
        }
        const mailed = response.email;
        if (!mailed?.configured) {
          notify("warn", "已签发。邮件通道未配置：请复制密钥手动转发给申请人");
        } else if (mailed.sent) {
          notify("ok", `已签发并发送到 ${row.email}`);
        } else {
          notify("danger", "已签发，但邮件没发出去：请复制密钥手动转发");
        }
      }
      await resource.refresh();
      refreshOverview();
    } catch (error) {
      notify("danger", `${next === "approve" ? "签发" : "拒绝"}失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("ok", "已复制到剪贴板");
    } catch {
      notify("warn", "浏览器拒绝了剪贴板写入，请手动选中复制");
    }
  };

  const columns: Column<ApplicationRow>[] = [
    {
      key: "applicant",
      header: "申请人",
      render: (row) => (
        <>
          <span className="block text-[12px] text-[var(--c-text)]">{row.name || "—"}</span>
          <span className="block font-mono text-[10px] text-[var(--c-text-mute)]">
            {row.email}
          </span>
        </>
      ),
    },
    {
      key: "purpose",
      header: "用途",
      hideBelow: "md",
      render: (row) => (
        <span className="line-clamp-2 max-w-[28rem] text-[11px] leading-4 text-[var(--c-text-dim)]">
          {row.purpose}
        </span>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "6rem",
      render: (row) => statusPill(row.status),
    },
    {
      key: "submitted",
      header: "提交",
      width: "7rem",
      hideBelow: "lg",
      align: "right",
      render: (row) => (
        <span className="num" title={row.createdAt ?? ""}>
          {relativeTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "10rem",
      render: (row) =>
        row.status === "pending" ? (
          <span className="flex flex-wrap items-center gap-1">
            <Button tone="ghost" onClick={() => openDecision(row, "approve")}>
              批准
            </Button>
            <Button tone="ghost" onClick={() => openDecision(row, "reject")}>
              拒绝
            </Button>
          </span>
        ) : (
          <Button tone="ghost" onClick={() => setPanel({ mode: "detail", row })}>
            查看
          </Button>
        ),
    },
  ];

  const current = panel?.row ?? null;

  if (resource.error && !resource.data) {
    return (
      <ErrorState
        title="申请队列加载失败"
        detail={resource.error instanceof ApiError ? describe(resource.error) : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="待审核"
          value={formatCount(counts.pending ?? 0)}
          unit="条"
          hint="只包含 pending：已处置的记录不再回到队列里"
        />
        <KpiCard
          label="已通过"
          value={formatCount(counts.approved ?? 0)}
          hint="每一条都对应一把已签发的密钥"
        />
        <KpiCard
          label="已拒绝"
          value={formatCount(counts.rejected ?? 0)}
          hint="记录保留，同一地址再申请时能看出前因"
        />
        <KpiCard
          label="累计申请"
          value={formatCount(total)}
          hint="表单页：/api/v1/open/apply（随 OPEN_API_ENABLED 开关）"
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={TABS.slice(1).map((tab) => ({
              value: tab.value,
              label: `${tab.label} · ${formatCount(counts[tab.value] ?? 0)}`,
            }))}
            includeEmpty
            emptyLabel={`全部 · ${formatCount(
              TABS.slice(1).reduce((sum, tab) => sum + (counts[tab.value] ?? 0), 0),
            )}`}
          />
          <p className="pb-1 text-[11px] text-[var(--c-text-dim)]">
            共 {formatCount(total)} 条 · 按提交时间倒序
          </p>
        </div>
        <Button tone="ghost" onClick={() => void resource.refresh()} disabled={resource.loading}>
          {resource.loading ? "刷新中…" : "刷新"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => setPanel({ mode: "detail", row })}
        activeKey={current?.id ?? null}
        loading={resource.loading && rows.length === 0}
        emptyTitle={status ? "这个状态下没有申请" : "队列是空的"}
        emptyDetail="申请来自站点页脚的「API 申请」链接。提交只写一条待审记录，不会自动签发任何密钥。"
        footer={<Pagination page={page} size={SIZE} total={total} onChange={setPage} />}
      />

      <Card title="关于这条通道">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          <li>
            <span className="text-[var(--c-text-mute)]">入口</span> — /api/v1/open/apply，
            由后端直接渲染 HTML；OPEN_API_ENABLED=false 时整页返回 404。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">防滥用</span> — 同一地址每小时 5 次提交上限，
            外加一个浏览器用户看不见的诱饵字段；命中的提交只看到成功页，不落库。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">签发</span> — 批准即签发只读密钥（默认每月 1000 次），
            与手工新建的密钥同表同权；撤销、用量与审计都在「开放 API」页。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">送达</span> — 配置 SMTP_HOST 时自动发信；
            未配置则明文只在批准响应里出现一次，需要手动转发。两种情况都不影响签发本身。
          </li>
        </ul>
      </Card>

      <Drawer
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panel?.mode === "secret" ? "已签发（只显示这一次）" : "申请详情"}
        subtitle={
          panel?.mode === "secret"
            ? "关闭后无法再次取回，只能吊销重建"
            : current
              ? `${current.email} · ${stamp(current.createdAt)}`
              : undefined
        }
        footer={
          panel?.mode === "secret" ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-[var(--c-text-mute)]">
                用量与撤销在「开放 API」页
              </span>
              <Button tone="primary" onClick={() => setPanel(null)}>
                我已保存
              </Button>
            </div>
          ) : current?.status === "pending" ? (
            <div className="flex items-center justify-end gap-2">
              <Button tone="ghost" onClick={() => openDecision(current, "reject")} disabled={busy}>
                拒绝
              </Button>
              <Button
                tone="primary"
                onClick={() => openDecision(current, "approve")}
                disabled={busy}
              >
                批准并签发
              </Button>
            </div>
          ) : undefined
        }
      >
        {panel?.mode === "secret" ? (
          <div className="space-y-3">
            <p className="rounded-[var(--c-radius)] border border-[var(--c-warn-line)] bg-[var(--c-warn-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--c-warn)]">
              这是唯一一次能看到完整密钥的时刻。关闭本抽屉后，服务端只剩下 sha256 摘要。
            </p>
            <Field label="密钥" hint="点一下即可全选">
              <textarea
                readOnly
                rows={2}
                value={panel.plaintext}
                onFocus={(event) => event.currentTarget.select()}
                className={`${INPUT_CLASS} resize-none break-all`}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="default" onClick={() => void copy(panel.plaintext)}>
                复制
              </Button>
              <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
                前缀 {panel.key?.prefix ?? "—"}… · {panel.row.email} · 配额{" "}
                {panel.row.monthlyQuota > 0 ? formatCount(panel.row.monthlyQuota) : "不限"}
              </span>
            </div>
            <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
              {panel.email?.sent
                ? `密钥已发送到 ${panel.row.email}。`
                : panel.email?.configured
                  ? "邮件发送失败，请手动转发给申请人。"
                  : "邮件通道未配置，请手动转发给申请人。"}
            </p>
          </div>
        ) : current ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {statusPill(current.status)}
              {current.siteUrl && (
                <a
                  href={current.siteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[10px] text-[var(--c-info)] underline underline-offset-2"
                >
                  {current.siteUrl}
                </a>
              )}
              <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
                {relativeTime(current.createdAt)}
              </span>
            </div>
            <Field label="申请人">
              <p className="text-[12px] text-[var(--c-text)]">
                {current.name || "—"}{" "}
                <span className="font-mono text-[11px] text-[var(--c-text-mute)]">
                  {current.email}
                </span>
              </p>
            </Field>
            <Field label="用途" hint="审核只看这一段：产品形态、展示位置、大致调用量">
              <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--c-text-dim)]">
                {current.purpose || "—"}
              </p>
            </Field>
            {current.status !== "pending" && (
              <Field
                label="处置"
                hint={`${current.decidedBy || "—"} · ${stamp(current.decidedAt)}`}
              >
                <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--c-text-dim)]">
                  {current.note || "没有写理由"}
                </p>
              </Field>
            )}
            {current.keyId && (
              <p className="font-mono text-[10px] text-[var(--c-text-mute)]">
                密钥编号 {current.keyId} · 配额{" "}
                {current.monthlyQuota > 0 ? formatCount(current.monthlyQuota) : "不限"}
              </p>
            )}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={decision !== null}
        title={decision?.next === "approve" ? "批准并签发密钥？" : "拒绝这条申请？"}
        detail={
          decision && (
            <>
              <p>
                {decision.next === "approve"
                  ? "批准后立即签发一把只读密钥，并写入审计。密钥明文只出现在下一个画面里。"
                  : "拒绝会关闭这条申请，记录保留。理由写入审计，申请人不会收到通知。"}
              </p>
              <p className="mt-2 font-mono text-[11px] text-[var(--c-text)]">
                {decision.row.name || "—"} · {decision.row.email}
              </p>
            </>
          )
        }
        extra={
          decision?.next === "approve" ? (
            <Field label="每月配额" hint="自然月重置；填 0 表示不限制">
              <TextInput
                value={quota}
                onChange={setQuota}
                type="number"
                min={0}
                placeholder={String(DEFAULT_QUOTA)}
              />
            </Field>
          ) : undefined
        }
        reasonLabel={decision?.next === "approve" ? "备注（可选，写入审计）" : "理由（写入审计）"}
        reasonPlaceholder={
          decision?.next === "approve"
            ? "例如：个人博客引用条目，量级与默认配额相符"
            : "例如：用途描述不足以判断，或与数据许可冲突"
        }
        requireReason={decision?.next !== "approve"}
        confirmLabel={decision?.next === "approve" ? "批准并签发" : "拒绝"}
        tone={decision?.next === "approve" ? "primary" : "danger"}
        busy={busy}
        onCancel={() => setDecision(null)}
        onConfirm={(reason) => void decide(reason)}
      />
    </div>
  );
}
