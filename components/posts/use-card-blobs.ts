"use client";
import { useEffect, useReducer, useState } from "react";
import { signedUrlsNow } from "@/lib/realtime/signed-urls";

// Image bytes of the selected cards, keyed by card_path (paths include the card version,
// so a remade card never serves the old picture). Prefetched so the share sheet can open
// synchronously inside the tap.
const blobs = new Map<string, Blob>();

export function useCardBlobs(paths: string[]) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = paths.join("|");

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const want = key ? key.split("|") : [];
      for (const k of [...blobs.keys()]) if (!want.includes(k)) blobs.delete(k);
      const need = want.filter((p) => !blobs.has(p));
      if (!need.length) { setFailed(false); bump(); return; }
      let urls: Record<string, string>;
      try { urls = await signedUrlsNow(need); } catch { if (alive) setFailed(true); return; }
      let bad = false;
      let next = 0;
      const worker = async () => {
        while (alive && next < need.length) {
          const p = need[next++];
          try {
            const res = await fetch(urls[p]);
            if (!res.ok) throw new Error("bad response");
            blobs.set(p, await res.blob());
          } catch { bad = true; }
          if (alive) bump();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (alive) setFailed(bad);
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, attempt]);

  const wanted = key ? key.split("|") : [];
  return {
    get: (p: string) => blobs.get(p),
    ready: wanted.filter((p) => blobs.has(p)).length,
    total: wanted.length,
    failed,
    retry: () => setAttempt((a) => a + 1),
  };
}
