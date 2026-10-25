import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "../api";
import { sessionApi, type Permission, type Role, type SessionInfo } from "./api";

/**
 * One source of truth for who is signed in and what they may do.
 *
 * The role arrives from `GET /session`, never from decoded client state: the
 * cookie is HttpOnly and the server is the only thing that knows the role. Every
 * gated control asks `can(...)` rather than comparing role strings, so adding a
 * permission later touches `auth.py` and nothing else.
 */

export type SessionStatus = "checking" | "out" | "in";

interface SessionContextValue {
  status: SessionStatus;
  session: SessionInfo | null;
  user: string | null;
  role: Role | null;
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  signIn: (user: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [session, setSession] = useState<SessionInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await sessionApi.read();
      setSession(info);
      setStatus("in");
    } catch (caught) {
      // A 5xx is not a signed-out user; it is a broken server. Either way the
      // console cannot render, and the login pane shows the failure honestly.
      setSession(null);
      setStatus("out");
      if (!(caught instanceof ApiError) || caught.status >= 500) throw caught;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const signIn = useCallback(async (user: string, password: string) => {
    const info = await sessionApi.login(user, password);
    const full = await sessionApi.read();
    setSession({ ...full, user: info.user });
    setStatus("in");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await sessionApi.logout();
    } finally {
      setSession(null);
      setStatus("out");
    }
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const permissions = session?.permissions ?? [];
    return {
      status,
      session,
      user: session?.user ?? null,
      role: session?.role ?? null,
      permissions,
      can: (permission) => permissions.includes(permission),
      signIn,
      signOut,
      refresh,
    };
  }, [status, session, signIn, signOut, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/** Narrow hook for the common case: `const canDecide = useCan("decide")`. */
export function useCan(permission: Permission): boolean {
  return useSession().can(permission);
}
