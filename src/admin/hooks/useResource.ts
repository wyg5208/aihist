import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";

/**
 * One fetch per resource, with cancellation and an explicit refresh.
 *
 * Every page here is the same shape: call an endpoint, show a skeleton, show an
 * error, show data, allow a manual reload, and never write to state after the
 * component unmounted or the filters changed. `AbortController` plus a request
 * generation counter covers that, and the counter is what stops an in-flight
 * response from a previous filter from overwriting the current one.
 */

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True only for the first load, so a refresh does not blank the screen. */
  initial: boolean;
  refresh: () => Promise<T | null>;
  setData: (value: T | null) => void;
}

export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean; autoload?: boolean } = {},
): Resource<T> {
  const enabled = options.enabled !== false;
  const autoload = options.autoload !== false;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [initial, setInitial] = useState(true);

  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async (): Promise<T | null> => {
    const ticket = ++generation.current;
    controller.current?.abort();
    const local = new AbortController();
    controller.current = local;
    setLoading(true);
    try {
      const value = await loaderRef.current(local.signal);
      if (ticket !== generation.current) return null;
      setData(value);
      setError(null);
      return value;
    } catch (caught) {
      if (ticket !== generation.current) return null;
      if (local.signal.aborted) return null;
      const failure =
        caught instanceof ApiError ? caught : new ApiError("unknown", 0);
      if (failure.code === "network" && local.signal.aborted) return null;
      setError(failure);
      return null;
    } finally {
      if (ticket === generation.current) {
        setLoading(false);
        setInitial(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!autoload) {
      // The poller owns the first tick; `initial` stays true until it lands so
      // the caller's skeleton does not flash off and back on.
      return;
    }
    if (!enabled) {
      setLoading(false);
      setInitial(false);
      return;
    }
    void run();
    return () => {
      controller.current?.abort();
    };
    // The dependency list is the caller's contract; `run` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoload, run, ...deps]);

  return { data, error, loading, initial, refresh: run, setData };
}

/**
 * Polling variant for the shell's status lamp: same cancellation rules, but the
 * timer keeps the clock honest and a failed tick never clears the last good data.
 */
export function usePolledResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  enabled = true,
): Resource<T> & { refreshedAt: number } {
  const resource = useResource(loader, [], { enabled, autoload: false });
  const [refreshedAt, setRefreshedAt] = useState(0);
  const refresh = resource.refresh;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      void refresh().then(() => setRefreshedAt(Date.now()));
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return { ...resource, refreshedAt };
}
