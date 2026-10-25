import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../../api";
import { overviewApi, type OverviewResponse } from "../api";
import { usePolledResource } from "../hooks/useResource";
import { HOME_ROUTE, useHashRoute } from "../router";
import { useSession } from "../session";
import { NoticeStack, useNotices, type NoticeTone } from "./Notice";
import { Sidebar, NAV, NAV_NAMES } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Overview } from "../pages/Overview";
import { ApiKeys } from "../pages/ApiKeys";
import { Audit } from "../pages/Audit";
import { Content } from "../pages/Content";
import { Editorial } from "../pages/Editorial";
import { Partners } from "../pages/Partners";
import { Runs } from "../pages/Runs";
import { Settings } from "../pages/Settings";
import { Sources } from "../pages/Sources";
import { Subscribers } from "../pages/Subscribers";
import { Traffic } from "../pages/Traffic";
import { Users } from "../pages/Users";

/**
 * The frame: sidebar, status strip, and one page at a time.
 *
 * The shell owns two things every page needs — the polling overview feed behind
 * the status lamp, and the notice stack — and hands them down through context.
 * That is why a page never builds its own toast host or its own sync button.
 */

interface ShellContextValue {
  /**
   * Bumped whenever something above the page asks for fresh data (a manual
   * sync, a click on the lamp). Pages include it in their loader deps.
   */
  reload: number;
  notify: (tone: NoticeTone, text: string) => void;
  /**
   * The polled dashboard feed. The Overview page renders this rather than
   * fetching its own copy: two requests for the same twelve queries every
   * fifteen seconds is a waste of the same SQLite connection.
   */
  overview: OverviewResponse | null;
  overviewError: ApiError | null;
  overviewLoading: boolean;
  refreshOverview: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <AppShell>");
  return value;
}

const POLL_MS = 15_000;

/** An unknown hash fragment. Never silently blank, never a 500. */
function NotFound({ name }: { name: string }) {
  return (
    <div className="rounded-[var(--c-radius)] border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface)] px-5 py-10 text-center">
      <p className="text-[13px] text-[var(--c-text-dim)]">没有这个页面：{name || "（空）"}</p>
      <p className="mt-2 text-[11px] leading-5 text-[var(--c-text-mute)]">
        左侧导航列出了全部可用页面；地址形如 <span className="font-mono">#/content?id=…</span>。
      </p>
    </div>
  );
}

function NoAccess({ label }: { label: string }) {
  return (
    <div className="rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-5 py-10 text-center">
      <p className="text-[13px] text-[var(--c-warn)]">当前角色无权访问「{label}」</p>
      <p className="mt-2 text-[11px] leading-5 text-[var(--c-text-mute)]">
        需要 owner 角色。请联系站点所有者开通。
      </p>
    </div>
  );
}

function pageFor(name: string): ReactNode {
  switch (name) {
    case "overview":
      return <Overview />;
    case "content":
      return <Content />;
    case "runs":
      return <Runs />;
    case "sources":
      return <Sources />;
    case "editorial":
      return <Editorial />;
    case "traffic":
      return <Traffic />;
    case "subscribers":
      return <Subscribers />;
    case "partners":
      return <Partners />;
    case "keys":
      return <ApiKeys />;
    case "users":
      return <Users />;
    case "audit":
      return <Audit />;
    case "settings":
      return <Settings />;
    default:
      return <NotFound name={name} />;
  }
}

export function AppShell() {
  const route = useHashRoute();
  const { can } = useSession();
  const notices = useNotices();
  const [reload, setReload] = useState(0);

  const feed = usePolledResource((signal) => overviewApi.read(7, signal), POLL_MS);
  const { refresh } = feed;
  const notify = notices.push;

  const bump = useCallback(() => {
    setReload((value) => value + 1);
    void refresh();
  }, [refresh]);

  const shell = useMemo<ShellContextValue>(
    () => ({
      reload,
      notify,
      overview: feed.data,
      overviewError: feed.error,
      overviewLoading: feed.initial && feed.loading,
      refreshOverview: bump,
    }),
    [reload, notify, feed.data, feed.error, feed.initial, feed.loading, bump],
  );

  const name = NAV_NAMES.has(route.name) ? route.name : HOME_ROUTE;
  const required = NAV.flatMap((group) => group.items).find((item) => item.name === name);
  const label = required?.label ?? "运营总览";
  const allowed = required ? can(required.permission) : false;

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-dvh overflow-hidden bg-[var(--c-bg)]">
        <Sidebar current={name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            overview={feed.data}
            refreshedAt={feed.refreshedAt}
            onRefreshed={bump}
            notify={notify}
          />
          <main className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <div className="mx-auto w-full max-w-[88rem]">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h1 className="text-[15px] tracking-wide text-[var(--c-text)]">{label}</h1>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--c-text-mute)]">
                  {name}
                </span>
              </div>
              {allowed ? pageFor(name) : <NoAccess label={label} />}
            </div>
          </main>
        </div>
      </div>
      <NoticeStack items={notices.items} onDismiss={notices.dismiss} />
    </ShellContext.Provider>
  );
}
