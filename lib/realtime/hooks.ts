"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CardRow, PostRow, WorkerStatusRow } from "@/lib/db/types";
import { lastSeenText, workerHealth } from "@/lib/status/worker-health";
import { etaSeconds, formatEta } from "@/lib/status/eta";
import { useRealtimeRows } from "./use-table";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function useWorker(initial: WorkerStatusRow | null) {
  // Stable array identity: useRealtimeRows re-seeds whenever `initial` changes.
  const seed = useMemo(() => (initial ? [initial] : []), [initial]);
  const [rows] = useRealtimeRows<WorkerStatusRow>("worker_status", seed, {
    key: "worker",
    refetch: async () => ((await createClient().from("worker_status").select("*").eq("id", 1)).data ?? []) as WorkerStatusRow[],
  });
  const now = useNow(5000);
  const row = rows[0] ?? null;
  return { row, health: workerHealth(row, now), lastSeen: lastSeenText(row, now) };
}

export async function recentDurations(): Promise<number[]> {
  const { data } = await createClient().from("cards").select("started_at, finished_at")
    .eq("status", "done").not("finished_at", "is", null).not("started_at", "is", null)
    .order("finished_at", { ascending: false }).limit(10);
  return (data ?? []).map((c) => (Date.parse(c.finished_at!) - Date.parse(c.started_at!)) / 1000).filter((s) => s > 0 && s < 600);
}

export interface Activity { post: PostRow | null; done: number; total: number; failed: number; etaText: string; finishedPostId: string | null }

// Powers the header pill on every page. Refetches a small summary whenever a
// card or post changes (debounced), instead of tracking every row.
export function useActivity(onFinish?: (postId: string) => void): Activity {
  const [state, setState] = useState<Activity>({ post: null, done: 0, total: 0, failed: 0, etaText: "", finishedPostId: null });
  const lastActive = useRef<string | null>(null);
  const onFinishRef = useRef(onFinish);
  useEffect(() => { onFinishRef.current = onFinish; });

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: posts } = await sb.from("posts").select("*").eq("status", "generating").order("created_at", { ascending: false }).limit(1);
    const post = (posts?.[0] ?? null) as PostRow | null;
    if (!post) {
      const finished = lastActive.current;
      lastActive.current = null;
      if (finished) {
        onFinishRef.current?.(finished);
        setState({ post: null, done: 0, total: 0, failed: 0, etaText: "", finishedPostId: finished });
        setTimeout(() => setState((s) => (s.finishedPostId === finished ? { ...s, finishedPostId: null } : s)), 20000);
      } else setState((s) => ({ ...s, post: null }));
      return;
    }
    lastActive.current = post.id;
    const { data: cards } = await sb.from("cards").select("status").eq("post_id", post.id);
    const list = (cards ?? []) as Pick<CardRow, "status">[];
    const done = list.filter((c) => c.status === "done").length;
    const failed = list.filter((c) => c.status === "failed").length;
    const remaining = list.length - done - failed;
    setState({ post, done, total: list.length, failed, etaText: formatEta(etaSeconds(remaining, await recentDurations())), finishedPostId: null });
  }, []);

  useEffect(() => {
    void load();
    const sb = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const kick = () => { clearTimeout(t); t = setTimeout(() => void load(), 400); };
    const ch = sb.channel("activity").on("postgres_changes", { event: "*", schema: "public", table: "cards" }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, kick).subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") kick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVisible); void sb.removeChannel(ch); };
  }, [load]);

  return state;
}
