import { formatCount, relativeTime, staleLabel } from "../lib/format";

interface Props {
  total: number;
  modelCount: number;
  familyCount: number;
  lastSuccessAt: string | null;
  stale: boolean;
  running: boolean;
  notice: string;
  onStandard: () => void;
}

export function Masthead({
  total,
  modelCount,
  familyCount,
  lastSuccessAt,
  stale,
  running,
  notice,
  onStandard,
}: Props) {
  return (
    <header className="pt-6 sm:pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--ink)] pb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-soft)] sm:text-[11px]">
        <p>AI Chronicle · 公开来源采集与交叉验证</p>
        <div className="flex items-baseline gap-4">
          <button
            type="button"
            onClick={onStandard}
            className="underline decoration-[var(--rule-strong)] underline-offset-4 transition-colors hover:text-[var(--accent)]"
          >
            收录标准
          </button>
          <p className="text-[var(--muted)]">Vol. I · 1950—{new Date().getFullYear()}</p>
        </div>
      </div>

      <div className="mt-8 grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <h1 className="font-serif text-[clamp(3.4rem,9vw,6.8rem)] leading-[0.86] tracking-[-0.03em] text-[var(--ink)]">
            AI 纪年
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            记录人工智能的关键节点、模型发布与重要研究。条目来自公开接口与官方公告，
            经过去重与交叉验证后入档；自动条目还要通过三个独立模型评审，至少两票同意。
            置信度、证据与评审票型随每条记录公开。
          </p>
        </div>

        <div className="lg:pb-1">
          <p className="flex min-w-[13rem] items-center gap-2 border-b border-[var(--rule)] pb-2 font-mono text-[11px] uppercase tracking-[0.18em]">
            <span
              className="sync-dot"
              data-state={running ? "running" : "idle"}
              aria-hidden="true"
            />
            {running ? "后台采集中" : "后台定时更新"}
          </p>
          <p
            className="mt-2 max-w-[16rem] font-mono text-[10px] leading-4 tracking-wide text-[var(--muted)]"
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>
          <a
            href="/admin/"
            className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] underline underline-offset-4 transition-colors hover:text-[var(--accent)]"
          >
            管理台
          </a>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 border-y border-[var(--rule)] sm:grid-cols-4">
        <Stat label="条目" value={formatCount(total)} note="已入档事件" />
        <Stat label="模型" value={formatCount(modelCount)} note="模型发布记录" />
        <Stat label="来源类别" value={formatCount(familyCount)} note="已入档的来源类别" />
        <Stat
          label="最近同步"
          value={lastSuccessAt ? relativeTime(lastSuccessAt) : "待建立"}
          note={staleLabel(lastSuccessAt, stale)}
          last
        />
      </dl>
    </header>
  );
}

function Stat({
  label,
  value,
  note,
  last = false,
}: {
  label: string;
  value: string;
  note: string;
  last?: boolean;
}) {
  return (
    <div
      className={`px-1 py-4 sm:px-4 sm:py-5 ${
        last ? "" : "border-b border-[var(--rule)] sm:border-b-0 sm:border-r"
      }`}
    >
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1.5 font-serif text-2xl leading-none text-[var(--ink)] sm:text-3xl">
        {value}
      </dd>
      <dd className="mt-2 font-mono text-[10px] text-[var(--muted)]">{note}</dd>
    </div>
  );
}
