import { beforeEach, describe, expect, it, vi } from "vitest";

// The pack is mocked so the flags can be switched per test (Unique Names turns them on in Task 2).
const pack = vi.hoisted(() => ({ captions: { titleOnly: false, themeFirst: false } as Record<string, unknown> }));
vi.mock("@/packs", async (real) => {
  const mod = await real<typeof import("@/packs")>();
  const base = mod.activePack();
  return { ...mod, activePack: () => ({ ...base, captions: { ...base.captions, ...pack.captions } }) };
});
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { THEME_CHECK_CHARS, THEME_LEAD_CHARS, aiCaptionLine, captionPrompt, captionProblem, shapeProblem, themeLeadProblem, themePhrase } = await import("@/lib/ai/caption");

const theme = { title: "Country Barn Boy", backdrop: "barn red wall", outfit: "denim overalls", props: "plush cow", lighting: "golden light", palette: "red, cream" };
const ok = (caption: string) => ({ ok: true, data: { caption, tags: [] } });

beforeEach(() => { delete process.env.AI_PROVIDER; generateJson.mockReset(); pack.captions = { titleOnly: false, themeFirst: false }; });

describe("theme phrase and the 100-character rule", () => {
  it("names the theme of each kind of post", () => {
    expect(themePhrase({ gender: "girl", letter: "R" })).toBe("baby girl names that start with R");
    expect(themePhrase({ gender: "boy", nameTheme: { title: "Biblical", hint: null } })).toBe("Biblical baby boy names");
    expect(themePhrase({ gender: "boy", initials: "AR" })).toBe("baby boy names with the initials A & R");
    expect(themePhrase({ gender: "girl", series: { part: 1 } })).toBe("Part 1 of our A to Z baby girl names");
    expect(themePhrase({ gender: "girl" })).toBe("baby girl names");
    expect(THEME_LEAD_CHARS).toBe(100);
    expect(THEME_CHECK_CHARS).toBe(120);
  });
  it("passes when the theme is named near the start, also after a short feeling question; fails past 120 characters", () => {
    const i = { gender: "girl" as const, letter: "R" };
    expect(themeLeadProblem("Still looking for a girl name that's sweet but not too common? 💕 These baby girl names that start with R might be the one.", i)).toBeNull();
    const late = `${"A soft and gentle opening line about the joy of waiting for a baby, ".repeat(2)}these baby girl names that start with R.`;
    expect(themeLeadProblem(late, i)).toMatch(/too late/);
    expect(themeLeadProblem("Sweet names for your little one.", i)).toMatch(/does not name/);
  });
  it("plain posts need boy / girl names (close wording accepted), for the right gender", () => {
    expect(themeLeadProblem("Looking for something sweet? These baby girl names feel just right.", { gender: "girl" })).toBeNull();
    expect(themeLeadProblem("Sweet names for your daughter, each one easy to love.", { gender: "girl" })).toBeNull();
    expect(themeLeadProblem("Strong boy names your son can grow into.", { gender: "girl" })).toMatch(/does not name/);
    expect(themeLeadProblem("Names for your son that feel strong and kind.", { gender: "boy" })).toBeNull();
  });
  it("name themes match on the theme's first word", () => {
    expect(themeLeadProblem("Want a name with faith in it? These Biblical baby boy names carry strength.", { gender: "boy", nameTheme: { title: "Biblical", hint: null } })).toBeNull();
  });
});

describe("matchers (a miss is a hard failure, so they accept close wording)", () => {
  const girl = { gender: "girl" as const };
  const nt = (title: string, gender: "boy" | "girl" = "boy") => ({ gender, nameTheme: { title, hint: null } });
  it("plain posts accept plurals and both apostrophes, and still reject the singular", () => {
    for (const c of ["Sweet baby names for girls, each with a meaning.", "Pretty names for little girls, each one easy to love.", "Lovely names for baby girls to say all day.",
      "Pretty girl’s names to save for later.", "Pretty girls' names to save for later.", "Pretty girls names to save for later."]) {
      expect(themeLeadProblem(c, girl), c).toBeNull();
    }
    expect(themeLeadProblem("Looking for a girl name that feels right?", girl)).toMatch(/does not name/);
  });
  it("letter posts accept 'R girl names' and 'R baby girl names'", () => {
    const i = { gender: "girl" as const, letter: "R" };
    expect(themeLeadProblem("These R girl names are pretty enough to say all day.", i)).toBeNull();
    expect(themeLeadProblem("These R baby girl names are pretty enough to say all day.", i)).toBeNull();
    expect(themeLeadProblem("Meet a girl named Rosa, who loves to sing and dance.", i)).toMatch(/does not name/);
  });
  it("name themes need a content word of the title next to 'names'", () => {
    const pass: [string, string, "boy" | "girl"][] = [
      ["These Biblical baby boy names carry strength", "Biblical", "boy"],
      ["Soft and cool baby girl names for your little one", "Soft and cool", "girl"],
      ["Nature-inspired baby boy names", "Nature-inspired", "boy"],
      ["Heavenly baby girl names", "Heavenly", "girl"],
      ["Timeless baby boy names", "Classic and timeless", "boy"],
      ["Names that feel soft and gentle", "Soft and cool", "girl"],
    ];
    for (const [c, title, g] of pass) {
      expect(themeLeadProblem(c, nt(title, g)), c).toBeNull();
      expect(captionProblem(c, { captionStyle: "question", ...nt(title, g) }), c).toBeNull();
    }
    for (const [c, title] of [["Want a strong name your son can grow into? Every name here carries a meaning worth keeping.", "Strong and brave"],
      ["Looking for something unique for your little girl? Each one is easy to love.", "Unique and modern"]]) {
      expect(themeLeadProblem(c, nt(title)), c).toMatch(/does not name/);
      expect(captionProblem(c, { captionStyle: "question", ...nt(title) }), c).toMatch(/does not say/);
    }
    expect(themeLeadProblem("The classics in baby boy names that last.", nt("The classics"))).toBeNull();
  });
});

