import { useState } from "react";
import { ApiError } from "../../api";
import { partnersApi, type PartnerRow, type PartnerWrite } from "../api";
import { useShell } from "../components/AppShell";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, Field, INPUT_CLASS, Select, TextInput } from "../components/Field";
import { KpiCard } from "../components/KpiCard";
import { RangePicker } from "../components/RangePicker";
import { StatusPill } from "../components/StatusPill";
import { formatCount, partnerKindLabel } from "../format";
import { useResource } from "../hooks/useResource";

/**
 * The partner ledger: who we have an agreement with, and whether the link works.
 *
 * Nothing here influences collection or ranking. A sponsorship buys a `/go/<code>`
 * link and a line in the ledger; that sentence is printed on the page because a
 * console that lets you forget it is a console that will eventually sell position.
 *
 * `/go` is a separate root route rather than an API path: it is a link people
 * paste, and the click it records is the only number the counterparty looks at —
 * hence bots are recorded as bots and excluded from the count shown here.
 */

const KINDS = [
  { value: "sponsor", label: "赞助商" },
  { value: "partner", label: "合作方" },
  { value: "mirror", label: "镜像站" },
];

const STATUSES = [
  { value: "prospect", label: "洽谈中" },
  { value: "active", label: "生效中" },
  { value: "paused", label: "已暂停" },
  { value: "ended", label: "已结束" },
];

const ERROR_TEXT: Record<string, string> = {
  name_required: "名称为空",
  invalid_code: "跳转代号只允许小写字母、数字与连字符，2–24 位",
  code_taken: "这个代号已被占用",
  invalid_kind: "合作类型不被支持",
  invalid_status: "状态不被支持",
  invalid_target_url: "目标地址必须是完整的 http(s) URL",
  invalid_starts_on: "开始日期格式应为 YYYY-MM-DD",
  invalid_ends_on: "结束日期格式应为 YYYY-MM-DD",
  nothing_to_update: "没有任何字段被修改",
  partner_not_found: "合作方不存在",
  forbidden: "当前角色无权管理合作台账",
};

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "未知错误";
  return ERROR_TEXT[error.code] ?? error.code;
}

/** Local calendar day; the backend buckets on UTC+8, so this is a display hint only. */
function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface Form {
  name: string;
  code: string;
  kind: string;
  status: string;
  targetUrl: string;
  contact: string;
  startsOn: string;
  endsOn: string;
  termsNote: string;
}

const EMPTY: Form = {
  name: "",
  code: "",
  kind: "sponsor",
  status: "prospect",
  targetUrl: "",
  contact: "",
  startsOn: "",
  endsOn: "",
  termsNote: "",
};

function toForm(row: PartnerRow): Form {
  return {
    name: row.name,
    code: row.code ?? "",
    kind: row.kind || "sponsor",
    status: row.status || "prospect",
    targetUrl: row.targetUrl ?? "",
    contact: row.contact,
    startsOn: row.startsOn ?? "",
    endsOn: row.endsOn ?? "",
    termsNote: row.termsNote,
  };
}

