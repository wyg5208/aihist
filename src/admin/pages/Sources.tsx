import { useState } from "react";
import { ApiError } from "../../api";
import { sourcesApi, type ProbeResult, type SourceRegistryRow } from "../api";
import { useShell } from "../components/AppShell";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, Field, Select, TextInput } from "../components/Field";
import { StatusPill } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";
import { duration, formatCount, ratio, relativeTime, stamp } from "../format";

/**
 * The source catalogue, as configuration rather than code.
 *
 * Two things separate this page from the health matrix it replaces. A source that
 * has never been probed is a first-class row with a `需探活` badge — because "we
 * never tried" and "we tried and it failed" are different answers. And adding a
 * source is a form, not a deploy: the catalogue lives in `ingest_sources`, so a
 * new feed takes effect on the next run.
 *
 * Enabling is gated server-side on `verified_at`. The UI mirrors that rule
 * instead of hiding the button, so the 409 is a bug report rather than a mystery.
 */

const FAMILY_OPTIONS = [
  { value: "official", label: "官方公告" },
  { value: "media", label: "媒体报道" },
  { value: "community", label: "社区讨论" },
  { value: "arxiv", label: "论文预印本" },
  { value: "paper", label: "学术期刊" },
  { value: "policy", label: "监管原文" },
  { value: "openrouter", label: "模型目录" },
  { value: "huggingface", label: "开源模型库" },
  { value: "reference", label: "参考资料" },
];

const KIND_OPTIONS = [
  { value: "feed", label: "RSS / Atom" },
  { value: "sitemap", label: "Sitemap" },
  { value: "arxiv", label: "arXiv API" },
  { value: "openrouter", label: "OpenRouter API" },
  { value: "hf", label: "Hugging Face API" },
  { value: "hn", label: "Hacker News API" },
];

const FAMILY_LABELS: Record<string, string> = Object.fromEntries(
  FAMILY_OPTIONS.map((option) => [option.value, option.label]),
);

function verdict(source: SourceRegistryRow): { status: string; text: string } {
  if (!source.enabled) return { status: "disabled", text: "已停用" };
  if (source.totalRuns === 0) return { status: "paused", text: "启用未运行" };
  if (source.consecutiveFailures >= 3) return { status: "failed", text: `连续失败 ${source.consecutiveFailures} 次` };
  if (source.consecutiveFailures > 0) return { status: "partial", text: `失败 ${source.consecutiveFailures} 次` };
  return { status: "succeeded", text: "正常" };
}

interface Draft {
  key: string;
  name: string;
  family: string;
  kind: string;
  url: string;
  pathPattern: string;
  domestic: boolean;
  aiOnly: boolean;
  timeoutMs: string;
  rationale: string;
}

const EMPTY_DRAFT: Draft = {
  key: "",
  name: "",
  family: "official",
  kind: "feed",
  url: "",
  pathPattern: "/news/",
  domestic: false,
  aiOnly: false,
  timeoutMs: "12000",
  rationale: "",
};

