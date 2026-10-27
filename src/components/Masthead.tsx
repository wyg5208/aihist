import { formatCount, relativeTime, staleLabel } from "../lib/format";
import { ARCHIVE_START_YEAR } from "../lib/eras";

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

/**
 * The hero. One column of type, one row of actions, and the four numbers the
 * archive can actually count — the sync detail that used to sit in a second
 * column now lives on the rule above it, where it costs a line instead of a
 * block.
 *
 * Subscribe comes first and the open API second: those are the two things a
 * first-time reader should be able to act on without scrolling, and the header
 * repeats them for anyone who arrives mid-page.
 */
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
    <header className="pt-6 sm:pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-[var(--ink)] pb-2.5 font-mono text-[11.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
        <p className="text-[var(--ink-soft)]">
          Vol. I · {ARCHIVE_START_YEAR}—{new Date().getFullYear()}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="flex items-center gap-2 whitespace-nowrap">
            <span
              className="sync-dot"
              data-state={running ? "running" : "idle"}
              aria-hidden="true"
            />
            {running ? "后台采集中" : "后台定时更新"}
          </p>
          <p role="status" aria-live="polite" className="max-w-[42rem] truncate">
            {notice}
          </p>
        </div>
      </div>

      <div className="mt-7">
        <h1 className="font-serif text-[clamp(3.1rem,8.4vw,6.4rem)] leading-[0.87] tracking-[-0.03em] text-[var(--ink)]">
          AI 纪年
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">
          人工智能发展编年史
        </p>
        <p className="mt-4 max-w-[52rem] text-pretty text-[15.5px] leading-8 text-[var(--ink-soft)] sm:text-[16.5px]">
          记录人工智能的关键节点、模型发布与重要研究。条目来自公开接口与官方公告，经过去重与
          交叉验证后入档；自动条目还要经五家厂商各一席的模型评审，至少三票同意且中位分不低于
          75 才收录。置信度、证据与评审票型随每条记录公开。
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <a className="btn btn-cta" href="/api/v1/subscribe?src=hero">
            订阅更新
          </a>
          <a className="btn btn-outline" href="/api/v1/open/apply">
            申请 API Key
          </a>
          <a className="btn btn-outline" href="/api/v1/correct">
            提交纠错
          </a>
          <span className="text-[12.5px] text-[var(--muted)]">
            每周一封，只写新增；API 免费额度每秒 5 次
          </span>
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
      className={`px-1 py-3.5 sm:px-4 sm:py-4 ${
        last ? "" : "border-b border-[var(--rule)] sm:border-b-0 sm:border-r"
      }`}
    >
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1.5 font-serif text-2xl leading-none text-[var(--ink)] sm:text-3xl">
        {value}
      </dd>
      <dd className="mt-2 font-mono text-[11.5px] text-[var(--muted)]">{note}</dd>
    </div>
  );
}
