import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchTimeline } from "../api";
import type { SyncSummary, TimelineItem } from "../types";

interface TimelineState {
  phase: "loading" | "ready" | "error";
  items: TimelineItem[];
  total: number;
  truncated: boolean;
  sync: SyncSummary | null;
  error: string | null;
  refreshing: boolean;
}

const initial: TimelineState = {
  phase: "loading",
  items: [],
  total: 0,
  truncated: false,
  sync: null,
  error: null,
  refreshing: false,
};

export function useTimeline() {
  const [state, setState] = useState<TimelineState>(initial);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((prev) =>
      prev.phase === "ready"
        ? { ...prev, refreshing: true }
        : { ...prev, phase: "loading", error: null }
    );
    try {
      const data = await fetchTimeline(1200, signal);
      if (!mounted.current || signal?.aborted) return;
      setState({
        phase: "ready",
        items: data.items,
        total: data.total,
        truncated: data.truncated,
        sync: data.sync,
        error: null,
        refreshing: false,
      });
    } catch (error) {
      if (!mounted.current || signal?.aborted) return;
      setState((prev) => ({
        ...prev,
        phase: prev.items.length ? "ready" : "error",
        refreshing: false,
        error: error instanceof ApiError ? error.code : "unknown",
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...state, reload: load };
}