function ProbePanel({ probe }: { probe: ProbeResult }) {
  return (
    <div className="space-y-2 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <StatusPill tone={probe.ok ? "ok" : "danger"}>{probe.ok ? "可解析" : probe.error ?? "失败"}</StatusPill>
        <span className="num text-[10px] text-[var(--c-text-mute)]">
          {probe.itemCount} 条 · {duration(probe.ms)}
          {probe.latestAt ? ` · 最新 ${probe.latestAt}` : ""}
          {probe.status ? ` · HTTP ${probe.status}` : ""}
        </span>
      </div>
      {probe.sample.length > 0 ? (
        <ul className="space-y-1">
          {probe.sample.map((item, index) => (
            <li key={`${item.url}-${index}`} className="flex items-baseline gap-2 text-[11px]">
              <span className="num flex-none text-[10px] text-[var(--c-text-mute)]">
                {item.publishedAt ?? "—"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--c-text-dim)]" title={item.title}>
                {item.title || "（无标题）"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
          {probe.ok
            ? "解析成功但没有条目：解析器与站点结构不匹配，先不要启用。"
            : "抓取或解析失败：检查地址、类型与站点是否改版。"}
        </p>
      )}
    </div>
  );
}

/** One copy of the form, used by both "add" and "edit". */
function SourceForm({
  draft,
  onChange,
  probe,
  busy,
  onProbe,
}: {
  draft: Draft;
  onChange: (next: Partial<Draft>) => void;
  probe: ProbeResult | null;
  busy: boolean;
  onProbe: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="key（小写+连字符，创建后不可改）">
          <TextInput value={draft.key} onChange={(value) => onChange({ key: value.trim().toLowerCase() })} placeholder="meta-ai" />
        </Field>
        <Field label="名称">
          <TextInput value={draft.name} onChange={(value) => onChange({ name: value })} placeholder="Meta AI Blog" />
        </Field>
        <Field label="覆盖族">
          <Select value={draft.family} onChange={(value) => onChange({ family: value })} options={FAMILY_OPTIONS} />
        </Field>
        <Field label="抓取类型">
          <Select value={draft.kind} onChange={(value) => onChange({ kind: value })} options={KIND_OPTIONS} />
        </Field>
      </div>

      <Field label="地址" hint="只允许 http/https，端口限 80/443/8080/8443，内网地址会被拒绝。">
        <TextInput value={draft.url} onChange={(value) => onChange({ url: value })} placeholder="https://example.com/feed/" />
      </Field>

      {draft.kind === "sitemap" && (
        <Field label="路径前缀" hint="只收录 URL 里含该片段的条目。">
          <TextInput value={draft.pathPattern} onChange={(value) => onChange({ pathPattern: value })} />
        </Field>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <Field label="超时 ms">
          <TextInput
            value={draft.timeoutMs}
            onChange={(value) => onChange({ timeoutMs: value.replace(/[^\d]/g, "").slice(0, 5) })}
          />
        </Field>
        <Field label="国内源">
          <Select
            value={draft.domestic ? "1" : "0"}
            onChange={(value) => onChange({ domestic: value === "1" })}
            options={[
              { value: "0", label: "否" },
              { value: "1", label: "是" },
            ]}
          />
        </Field>
        <Field label="仅 AI 相关" hint="未命中主题词会以「非 AI 相关」丢弃。">
          <Select
            value={draft.aiOnly ? "1" : "0"}
            onChange={(value) => onChange({ aiOnly: value === "1" })}
            options={[
              { value: "0", label: "否" },
              { value: "1", label: "是" },
            ]}
          />
        </Field>
      </div>

      <Field label="收录理由（审计用）" hint="写清为什么需要这个源；一年后回看时，这句话是唯一能解释配置的线索。">
        <TextInput value={draft.rationale} onChange={(value) => onChange({ rationale: value })} />
      </Field>

      <div className="flex items-center gap-2">
        <Button onClick={onProbe} disabled={busy || !draft.url}>
          {busy ? "探活中…" : "先探活"}
        </Button>
        <span className="text-[10px] leading-4 text-[var(--c-text-mute)]">
          探活只抓一次、不落库；保存后仍需在行内探活成功才能启用。
        </span>
      </div>

      {probe && <ProbePanel probe={probe} />}
    </div>
  );
}

export function Sources() {
  const { notify, reload } = useShell();
  const registry = useResource((signal) => sourcesApi.registry(signal), [reload]);
  const rows = registry.data?.items ?? [];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SourceRegistryRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setProbe(null);
    setCreating(true);
  };

  const openEdit = (row: SourceRegistryRow) => {
    setDraft({
      key: row.key,
      name: row.name,
      family: row.family,
      kind: row.kind,
      url: row.url,
      pathPattern: "/news/",
      domestic: row.domestic ?? false,
      aiOnly: row.aiOnly ?? false,
      timeoutMs: String(12000),
      rationale: row.rationale ?? "",
    });
    setProbe(null);
    setEditing(row);
  };

  const runProbe = async () => {
    setBusy(true);
    try {
      const result = await sourcesApi.probe({
        url: draft.url,
        kind: draft.kind,
        pathPattern: draft.pathPattern,
        timeoutMs: Number(draft.timeoutMs) || 12000,
      });
      setProbe(result.probe);
      notify(result.probe.ok ? "ok" : "warn", result.probe.ok ? `探活成功：${result.probe.itemCount} 条` : `探活失败：${result.probe.error}`);
    } catch (error) {
      notify("danger", error instanceof ApiError ? `探活失败：${error.code}` : "探活失败");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await sourcesApi.update(editing.key, {
          name: draft.name,
          family: draft.family,
          kind: draft.kind,
          url: draft.url,
          pathPattern: draft.pathPattern,
          domestic: draft.domestic,
          aiOnly: draft.aiOnly,
          timeoutMs: Number(draft.timeoutMs) || 12000,
          rationale: draft.rationale,
        });
        notify("ok", `已保存 ${editing.key}`);
        setEditing(null);
      } else {
        await sourcesApi.create({
          key: draft.key,
          name: draft.name,
          family: draft.family,
          kind: draft.kind,
          url: draft.url,
          pathPattern: draft.pathPattern,
          domestic: draft.domestic,
          aiOnly: draft.aiOnly,
          timeoutMs: Number(draft.timeoutMs) || 12000,
          rationale: draft.rationale,
        });
        notify("ok", `已加入目录 ${draft.key}，探活成功后可启用`);
        setCreating(false);
      }
      await registry.refresh();
    } catch (error) {
      notify("danger", error instanceof ApiError ? `保存失败：${error.code}` : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  /** Probe a stored row, then enable it — the only path to `enabled=true`. */
  const verifyThenEnable = async (row: SourceRegistryRow) => {
    setRowBusy(row.key);
    try {
      const result = await sourcesApi.verify(row.key);
      if (!result.probe.ok) {
        notify("warn", `探活未通过（${result.probe.error}），无法启用`);
      } else {
        await sourcesApi.setEnabled(row.key, true);
        notify("ok", `${row.key} 探活通过（${result.probe.itemCount} 条），已启用`);
      }
      await registry.refresh();
    } catch (error) {
      notify("danger", error instanceof ApiError ? `操作失败：${error.code}` : "操作失败");
    } finally {
      setRowBusy(null);
    }
  };

  const toggle = async (row: SourceRegistryRow) => {
    if (!row.enabled && !row.verifiedAt) {
      await verifyThenEnable(row);
      return;
    }
    setRowBusy(row.key);
    try {
      await sourcesApi.setEnabled(row.key, !row.enabled);
      notify("ok", `${row.key} 已${row.enabled ? "停用" : "启用"}`);
      await registry.refresh();
    } catch (error) {
      notify("danger", error instanceof ApiError ? `操作失败：${error.code}` : "操作失败");
    } finally {
      setRowBusy(null);
    }
  };

  const enabled = rows.filter((row) => row.enabled);
  const failing = rows.filter((row) => row.consecutiveFailures >= 3);
  const unverified = rows.filter((row) => !row.verifiedAt);
  const families = new Set(rows.map((row) => row.family).filter(Boolean));

  const columns: Column<SourceRegistryRow>[] = [
    {
      key: "name",
      header: "来源",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[12px] text-[var(--c-text)]">{row.name}</p>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
            {row.key} · {FAMILY_LABELS[row.family] ?? row.family ?? "—"}
          </p>
        </div>
      ),
    },
    {
      key: "enabled",
      header: "启用",
      width: "6rem",
      render: (row) => {
        const state = verdict(row);
        return (
          <div className="space-y-1">
            <StatusPill status={state.status} title={row.lastError || undefined}>
              {state.text}
            </StatusPill>
            {!row.verifiedAt && (
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--c-warn)]">需探活</p>
            )}
          </div>
        );
      },
    },
    {
      key: "kind",
      header: "类型",
      width: "6rem",
      hideBelow: "md",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--c-text-mute)]">{row.kind || "—"}</span>
      ),
    },
    {
      key: "url",
      header: "覆盖地址",
      hideBelow: "lg",
      render: (row) => (
        <span className="block max-w-[18rem] truncate font-mono text-[10px] text-[var(--c-text-dim)]" title={row.url}>
          {row.url || "—"}
        </span>
      ),
    },
    {
      key: "verified",
      header: "最近探活",
      width: "7rem",
      hideBelow: "lg",
      render: (row) => (
        <span className={row.verifiedAt ? "" : "text-[var(--c-warn)]"}>
          {row.verifiedAt ? relativeTime(row.verifiedAt) : "从未"}
        </span>
      ),
    },
    {
      key: "items",
      header: "上次条目",
      width: "5.5rem",
      align: "right",
      hideBelow: "sm",
      render: (row) => formatCount(row.lastItemCount),
    },
    {
      key: "ms",
      header: "耗时",
      width: "5rem",
      align: "right",
      hideBelow: "lg",
      render: (row) => duration(row.lastMs),
    },
    {
      key: "rate",
      header: "成功率",
      width: "5.5rem",
      align: "right",
      hideBelow: "lg",
      render: (row) =>
        row.totalRuns === 0 ? (
          <span className="text-[var(--c-text-mute)]">—</span>
        ) : (
          ratio(row.totalRuns - row.totalFailures, row.totalRuns, 0)
        ),
    },
    {
      key: "actions",
      header: "操作",
      width: "10rem",
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => void toggle(row)} disabled={rowBusy === row.key}>
            {row.enabled ? "停用" : row.verifiedAt ? "启用" : "探活并启用"}
          </Button>
          <Button tone="ghost" onClick={() => openEdit(row)} disabled={rowBusy === row.key}>
            编辑
          </Button>
        </div>
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

  if (registry.error && !registry.data) {
    return (
      <ErrorState
        title="来源目录加载失败"
        detail={registry.error instanceof ApiError ? registry.error.code : undefined}
        action={<Button onClick={() => void registry.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "注册来源", value: `${rows.length}`, hint: "目录来自 ingest_sources 表" },
          { label: "启用中", value: `${enabled.length}`, hint: "下一次采集会请求这些源" },
          { label: "连续失败", value: `${failing.length}`, hint: "≥3 次视为端点故障", tone: failing.length > 0 },
          { label: "从未探活", value: `${unverified.length}`, hint: "未探活不可启用", tone: unverified.length > 0 },
          { label: "覆盖族数", value: `${families.size}`, hint: "官方 / 媒体 / 学术 / 监管…" },
        ].map((item) => (
          <Card key={item.label}>
            <p className="label">{item.label}</p>
            <p className={`num mt-1 text-[20px] ${item.tone ? "text-[var(--c-warn)]" : "text-[var(--c-text)]"}`}>
              {item.value}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--c-text-mute)]">{item.hint}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <p className="text-[11px] leading-5 text-[var(--c-text-dim)]">
          改源不需要发版：新增/编辑/启停都写进 <span className="font-mono">ingest_sources</span>，下一次采集立即生效。
          启用前必须先探活成功（服务端强制）。
        </p>
        <div className="flex items-center gap-1.5">
          <Button tone="primary" onClick={openCreate}>
            添加来源
          </Button>
          <Button tone="ghost" onClick={() => void registry.refresh()} disabled={registry.loading}>
            {registry.loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={[...rows].sort(
          (a, b) =>
            Number(b.enabled) - Number(a.enabled) ||
            b.consecutiveFailures - a.consecutiveFailures ||
            a.name.localeCompare(b.name),
        )}
        rowKey={(row) => row.key}
        loading={registry.loading}
        emptyTitle="目录是空的"
        emptyDetail="运行一次采集会自动灌入种子目录，或用「添加来源」逐条加入。"
      />

      <Drawer
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `编辑来源 · ${editing.key}` : "添加来源"}
        subtitle="先探活，再保存；启用是第三步，由服务端校验 verified_at"
        width="42rem"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] leading-4 text-[var(--c-text-mute)]">
              {editing
                ? "改地址或类型会清空最近探活时间并自动停用，需重新探活。"
                : "保存后条目处于停用状态，行内探活通过即可启用。"}
            </span>
            <div className="flex gap-1.5">
              <Button
                tone="ghost"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                取消
              </Button>
              <Button tone="primary" onClick={() => void save()} disabled={busy || !draft.key || !draft.url}>
                保存
              </Button>
            </div>
          </div>
        }
      >
        <SourceForm
          draft={draft}
          onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
          probe={probe}
          busy={busy}
          onProbe={() => void runProbe()}
        />
      </Drawer>

      <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
        连续失败 3 次以上会在总览页报警；单次失败只记录，不改收录判定。停用某个源后，下一次采集不再请求它，
        历史健康数据与采集库里的记录都会保留。最近的探活时间：{rows[0]?.verifiedAt ? stamp(rows[0].verifiedAt) : "—"}。
      </p>
    </div>
  );
}
