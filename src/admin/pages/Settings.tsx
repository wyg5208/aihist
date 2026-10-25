import { useState } from "react";
import { ApiError } from "../../api";
import { settingsApi, type SettingsEntry } from "../api";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Button, Card } from "../components/Field";
import { StatusPill, type PillTone } from "../components/StatusPill";
import { useResource } from "../hooks/useResource";

/**
 * A configuration health check that only reads.
 *
 * Every value here is a path, a boolean or a count — never a secret — so the page
 * can answer "is this deployment actually wired up" without becoming a place where
 * you paste credentials. Nothing is editable from the browser: configuration lives
 * in `.env` / `deploy/api.env`, and a console that can flip `OPEN_API_ENABLED` at
 * runtime is a console whose audit trail no longer describes the running system.
 *
 * The env-variable hint under each row is the part that saves time: an operator who
 * reads 「访问日志摄取：未接入」 needs to know the variable is `ANALYTICS_LOG_PATH`,
 * not to go read `config.py`.
 */

const TONE: Record<SettingsEntry["level"], PillTone> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
};

const LEVEL_TEXT: Record<SettingsEntry["level"], string> = {
  ok: "正常",
  warn: "待处理",
  danger: "需修复",
};

/** Which variable to change when a row is not green. `—` means "not configurable". */
const ENV_HINT: Record<string, string> = {
  database: "DATABASE_URL",
  session: "SESSION_SECRET",
  accounts: "/admin/users 页面",
  env_account: "ADMIN_USER / ADMIN_PASSWORD_HASH",
  panel: "deploy/api.env.example 中的评审面板配置",
  analytics: "ANALYTICS_ENABLED",
  access_log: "ANALYTICS_LOG_PATH / ANALYTICS_LOG_FORMAT",
  open_api: "OPEN_API_ENABLED",
  retention: "ANALYTICS_RETENTION_DAYS",
  mail: "—",
};

export function Settings() {
  const [collapsed, setCollapsed] = useState(false);
  const report = useResource((signal) => settingsApi.read(signal), []);

  const entries = report.data?.settings ?? [];
  const counts = {
    ok: entries.filter((entry) => entry.level === "ok").length,
    warn: entries.filter((entry) => entry.level === "warn").length,
    danger: entries.filter((entry) => entry.level === "danger").length,
  };

  if (report.error && !report.data) {
    return (
      <ErrorState
        title="配置体检加载失败"
        detail={report.error instanceof ApiError ? report.error.code : undefined}
        action={<Button onClick={() => void report.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--c-text-dim)]">
          <span>{entries.length} 项检查</span>
          <span className="text-[var(--c-ok)]">{counts.ok} 正常</span>
          <span className="text-[var(--c-warn)]">{counts.warn} 待处理</span>
          <span className="text-[var(--c-danger)]">{counts.danger} 需修复</span>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--c-text-mute)] hover:text-[var(--c-text-dim)]"
          >
            {collapsed ? "展开正常项" : "只看待处理"}
          </button>
        </p>
        <Button tone="ghost" onClick={() => void report.refresh()} disabled={report.loading}>
          {report.loading ? "刷新中…" : "重新体检"}
        </Button>
      </div>

      <Card padded={false}>
        {entries.length === 0 ? (
          <EmptyState
            title={report.loading ? "正在读取配置…" : "没有检查项"}
            detail="配置体检会逐项报告数据库、会话、账号、评审面板、埋点、日志摄取、开放 API、保留期与邮件通道的状态。"
          />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {entries
              .filter((entry) => !collapsed || entry.level !== "ok")
              .map((entry) => (
                <li key={entry.key} className="grid gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[7rem_1fr]">
                  <div className="flex items-start gap-2">
                    <StatusPill tone={TONE[entry.level]}>{LEVEL_TEXT[entry.level]}</StatusPill>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[12px] text-[var(--c-text)]">{entry.label}</span>
                      <span className="font-mono text-[11px] text-[var(--c-text-dim)]">
                        {entry.value}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--c-text-mute)]">
                      {entry.detail}
                    </p>
                    {ENV_HINT[entry.key] && entry.level !== "ok" && (
                      <p className="mt-1 font-mono text-[10px] text-[var(--c-text-mute)]">
                        改这里：{ENV_HINT[entry.key]}
                      </p>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title="为什么是只读">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          <li>
            <span className="text-[var(--c-text-mute)]">配置在进程启动时读取</span> — 改 .env 后需要
            重启 API 才生效；浏览器里能翻转的开关会让「线上跑的是什么」和审计记录对不上。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">不显示密钥</span> — 会话密钥、数据库口令、
            judge API key 一律不显示，只报告「已设置 / 未设置」与路径。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">非绿色不一定是故障</span> — 开放 API 关闭、
            日志路径未配置都是合法的部署状态，只是相应模块没有数据可看。
          </li>
        </ul>
      </Card>
    </div>
  );
}
