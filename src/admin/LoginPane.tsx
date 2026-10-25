import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { INPUT_CLASS } from "./components/Field";
import { useSession } from "./session";

/**
 * The front door.
 *
 * Every failure the API can return has a sentence here, because a bare code on a
 * login screen is indistinguishable from a broken deployment. The lockout and
 * disabled cases matter most: they mean the credentials were right and something
 * else is wrong, and the operator needs to know which.
 */

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "登录失败，请稍后重试。";
  switch (error.code) {
    case "admin_not_configured":
      return "服务端未配置 ADMIN_PASSWORD_HASH，且没有数据库账号，登录已停用。";
    case "invalid_credentials":
      return "用户名或密码不正确。";
    case "account_locked":
      return "连续失败次数过多，账号已临时锁定约 15 分钟。";
    case "account_disabled":
      return "该账号已被停用，请联系所有者。";
    case "too_many_attempts":
      return "尝试过于频繁，请稍后再试。";
    case "network":
      return "无法连接接口，请确认服务是否在运行。";
    default:
      if (error.status === 403) return "请求缺少 X-Requested-With 头，已拒绝。";
      if (error.status >= 500) return `服务端错误（${error.code}），请查看日志。`;
      return `登录失败（${error.code}）。`;
  }
}

export function LoginPane() {
  const { signIn } = useSession();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second, silent path: after a lockout the honest message is not enough, so
  // we also show how long to wait when the header says so.
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setRetryAfter(null);
    try {
      await signIn(user.trim(), password);
      setPassword("");
    } catch (caught) {
      setError(messageFor(caught));
      setRetryAfter(caught instanceof ApiError ? caught.retryAfter : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, #1b2430 0%, transparent 60%)",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] p-6 shadow-2xl shadow-black/50">
          <p className="label">AI Chronicle · Console</p>
          <h1 className="mt-2 text-[18px] tracking-wide text-[var(--c-text)]">运营控制台</h1>
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--c-text-mute)]">
            采集与访问完全解耦：只有这里和后台定时任务可以触发同步。
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block">
              <span className="label">账号</span>
              <input
                className={INPUT_CLASS}
                value={user}
                onChange={(event) => setUser(event.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label">密码</span>
              <input
                className={INPUT_CLASS}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error && (
              <p role="alert" className="border-l-2 border-[var(--c-danger)] pl-2.5 text-[11px] leading-5 text-[var(--c-danger)]">
                {error}
                {retryAfter !== null && ` （${retryAfter}s 后重试）`}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 w-full rounded-[var(--c-radius)] border border-[var(--c-accent)] bg-[var(--c-accent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#101216] transition-[filter] hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "验证中…" : "登录"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center font-mono text-[9px] uppercase leading-5 tracking-[0.14em] text-[var(--c-text-mute)]">
          会话为 HttpOnly Cookie · 有效期 12 小时 · 失败 5 次锁定 15 分钟
        </p>
      </div>
    </div>
  );
}
