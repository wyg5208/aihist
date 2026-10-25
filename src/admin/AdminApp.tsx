import { AppShell } from "./components/AppShell";
import { LoginPane } from "./LoginPane";
import { SessionProvider, useSession } from "./session";

/**
 * Two states, no router at this level: a signed-out visitor sees the login pane
 * and nothing else, and the shell only exists once `/session` has answered.
 */

function Gate() {
  const { status } = useSession();

  if (status === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--c-text-mute)]">
          正在校验会话…
        </p>
      </div>
    );
  }

  if (status === "out") {
    return <LoginPane />;
  }

  return <AppShell />;
}

export default function AdminApp() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
