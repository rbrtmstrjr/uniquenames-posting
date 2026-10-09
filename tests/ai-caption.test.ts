import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { aiCaption, aiCaptionLine, captionPrompt, captionProblem, sanitizeCaption, CAPTION_MAX, CAPTION_SYSTEM, STYLE_GUIDE } = await import("@/lib/ai/caption");
const { postHistory } = await import("@/lib/captions/history");

const theme = {
  title: "Autumn Pumpkin Patch", backdrop: "rustic barn wall with hay bales", outfit: "knitted mustard sweater",
  props: "tiny pumpkins and a wicker basket", lighting: "golden hour side light", palette: "orange, cream, rust",
};
const settings = { caption_template: "Here are some beautiful names for your baby {gender}. 🥰", hashtags: "#babynames #uniquenames", caption_ai: true };
const s009 = { ...settings, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #babygirlnames #babyboynames #momlife #newmom" };
const names = [{ name: "Aurelia", meaning: "golden, from Latin" }, { name: "Wren", meaning: "small songbird" }];
const ok = (caption: string, tags: string[] = []) => ({ ok: true, data: { caption, tags } });

beforeEach(() => generateJson.mockReset());

describe("captionPrompt", () => {
  it("carries every theme field, the gender and the style", () => {
    const p = captionPrompt({ theme, gender: "girl", style: "two-word", captionStyle: "story" });
    for (const v of Object.values(theme)) expect(p).toContain(v);
    expect(p).toContain("baby girl names");
    expect(p).toContain(STYLE_GUIDE.story("girl"));
  });
  it("name styles list the post's names with their real meanings; other styles don't", () => {
    expect(captionPrompt({ theme, gender: "girl", captionStyle: "spotlight", names })).toContain("- Aurelia: golden, from Latin");
    expect(captionPrompt({ theme, gender: "girl", captionStyle: "question", names })).not.toContain("Aurelia");
  });
  it("lists the recent captions (newest first), their opening words and the recent hashtags", () => {
    const p = captionPrompt({ theme, gender: "girl", captionStyle: "story", recent: ["These lovely names. Which one?", "Soft light today."], recentTags: ["#babynames", "#autumnbaby"] });
    expect(p).toContain("1. These lovely names. Which one?");
    expect(p).toContain("2. Soft light today.");
    expect(p).toMatch(/Do not start with any of these words: these, soft\./);
    expect(p).toContain("#babynames #autumnbaby");
  });
  it("system prompt sets the rules (hashtags only in tags, no invented meanings, no bait, ≤ 1 emoji)", () => {
    expect(CAPTION_SYSTEM).toMatch(/No hashtags in the caption/);
    expect(CAPTION_SYSTEM).toMatch(/never invent a meaning/);
    expect(CAPTION_SYSTEM).toMatch(/engagement bait/);
    expect(CAPTION_SYSTEM).toMatch(/at most one emoji/i);
    expect(CAPTION_SYSTEM).toMatch(/clearly different from the recent captions/);
  });
});

describe("captionProblem", () => {
  it("a recent opening word is a problem", () => {
    expect(captionProblem("These names glow. Which one?", { captionStyle: "story", recent: ["These lovely names."] })).toMatch(/starts with "these"/);
    expect(captionProblem("Golden light. Which one?", { captionStyle: "story", recent: ["These lovely names."] })).toBeNull();
  });
  it("name styles must name names from the list (A or B: two)", () => {
    expect(captionProblem("Golden light for baby girl names.", { captionStyle: "spotlight", names })).toMatch(/name a name/);
    expect(captionProblem("Aurelia means golden, a warm pick.", { captionStyle: "spotlight", names })).toBeNull();
    expect(captionProblem("Aurelia for the golden hour?", { captionStyle: "choice", names })).toMatch(/two names/);
    expect(captionProblem("Aurelia or Wren for this golden shoot?", { captionStyle: "choice", names })).toBeNull();
  });
});

describe("aiCaptionLine", () => {
  const input = { theme, gender: "girl" as const, captionStyle: "story" as const, recent: ["These lovely baby girl names."] };
  it("returns the clean line and Gemini's tags", async () => {
    generateJson.mockResolvedValueOnce(ok("Tiny pumpkins line the hay bales for today's baby girl names 🎃 #fall", ["#autumnbaby"]));
    expect(await aiCaptionLine(input)).toEqual({ line: "Tiny pumpkins line the hay bales for today's baby girl names 🎃", tags: ["#autumnbaby"] });
  });
  it("retries once when the opener repeats; keeps the second", async () => {
    generateJson.mockResolvedValueOnce(ok("These pumpkins are cute for baby girl names.")).mockResolvedValueOnce(ok("Hay bales and pumpkins frame these baby girl names."));
    expect((await aiCaptionLine(input))?.line).toBe("Hay bales and pumpkins frame these baby girl names.");
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/starts with "these"/);
  });
  it("never accepts engagement bait: retries, then gives up", async () => {
    generateJson.mockResolvedValue(ok("Hay bales and baby girl names. Comment YES if you love them!"));
    expect(await aiCaptionLine(input)).toBeNull();
    expect(generateJson).toHaveBeenCalledTimes(2);
    generateJson.mockReset();
    generateJson.mockResolvedValue(ok("Golden light for baby girl names. Tag a friend who is expecting!"));
    expect(await aiCaptionLine(input)).toBeNull();
  });
  it("a still-repeated opener after the retry is kept (better than the template)", async () => {
    generateJson.mockResolvedValue(ok("These pumpkins are cute for baby girl names."));
    expect((await aiCaptionLine(input))?.line).toBe("These pumpkins are cute for baby girl names.");
  });
  it("no retry when too little time is left", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      generateJson.mockImplementation(async () => { now += 7000; return ok("These pumpkins are cute for baby girl names."); });
      expect(await aiCaptionLine(input, 9000)).not.toBeNull();
      expect(generateJson).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
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
  it("strips markdown and hashtags glued to punctuation", () => {
    expect(sanitizeCaption("**Cozy** _pumpkin_ vibes for `baby girl` ~names~!#cute#fall Which is your favorite?"))
      .toBe("Cozy pumpkin vibes for baby girl names! Which is your favorite?");
    expect(sanitizeCaption("Sweet baby boy names for a beach day,#summer right?")).toBe("Sweet baby boy names for a beach day, right?");
  });
  it("cuts at a sentence end that lands exactly on the cap", () => {
    // The "." is the last character within the cap; its following space is just past it.
    const s = `Baby boy names ${"x".repeat(CAPTION_MAX - "Baby boy names ".length - 1)}. And more words here.`;
    expect(s.indexOf(". ")).toBe(CAPTION_MAX - 1);
    expect(sanitizeCaption(s)).toBe(s.slice(0, CAPTION_MAX));
  });
  it("rejects text that is empty after cleaning", () => {
    expect(sanitizeCaption("#a #b #c")).toBeNull();
    expect(sanitizeCaption("  ")).toBeNull();
  });
});

describe("aiCaption", () => {
  it("AI line + always-tag + theme tags + 1 rotated pool tag; the style is stored", async () => {
    generateJson.mockResolvedValueOnce(ok("Pumpkin-patch cuteness for today's baby girl names 🎃 Which one is your favorite? #fall", ["#autumnbaby", "#fyp"]));
    const r = await aiCaption({ theme, gender: "girl", style: "single", settings: s009, rand: () => 0 });
    expect(r).toEqual({
      source: "ai", caption_style: "story", hashtag_set: "#uniquenames #autumnbaby #babynames",
      caption: "Pumpkin-patch cuteness for today's baby girl names 🎃 Which one is your favorite?\n\n#uniquenames #autumnbaby #babynames",
    });
    const arg = generateJson.mock.calls[0][0];
    expect(arg.prompt).toContain("tiny pumpkins and a wicker basket");
    expect(arg.system).toBe(CAPTION_SYSTEM);
    expect(arg.timeoutMs).toBeLessThanOrEqual(10000);
  });

  it("never the previous post's style; the history's captions reach the prompt; the set differs from the last 10", async () => {
    const history = postHistory([
      { caption: "Golden light on tiny boots.\n\n#uniquenames #autumnbaby #babynames", caption_style: "story", hashtag_set: "#uniquenames #autumnbaby #babynames" },
    ]);
    generateJson.mockResolvedValueOnce(ok("Aurelia means golden, just like this pumpkin-patch light on baby girl names.", ["#autumnbaby"]));
    const r = await aiCaption({ theme, gender: "girl", names, settings: s009, history, rand: () => 0 });
    expect(r.caption_style).not.toBe("story");
    expect(generateJson.mock.calls[0][0].prompt).toContain("1. Golden light on tiny boots.");
    expect(r.hashtag_set).toBe("#uniquenames #autumnbaby #babygirlnames");
  });

  it("falls back to the template + always-tag + 2 rotated pool tags on AI failure", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    const r = await aiCaption({ theme, gender: "boy", settings: s009 });
    expect(r).toEqual({ source: "template", caption_style: "template", hashtag_set: "#uniquenames #babynames #babyboynames",
      caption: "Here are some beautiful names for your baby boy. 🥰\n\n#uniquenames #babynames #babyboynames" });
  });

  it("before 009: the always-tag is #uniquenames and the pool comes from the old hashtags (default pool + extras)", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "x" });
    const r = await aiCaption({ theme, gender: "girl", settings: { ...settings, hashtags: "#parenting #fypシ" } });
    expect(r.hashtag_set).toBe("#uniquenames #babynames #babygirlnames");
  });

  it("falls back when the AI text is unusable after cleaning", async () => {
    generateJson.mockResolvedValue(ok("#only #tags"));
    expect((await aiCaption({ theme, gender: "boy", settings })).source).toBe("template");
  });

  it("does not call Gemini when caption_ai is off; undefined (migration not run) counts as on", async () => {
    expect(await aiCaption({ theme, gender: "boy", settings: { ...settings, caption_ai: false } })).toMatchObject({ source: "template" });
    expect(generateJson).not.toHaveBeenCalled();
    generateJson.mockResolvedValueOnce(ok("Little explorers deserve big, bold baby boy names."));
    const { caption_ai: _drop, ...legacy } = settings;
    void _drop;
    expect(await aiCaption({ theme, gender: "boy", settings: legacy })).toMatchObject({ source: "ai" });
  });
});

