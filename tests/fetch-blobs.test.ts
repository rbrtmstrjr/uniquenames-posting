import { describe, expect, it } from "vitest";
import { fetchMissingBlobs } from "@/lib/files/fetch-blobs";

const ok = (s: string) => new Response(new Blob([s]), { status: 200 });

describe("fetchMissingBlobs (zip on demand)", () => {
  it("signs and fetches only the paths not cached yet", async () => {
    const cache = new Map<string, Blob>([["a", new Blob(["A"])]]);
    const signed: string[][] = [];
    const r = await fetchMissingBlobs(["a", "b", "c"], cache,
      async (ps) => { signed.push(ps); return Object.fromEntries(ps.map((p) => [p, `https://s/${p}`])); },
      async (u) => ok(u));
    expect(r.failed).toEqual([]);
    expect(signed).toEqual([["b", "c"]]);
    expect([...cache.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(await cache.get("c")!.text()).toBe("https://s/c");
  });
  it("makes no calls when everything is cached", async () => {
    const cache = new Map<string, Blob>([["a", new Blob(["A"])]]);
    let calls = 0;
    const r = await fetchMissingBlobs(["a"], cache, async () => { calls++; return {}; }, async () => { calls++; return ok(""); });
    expect(r.failed).toEqual([]);
    expect(calls).toBe(0);
  });
  it("reports failed paths (bad response, missing url, signing error)", async () => {
    const cache = new Map<string, Blob>();
    const r = await fetchMissingBlobs(["a", "b", "c"], cache,
      async () => ({ a: "https://s/a", b: "https://s/b" }),
      async (u) => (u.endsWith("/b") ? new Response("", { status: 403 }) : ok("x")));
    expect(r.failed.sort()).toEqual(["b", "c"]);
    expect(cache.has("a")).toBe(true);
    const r2 = await fetchMissingBlobs(["z"], new Map(), async () => { throw new Error("offline"); });
    expect(r2.failed).toEqual(["z"]);
  });
});
