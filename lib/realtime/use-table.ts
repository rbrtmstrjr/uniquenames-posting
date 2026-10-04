"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string | number };

// Keeps a list of rows in sync with Postgres changes. `refetch` (optional)
// resyncs after the socket reconnects or the tab/phone wakes up, so events
// missed while asleep never leave stale cards on screen.
export function useRealtimeRows<T extends Row>(table: string, initial: T[], opts: {
  key: string; filter?: string; sort?: (a: T, b: T) => number; refetch?: () => Promise<T[]>;
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
    const resync = async () => { if (refetchRef.current) setRows(sortIt(await refetchRef.current())); };
    const channel = sb.channel(`${table}:${opts.key}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(opts.filter ? { filter: opts.filter } : {}) }, (payload) => {
        setRows((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== (payload.old as T).id);
          const row = payload.new as T;
          const exists = prev.some((r) => r.id === row.id);
          return sortIt(exists ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]);
        });
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") void resync(); });
    const onVisible = () => { if (document.visibilityState === "visible") void resync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); void sb.removeChannel(channel); };
  }, [table, opts.key, opts.filter]);

  return [rows, setRows] as const;
}
