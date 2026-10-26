import type { PanelInfo, StatusResponse } from "../types";
import type { SyncPhase } from "../hooks/useSync";
import { formatTimestamp, relativeTime, sourceLabel } from "../lib/format";

interface Props {
  snapshot: StatusResponse | null;
  phase: SyncPhase;
  notice: string;
  panel: PanelInfo | null;
  onRefresh: () => void;
  onStandard: () => void;
}

const PHASE_LABEL: Record<SyncPhase, string> = {
  idle: "待命",
  running: "采集中",
  done: "已更新",
  failed: "读取失败",
};

export function SyncPanel({
  snapshot,
  phase,
  notice,
  panel,
  onRefresh,
  onStandard,
}: Props) {
  const runs = snapshot?.runs?.slice(0, 3) || [];
  const latest = runs[0] ?? null;
  const running = phase === "running" || Boolean(snapshot?.sync.running);

  return (
    <section className="rail-card" aria-labelledby="sync-heading">
      <div className="rail-heading">
        <h2 id="sync-heading">同步台</h2>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
          Sync desk
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span
          className="sync-dot"
          data-state={running ? "running" : phase}
          aria-hidden="true"
        />
        <p className="font-mono text-[12.5px] uppercase tracking-[0.16em]">
          {PHASE_LABEL[phase]}
          {latest && !running && (
            <span className="ml-2 text-[var(--muted)]">
              {latest.trigger === "manual" ? "手动" : "定时"}
            </span>
          )}
        </p>
      </div>

      <p className="mt-2 text-[13.5px] leading-5 text-[var(--ink-soft)]" aria-live="polite">
        {notice}
      </p>

      <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {panel
          ? panel.configured
            ? `评审面板 ${panel.models.length} 个模型 · 至少 ${panel.minVotes} 票`
            : "评审面板未配置"
          : "评审面板状态待读取"}
      </p>

      {panel && !panel.configured && (
        <p className="mt-2 border-l-2 border-[var(--accent)] pl-2 text-[12.5px] leading-5 text-[var(--ink-soft)]">
          未经评审的自动条目暂缓并隐藏，只保留人工校订条目。
          <button
            type="button"
            onClick={onStandard}
            className="ml-1 text-[var(--accent)] underline underline-offset-4"
          >
            查看收录标准
          </button>
        </p>
      )}

      {latest && (
        <dl className="mt-4 grid grid-cols-3 border-y border-[var(--rule)]">
          <Metric label="抓取" value={latest.rawCount} />
          <Metric label="新增" value={latest.createdCount} />
          <Metric label="合并" value={latest.mergedCount} />
        </dl>
      )}

      {latest && latest.failedSources.length > 0 && (
        <p className="mt-3 text-[12.5px] leading-5 text-[var(--accent)]">
          未取回：{latest.failedSources.map(sourceLabel).join("、")}
        </p>
      )}

      <div className="mt-5 border-t border-[var(--rule)] pt-3">
        <div className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--muted)]">
          <span>最近记录</span>
          <span>{snapshot?.sync.eventCount ? `${snapshot.sync.eventCount} 条在档` : "—"}</span>
        </div>
        <ol className="mt-2 space-y-2">
          {runs.length === 0 && (
            <li className="text-[12.5px] text-[var(--muted)]">还没有同步记录。</li>
          )}
          {runs.map((run) => (
            <li key={run.id} className="grid grid-cols-[1fr_auto] gap-2 text-[12.5px]">
              <span className="truncate text-[var(--ink-soft)]">
                {formatTimestamp(run.startedAt)} · {run.trigger === "manual" ? "手动" : "定时"}
              </span>
              <span
                className="font-mono text-[11.5px] uppercase tracking-wide"
                data-run-status={run.status}
              >
                {run.status === "succeeded"
                  ? `+${run.createdCount}`
                  : run.status === "partial"
                    ? `部分 +${run.createdCount}`
                    : run.status === "failed"
                      ? "失败"
                      : "进行中"}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11.5px] leading-4 text-[var(--muted)]">
          采集由后台定时任务执行，访问本页不会触发同步。
        </p>
        {snapshot?.sync.lastSuccessAt && (
          <p className="mt-1 font-mono text-[10.5px] text-[var(--muted)]">
            上次成功 {relativeTime(snapshot.sync.lastSuccessAt)}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onRefresh}
          className="border border-[var(--ink)] px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.18em] transition-colors motion-safe:hover:bg-[var(--ink)] motion-safe:hover:text-[var(--paper)]"
        >
          刷新状态
        </button>
        <a
          href="/admin/"
          className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-[var(--muted)] underline underline-offset-4 transition-colors hover:text-[var(--accent)]"
        >
          进入管理台
        </a>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-1 py-3 text-center first:text-left last:text-right">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 font-serif text-xl leading-none">{value}</dd>
    </div>
  );
}
