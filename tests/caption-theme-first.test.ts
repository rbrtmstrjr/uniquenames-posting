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
const { THEME_CHECK_CHARS, THEME_LEAD_CHARS, aiCaptionLine, captionPrompt, themeLeadProblem, themePhrase } = await import("@/lib/ai/caption");

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
  it("a caption that names the theme too late is retried and never kept", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    generateJson.mockResolvedValue(ok("Sweet names for your little one, picked with love."));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).toBeNull();
    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/does not name/);
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
