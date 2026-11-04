import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FacebookError, GRAPH_VERSION, appSecretProof, facebookConfig, graphClient } from "@/lib/facebook/graph";

const cfg = { pageId: "111", token: "PAGE-TOKEN", appSecret: "SECRET" };

/** A fake Facebook: records every request and answers with `answer(path, params)`. */
function fakeFetch(answer: (path: string, params: URLSearchParams, method: string) => { status?: number; body: unknown } | "throw") {
  const calls: { method: string; path: string; params: URLSearchParams }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const params = method === "GET" || method === "DELETE" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
    const path = url.pathname.replace(`/${GRAPH_VERSION}`, "");
    calls.push({ method, path, params });
    const a = answer(path, params, method);
    if (a === "throw") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("facebookConfig", () => {
  it("needs all three keys, trimmed", () => {
    expect(facebookConfig({ FACEBOOK_PAGE_ID: " 111 ", FACEBOOK_PAGE_TOKEN: "t ", FACEBOOK_APP_SECRET: " s" })).toEqual({ pageId: "111", token: "t", appSecret: "s" });
    expect(facebookConfig({ FACEBOOK_PAGE_ID: "111", FACEBOOK_PAGE_TOKEN: "t" })).toBeNull();
    expect(facebookConfig({})).toBeNull();
  });
});

describe("graph client", () => {
  it("signs every call with appsecret_proof (HMAC-SHA256 of the token, keyed with the app secret) on v26.0", async () => {
    expect(appSecretProof("PAGE-TOKEN", "SECRET")).toBe(createHmac("sha256", "SECRET").update("PAGE-TOKEN").digest("hex"));
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { name: "Unique Names", id: "111" } }));
    expect(await graphClient(cfg, fetchImpl).pageName()).toBe("Unique Names");
    expect(calls[0].path).toBe("/111");
    expect(calls[0].params.get("access_token")).toBe("PAGE-TOKEN");
    expect(calls[0].params.get("appsecret_proof")).toBe(appSecretProof("PAGE-TOKEN", "SECRET"));
    expect(GRAPH_VERSION).toBe("v26.0");
  });

  it("uploads a photo unpublished from a URL (temporary when it is for a scheduled post)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { id: "photo-1" } }));
    const fb = graphClient(cfg, fetchImpl);
    expect(await fb.uploadPhoto("https://files.example/c1.jpg")).toBe("photo-1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/111/photos" });
    expect(calls[0].params.get("url")).toBe("https://files.example/c1.jpg");
    expect(calls[0].params.get("published")).toBe("false");
    expect(calls[0].params.has("temporary")).toBe(false);
    await fb.uploadPhoto("https://files.example/c2.jpg", { temporary: true });
    expect(calls[1].params.get("temporary")).toBe("true");
  });

  it("creates ONE feed post with every photo attached in order, and the caption", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { id: "111_999" } }));
    const ids = Array.from({ length: 14 }, (_, i) => `p${i + 1}`);
    expect(await graphClient(cfg, fetchImpl).createPost({ message: "Names 🥰\n\n#uniquenames", photoIds: ids })).toBe("111_999");
    const p = calls[0].params;
    expect(calls[0]).toMatchObject({ method: "POST", path: "/111/feed" });
    expect(p.get("message")).toBe("Names 🥰\n\n#uniquenames");
    ids.forEach((id, i) => expect(JSON.parse(p.get(`attached_media[${i}]`)!)).toEqual({ media_fbid: id }));
    expect(p.has("attached_media[14]")).toBe(false);
    expect(p.has("published")).toBe(false);
  });

  it("schedules: unpublished with Facebook's scheduled time (unix seconds) and the SCHEDULED type", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { id: "111_5" } }));
    const at = new Date("2026-11-05T11:00:00Z");
    await graphClient(cfg, fetchImpl).createPost({ message: "x", photoIds: ["a"], scheduledAt: at });
    const p = calls[0].params;
    expect(p.get("published")).toBe("false");
    expect(p.get("scheduled_publish_time")).toBe(String(at.getTime() / 1000));
    expect(p.get("unpublished_content_type")).toBe("SCHEDULED");
  });

  it("reads a post's link and deletes a post", async () => {
    const { fetchImpl, calls } = fakeFetch((path, _p, method) => ({ body: method === "DELETE" ? { success: true } : { permalink_url: "https://www.facebook.com/111/posts/999" } }));
    const fb = graphClient(cfg, fetchImpl);
    expect(await fb.permalink("111_999")).toBe("https://www.facebook.com/111/posts/999");
    expect(calls[0].params.get("fields")).toBe("permalink_url");
    await fb.deletePost("111_999");
    expect(calls[1]).toMatchObject({ method: "DELETE", path: "/111_999" });
  });

  it.each([
    [{ code: 190, error_subcode: 460 }, "auth"],
    [{ code: 190 }, "auth"],
    [{ code: 10, error_subcode: 492 }, "auth"],
    [{ code: 368 }, "blocked"],
    [{ code: 4 }, "rate"],
    [{ code: 32 }, "rate"],
    [{ code: 80001 }, "rate"],
    [{ code: 100, error_subcode: 2018062 }, "other"],
  ])("maps Facebook error %j to kind %s, keeping Facebook's message", async (e, kind) => {
    const { fetchImpl } = fakeFetch(() => ({ status: 400, body: { error: { message: "Facebook says no", type: "OAuthException", ...e } } }));
    const err = await graphClient(cfg, fetchImpl).pageName().catch((x) => x);
    expect(err).toBeInstanceOf(FacebookError);
    expect(err).toMatchObject({ kind, code: e.code, message: "Facebook says no" });
  });

  it("no answer at all is 'network' (nothing is known about what Facebook did)", async () => {
    const { fetchImpl } = fakeFetch(() => "throw");
    await expect(graphClient(cfg, fetchImpl).createPost({ message: "x", photoIds: ["a"] })).rejects.toMatchObject({ kind: "network" });
    const slow = (async (_i: string | URL, init?: RequestInit) => new Promise((_r, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
    await expect(graphClient(cfg, slow, 20).pageName()).rejects.toMatchObject({ kind: "network" });
  });
});
