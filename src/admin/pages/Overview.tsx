import { useShell } from "../components/AppShell";
import { LineChart, StackedBar } from "../components/charts";
import { Button, Card } from "../components/Field";
import { ErrorState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { StatusPill, toneForStatus } from "../components/StatusPill";
import { useSession } from "../session";
import { go, navigate } from "../router";
import {
  dayShort,
  delta,
  duration,
  formatCount,
  ratio,
  relativeTime,
  stamp,
  statusLabel,
  triggerLabel,
} from "../format";

/**
 * The page the operator opens first.
 *
 * Order is the work order: what needs attention, then how much is in the file,
 * then whether it is growing, then whether collection is healthy. Every number
 * on this page comes from `repo_ops.overview` — nothing here recomputes a metric,
 * which is what keeps "PV" meaning one thing across the console.
 */

function AlertStrip() {
  const { overview } = useShell();
  const alerts = overview?.alerts ?? [];

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--c-radius)] border border-[var(--c-ok-line)] bg-[var(--c-ok-bg)] px-3 py-2">
        <StatusPill tone="ok">无待办</StatusPill>
        <span className="text-[11px] text-[var(--c-text-dim)]">
          采集、暂缓队列、配置均正常，今天没有需要处理的事项。
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {alerts.map((alert) => {
        const tone =
          alert.level === "danger" ? "danger" : alert.level === "warn" ? "warn" : alert.level === "info" ? "info" : "muted";
        const shell =
          tone === "danger"
            ? "border-[var(--c-danger-line)] bg-[var(--c-danger-bg)] text-[var(--c-danger)] hover:bg-[var(--c-danger-bg-hover)]"
            : tone === "warn"
              ? "border-[var(--c-warn-line)] bg-[var(--c-warn-bg)] text-[var(--c-warn)] hover:bg-[var(--c-warn-bg-hover)]"
              : "border-[var(--c-info-line)] bg-[var(--c-info-bg)] text-[var(--c-info)] hover:bg-[var(--c-info-bg-hover)]";
        return (
          <button
            key={alert.code}
            type="button"
            onClick={() => go(alert.href)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${shell}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {alert.message}
            <span aria-hidden="true" className="opacity-60">
              →
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Overview() {
  const { overview, overviewError, overviewLoading, refreshOverview } = useShell();
  const { can } = useSession();

  if (overviewError && !overview) {
    return (
      <ErrorState
        title="总览加载失败"
        detail={overviewError.code}
        action={<Button onClick={refreshOverview}>重试</Button>}
      />
    );
  }

  if (!overview || overviewLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="skeleton h-[92px] rounded-[var(--c-radius)]" />
        ))}
      </div>
    );
  }

  const { content, health, traffic, subscribers, admissions, runs, sources, keys, panel } = overview;
  const today = traffic.today;
  const admissionTotal = admissions.reduce((sum, day) => sum + day.admitted, 0);
  const failing = sources.filter((source) => source.consecutiveFailures > 0);
  const healthy = sources.length - failing.length;

  return (
    <div className="space-y-3">
      <AlertStrip />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard
          label="在档条目"
          value={formatCount(content.live)}
          unit="条"
          hint={`公开时间轴可见；共 ${formatCount(content.total)} 条记录`}
          href="#/content?status=live"
        />
        <KpiCard
          label={`近 ${content.recentDays} 日新增`}
          value={formatCount(content.recent)}
          unit="条"
          hint="按首次发现时间统计，含暂缓与下架"
        />
        <KpiCard
          label="待处理暂缓"
          value={formatCount(content.hold)}
          unit="条"
          hint="需人工判断是否入档"
          href="#/content?status=hold"
        />
        <KpiCard
          label="今日 PV"
          value={formatCount(today.pv)}
          unit="次"
          delta={{
            text: delta(today.pv, today.pvPrev),
            tone: today.pv > today.pvPrev ? "up" : today.pv < today.pvPrev ? "down" : "flat",
          }}
          spark={traffic.series.map((day) => day.pv)}
          hint="埋点口径，仅人类访问，不含爬虫"
          href="#/traffic"
        />
        <KpiCard
          label="今日 UV"
          value={formatCount(today.uv)}
          unit="人"
          delta={{
            text: delta(today.uv, today.uvPrev),
            tone: today.uv > today.uvPrev ? "up" : today.uv < today.uvPrev ? "down" : "flat",
          }}
          hint="按 visitor 去重，与 PV 同源"
          href="#/traffic"
        />
        <KpiCard
          label="订阅人数"
          value={formatCount(subscribers.total)}
          unit="人"
          hint="含待确认；名单在「订阅名单」页"
          href={can("manage") ? "#/subscribers" : undefined}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card
          title="近 14 日入档量"
          action={
            <span className="num text-[10px] text-[var(--c-text-mute)]">
              合计 {formatCount(admissionTotal)} 条
            </span>
          }
        >
          <LineChart
            series={[
              {
                key: "admitted",
                label: "入档",
                values: admissions.map((day) => day.admitted),
              },
            ]}
            labels={admissions.map((day) => dayShort(day.day))}
            height={150}
          />
          <div className="mt-3 border-t border-[var(--c-line)] pt-3">
            <p className="label mb-2">同期判定分布</p>
            <StackedBar
              segments={[
                { label: "入档", value: content.admitted, tone: "var(--c-ok)" },
                { label: "暂缓", value: content.hold, tone: "var(--c-warn)" },
                { label: "下架", value: content.excluded, tone: "var(--c-danger)" },
                { label: "历史遗留", value: content.legacy, tone: "var(--c-line-strong)" },
              ]}
            />
            <p className="mt-2 text-[10px] leading-4 text-[var(--c-text-mute)]">
              入档率 {ratio(content.admitted, content.admitted + content.hold + content.excluded)}
              （入档 ÷ 已判定总量，历史遗留未判定故不计入分母）
            </p>
          </div>
        </Card>

        <Card title="数据体检" action={<span className="label">永久口径</span>}>
          <ul className="space-y-2">
            {[
              { label: "缺 slug（无法生成引用页）", value: health.unslugged, filter: "unslugged" },
              { label: "无来源（不可引用）", value: health.sourceless, filter: "sourceless" },
              { label: "未过评审闸门", value: health.ungated, filter: "ungated" },
              { label: "缺分类", value: health.uncategorized, filter: "uncategorized" },
            ].map((row) => (
              <li key={row.label}>
                {/* Each count opens exactly the rows it counted: the filter and
                    `data_health` share one predicate list in `repo_ops`. */}
                <button
                  type="button"
                  onClick={() => go(`#/content?filter=${row.filter}`)}
                  disabled={row.value === 0}
                  className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
                >
                  <span className="text-[11px] text-[var(--c-text-dim)]">{row.label}</span>
                  <span
                    className={`num text-[12px] ${
                      row.value > 0 ? "text-[var(--c-warn)]" : "text-[var(--c-text-mute)]"
                    }`}
                  >
                    {formatCount(row.value)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-[var(--c-line)] pt-3 text-[10px] leading-4 text-[var(--c-text-mute)]">
            <p>
              评审面板：
              <span className={panel.configured ? "text-[var(--c-ok)]" : "text-[var(--c-warn)]"}>
                {panel.configured ? `${panel.models.length} 个模型已配置` : panel.reason ?? "未配置"}
              </span>
            </p>
            <p className="mt-1">
              开放 API：{keys.total} 把密钥{keys.overQuota > 0 ? `，${keys.overQuota} 把超配额` : ""}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card
          title="最近采集运行"
          action={
            <Button tone="ghost" onClick={() => navigate("runs")}>
              全部运行 →
            </Button>
          }
          padded={false}
        >
          {runs.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-[var(--c-text-mute)]">
              还没有运行记录。{can("sync") ? "可在顶部手动触发一次。" : ""}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => navigate("runs", { query: { id: run.id } })}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--c-surface-2)]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusPill status={run.status} />
                      <span className="num text-[11px] text-[var(--c-text-dim)]">
                        {stamp(run.startedAt)}
                      </span>
                      <span className="text-[10px] text-[var(--c-text-mute)]">
                        {triggerLabel(run.trigger)}
                      </span>
                    </span>
                    <span className="num flex-none text-[10px] text-[var(--c-text-mute)]">
                      入档 {run.admittedCount} · 暂缓 {run.heldCount} · {duration(run.durationMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="来源健康" action={<span className="num text-[10px] text-[var(--c-text-mute)]">{healthy}/{sources.length}</span>}>
          <div className="grid grid-cols-2 gap-1.5">
            {sources.map((source) => {
              const tone = toneForStatus(
                source.consecutiveFailures >= 3 ? "failed" : source.consecutiveFailures > 0 ? "partial" : "active",
              );
              const dot =
                tone === "ok"
                  ? "bg-[var(--c-ok)]"
                  : tone === "warn"
                    ? "bg-[var(--c-warn)]"
                    : tone === "danger"
                      ? "bg-[var(--c-danger)]"
                      : "bg-[var(--c-line-strong)]";
              return (
                <button
                  key={source.key}
                  type="button"
                  onClick={() => navigate("sources")}
                  title={
                    source.lastError
                      ? `${source.name} · ${source.lastError}`
                      : `${source.name} · ${statusLabel(source.consecutiveFailures ? "partial" : "succeeded")} · ${relativeTime(source.lastOkAt)}`
                  }
                  className="flex items-center gap-1.5 rounded border border-[var(--c-line)] px-1.5 py-1 text-left hover:border-[var(--c-line-strong)]"
                >
                  <span className={`h-1.5 w-1.5 flex-none rounded-full ${dot}`} />
                  <span className="truncate text-[10px] text-[var(--c-text-dim)]">{source.name}</span>
                </button>
              );
            })}
          </div>
          {failing.length > 0 && (
            <p className="mt-2 text-[10px] leading-4 text-[var(--c-warn)]">
              {failing.length} 个来源正在连续失败，见「来源健康」。
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
