import type { Permission } from "../api";
import { navigate } from "../router";
import { useSession } from "../session";

/**
 * The single source of truth for navigation.
 *
 * `AppShell` renders from this list, the router resolves against it, and the
 * permission filter lives here rather than in each page: an analyst opening
 * `#/users` by hand gets the same "no access" as one who never saw the link.
 */

export interface NavItem {
  name: string;
  label: string;
  permission: Permission;
  hint?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { group: "总览", items: [{ name: "overview", label: "运营总览", permission: "read" }] },
  { group: "档案", items: [{ name: "content", label: "条目库", permission: "read" }] },
  {
    group: "采集与评审",
    items: [
      { name: "library", label: "采集库", permission: "read" },
      { name: "runs", label: "采集运行", permission: "read" },
      { name: "sources", label: "信源目录", permission: "read" },
      { name: "editorial", label: "评审一致性", permission: "read" },
    ],
  },
  {
    group: "运营",
    items: [
      { name: "traffic", label: "流量分析", permission: "read" },
      { name: "subscribers", label: "订阅名单", permission: "manage" },
    ],
  },
  {
    group: "商业化",
    items: [
      { name: "partners", label: "合作台账", permission: "manage" },
      { name: "keys", label: "开放 API", permission: "manage" },
      { name: "applications", label: "API 申请", permission: "manage" },
    ],
  },
  {
    group: "系统",
    items: [
      { name: "users", label: "账号权限", permission: "manage" },
      { name: "audit", label: "审计日志", permission: "manage" },
      { name: "settings", label: "配置体检", permission: "manage" },
    ],
  },
];

/** Every routable name, including the ones this user cannot open. */
export const NAV_NAMES = new Set(NAV.flatMap((group) => group.items.map((item) => item.name)));

export function Sidebar({ current }: { current: string }) {
  const { can } = useSession();

  return (
    <nav
      aria-label="控制台导航"
      className="flex h-full w-[13.5rem] flex-none flex-col border-r border-[var(--c-line)] bg-[var(--c-surface)]"
    >
      <div className="border-b border-[var(--c-line)] px-4 py-3.5">
        <a href="#/overview" className="block">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--c-text-mute)]">
            AI Chronicle
          </span>
          <span className="mt-0.5 block text-[13px] tracking-wide text-[var(--c-text)]">运营控制台</span>
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group) => {
          const items = group.items.filter((item) => can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={group.group} className="mb-4">
              <p className="label px-2 pb-1.5">{group.group}</p>
              <ul>
                {items.map((item) => {
                  const active = item.name === current;
                  return (
                    <li key={item.name}>
                      <button
                        type="button"
                        onClick={() => navigate(item.name)}
                        aria-current={active ? "page" : undefined}
                        className={`mb-0.5 flex w-full items-center justify-between rounded-[var(--c-radius)] px-2 py-1.5 text-left text-[12px] transition-colors ${
                          active
                            ? "bg-[var(--c-surface-2)] text-[var(--c-text)]"
                            : "text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)]/60 hover:text-[var(--c-text)]"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-3 w-[2px] rounded-full ${
                              active ? "bg-[var(--c-accent)]" : "bg-transparent"
                            }`}
                          />
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[var(--c-line)] px-4 py-2.5">
        <a
          href="/"
          className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--c-text-mute)] hover:text-[var(--c-text-dim)]"
        >
          ← 返回站点
        </a>
      </div>
    </nav>
  );
}
