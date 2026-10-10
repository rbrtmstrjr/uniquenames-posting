import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeJson, CLAUDE_CREDITS_OUT, CLAUDE_HAIKU, CLAUDE_MAX_TOKENS } from "@/lib/ai/claude";
import type { GeminiSchema } from "@/lib/ai/gemini";

const KEY = "sk-ant-test-secret-key";
const schema: GeminiSchema = { type: "OBJECT", properties: { a: { type: "STRING" } }, required: ["a"] };
const base = { system: "sys", prompt: "hello", schema, timeoutMs: 5000 };

const message = (text: string, stop_reason = "end_turn", extra: object = {}) => ({
  id: "msg_1", type: "message", role: "assistant", model: CLAUDE_HAIKU,
  content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text }],
  stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "retry-after-ms": "1", ...headers } });
const apiError = (status: number, type: string, msg: string) => json({ type: "error", error: { type, message: msg } }, status);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", KEY);
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

describe("claudeJson", () => {
  it("sends structured-output JSON Schema, effort and no sampling/thinking params; reads the JSON", async () => {
    fetchMock.mockResolvedValueOnce(json(message('{"a":"x"}')));
    const r = await claudeJson<{ a: string }>({ ...base, model: "claude-sonnet-5-5", effort: "medium" });
    expect(r).toEqual({ ok: true, data: { a: "x" } });
    const b = sentBody();
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(b.max_tokens).toBe(CLAUDE_MAX_TOKENS);
    expect(b.system).toBe("sys");
    expect(b.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(b.output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } },
    });
    for (const k of ["temperature", "top_p", "top_k", "thinking", "output_format"]) expect(b).not.toHaveProperty(k);
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("x-api-key")).toBe(KEY);
    expect(headers.get("authorization")).toBeNull();
  });

  it("defaults to Haiku at medium effort", async () => {
    fetchMock.mockResolvedValueOnce(json(message('{"a":"x"}')));
    await claudeJson(base);
    expect(sentBody().model).toBe(CLAUDE_HAIKU);
    expect(sentBody().output_config.effort).toBe("medium");
  });

  it("applies parse and rejects the wrong shape", async () => {
    fetchMock.mockResolvedValueOnce(json(message('{"a":"x"}')));
    expect(await claudeJson({ ...base, parse: () => null })).toEqual({ ok: false, error: "Claude returned JSON in the wrong shape." });
    fetchMock.mockResolvedValueOnce(json(message('{"a":"x"}')));
    expect(await claudeJson({ ...base, parse: (x) => (x as { a: string }).a })).toEqual({ ok: true, data: "x" });
  });

  it("needs the key and never sends a request without it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", " ");
    expect(await claudeJson(base)).toEqual({ ok: false, error: "ANTHROPIC_API_KEY is not set." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a refusal and a max_tokens cut before reading the content", async () => {
    fetchMock.mockResolvedValueOnce(json(message('{"a":', "refusal")));
    const r1 = await claudeJson(base);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/declined/i);
    fetchMock.mockResolvedValueOnce(json(message('{"a":', "max_tokens")));
    const r2 = await claudeJson(base);
    if (!r2.ok) expect(r2.error).toMatch(/max_tokens/);
    expect(r2.ok).toBe(false);
  });

  it("reports empty text and invalid JSON", async () => {
    fetchMock.mockResolvedValueOnce(json(message("  ")));
    expect(await claudeJson(base)).toEqual({ ok: false, error: "Claude returned no text." });
    fetchMock.mockResolvedValueOnce(json(message("not json")));
    expect(await claudeJson(base)).toEqual({ ok: false, error: "Claude returned invalid JSON." });
  });

  it("maps 401 to a key message (no retry) and never leaks the key", async () => {
    fetchMock.mockResolvedValue(apiError(401, "authentication_error", "invalid x-api-key"));
    const r = await claudeJson(base);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toMatch(/ANTHROPIC_API_KEY/); expect(r.error).not.toContain(KEY); }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 402 and the 400 credit-balance error to the credits message", async () => {
    fetchMock.mockResolvedValueOnce(apiError(402, "billing_error", "payment required"));
    expect(await claudeJson(base)).toEqual({ ok: false, error: CLAUDE_CREDITS_OUT });
    fetchMock.mockResolvedValueOnce(apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."));
    expect(await claudeJson(base)).toEqual({ ok: false, error: CLAUDE_CREDITS_OUT });
    expect(CLAUDE_CREDITS_OUT).toMatch(/^Your Claude credits have run out/);
  });

  it("keeps other 400s readable", async () => {
    fetchMock.mockResolvedValueOnce(apiError(400, "invalid_request_error", "output_config.format: bad schema"));
    const r = await claudeJson(base);
    expect(r).toEqual({ ok: false, error: "Claude error 400: output_config.format: bad schema" });
  });

  it("retries a 429 once, then reports it", async () => {
    fetchMock.mockResolvedValue(apiError(429, "rate_limit_error", "slow down"));
    const r = await claudeJson(base);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/429/);
  });

  it("retries a 529 once and succeeds", async () => {
    fetchMock.mockResolvedValueOnce(apiError(529, "overloaded_error", "Overloaded")).mockResolvedValueOnce(json(message('{"a":"y"}')));
    expect(await claudeJson(base)).toEqual({ ok: true, data: { a: "y" } });
  });

  it("reports a 5xx after its retry", async () => {
    fetchMock.mockResolvedValue(apiError(500, "api_error", "boom"));
    const r = await claudeJson(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/busy|trouble/i);
  });

  it("times out at the deadline", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const r = await claudeJson({ ...base, timeoutMs: 50 });
    expect(r).toEqual({ ok: false, error: "Claude timed out." });
  });

  it("reports a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const r = await claudeJson(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Could not reach Claude/);
  });
});
