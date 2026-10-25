import { useState } from "react";
import { ApiError } from "../../api";
import { keysApi, type ApiKeyRow, type KeyUsagePoint } from "../api";
import { useShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, Field, INPUT_CLASS, TextInput } from "../components/Field";
import { KpiCard } from "../components/KpiCard";
import { RangePicker } from "../components/RangePicker";
import { StatusPill } from "../components/StatusPill";
import { LineChart } from "../components/charts";
import { dayShort, formatCount, relativeTime, stamp } from "../format";
import { useResource } from "../hooks/useResource";

/**
 * The open-data API: credentials people hold, and how much of the quota they use.
 *
 * The one interaction that shapes the whole page is that a key's plaintext exists
 * for exactly one response. So the drawer has two states — compose, then a
 * copy-once box that says out loud "close this and it is gone". Everything else
 * (prefix, quota, last use) is shown in the clear because all of it is safe to
 * lose, and a credential you cannot audit the usage of is a credential you will
 * forget is live.
 *
 * Revocation keeps the row. `POST /keys/{id}/revoke` is idempotent and the first
 * timestamp sticks, so "who had this in March" stays answerable.
 */

const DEFAULT_QUOTA = 1000;
const USAGE_RANGES = [7, 30, 90] as const;

const ERROR_TEXT: Record<string, string> = {
  name_required: "名称为空",
  invalid_scope: "权限范围不被支持",
  key_not_found: "密钥不存在",
  forbidden: "当前角色无权管理密钥",
};

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "未知错误";
  return ERROR_TEXT[error.code] ?? error.code;
}

type Panel =
  | { mode: "create" }
  | { mode: "secret"; row: ApiKeyRow; plaintext: string }
  | null;