describe("captionPrompt flags", () => {
  it("titleOnly: only the photoshoot title, marked for hashtags; no set details", () => {
    pack.captions = { titleOnly: true, themeFirst: false };
    const p = captionPrompt({ theme, gender: "boy", captionStyle: "question", letter: "R" });
    expect(p).toContain("Photoshoot title (only for the hashtags; do not describe the photos): Country Barn Boy");
    for (const v of [theme.backdrop, theme.outfit, theme.props, theme.lighting, theme.palette]) expect(p).not.toContain(v);
  });
  it("without the flag the set details are still sent (other packs)", () => {
    const p = captionPrompt({ theme, gender: "boy", captionStyle: "question" });
    for (const v of Object.values(theme)) expect(p).toContain(v);
  });
  it("themeFirst: the prompt states the theme phrase and the 100-character rule", () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    const p = captionPrompt({ theme, gender: "girl", captionStyle: "question", nameTheme: { title: "Soft and cool", hint: null } });
    expect(p).toContain("This post's theme: Soft and cool baby girl names.");
    expect(p).toContain("within the first 100 characters");
  });
});

describe("the hard check", () => {
  it("a caption that does not name the theme is retried and never kept", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateJson.mockResolvedValue(ok("Sweet names for your little one, picked with love."));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).toBeNull();
    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/does not name/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/never named the theme/));
    warn.mockRestore();
  });
  it("a caption that names the theme only after 120 characters is retried and never kept", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateJson.mockResolvedValue(ok(`${"A soft and gentle opening line about the joy of waiting for a baby, ".repeat(2)}these baby girl names that start with R.`));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).toBeNull();
    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/too late/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/never named the theme/));
    warn.mockRestore();
  });
  it("a caption that never names the theme is logged once as a fallback", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateJson.mockResolvedValue(ok("Sweet names for your little one, picked with love."));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/never named the theme: does not name/));
    warn.mockRestore();
  });
  it("a first attempt that passes the hard check but has a soft problem wins over a second that fails it", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = "Still looking for something sweet? These baby girl names that start with R might be the one.";
    generateJson.mockResolvedValueOnce(ok(first)).mockResolvedValueOnce(ok("Sweet names for your little one, picked with love."));
    const r = await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R", recent: ["Still here, still sweet."] });
    expect(r?.line).toBe(first);
    expect(generateJson).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it("the retry that fixes it is kept", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    generateJson.mockResolvedValueOnce(ok("Sweet names for your little one, picked with love."))
      .mockResolvedValueOnce(ok("Still looking for something sweet? These baby girl names that start with R might be the one."));
    expect((await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" }))?.line).toMatch(/start with R/);
  });
  it("without themeFirst nothing changes", async () => {
    generateJson.mockResolvedValue(ok("Sweet names for your little one, picked with love, these baby girl names that start with R."));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).not.toBeNull();
  });
});

describe("shape: at most 2 sentences and one question", () => {
  it("shapeProblem", () => {
    expect(shapeProblem("These baby girl names feel just right 💕")).toBeNull();
    expect(shapeProblem("Ethan, Leon or Andre? These strong and brave baby boy names each fit.")).toBeNull();
    expect(shapeProblem("Looking for a name your daughter can be proud of? Baby girl names that start with M carry meanings worth keeping. Mira means wonderful, Margot means pearl, and Mila means gracious and dear. Which one feels like hers?")).toMatch(/4 sentences/);
    expect(shapeProblem("Is it sweet? Is it strong?")).toMatch(/2 questions/);
    expect(shapeProblem("Picture her name. ✨")).toBeNull();
  });
  it("a 4-sentence answer is retried with the reason and the 2-sentence retry is kept", async () => {
    const { UNIQUE_NAMES_CAPTIONS } = await import("@/packs/unique-names/captions");
    pack.captions = { titleOnly: UNIQUE_NAMES_CAPTIONS.titleOnly, themeFirst: true };
    const good = "Want a name your son can grow into? These Biblical baby boy names carry stories of faith.";
    generateJson.mockResolvedValueOnce(ok("Want a name for your son? These Biblical baby boy names are lovely. They are strong. Pick one."))
      .mockResolvedValueOnce(ok(good));
    const r = await aiCaptionLine({ theme, gender: "boy", captionStyle: "question", nameTheme: { title: "Biblical", hint: null } });
    expect(r?.line).toBe(good);
    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/4 sentences/);
  });
});