describe("A–Z series captions (011)", () => {
  it("the prompt says which part of the A to Z series this is", () => {
    const p = captionPrompt({ theme, gender: "boy", style: "single", captionStyle: "story", series: { part: 1 } });
    expect(p).toContain("Part 1 of 2 of an A to Z series of single-word baby boy names: one name for each letter from A to M.");
    expect(p).toContain('"Part 1 of our A to Z baby boy names, A to M"');
    expect(captionPrompt({ theme, gender: "girl", captionStyle: "story", series: { part: 2 } })).toContain("each letter from N to Z");
    expect(captionPrompt({ theme, gender: "girl", captionStyle: "story" })).not.toContain("A to Z");
  });

  it("a series caption that does not say its part is a problem (and earns the retry)", () => {
    const base = { captionStyle: "story" as const, names: [], recent: [] };
    expect(captionProblem("Soft light and baby boy names.", { ...base, series: { part: 1 } })).toMatch(/Part 1 of the A to Z series/);
    expect(captionProblem("Part 1 of our A to Z baby boy names, A to M.", { ...base, series: { part: 1 } })).toBeNull();
    expect(captionProblem("Part one of our A–Z names, A to M.", { ...base, series: { part: 1 } })).toBeNull();
    expect(captionProblem("Part 1 of our A to Z baby boy names.", { ...base, series: { part: 2 } })).toMatch(/Part 2/);
  });

  it("the series hashtag takes a theme-tag slot; the template fallback names the part too", async () => {
    const { composePostCaption } = await import("@/lib/ai/caption");
    const history = postHistory([]);
    const ai = { line: "Part 1 of our A to Z baby boy names, A to M, in a cozy pumpkin patch.", tags: ["#pumpkinbaby"] };
    const withAi = composePostCaption({ ai, aiOn: true, captionStyle: "story", gender: "boy", settings: s009, history, series: { part: 1 } });
    expect(withAi.hashtag_set.split(" ")).toEqual(["#uniquenames", "#atozbabynames", "#pumpkinbaby", "#babynames"]);
    const tpl = composePostCaption({ ai: null, aiOn: false, captionStyle: "story", gender: "girl", settings: s009, history, series: { part: 2 } });
    expect(tpl.caption.startsWith("A to Z baby girl names, Part 2 (N to Z). Here are some beautiful names for your baby girl. 🥰")).toBe(true);
    expect(tpl.hashtag_set).toContain("#atozbabynames");
  });
});
