import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchEvent } from "../api";
import type { EventDetail } from "../types";

/**
 * Expanded rows are read on demand, but the answer is kept across unmounts:
 * switching view or collapsing a row and opening it again should not cost a
 * second round trip. Only expanded rows ever enter the cache, and it is capped
 * so a long reading session cannot grow it without bound.
 */
const CACHE = new Map<string, EventDetail>();
const MAX_ENTRIES = 48;

function remember(id: string, detail: EventDetail) {
  CACHE.delete(id);
  CACHE.set(id, detail);
  while (CACHE.size > MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

const PREFETCHING = new Set<string>();

/**
 * 放映会一屏接一屏地走，下一屏的摘要值得提前取。取回来只进缓存，不触发
 * 任何渲染；真正打开那一屏时 `useEventDetail` 从缓存里直接拿得到。
 */
export function prefetchEvent(id: string) {
  if (!id || CACHE.has(id) || PREFETCHING.has(id)) return;
  PREFETCHING.add(id);
  fetchEvent(id)
    .then((data) => remember(id, data.event))
    .catch(() => undefined)
    .finally(() => PREFETCHING.delete(id));
}

export function useEventDetail(id: string, expanded: boolean) {
  const [detail, setDetail] = useState<EventDetail | null>(() => CACHE.get(id) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchEvent(id, signal);
        if (signal?.aborted) return;
        remember(id, data.event);
        setDetail(data.event);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof ApiError ? err.code : "unknown");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    if (!expanded || detail) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [expanded, detail, load]);

  return { detail, loading, error, retry: () => void load() };
}
