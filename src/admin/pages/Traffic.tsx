import { useState } from "react";
import { ApiError } from "../../api";
import { trafficApi, type TrafficResponse } from "../api";
import { BarList, LineChart } from "../components/charts";
import { DataTable, type Column } from "../components/DataTable";
import { Button, Card } from "../components/Field";
import { ErrorState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { RangePicker } from "../components/RangePicker";
import {
  channelLabel,
  dayShort,
  deviceLabel,
  formatCount,
  pageKindLabel,
  pct,
  ratio,
} from "../format";
import { useResource } from "../hooks/useResource";

/**
 * Two answers to "is anyone reading this", from two different instruments.
 *
 * The upper half is the SPA beacon: it only sees pages with JavaScript, which
 * excludes every static reference page (`/e/<slug>.html`). The lower half is the
 * reverse proxy's access log: it sees those pages and it sees crawlers, but it
 * cannot tell a reader from a prefetch.
 *
 * They are never added together. A crawler that renders the SPA would appear in
 * both, and a number nobody can defend is worse than two numbers that are each
 * precisely defined — so the definitions are printed next to the charts.
 */

type PathRow = { path: string; views: number; visitors: number };

const TOP_PATH_COLUMNS: Column<PathRow>[] = [
  {
    key: "path",
    header: "路径",
    render: (row) => (
      <span className="font-mono text-[11px] text-[var(--c-text)]" title={row.path}>
        {row.path}
      </span>
    ),
  },
  { key: "views", header: "浏览", width: "6rem", align: "right", render: (row) => formatCount(row.views) },
  {
    key: "visitors",
    header: "访客",
    width: "6rem",
    align: "right",
    hideBelow: "sm",
    render: (row) => formatCount(row.visitors),
  },
];

const CRAWL_PATH_COLUMNS: Column<{ path: string; hits: number }>[] = [
  {
    key: "path",
    header: "被抓住的路径",
    render: (row) => (
      <span className="font-mono text-[11px] text-[var(--c-text)]" title={row.path}>
        {row.path}
      </span>
    ),
  },
  { key: "hits", header: "次数", width: "6rem", align: "right", render: (row) => formatCount(row.hits) },
];

function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function BeaconSection({ days, beacon }: { days: number; beacon: TrafficResponse["beacon"] }) {
  const labels = beacon.series.map((day) => dayShort(day.day));
  const today = beacon.series[beacon.series.length - 1];
  const views = total(beacon.series.map((day) => day.pv));
  const visitors = total(beacon.series.map((day) => day.uv));
  const aiViews = beacon.breakdown.channel.find((group) => group.key === "ai")?.count ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] text-[var(--c-text)]">页面浏览 · SPA 埋点</h2>
        <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
          只覆盖带脚本的页面；静态引用页与爬虫不在此列
        </p>
      </div>

      {!beacon.enabled ? (
        <div className="rounded-[var(--c-radius)] border border-[var(--c-warn-line)] bg-[var(--c-warn-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--c-warn)]">
          埋点已关闭（`ANALYTICS_ENABLED=false`）。客户端仍会发 beacon，服务端一律返回 204
          且不落库，因此下面的数字不会增长。
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`近 ${days} 日浏览`}
          value={formatCount(views)}
          unit="次"
          hint="page_views 行数，仅人类访问（is_bot=false）"
        />
        <KpiCard
          label="今日浏览"
          value={formatCount(today?.pv ?? 0)}
          unit="次"
          spark={beacon.series.map((day) => day.pv)}
          hint={`${today?.day ?? "—"} · 与总览页同一口径`}
        />
        <KpiCard
          label="今日独立访客"
          value={formatCount(today?.uv ?? 0)}
          unit="人"
          hint="当日 visitor_hash 去重；跨日不可 join"
        />
        <KpiCard
          label="来自 AI 助手"
          value={formatCount(aiViews)}
          unit="次"
          hint="referrer 命中 ChatGPT / Perplexity / Kimi 等；可被引用的直接证据"
        />
      </div>

      <Card
        title="浏览趋势"
        action={
          <span className="num text-[10px] text-[var(--c-text-mute)]">
            日均浏览 {formatCount(Math.round(views / Math.max(days, 1)))} ·
            日均访客 {formatCount(Math.round(visitors / Math.max(days, 1)))}
          </span>
        }
      >
        <LineChart
          series={[
            { key: "pv", label: "浏览", values: beacon.series.map((day) => day.pv) },
            {
              key: "uv",
              label: "独立访客",
              values: beacon.series.map((day) => day.uv),
              tone: "var(--c-info)",
            },
          ]}
          labels={labels}
          height={170}
        />
        <p className="mt-2 text-[10px] leading-4 text-[var(--c-text-mute)]">
          两条线同一横轴。日访客数是逐日去重的，把各日相加不等于期间独立访客人数，所以这里只做日均。
        </p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="来源渠道">
          <BarList
            items={beacon.breakdown.channel.map((group) => ({
              label: channelLabel(group.key),
              value: group.count,
            }))}
          />
        </Card>
        <Card title="落点类型">
          <BarList
            items={beacon.breakdown.pageKind.map((group) => ({
              label: pageKindLabel(group.key),
              value: group.count,
            }))}
            tone="var(--c-info)"
          />
        </Card>
        <Card title="设备与浏览器">
          <BarList
            items={beacon.breakdown.device.map((group) => ({
              label: deviceLabel(group.key),
              value: group.count,
            }))}
            tone="var(--c-ok)"
          />
          <div className="mt-3 border-t border-[var(--c-line)] pt-3">
            <BarList
              items={beacon.breakdown.uaFamily.map((group) => ({
                label: group.key || "未标注",
                value: group.count,
              }))}
              tone="var(--c-line-strong)"
              emptyLabel="没有浏览器分布数据"
            />
          </div>
        </Card>
      </div>

      <Card title="最常被打开的路径" padded={false}>
        <DataTable
          columns={TOP_PATH_COLUMNS}
          rows={beacon.topPaths}
          rowKey={(row) => row.path}
          skeletonRows={4}
          emptyTitle="这段时间还没有浏览记录"
          emptyDetail="埋点只在有人打开页面时写入。刚部署完或刚清空分析表时看到空表是正常的。"
        />
      </Card>
    </section>
  );
}

