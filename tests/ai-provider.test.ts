import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateJson, claudeJson } = vi.hoisted(() => ({ generateJson: vi.fn(), claudeJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
vi.mock("@/lib/ai/claude", () => ({ claudeJson, CLAUDE_HAIKU: "claude-haiku-5-5", CLAUDE_SONNET: "claude-sonnet-5-5" }));

import { aiJson, aiProvider, claudeModelFor } from "@/lib/ai/provider";
import type { GeminiSchema } from "@/lib/ai/gemini";

const schema: GeminiSchema = { type: "OBJECT", properties: { a: { type: "STRING" } }, required: ["a"] };
const parse = (x: unknown) => x as { a: string };
const input = {
  system: "s", prompt: "p", schema, timeoutMs: 9000, parse, temperature: 1, model: "gemini-3.1-pro-preview", thinkingLevel: "low" as const,
};

beforeEach(() => {
  generateJson.mockReset().mockResolvedValue({ ok: true, data: { a: "g" } });
  claudeJson.mockReset().mockResolvedValue({ ok: true, data: { a: "c" } });
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("AI_SCRIPT_MODEL", "");
  vi.stubEnv("AI_SCRIPT_EFFORT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("aiProvider", () => {
  it("is Gemini unless AI_PROVIDER=claude", () => {
    expect(aiProvider()).toBe("gemini");
    vi.stubEnv("AI_PROVIDER", "openai");
    expect(aiProvider()).toBe("gemini");
    vi.stubEnv("AI_PROVIDER", " Claude ");
    expect(aiProvider()).toBe("claude");
  });
});

describe("claudeModelFor", () => {
  it("uses Haiku for small tasks and for scripts by default; Sonnet when AI_SCRIPT_MODEL says so", () => {
    expect(claudeModelFor("small")).toBe("claude-haiku-5-5");
    expect(claudeModelFor("script")).toBe("claude-haiku-5-5");
    vi.stubEnv("AI_SCRIPT_MODEL", "sonnet");
    expect(claudeModelFor("script")).toBe("claude-sonnet-5-5");
    expect(claudeModelFor("small")).toBe("claude-haiku-5-5");
    vi.stubEnv("AI_SCRIPT_MODEL", "claude-sonnet-5-5");
    expect(claudeModelFor("script")).toBe("claude-sonnet-5-5");
    vi.stubEnv("AI_SCRIPT_MODEL", "gpt-9");
    expect(claudeModelFor("script")).toBe("claude-haiku-5-5");
  });
});

describe("aiJson", () => {
  it("passes the call to Gemini unchanged by default (task removed)", async () => {
    const r = await aiJson({ ...input, task: "script" });
    expect(r).toEqual({ ok: true, data: { a: "g" } });
    expect(generateJson).toHaveBeenCalledWith(input);
    expect(claudeJson).not.toHaveBeenCalled();
  });

  it("sends scripts to Claude at medium effort without the Gemini-only settings", async () => {
    vi.stubEnv("AI_PROVIDER", "claude");
    vi.stubEnv("AI_SCRIPT_MODEL", "sonnet");
    const r = await aiJson({ ...input, task: "script" });
    expect(r).toEqual({ ok: true, data: { a: "c" } });
    expect(generateJson).not.toHaveBeenCalled();
    expect(claudeJson).toHaveBeenCalledWith({ system: "s", prompt: "p", schema, timeoutMs: 9000, parse, model: "claude-sonnet-5-5", effort: "medium" });
  });

  it("AI_SCRIPT_EFFORT tunes the script effort only (low|medium|high; anything else = medium)", async () => {
    vi.stubEnv("AI_PROVIDER", "claude");
    vi.stubEnv("AI_SCRIPT_EFFORT", "low");
    await aiJson({ ...input, task: "script" });
    expect(claudeJson.mock.calls[0][0].effort).toBe("low");
    await aiJson({ ...input, task: "small" });
    expect(claudeJson.mock.calls[1][0].effort).toBe("low");
    vi.stubEnv("AI_SCRIPT_EFFORT", "high");
    await aiJson({ ...input, task: "script" });
    expect(claudeJson.mock.calls[2][0].effort).toBe("high");
    vi.stubEnv("AI_SCRIPT_EFFORT", "max");
    await aiJson({ ...input, task: "script" });
    expect(claudeJson.mock.calls[3][0].effort).toBe("medium");
  });

  it("sends small tasks to Haiku at low effort", async () => {
    vi.stubEnv("AI_PROVIDER", "claude");
    await aiJson({ system: "s", prompt: "p", schema, timeoutMs: 5000, task: "small", temperature: 0.4, thinkingBudget: 2048 });
    expect(claudeJson).toHaveBeenCalledWith({ system: "s", prompt: "p", schema, timeoutMs: 5000, parse: undefined, model: "claude-haiku-5-5", effort: "low" });
  });
});
