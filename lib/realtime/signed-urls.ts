"use client";
import { useEffect, useReducer } from "react";
import { createClient } from "@/lib/supabase/client";

const cache = new Map<string, { url: string; exp: number }>();

const TTL_S = 3600;
// Re-sign anything that expires within this window, so an image never goes blank.
export const RESIGN_WINDOW_MS = 5 * 60_000;
// Refresh timer while the page stays open: it fires at most every ~50 min, and earlier
// when a cached URL enters the re-sign window sooner (so a page mounted on half-used URLs
// still re-signs in time). A failed or empty signing retries after RESIGN_RETRY_MS.
export const RESIGN_INTERVAL_MS = 50 * 60_000;
export const RESIGN_RETRY_MS = 30_000;

// Paths with no cached URL or one expiring within RESIGN_WINDOW_MS of `now`.
export function pathsNeedingSignature(paths: string[], cached: Map<string, { exp: number }>, now: number): string[] {
  return paths.filter((p) => { const c = cached.get(p); return !c || c.exp <= now + RESIGN_WINDOW_MS; });
}

// How long until the next refresh should run for `paths`: when the soonest-expiring one
// enters the re-sign window, capped at RESIGN_INTERVAL_MS, never sooner than RESIGN_RETRY_MS.
export function nextResignDelay(paths: string[], cached: Map<string, { exp: number }>, now: number): number {
  let delay = RESIGN_INTERVAL_MS;
  for (const p of paths) {
    const c = cached.get(p);
    delay = Math.min(delay, c ? c.exp - RESIGN_WINDOW_MS - now : 0);
  }
  return Math.max(delay, RESIGN_RETRY_MS);
}

// Private bucket: images are shown through signed URLs (1 h), cached per path.
// Paths include the card version, so a regenerated card never shows the old image.
// The signing re-runs when the tab/app becomes visible again and on a ~50 min timer, so a
// phone that resumes the same page after an hour gets fresh URLs instead of blank images.
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const key = wanted.join("|");
  useEffect(() => {
    const list = key ? key.split("|") : [];
    if (!list.length) return;
    let alive = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (alive) timer = setTimeout(sign, nextResignDelay(list, cache, Date.now()));
    };
    const sign = () => {
      if (inFlight) return;
      const need = pathsNeedingSignature(list, cache, Date.now());
      if (!need.length) { schedule(); return; }
      inFlight = true;
      createClient().storage.from("cards").createSignedUrls(need, TTL_S).then(({ data }) => {
        const exp = Date.now() + TTL_S * 1000;
        (data ?? []).forEach((d) => { if (d.path && d.signedUrl) cache.set(d.path, { url: d.signedUrl, exp }); });
        if (alive) bump();
      }, () => { /* offline: the retry timer / next visibility change tries again */ })
        .finally(() => { inFlight = false; schedule(); });
    };
    const onVisible = () => { if (document.visibilityState === "visible") sign(); };
    sign();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }, [key]);
  // An expired URL would only render a broken image; return nothing until it is re-signed.
  return (p?: string | null) => { const c = p ? cache.get(p) : undefined; return c && c.exp > Date.now() ? c.url : undefined; };
}

export async function signedUrlsNow(paths: string[]): Promise<Record<string, string>> {
  const { data } = await createClient().storage.from("cards").createSignedUrls(paths, 600);
  return Object.fromEntries((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path!, d.signedUrl!]));
}
