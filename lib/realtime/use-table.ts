"use client";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient, realtimeAuthReady } from "@/lib/supabase/client";

type Row = { id: string | number };

// Keeps a list of rows in sync with Postgres changes. `refetch` (optional)
// resyncs after the socket reconnects or the tab/phone wakes up, so events
// missed while asleep never leave stale cards on screen.
export function useRealtimeRows<T extends Row>(table: string, initial: T[], opts: {
  key: string; filter?: string; sort?: (a: T, b: T) => number; refetch?: () => Promise<T[] | null>;
}) {
  const [rows, setRows] = useState<T[]>(initial);
  const sortRef = useRef(opts.sort);
  const refetchRef = useRef(opts.refetch);
  useEffect(() => {
    sortRef.current = opts.sort;
    refetchRef.current = opts.refetch;
  });

  // Re-seed when the server hands us a new `initial` (adjust state during render).
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) { setSeed(initial); setRows(initial); }

  useEffect(() => {
    const sb = createClient();
    const sortIt = (list: T[]) => (sortRef.current ? [...list].sort(sortRef.current) : list);
    // A failed refetch (null or thrown) keeps the rows we already have.
    const resync = async () => {
      if (!refetchRef.current) return;
      try { const fresh = await refetchRef.current(); if (fresh) setRows(sortIt(fresh)); } catch { /* keep rows */ }
    };
    let channel: RealtimeChannel | null = null;
    let gone = false;
    // Join only once the signed-in token is on the socket (see realtimeAuthReady).
    void realtimeAuthReady(sb).then(() => {
      if (gone) return;
      // Unique topic per instance: realtime-js returns the existing channel for a repeated topic.
      channel = sb.channel(`${table}:${opts.key}:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table, ...(opts.filter ? { filter: opts.filter } : {}) }, (payload) => {
          // An event the server couldn't authorize arrives with empty rows: never apply it, reload instead.
          if ((payload as { errors?: unknown[] | null }).errors?.length) { void resync(); return; }
          setRows((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== (payload.old as T).id);
            const row = payload.new as T;
            const exists = prev.some((r) => r.id === row.id);
            return sortIt(exists ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]);
          });
        })
        .subscribe((status) => { if (status === "SUBSCRIBED") void resync(); });
    });
    const onVisible = () => { if (document.visibilityState === "visible") void resync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void sb.removeChannel(channel);
    };
  }, [table, opts.key, opts.filter]);

  return [rows, setRows] as const;
}
