import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { aiCaption, captionPrompt, sanitizeCaption, CAPTION_MAX, CAPTION_SYSTEM } = await import("@/lib/ai/caption");

const theme = {
  title: "Autumn Pumpkin Patch", backdrop: "rustic barn wall with hay bales", outfit: "knitted mustard sweater",
  props: "tiny pumpkins and a wicker basket", lighting: "golden hour side light", palette: "orange, cream, rust",
};
const settings = { caption_template: "Here are some beautiful names for your baby {gender}. 🥰", hashtags: "#babynames #uniquenames", caption_ai: true };

beforeEach(() => generateJson.mockReset());

describe("captionPrompt", () => {
  it("carries every theme field and the gender", () => {
    const p = captionPrompt({ theme, gender: "girl", style: "two-word" });
    for (const v of Object.values(theme)) expect(p).toContain(v);
    expect(p).toContain("baby girl names");
  });
  it("system prompt sets the rules (no hashtags, no invented meanings, ≤ 1 emoji)", () => {
    expect(CAPTION_SYSTEM).toMatch(/No hashtags/);
    expect(CAPTION_SYSTEM).toMatch(/never state what a name means/);
    expect(CAPTION_SYSTEM).toMatch(/at most one emoji/i);
  });
});

describe("sanitizeCaption", () => {
  it("strips hashtags, mentions, links and quotes but keeps apostrophes", () => {
    expect(sanitizeCaption('"Cozy pumpkin vibes for today\'s baby girl names!" #fall @someone https://x.co/a Which is your favorite?'))
      .toBe("Cozy pumpkin vibes for today's baby girl names! Which is your favorite?");
  });
  it("keeps only the first emoji", () => {
    expect(sanitizeCaption("Sweet baby boy names for a sunny shoot 🌻 so cute 🥰👶 love them")).toBe("Sweet baby boy names for a sunny shoot 🌻 so cute love them");
  });
  it("trims to the length cap at a sentence end, or with an ellipsis", () => {
    const long = `${"Soft autumn light and tiny pumpkins set the mood for these baby girl names. ".repeat(4)}`;
    const out = sanitizeCaption(long)!;
    expect(out.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(out.endsWith(".")).toBe(true);
    const words = sanitizeCaption("word ".repeat(80))!;
    expect(words.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(words.endsWith("…")).toBe(true);
  });
  it("rejects text that is empty after cleaning", () => {
    expect(sanitizeCaption("#a #b #c")).toBeNull();
    expect(sanitizeCaption("  ")).toBeNull();
  });
});

describe("aiCaption", () => {
  it("returns the AI line + the owner's hashtags, and the theme reaches the prompt", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Pumpkin-patch cuteness for today's baby girl names 🎃 Which one is your favorite? #fall" } });
    const r = await aiCaption({ theme, gender: "girl", style: "single", settings });
    expect(r).toEqual({ source: "ai", caption: "Pumpkin-patch cuteness for today's baby girl names 🎃 Which one is your favorite?\n\n#babynames #uniquenames" });
    const arg = generateJson.mock.calls[0][0];
    expect(arg.prompt).toContain("tiny pumpkins and a wicker basket");
    expect(arg.prompt).toContain("Autumn Pumpkin Patch");
    expect(arg.system).toBe(CAPTION_SYSTEM);
    expect(arg.timeoutMs).toBeLessThanOrEqual(10000);
  });

  it("falls back to the template on AI failure", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    const r = await aiCaption({ theme, gender: "boy", settings });
    expect(r).toEqual({ source: "template", caption: "Here are some beautiful names for your baby boy. 🥰\n\n#babynames #uniquenames" });
  });

  it("falls back when the AI text is unusable after cleaning", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "#only #tags" } });
    expect((await aiCaption({ theme, gender: "boy", settings })).source).toBe("template");
  });

  it("does not call Gemini when caption_ai is off; undefined (migration not run) counts as on", async () => {
    expect(await aiCaption({ theme, gender: "boy", settings: { ...settings, caption_ai: false } })).toMatchObject({ source: "template" });
    expect(generateJson).not.toHaveBeenCalled();
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Little explorers deserve big, bold baby boy names." } });
    const { caption_ai: _drop, ...legacy } = settings;
    void _drop;
    expect(await aiCaption({ theme, gender: "boy", settings: legacy })).toMatchObject({ source: "ai" });
  });
});
