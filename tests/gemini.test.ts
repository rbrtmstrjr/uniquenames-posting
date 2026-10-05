import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEMINI_MODEL, generateJson } from "@/lib/ai/gemini";

const KEY = "test-key-SECRET-123";
const schema = { type: "OBJECT", properties: { caption: { type: "STRING" } }, required: ["caption"] } as const;
const base = { system: "sys", prompt: "hello", schema: { ...schema, properties: { ...schema.properties }, required: [...schema.required] } };

const ok = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] }), { status: 200 });
const status = (code: number, message = "boom") => new Response(JSON.stringify({ error: { message } }), { status: code });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", KEY);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("generateJson", () => {
  it("posts to the model with the key in a header (never the URL) and parses the JSON", async () => {
    fetchMock.mockResolvedValueOnce(ok({ caption: "Hi" }));
    const r = await generateJson<{ caption: string }>(base);
    expect(r).toEqual({ ok: true, data: { caption: "Hi" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    expect(String(url)).not.toContain(KEY);
    expect(init.headers["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[0].text).toBe("hello");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseSchema: base.schema, thinkingConfig: { thinkingBudget: 0 } });
  });

  it("works for arrays of objects (name/theme suggestions) and skips thought parts", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: '[{"name":"Arlo"},{"name":"Juno"}]' }] } }] })));
    const r = await generateJson<{ name: string }[]>({ ...base, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" } } } } });
    expect(r).toEqual({ ok: true, data: [{ name: "Arlo" }, { name: "Juno" }] });
  });

  it("retries once after a 500, then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(status(500)).mockResolvedValueOnce(ok({ caption: "Again" }));
    expect(await generateJson(base)).toEqual({ ok: true, data: { caption: "Again" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 only once and reports the error", async () => {
    fetchMock.mockImplementation(async () => status(429, "quota"));
    const r = await generateJson(base);
    expect(r).toEqual({ ok: false, error: "Gemini error 429: quota" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    fetchMock.mockImplementation(async () => status(400, "bad"));
    expect(await generateJson(base)).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out without throwing", async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const r = await generateJson({ ...base, timeoutMs: 50 });
    expect(r).toEqual({ ok: false, error: "Gemini timed out." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bad JSON text is a clean failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json {" }] } }] })));
    expect(await generateJson(base)).toEqual({ ok: false, error: "Gemini returned invalid JSON." });
  });

  it("an unreadable body or empty candidates is a clean failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await generateJson(base)).toMatchObject({ ok: false });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })));
    expect(await generateJson(base)).toEqual({ ok: false, error: "Gemini returned no text (SAFETY)." });
  });

  it("a parse() rejection is a clean failure", async () => {
    fetchMock.mockResolvedValueOnce(ok({ wrong: 1 }));
    expect(await generateJson({ ...base, parse: () => null })).toEqual({ ok: false, error: "Gemini returned JSON in the wrong shape." });
  });

  it("missing key fails without calling fetch", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await generateJson(base)).toEqual({ ok: false, error: "GEMINI_API_KEY is not set." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a network error retries once and never leaks the key in the error", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed ${KEY}`));
    const r = await generateJson(base);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
