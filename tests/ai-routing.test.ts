import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every text caller goes through aiJson: with AI_PROVIDER=claude, Gemini is never called.
const { generateJson, claudeJson } = vi.hoisted(() => ({ generateJson: vi.fn(), claudeJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
vi.mock("@/lib/ai/claude", () => ({ claudeJson, CLAUDE_HAIKU: "claude-haiku-5-5", CLAUDE_SONNET: "claude-sonnet-5-5" }));

const { writeReelScript, REEL_SCRIPT_SYSTEM } = await import("@/lib/ai/reel-script");
const { suggestNames, suggestThemes, suggestLetterNames, NAMES_SYSTEM, LETTER_SYSTEM } = await import("@/lib/ai/suggest");
const { writeReelCaption } = await import("@/lib/ai/reel-caption");

beforeEach(() => {
  generateJson.mockReset();
  claudeJson.mockReset().mockResolvedValue({ ok: false, error: "stub" });
  vi.stubEnv("AI_PROVIDER", "claude");
  vi.stubEnv("AI_SCRIPT_MODEL", "sonnet");
});
afterEach(() => vi.unstubAllEnvs());

const call = () => claudeJson.mock.calls[0][0];

describe("callers on Claude", () => {
  it("reel script: the same system prompt, the script model at medium effort", async () => {
    await writeReelScript({ maxScenes: 30, alreadyMade: [], format: "problem_fix", theme: { id: "crayon", faces: true } });
    expect(generateJson).not.toHaveBeenCalled();
    expect(call().system).toBe(REEL_SCRIPT_SYSTEM);
    expect(call()).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium" });
    expect(call()).not.toHaveProperty("temperature");
  });

  it("name, theme and letter suggestions: Haiku at low effort", async () => {
    await suggestNames({ gender: "girl", style: "single", count: 3, existing: [] });
    expect(call()).toMatchObject({ system: NAMES_SYSTEM, model: "claude-haiku-5-5", effort: "low" });
    claudeJson.mockClear();
    await suggestThemes({ gender: "boy", count: 2, existing: [] });
    expect(call()).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    claudeJson.mockClear();
    await suggestLetterNames({ gender: "boy", style: "single", letter: "A", count: 3, existing: [] });
    expect(call()).toMatchObject({ system: LETTER_SYSTEM, model: "claude-haiku-5-5", effort: "low" });
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("captions: Haiku at low effort", async () => {
    await writeReelCaption({ title: "Two choices", lines: ["Try the two-choice rule tonight."] });
    expect(call()).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    expect(generateJson).not.toHaveBeenCalled();
  });
});