function CrawlSection({ days, crawl }: { days: number; crawl: TrafficResponse["crawl"] }) {
  const labels = crawl.series.map((day) => dayShort(day.day));

  if (!crawl.configured) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] text-[var(--c-text)]">抓取 · 服务端访问日志</h2>
          <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">未接入</p>
        </div>
        <div className="rounded-[var(--c-radius)] border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface)] px-4 py-6">
          <p className="text-[12px] text-[var(--c-text-dim)]">还没有配置访问日志路径</p>
          <p className="mt-2 max-w-xl text-[11px] leading-5 text-[var(--c-text-mute)]">
            静态引用页（`/e/&lt;slug&gt;.html`）按设计不带任何脚本，所以 GPTBot 这类抓取只能从反向代理的访问日志里读出来。
            在部署环境设置 `ANALYTICS_LOG_PATH`（例如 `/var/log/nginx/aihist.access.log`）并让每小时的计划任务跑
            `python -m app.cli ingest-access-log`，这块才会出现数据。其余页面不受影响。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] text-[var(--c-text)]">抓取 · 服务端访问日志</h2>
        <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">
          {crawl.logPath} · 与上方浏览数据不可相加
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`近 ${days} 日抓取`}
          value={formatCount(crawl.hits)}
          unit="次"
          hint="document 请求，已排除 /api/、/assets/、robots.txt"
        />
        <KpiCard
          label="其中 AI 爬虫"
          value={formatCount(crawl.aiHits)}
          unit="次"
          hint="GPTBot / ClaudeBot / PerplexityBot 等按 UA 识别"
        />
        <KpiCard
          label="AI 占比"
          value={ratio(crawl.aiHits, crawl.hits)}
          hint="AI 抓取 ÷ 全部文档抓取"
        />
        <KpiCard
          label="被引用的抓取来源"
          value={formatCount(crawl.byBot.length)}
          unit="种"
          hint="按 bot 名称去重"
        />
      </div>

      <Card title="AI 抓取趋势">
        <LineChart
          series={[
            {
              key: "count",
              label: "AI 抓取",
              values: crawl.series.map((day) => day.count),
              tone: "var(--c-info)",
            },
          ]}
          labels={labels}
          height={150}
        />
        <p className="mt-2 text-[10px] leading-4 text-[var(--c-text-mute)]">
          只画 `is_ai=true` 的行：通用搜索引擎爬虫会被记录，但不在这条线上。
        </p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="按爬虫">
          <BarList
            items={crawl.byBot.map((group) => ({
              label: group.key || "未识别",
              value: group.count,
            }))}
            tone="var(--c-info)"
            emptyLabel="这段时间没有爬虫访问"
          />
        </Card>
        <Card title="被抓取的路径" padded={false}>
          <DataTable
            columns={CRAWL_PATH_COLUMNS}
            rows={crawl.topPaths}
            rowKey={(row) => row.path}
            skeletonRows={4}
            emptyTitle="没有 AI 抓取记录"
            emptyDetail="路径通常以 /e/&lt;slug&gt;.html 结尾——那就是被引用时最容易被抓的一页。"
          />
        </Card>
      </div>
    </section>
  );
}

export function Traffic() {
  const [days, setDays] = useState(30);
  const resource = useResource((signal) => trafficApi.read(days, signal), [days]);

  if (resource.error && !resource.data) {
    return (
      <ErrorState
        title="流量数据加载失败"
        detail={resource.error instanceof ApiError ? resource.error.code : undefined}
        action={<Button onClick={() => void resource.refresh()}>重试</Button>}
      />
    );
  }

  if (!resource.data) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 rounded-[var(--c-radius)]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton h-[92px] rounded-[var(--c-radius)]" />
          ))}
        </div>
        <div className="skeleton h-[220px] rounded-[var(--c-radius)]" />
      </div>
    );
  }

  const { beacon, crawl, note } = resource.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <RangePicker value={days} onChange={setDays} />
        <p className="text-[10px] leading-4 text-[var(--c-text-mute)]">{note}</p>
      </div>

      <BeaconSection days={days} beacon={beacon} />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--c-line)]" />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--c-text-mute)]">
          以下为另一套口径
        </span>
        <span className="h-px flex-1 bg-[var(--c-line)]" />
      </div>

      <CrawlSection days={days} crawl={crawl} />

      <p className="text-[10px] leading-5 text-[var(--c-text-mute)]">
        口径备忘：PV = 当日 page_views 行数（人类、非 bot）；UV = 当日 visitor_hash 去重；
        AI 抓取 = 当日 crawl_hits 且 is_ai。访客标识是逐日加盐的哈希，跨日无法还原成同一个人。
        {crawl.hits > 0 && ` 近 ${days} 日共 ${formatCount(crawl.hits)} 次文档抓取，其中 AI 占 ${pct(
          crawl.hits ? crawl.aiHits / crawl.hits : 0,
          0,
        )}。`}
      </p>
    </div>
  );
}
