"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CardRow, PostRow, WorkerStatusRow } from "@/lib/db/types";
import { lastSeenText, workerHealth } from "@/lib/status/worker-health";
import { etaSeconds, formatEta } from "@/lib/status/eta";
import { decideLoad } from "@/lib/status/activity-decision";
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
    refetch: async () => {
      const { data, error } = await createClient().from("worker_status").select("*").eq("id", 1);
      return error ? null : ((data ?? []) as WorkerStatusRow[]);
    },
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

  const seqRef = useRef(0);

  // Query errors and out-of-order loads change nothing (see decideLoad), so a
  // network blip can never fake "Post ready" or leave a stale pill.
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const sb = createClient();
      const { data: posts, error: postsErr } = await sb.from("posts").select("*").eq("status", "generating").order("created_at", { ascending: false }).limit(1);
      const post = (posts?.[0] ?? null) as PostRow | null;
      const d1 = decideLoad({ seq, latestSeq: seqRef.current, errored: !!postsErr, lastActive: lastActive.current, generatingPostId: post?.id ?? null });
      if (!d1.apply) return;
      if (!post) {
        lastActive.current = d1.nextLastActive;
        const finished = d1.finished;
        if (finished) {
          onFinishRef.current?.(finished);
          setState({ post: null, done: 0, total: 0, failed: 0, etaText: "", finishedPostId: finished });
          setTimeout(() => setState((s) => (s.finishedPostId === finished ? { ...s, finishedPostId: null } : s)), 20000);
        } else setState((s) => ({ ...s, post: null }));
        return;
      }
      const { data: cards, error: cardsErr } = await sb.from("cards").select("status").eq("post_id", post.id);
      const durations = await recentDurations();
      const d2 = decideLoad({ seq, latestSeq: seqRef.current, errored: !!cardsErr, lastActive: lastActive.current, generatingPostId: post.id });
      if (!d2.apply) return;
      lastActive.current = d2.nextLastActive;
      const list = (cards ?? []) as Pick<CardRow, "status">[];
      const done = list.filter((c) => c.status === "done").length;
      const failed = list.filter((c) => c.status === "failed").length;
      const remaining = list.length - done - failed;
      setState({ post, done, total: list.length, failed, etaText: formatEta(etaSeconds(remaining, durations)), finishedPostId: null });
    } catch { /* fetch threw: keep the current state */ }
  }, []);

  useEffect(() => {
    void load();
    const sb = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const kick = () => { clearTimeout(t); t = setTimeout(() => void load(), 400); };
    const ch = sb.channel(`activity:${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table: "cards" }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, kick).subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") kick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVisible); void sb.removeChannel(ch); };
  }, [load]);

  return state;
}