export function ApiKeys() {
  const { notify, refreshOverview, reload } = useShell();

  const [days, setDays] = useState<number>(30);
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState("");
  const [quota, setQuota] = useState(String(DEFAULT_QUOTA));
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [busy, setBusy] = useState(false);

  const keys = useResource((signal) => keysApi.list(signal), [reload]);
  const usage = useResource((signal) => keysApi.usage(days, signal), [days, reload]);

  const rows = keys.data?.items ?? [];
  const series: KeyUsagePoint[] = usage.data?.series ?? [];
  const active = rows.filter((row) => row.active).length;
  const monthRequests = rows.reduce((sum, row) => sum + row.monthRequests, 0);
  const monthErrors = rows.reduce((sum, row) => sum + row.monthErrors, 0);
  const overQuota = keys.data?.overQuota ?? 0;

  const openCreate = () => {
    setName("");
    setQuota(String(DEFAULT_QUOTA));
    setPanel({ mode: "create" });
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify("warn", "请先给密钥起一个名字：以后认出它属于谁，全靠这一行");
      return;
    }
    const parsed = Number.parseInt(quota || "0", 10);
    setBusy(true);
    try {
      const response = await keysApi.create({
        name: trimmed,
        monthlyQuota: Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_QUOTA,
      });
      // Straight into the copy-once state: the create form is gone in the same
      // tick, so there is no way to mint a second key from a stale form.
      setPanel({ mode: "secret", row: response.key, plaintext: response.plaintext });
      await keys.refresh();
      void usage.refresh();
      refreshOverview();
    } catch (error) {
      notify("danger", `创建失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await keysApi.revoke(revoking.id);
      notify("ok", `已吊销 ${revoking.prefix}…，调用方下一次请求就会收到 401`);
      setRevoking(null);
      await keys.refresh();
      refreshOverview();
    } catch (error) {
      notify("danger", `吊销失败：${describe(error)}`);
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

  const columns: Column<ApiKeyRow>[] = [
    {
      key: "name",
      header: "名称",
      render: (row) => (
        <>
          <span className="block text-[12px] text-[var(--c-text)]">{row.name}</span>
          <span className="block text-[10px] text-[var(--c-text-mute)]">
            {row.createdBy || "—"} · {stamp(row.createdAt)}
          </span>
        </>
      ),
    },
    {
      key: "prefix",
      header: "前缀",
      width: "9rem",
      render: (row) => (
        <span className="font-mono text-[11px] text-[var(--c-text-dim)]">{row.prefix}…</span>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "6rem",
      render: (row) => <StatusPill status={row.active ? "active" : "revoked"} />,
    },
    {
      key: "usage",
      header: "本月用量",
      width: "10rem",
      align: "right",
      render: (row) => {
        const cap = row.monthlyQuota || 0;
        const exhausted = cap > 0 && row.monthRequests >= cap;
        return (
          <>
            <span className={exhausted ? "text-[var(--c-danger)]" : ""}>
              {formatCount(row.monthRequests)}
            </span>
            <span className="text-[var(--c-text-mute)]">
              {" / "}
              {cap > 0 ? formatCount(cap) : "不限"}
            </span>
            {row.monthErrors > 0 && (
              <span className="ml-1.5 text-[10px] text-[var(--c-warn)]">错 {row.monthErrors}</span>
            )}
          </>
        );
      },
    },
    {
      key: "lastUsed",
      header: "最近使用",
      width: "7rem",
      hideBelow: "md",
      render: (row) => (
        <span title={row.lastUsedAt ?? "从未被调用"}>{relativeTime(row.lastUsedAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "6rem",
      render: (row) =>
        row.active ? (
          <Button tone="ghost" onClick={() => setRevoking(row)}>
            吊销
          </Button>
        ) : (
          <span className="text-[10px] text-[var(--c-text-mute)]">{stamp(row.revokedAt)}</span>
        ),
    },
  ];

  if (keys.error && !keys.data) {
    return (
      <ErrorState
        title="密钥列表加载失败"
        detail={keys.error instanceof ApiError ? describe(keys.error) : undefined}
        action={<Button onClick={() => void keys.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="生效密钥"
          value={formatCount(active)}
          unit={`/ ${formatCount(rows.length)}`}
          hint="已吊销的记录保留在表里，用于回答「三月时谁能读」"
        />
        <KpiCard
          label="本月请求"
          value={formatCount(monthRequests)}
          hint={`自 ${keys.data?.monthStart ?? "本月 1 日"} 起，全部密钥合计`}
        />
        <KpiCard
          label="本月错误"
          value={formatCount(monthErrors)}
          hint="4xx 与 5xx 都算；被配额拒绝的请求也计入"
        />
        <KpiCard
          label="超配额"
          value={formatCount(overQuota)}
          unit="个"
          hint="本月用量已达各自上限的生效密钥数"
        />
      </div>

      <Card
        title="每日请求"
        action={
          <RangePicker value={days} onChange={setDays} options={USAGE_RANGES} />
        }
      >
        {series.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-[var(--c-text-mute)]">还没有调用记录</p>
        ) : (
          <LineChart
            labels={series.map((point) => dayShort(point.day))}
            series={[
              { key: "requests", label: "请求", values: series.map((point) => point.count) },
              {
                key: "errors",
                label: "错误",
                values: series.map((point) => point.errors),
                tone: "var(--c-danger)",
              },
            ]}
            height={150}
          />
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <p className="text-[11px] text-[var(--c-text-dim)]">
          共 {formatCount(rows.length)} 个密钥 · 本月合计 {formatCount(monthRequests)} 次请求
        </p>
        <div className="flex items-center gap-2">
          <Button tone="primary" onClick={openCreate}>
            新建密钥
          </Button>
          <Button tone="ghost" onClick={() => void keys.refresh()} disabled={keys.loading}>
            {keys.loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={keys.loading && rows.length === 0}
        emptyTitle="还没有发过密钥"
        emptyDetail="密钥只发给确实要调用接口的一方。明文只在创建响应里出现一次，之后库里只有 sha256 摘要。"
        emptyAction={
          <Button tone="primary" onClick={openCreate}>
            新建密钥
          </Button>
        }
      />

      <Card title="关于开放 API">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          <li>
            <span className="text-[var(--c-text-mute)]">端点</span> — GET
            /api/v1/open/events 与 /api/v1/open/events/&#123;slug&#125;，请求头 X-API-Key。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">口径</span> — 只返回已入档条目，与公开页面完全一致；
            暂缓与已下架的内容对密钥同样不可见，内部按语永不进入响应。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">配额</span> — 按自然月计数，0 表示不限；
            超限返回 429 并带上剩余配额头。被拒绝的请求也计一次，因为它的确打到了门口。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">总开关</span> — OPEN_API_ENABLED=false 时
            所有 /api/v1/open/* 返回 404，密钥行保持不变。
          </li>
        </ul>
      </Card>

      <Drawer
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panel?.mode === "secret" ? "新密钥（只显示这一次）" : "新建 API 密钥"}
        subtitle={
          panel?.mode === "secret"
            ? "关闭后无法再次取回，只能吊销重建"
            : "给谁用就写谁的名字，以后对账全靠它"
        }
        footer={
          panel?.mode === "secret" ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-[var(--c-text-mute)]">
                建议直接存进对方的密钥管理系统
              </span>
              <Button tone="primary" onClick={() => setPanel(null)}>
                我已保存
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button tone="ghost" onClick={() => setPanel(null)} disabled={busy}>
                取消
              </Button>
              <Button tone="primary" onClick={() => void create()} disabled={busy}>
                {busy ? "创建中…" : "创建"}
              </Button>
            </div>
          )
        }
      >
        {panel?.mode === "secret" ? (
          <div className="space-y-3">
            <p className="rounded-[var(--c-radius)] border border-[#4a3d22] bg-[#241d12] px-3 py-2 text-[11px] leading-5 text-[var(--c-warn)]">
              这是唯一一次能看到完整密钥的时刻。关闭本抽屉后，服务端只剩下 sha256 摘要，
              任何接口都无法把它还原出来。
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
                前缀 {panel.row.prefix}… · 名称 {panel.row.name} · 配额{" "}
                {panel.row.monthlyQuota > 0 ? formatCount(panel.row.monthlyQuota) : "不限"}
              </span>
            </div>
            <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
              调用示例：curl -H &quot;X-API-Key: {panel.row.prefix}…&quot;
              https://aihist.net/api/v1/open/events
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="名称" hint="写给未来回看的自己：谁在用、为什么发">
              <TextInput value={name} onChange={setName} placeholder="例如：合作伙伴 A · 数据看板" />
            </Field>
            <Field label="每月配额" hint="自然月重置；填 0 表示不限制">
              <TextInput
                value={quota}
                onChange={setQuota}
                type="number"
                min={0}
                placeholder={String(DEFAULT_QUOTA)}
              />
            </Field>
            <Field label="权限范围" hint="本期只有只读权限，读写权限等有真实需求再加">
              <TextInput value="read" onChange={() => undefined} readOnly />
            </Field>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={revoking !== null}
        title="吊销这个密钥？"
        detail={
          revoking && (
            <>
              <p>
                调用方在下一次请求时立即收到 401。记录会保留，吊销时间只写一次，
                所以「什么时候停的」仍然可查。
              </p>
              <p className="mt-2 font-mono text-[11px] text-[var(--c-text)]">
                {revoking.name} · {revoking.prefix}…
              </p>
            </>
          )
        }
        confirmLabel="吊销"
        tone="danger"
        requireReason={false}
        busy={busy}
        onCancel={() => setRevoking(null)}
        onConfirm={() => void revoke()}
      />
    </div>
  );
}
