"use client";
import { useEffect, useReducer } from "react";
import { createClient } from "@/lib/supabase/client";

const cache = new Map<string, { url: string; exp: number }>();

// Private bucket: images are shown through signed URLs (1 h), cached per path.
// Paths include the card version, so a regenerated card never shows the old image.
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const key = wanted.join("|");
  useEffect(() => {
    const need = wanted.filter((p) => { const c = cache.get(p); return !c || c.exp < Date.now() + 60_000; });
    if (!need.length) return;
    let alive = true;
    void createClient().storage.from("cards").createSignedUrls(need, 3600).then(({ data }) => {
      (data ?? []).forEach((d) => { if (d.path && d.signedUrl) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3_600_000 }); });
      if (alive) bump();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (p?: string | null) => (p ? cache.get(p)?.url : undefined);
}

export async function signedUrlsNow(paths: string[]): Promise<Record<string, string>> {
  const { data } = await createClient().storage.from("cards").createSignedUrls(paths, 600);
  return Object.fromEntries((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path!, d.signedUrl!]));
}
