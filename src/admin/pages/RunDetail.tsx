import { ApiError } from "../../api";
import { runsApi, type AdminRunRecord, type RunSourceEntry } from "../api";
import { Button, Card } from "../components/Field";
import { ErrorState, TableSkeleton } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";
import { clock, duration, formatCount, ratio, relativeTime, stamp } from "../format";

/**
 * One run, in full.
 *
 * The per-source table is the reason this page exists: `notes` in the run row is
 * a single semicolon-joined string, which is enough for a log line and useless
 * for "which feed was slow". The structured `detail` column carries the same
 * facts as data, so this page never parses a string.
 */

function Counter({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="num mt-1 text-[16px] text-[var(--c-text)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--c-text-mute)]">{hint}</p>}
    </div>
  );
}

function SourceRow({ entry }: { entry: RunSourceEntry }) {
  const ok = Boolean(entry.ok);
  return (
    <tr className="border-b border-[var(--c-line)] last:border-b-0">
      <td className="px-3 py-1.5">
        <span className={ok ? "text-[var(--c-text-dim)]" : "text-[var(--c-warn)]"}>
          {entry.name || entry.key}
        </span>
      </td>
      <td className="px-3 py-1.5">
        <StatusPill status={ok ? "succeeded" : "failed"}>
          {ok ? "成功" : entry.error || "失败"}
        </StatusPill>
      </td>
      <td className="num px-3 py-1.5 text-right">{entry.items ?? 0}</td>
      <td className="num px-3 py-1.5 text-right">{duration(entry.ms)}</td>
    </tr>
  );
}

export function RunDetail({ runId }: { runId: string }) {
  const resource = useResource(
    (signal) => runsApi.detail(runId, signal),
    [runId],
    { enabled: Boolean(runId) },
  );

  if (!runId) {
    return <p className="py-8 text-center text-[11px] text-[var(--c-text-mute)]">未选择运行</p>;
  }

  if (resource.error) {
    return (
      <ErrorState
        title="运行详情加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  if (!resource.data) return <TableSkeleton rows={8} columns={4} />;

  const run: AdminRunRecord = resource.data.run;
  const detail = run.detail ?? {};
  const sources = Array.isArray(detail.sources) ? detail.sources : [];
  const notes = Array.isArray(detail.notes) ? detail.notes : [];
  const failed = sources.filter((entry) => !entry.ok);
  const slowest = [...sources].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 3);
  const totalItems = sources.reduce((sum, entry) => sum + (entry.items ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={run.status} dot={run.status === "running"} />
        <span className="text-[11px] text-[var(--c-text-dim)]">
          {run.trigger === "manual" ? "手动触发" : "定时触发"}
        </span>
        <span className="num text-[10px] text-[var(--c-text-mute)]">
          {stamp(run.startedAt)}
          {run.finishedAt ? ` → ${clock(run.finishedAt)}` : " → 进行中"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2.5 sm:grid-cols-4">
        <Counter label="耗时" value={duration(run.durationMs)} hint={relativeTime(run.startedAt)} />
        <Counter label="原始条目" value={formatCount(run.rawCount)} hint={`来源合计 ${totalItems}`} />
        <Counter label="新增 / 合并" value={`${run.createdCount} / ${run.mergedCount}`} />
        <Counter
          label="评审"
          value={formatCount(run.reviewedCount)}
          hint={`入档率 ${ratio(run.admittedCount, run.reviewedCount)}`}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded border border-[var(--c-line)] px-2 py-1.5">
          <span className="label">入档</span>
          <p className="num mt-0.5 text-[var(--c-ok)]">{run.admittedCount}</p>
        </div>
        <div className="rounded border border-[var(--c-line)] px-2 py-1.5">
          <span className="label">暂缓</span>
          <p className="num mt-0.5 text-[var(--c-warn)]">{run.heldCount}</p>
        </div>
        <div className="rounded border border-[var(--c-line)] px-2 py-1.5">
          <span className="label">下架</span>
          <p className="num mt-0.5 text-[var(--c-danger)]">{run.excludedCount}</p>
        </div>
      </div>

      <Card
        title="每来源明细"
        action={
          <span className="num text-[10px] text-[var(--c-text-mute)]">
            {sources.length - failed.length}/{sources.length} 成功
          </span>
        }
        padded={false}
      >
        {sources.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-[var(--c-text-mute)]">
            这次运行没有留下结构化明细（早于 0002 迁移的运行只有 notes 文本）。
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="bg-[var(--c-surface-2)]">
                <th className="px-3 py-1.5 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
                  来源
                </th>
                <th className="px-3 py-1.5 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
                  结果
                </th>
                <th className="px-3 py-1.5 text-right font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
                  条目
                </th>
                <th className="px-3 py-1.5 text-right font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
                  耗时
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((entry) => (
                <SourceRow key={entry.key ?? entry.name} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {slowest.length > 0 && (
        <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
          最慢：{slowest.map((entry) => `${entry.name || entry.key} ${duration(entry.ms)}`).join(" · ")}
          {failed.length > 0 && `｜失败来源：${failed.map((entry) => entry.key).join(", ")}`}
        </p>
      )}

      {notes.length > 0 && (
        <Card title="运行备注">
          <div className="flex flex-wrap gap-1.5">
            {notes.map((note, index) => (
              <span
                key={`${note}-${index}`}
                className="rounded-full border border-[var(--c-line)] px-2 py-0.5 font-mono text-[10px] text-[var(--c-text-dim)]"
              >
                {note}
              </span>
            ))}
          </div>
        </Card>
      )}

      {run.notes && notes.length === 0 && (
        <Card title="运行备注（旧格式）">
          <p className="font-mono text-[10px] leading-5 text-[var(--c-text-dim)]">{run.notes}</p>
        </Card>
      )}
    </div>
  );
}