export function Partners() {
  const { notify, refreshOverview, reload } = useShell();

  const [days, setDays] = useState(30);
  /** `null` = closed; `{ row: null }` = creating. */
  const [editing, setEditing] = useState<{ row: PartnerRow | null } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);

  const ledger = useResource((signal) => partnersApi.list(days, signal), [days, reload]);
  const rows = ledger.data?.items ?? [];
  const today = todayKey();

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const live = (row: PartnerRow) =>
    row.status === "active" &&
    Boolean(row.targetUrl) &&
    (!row.startsOn || row.startsOn <= today) &&
    (!row.endsOn || row.endsOn >= today);

  const expired = (row: PartnerRow) => Boolean(row.endsOn && row.endsOn < today);

  const openCreate = () => {
    setForm(EMPTY);
    setEditing({ row: null });
  };

  const openEdit = (row: PartnerRow) => {
    setForm(toForm(row));
    setEditing({ row });
  };

  const save = async () => {
    const name = form.name.trim();
    const code = form.code.trim().toLowerCase();
    if (!name) {
      notify("warn", "请填写合作方名称");
      return;
    }
    if (!code) {
      notify("warn", "请填写跳转代号：/go/ 后面那一段就是它");
      return;
    }
    const payload: PartnerWrite = {
      name,
      code,
      kind: form.kind,
      status: form.status,
      // Empty strings become null so PATCH genuinely clears the column instead
      // of writing "" into a date field that is compared lexically.
      targetUrl: form.targetUrl.trim() || null,
      contact: form.contact.trim(),
      startsOn: form.startsOn.trim() || null,
      endsOn: form.endsOn.trim() || null,
      termsNote: form.termsNote.trim(),
    };
    setBusy(true);
    try {
      if (editing?.row) {
        await partnersApi.update(editing.row.id, payload);
        notify("ok", `已更新 ${name}，变更已写入审计`);
      } else {
        await partnersApi.create(payload);
        notify("ok", `已登记 ${name}：链接 /go/${code} 可以发出去了`);
      }
      setEditing(null);
      await ledger.refresh();
      refreshOverview();
    } catch (error) {
      notify("danger", `保存失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (code: string) => {
    const url = `${window.location.origin}/go/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("ok", "链接已复制");
    } catch {
      notify("warn", `复制被拒绝，链接是 ${url}`);
    }
  };

  const columns: Column<PartnerRow>[] = [
    {
      key: "name",
      header: "名称",
      render: (row) => (
        <>
          <span className="block text-[12px] text-[var(--c-text)]">{row.name}</span>
          <span className="block text-[10px] text-[var(--c-text-mute)]">{row.contact || "—"}</span>
        </>
      ),
    },
    {
      key: "kind",
      header: "类型",
      width: "6rem",
      hideBelow: "sm",
      render: (row) => (
        <span className="text-[11px] text-[var(--c-text-dim)]">{partnerKindLabel(row.kind)}</span>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "7rem",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill status={row.status} />
          {expired(row) && <StatusPill status="expired" />}
        </span>
      ),
    },
    {
      key: "link",
      header: "链接",
      width: "13rem",
      render: (row) => (
        <span className="block min-w-0">
          <button
            type="button"
            onClick={() => void copyLink(row.code ?? "")}
            title="复制完整链接"
            className="block max-w-full truncate font-mono text-[11px] text-[var(--c-text)] hover:text-[var(--c-accent)]"
          >
            /go/{row.code ?? "—"}
          </button>
          <span className="block truncate text-[10px] text-[var(--c-text-mute)]">
            {hostOf(row.targetUrl) || "未填写目标地址，链接会回首页"}
          </span>
        </span>
      ),
    },
    {
      key: "window",
      header: "期限",
      width: "10rem",
      hideBelow: "lg",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
          {row.startsOn || "—"} → {row.endsOn || "—"}
        </span>
      ),
    },
    {
      key: "clicks",
      header: "点击",
      width: "5rem",
      align: "right",
      render: (row) => (
        <span title={`近 ${days} 日，不含爬虫`}>{formatCount(row.clicks)}</span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "5rem",
      render: (row) => (
        <Button tone="ghost" onClick={() => openEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  if (ledger.error && !ledger.data) {
    return (
      <ErrorState
        title="合作台账加载失败"
        detail={ledger.error instanceof ApiError ? describe(ledger.error) : undefined}
        action={<Button onClick={() => void ledger.refresh()}>重试</Button>}
      />
    );
  }

  const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="台账条目" value={formatCount(rows.length)} hint="含已结束与洽谈中的记录，不删除" />
        <KpiCard
          label="生效中"
          value={formatCount(rows.filter(live).length)}
          hint="状态为生效中、有目标地址、且当天在期限窗口内"
        />
        <KpiCard
          label="窗口内点击"
          value={formatCount(totalClicks)}
          unit={`/ ${days} 日`}
          hint="只统计非爬虫点击；爬虫的访问单独记录，不混进这个数"
        />
        <KpiCard
          label="洽谈中"
          value={formatCount(rows.filter((row) => row.status === "prospect").length)}
          hint="还没有生效的合作方：填好目标地址与期限再改成生效中"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[var(--c-text-dim)]">
            共 {formatCount(rows.length)} 个合作方
          </span>
          <RangePicker
            value={days}
            onChange={setDays}
            options={[7, 30, 90]}
            hint="点击统计的窗口"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button tone="primary" onClick={openCreate}>
            新建合作
          </Button>
          <Button tone="ghost" onClick={() => void ledger.refresh()} disabled={ledger.loading}>
            {ledger.loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={ledger.loading && rows.length === 0}
        emptyTitle="还没有合作方"
        emptyDetail="登记一个合作方会得到一条 /go/<code> 链接；把它发给对方，点击次数会在这里按天统计。"
        emptyAction={
          <Button tone="primary" onClick={openCreate}>
            新建合作
          </Button>
        }
      />

      <Card title="边界">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          <li>
            <span className="text-[var(--c-text-mute)]">不干预收录</span> — 赞助与合作为内容零让步：
            不影响是否入档、不影响排序、不影响首页展示位。产品规划 C4 已定，这里只是把它写进界面。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">点击口径</span> — /go 每次跳转响应都带
            no-store，避免缓存把第二次点击吞掉；爬虫记录 is_bot=true，不计入此处数字。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">失效行为</span> — 状态不是生效中、没有目标地址、
            或超出期限窗口时，/go 一律 302 回首页，不报错、不记点击。
          </li>
        </ul>
      </Card>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.row ? `编辑 ${editing.row.name}` : "新建合作方"}
        subtitle="目标地址与期限一起决定链接是否生效"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] text-[var(--c-text-mute)]">
              {form.code ? `/go/${form.code.trim().toLowerCase()}` : "尚未填写代号"}
            </span>
            <div className="flex items-center gap-2">
              <Button tone="ghost" onClick={() => setEditing(null)} disabled={busy}>
                取消
              </Button>
              <Button tone="primary" onClick={() => void save()} disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="名称" hint="内部叫法即可，会出现在审计里">
            <TextInput value={form.name} onChange={(value) => set("name", value)} placeholder="例如：Acme 数据服务" />
          </Field>
          <Field label="跳转代号" hint="小写字母、数字与连字符，2–24 位；/go/<代号>">
            <TextInput
              value={form.code}
              onChange={(value) => set("code", value)}
              placeholder="acme"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="类型">
              <Select value={form.kind} onChange={(value) => set("kind", value)} options={KINDS} />
            </Field>
            <Field label="状态" hint="只有「生效中」且填了地址才会跳转">
              <Select value={form.status} onChange={(value) => set("status", value)} options={STATUSES} />
            </Field>
          </div>
          <Field label="目标地址" hint="必须是完整 http(s) 地址；留空则链接回首页">
            <TextInput
              value={form.targetUrl}
              onChange={(value) => set("targetUrl", value)}
              placeholder="https://example.com/?utm_source=aihist"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="开始日期" hint="YYYY-MM-DD，留空表示立即">
              <TextInput
                value={form.startsOn}
                onChange={(value) => set("startsOn", value)}
                placeholder="2026-03-01"
              />
            </Field>
            <Field label="结束日期" hint="YYYY-MM-DD，留空表示不设终点">
              <TextInput
                value={form.endsOn}
                onChange={(value) => set("endsOn", value)}
                placeholder="2026-06-30"
              />
            </Field>
          </div>
          <Field label="联系人" hint="只给内部看，不会出现在任何公开页面">
            <TextInput value={form.contact} onChange={(value) => set("contact", value)} placeholder="邮箱或微信" />
          </Field>
          <label className="block">
            <span className="label">约定备注</span>
            <textarea
              rows={4}
              value={form.termsNote}
              onChange={(event) => set("termsNote", event.target.value)}
              placeholder="合作内容、金额、露出方式、双方约束……"
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>
          {editing?.row && (
            <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
              保存会记录修改了哪些字段到审计。链接本身的点击不会因为编辑而清零。
            </p>
          )}
        </div>
      </Drawer>
    </div>
  );
}
