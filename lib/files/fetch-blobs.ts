// Fetches the image bytes for `paths` that are not in `cache` yet (3 at a time),
// signing fresh URLs for just those paths. Fills `cache` as it goes and reports
// which paths failed, so callers can retry or give a clear error.
export async function fetchMissingBlobs(
  paths: string[],
  cache: Map<string, Blob>,
  sign: (paths: string[]) => Promise<Record<string, string>>,
  fetchFn: (url: string) => Promise<Response> = (u) => fetch(u),
  opts: { alive?: () => boolean; onProgress?: () => void } = {},
): Promise<{ failed: string[] }> {
  const alive = opts.alive ?? (() => true);
  const need = paths.filter((p) => !cache.has(p));
  if (!need.length) return { failed: [] };
  let urls: Record<string, string>;
  try { urls = await sign(need); } catch { return { failed: need }; }
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (alive() && next < need.length) {
      const p = need[next++];
      try {
        if (!urls[p]) throw new Error("no signed url");
        const res = await fetchFn(urls[p]);
        if (!res.ok) throw new Error("bad response");
        cache.set(p, await res.blob());
      } catch { failed.push(p); }
      if (alive()) opts.onProgress?.();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { failed };
}
