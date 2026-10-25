import { useState } from "react";
import { ApiError } from "../../api";
import { usersApi, type AdminUserRow, type Role } from "../api";
import { useShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { ErrorState } from "../components/EmptyState";
import { Button, Card, Field, Select, TextInput } from "../components/Field";
import { StatusPill } from "../components/StatusPill";
import { relativeTime, stamp } from "../format";
import { useResource } from "../hooks/useResource";
import { useSession } from "../session";

/**
 * Console accounts.
 *
 * Two rules are visible in the UI rather than only in the API: you cannot demote
 * or disable yourself here, and the last active owner cannot be removed. Both are
 * enforced server-side as well — this page just refuses to offer the click, which
 * is cheaper than a 400 that a hurried operator reads as a bug.
 *
 * The env account is deliberately absent from the table: it lives in
 * `ADMIN_USER` / `ADMIN_PASSWORD_HASH`, is always an owner, and is the way back in
 * if this table is ever emptied by mistake.
 */

const ROLES: Array<{ value: Role; label: string; detail: string }> = [
  { value: "owner", label: "owner · 所有者", detail: "全部权限，含账号、密钥、合作与审计" },
  { value: "editor", label: "editor · 编辑", detail: "可触发采集、可处置条目" },
  { value: "analyst", label: "analyst · 观察者", detail: "只读：能看所有指标，不能改任何东西" },
];

const MIN_PASSWORD = 12;

const ERROR_TEXT: Record<string, string> = {
  invalid_username: "用户名只允许字母、数字、点、下划线、连字符，3–40 位",
  password_too_short: `密码至少 ${MIN_PASSWORD} 位`,
  username_taken: "这个用户名已存在",
  invalid_role: "角色不被支持",
  cannot_demote_self: "不能在这里降低自己的角色",
  cannot_disable_self: "不能在这里停用自己的账号",
  last_owner: "这是最后一个启用中的 owner，移除后没人能进后台",
  user_not_found: "账号不存在",
  nothing_to_update: "没有任何字段被修改",
  forbidden: "当前角色无权管理账号",
};

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "未知错误";
  return ERROR_TEXT[error.code] ?? error.code;
}

const roleDetail = (role: string): string =>
  ROLES.find((item) => item.value === role)?.detail ?? "";

