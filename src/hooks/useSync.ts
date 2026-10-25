import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchStatus } from "../api";
import type { StatusResponse } from "../types";

export type SyncPhase = "idle" | "running" | "done" | "failed";

/**
 * Reading the archive never triggers collection. A cron job on the server owns
 * that job; this hook only mirrors what the last run reported, and keeps a
 * short poll running while a run is actually in flight so the page catches the
 * result without the visitor reloading.
 */
const POLL_MS = 5_000;
const REFRESH_MS = 5 * 60_000;

function describeError(error: unknown) {
  if (error instanceof ApiError && error.code === "network") {
    return "无法连接档案接口，仍可浏览已载入的内容。";
  }
  return "无法读取同步状态，仍可浏览已收录的档案。";
}

export function useSync({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<StatusResponse | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [notice, setNotice] = useState("采集由后台定时任务执行，本页只读取档案状态。");

  const refreshStatus = useCallback(async () => {
    const data = await fetchStatus();
    setSnapshot(data);
    return data;
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      let delay = REFRESH_MS;
      try {
        const data = await fetchStatus();
        if (cancelled) return;
        setSnapshot(data);
        const last = data.runs[0];
        if (data.sync.running) {
          setPhase("running");
          setNotice("后台正在采集公开来源，本页会自动刷新结果。");
          delay = POLL_MS;
        } else if (last?.status === "failed") {
          setPhase("failed");
          setNotice("上一次采集未能完成，详情见下方记录。");
        } else if (last?.status === "partial") {
          setPhase("done");
          setNotice("上次采集完成，但部分公开来源未能抓取。");
        } else if (last) {
          setPhase("done");
          setNotice("档案由后台定时任务更新，本页只读取最新状态。");
        } else {
          setPhase("idle");
          setNotice("还没有采集记录，首次定时任务完成后会显示在这里。");
        }
      } catch (error) {
        if (cancelled) return;
        setPhase("failed");
        setNotice(describeError(error));
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready]);

  return {
    snapshot,
    phase,
    notice,
    running: phase === "running" || Boolean(snapshot?.sync.running),
    refreshStatus,
  };
}
