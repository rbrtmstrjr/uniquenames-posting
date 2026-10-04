"use client";
import { useEffect, useReducer, useState } from "react";
import { signedUrlsNow } from "@/lib/realtime/signed-urls";
import { fetchMissingBlobs } from "@/lib/files/fetch-blobs";

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
      if (want.every((p) => blobs.has(p))) { setFailed(false); bump(); return; }
      const r = await fetchMissingBlobs(want, blobs, signedUrlsNow, undefined, { alive: () => alive, onProgress: bump });
      if (alive) setFailed(r.failed.length > 0);
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, attempt]);

  const wanted = key ? key.split("|") : [];
  return {
    get: (p: string) => blobs.get(p),
    // The zip path does not depend on the prefetch: it fetches whatever is still
    // missing on demand (fresh signed URLs) and throws if a picture can't be loaded.
    ensure: async (want: string[]): Promise<Blob[]> => {
      const r = await fetchMissingBlobs(want, blobs, signedUrlsNow, undefined, { onProgress: bump });
      if (r.failed.length) throw new Error(`${r.failed.length} picture${r.failed.length === 1 ? "" : "s"} could not be downloaded`);
      setFailed(false);
      return want.map((p) => blobs.get(p)!);
    },
    ready: wanted.filter((p) => blobs.has(p)).length,
    total: wanted.length,
    failed,
    retry: () => setAttempt((a) => a + 1),
  };
}