export function Users() {
  const { notify, reload } = useShell();
  const { user } = useSession();

  const [composeOpen, setComposeOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("analyst");
  const [busy, setBusy] = useState(false);

  /** Role change and enable/disable both go through one confirm dialog. */
  const [changing, setChanging] = useState<{ row: AdminUserRow; role: Role } | null>(null);
  const [toggling, setToggling] = useState<AdminUserRow | null>(null);
  const [resetting, setResetting] = useState<AdminUserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const accounts = useResource((signal) => usersApi.list(signal), [reload]);
  const rows = accounts.data?.items ?? [];
  const isEnvAccount = Boolean(user) && rows.every((row) => row.username !== user);

  const create = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      notify("warn", "请填写用户名");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      notify("warn", `密码至少 ${MIN_PASSWORD} 位`);
      return;
    }
    setBusy(true);
    try {
      await usersApi.create({ username: trimmed, password, role });
      notify("ok", `已创建 ${trimmed}（${role}），密码不会在任何地方再次显示`);
      setComposeOpen(false);
      setUsername("");
      setPassword("");
      setRole("analyst");
      await accounts.refresh();
    } catch (error) {
      notify("danger", `创建失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async () => {
    if (!changing) return;
    setBusy(true);
    try {
      await usersApi.update(changing.row.id, { role: changing.role });
      notify("ok", `${changing.row.username} 的角色已改为 ${changing.role}`);
      setChanging(null);
      await accounts.refresh();
    } catch (error) {
      notify("danger", `改角色失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!toggling) return;
    const next = !toggling.active;
    setBusy(true);
    try {
      await usersApi.update(toggling.id, { active: next });
      notify("ok", next ? `已启用 ${toggling.username}` : `已停用 ${toggling.username}`);
      setToggling(null);
      await accounts.refresh();
    } catch (error) {
      notify("danger", `操作失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!resetting) return;
    if (newPassword.length < MIN_PASSWORD) {
      notify("warn", `密码至少 ${MIN_PASSWORD} 位`);
      return;
    }
    setBusy(true);
    try {
      await usersApi.resetPassword(resetting.id, newPassword);
      notify("ok", `已重置 ${resetting.username} 的密码，需通知对方新密码`);
      setResetting(null);
      setNewPassword("");
    } catch (error) {
      notify("danger", `重置失败：${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminUserRow>[] = [
    {
      key: "username",
      header: "用户名",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] text-[var(--c-text)]">{row.username}</span>
          {row.username === user && (
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-mute)]">
              你
            </span>
          )}
        </span>
      ),
    },
    {
      key: "role",
      header: "角色",
      width: "9rem",
      render: (row) => (
        <span className="block">
          <span className="block font-mono text-[11px] text-[var(--c-text-dim)]">{row.role}</span>
          <span className="block text-[10px] text-[var(--c-text-mute)]">{roleDetail(row.role)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "7rem",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill status={row.active ? "active" : "disabled"} />
          {row.lockedUntil && <StatusPill status="locked" title={`直到 ${stamp(row.lockedUntil)}`} />}
        </span>
      ),
    },
    {
      key: "lastLogin",
      header: "最近登录",
      width: "8rem",
      hideBelow: "md",
      render: (row) => (
        <span title={row.lastLoginAt ?? "从未登录"}>{relativeTime(row.lastLoginAt)}</span>
      ),
    },
    {
      key: "failures",
      header: "失败次数",
      width: "6rem",
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <span className={row.failedAttempts > 0 ? "text-[var(--c-warn)]" : ""}>
          {row.failedAttempts}
        </span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "14rem",
      render: (row) => {
        const self = row.username === user;
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Button
              tone="ghost"
              disabled={self}
              title={self ? "不能在这里改自己的角色" : undefined}
              onClick={() => setChanging({ row, role: row.role })}
            >
              改角色
            </Button>
            <Button
              tone="ghost"
              disabled={self}
              title={self ? "不能停用自己" : undefined}
              onClick={() => setToggling(row)}
            >
              {row.active ? "停用" : "启用"}
            </Button>
            <Button tone="ghost" onClick={() => setResetting(row)}>
              重置密码
            </Button>
          </span>
        );
      },
    },
  ];

  if (accounts.error && !accounts.data) {
    return (
      <ErrorState
        title="账号列表加载失败"
        detail={accounts.error instanceof ApiError ? describe(accounts.error) : undefined}
        action={<Button onClick={() => void accounts.refresh()}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--c-radius)] border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2">
        <p className="text-[11px] text-[var(--c-text-dim)]">
          共 {rows.length} 个账号
          {isEnvAccount && " · 当前登录的是环境变量账号（不在表里）"}
        </p>
        <div className="flex items-center gap-2">
          <Button tone="primary" onClick={() => setComposeOpen(true)}>
            新建账号
          </Button>
          <Button tone="ghost" onClick={() => void accounts.refresh()} disabled={accounts.loading}>
            {accounts.loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={accounts.loading && rows.length === 0}
        emptyTitle="表里还没有账号"
        emptyDetail="当前只有环境变量账号可用。建一个 owner 账号后，就可以把 ADMIN_PASSWORD_HASH 当成应急通道而不必日常使用。"
        emptyAction={
          <Button tone="primary" onClick={() => setComposeOpen(true)}>
            新建账号
          </Button>
        }
      />

      <Card title="角色与兜底">
        <ul className="space-y-1.5 text-[11px] leading-5 text-[var(--c-text-dim)]">
          {ROLES.map((item) => (
            <li key={item.value}>
              <span className="font-mono text-[var(--c-text-mute)]">{item.label}</span> — {item.detail}
            </li>
          ))}
          <li>
            <span className="text-[var(--c-text-mute)]">环境变量账号</span> — ADMIN_USER /
            ADMIN_PASSWORD_HASH 决定，始终可登录且视为 owner，不出现在上表，也不会被这张表里的任何误操作锁死。
          </li>
          <li>
            <span className="text-[var(--c-text-mute)]">登录锁定</span> — 同一用户名连续 5 次密码错误锁定
            15 分钟；「失败次数」为 0 说明没有正在积累的失败。
          </li>
        </ul>
      </Card>

      <Drawer
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="新建账号"
        subtitle="密码只在这里输入一次，之后只能重置"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button tone="ghost" onClick={() => setComposeOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button tone="primary" onClick={() => void create()} disabled={busy}>
              {busy ? "创建中…" : "创建"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="用户名" hint="字母、数字、点、下划线、连字符，3–40 位">
            <TextInput value={username} onChange={setUsername} placeholder="例如：editor.zhang" />
          </Field>
          <Field label="初始密码" hint={`至少 ${MIN_PASSWORD} 位；创建后不会再显示`}>
            <TextInput value={password} onChange={setPassword} type="password" />
          </Field>
          <Field label="角色" hint={roleDetail(role)}>
            <Select
              value={role}
              onChange={(value) => setRole(value as Role)}
              options={ROLES.map((item) => ({ value: item.value, label: item.label }))}
            />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={resetting !== null}
        onClose={() => {
          setResetting(null);
          setNewPassword("");
        }}
        title={resetting ? `重置 ${resetting.username} 的密码` : "重置密码"}
        subtitle="旧密码不需要知道；改完请通过可信渠道把新密码交给对方"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              tone="ghost"
              onClick={() => {
                setResetting(null);
                setNewPassword("");
              }}
              disabled={busy}
            >
              取消
            </Button>
            <Button tone="danger" onClick={() => void resetPassword()} disabled={busy}>
              {busy ? "重置中…" : "重置"}
            </Button>
          </div>
        }
      >
        <Field label="新密码" hint={`至少 ${MIN_PASSWORD} 位`}>
          <TextInput value={newPassword} onChange={setNewPassword} type="password" />
        </Field>
      </Drawer>

      <ConfirmDialog
        open={changing !== null}
        title="修改角色"
        detail={
          changing && (
            <>
              <p>
                角色决定这个人能做什么。改动会以操作者、时间与前后值写入审计；
                owner 是唯一能管理账号与密钥的角色。
              </p>
              <p className="mt-2 font-mono text-[11px] text-[var(--c-text)]">{changing.row.username}</p>
            </>
          )
        }
        extra={
          changing && (
            <Field label="新角色" hint={roleDetail(changing.role)}>
              <Select
                value={changing.role}
                onChange={(value) =>
                  setChanging((current) => (current ? { ...current, role: value as Role } : current))
                }
                options={ROLES.map((item) => ({ value: item.value, label: item.label }))}
              />
            </Field>
          )
        }
        confirmLabel="保存"
        requireReason={false}
        busy={busy}
        onCancel={() => setChanging(null)}
        onConfirm={() => void changeRole()}
      />

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.active ? "停用这个账号？" : "启用这个账号？"}
        detail={
          toggling && (
            <>
              <p>
                {toggling.active
                  ? "停用后该账号无法登录，已有会话在过期后失效。账号与它的审计记录都会保留。"
                  : "启用后该账号可以立刻用原密码登录。"}
              </p>
              <p className="mt-2 font-mono text-[11px] text-[var(--c-text)]">{toggling.username}</p>
            </>
          )
        }
        confirmLabel={toggling?.active ? "停用" : "启用"}
        tone={toggling?.active ? "danger" : "primary"}
        requireReason={false}
        busy={busy}
        onCancel={() => setToggling(null)}
        onConfirm={() => void toggle()}
      />
    </div>
  );
}
