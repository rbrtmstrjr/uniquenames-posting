import { describe, expect, it } from "vitest";
import { filterNameSuggestions, filterThemeSuggestions, propsKey, sampleForPrompt, themeTitleKey, unsafeThemeWording } from "@/lib/ai/suggest-filter";

const t = (title: string, props: string, over: Partial<Record<string, string>> = {}) => ({
  title, props, backdrop: "smooth seamless sage green studio backdrop", outfit: "cream knit romper",
  lighting: "soft warm light from the left", palette: "sage, cream and oat", ...over,
});

describe("filterNameSuggestions", () => {
  const existing = ["Arlo Zenith", "  kai   rowan ", "Luna"];

  it("drops names already in the list, ignoring case and spaces, and duplicates within the batch", () => {
    const r = filterNameSuggestions([
      { name: "ARLO zenith", meaning: "strong peak" },
      { name: "Kai Rowan", meaning: "sea and tree" },
      { name: "Milo Rivers", meaning: "gentle flowing water" },
      { name: "milo   rivers", meaning: "gentle flowing water" },
    ], existing, "two-word");
    expect(r.fresh.map((n) => n.name)).toEqual(["Milo Rivers"]);
    expect(r.duplicates).toBe(3);
    expect(r.invalid).toBe(0);
  });

  it("allows a new pair that reuses only the first OR only the second word", () => {
    const r = filterNameSuggestions([
      { name: "Arlo Sterling", meaning: "bold silver heart" },
      { name: "Beau Zenith", meaning: "handsome high point" },
    ], existing, "two-word");
    expect(r.fresh.map((n) => n.name)).toEqual(["Arlo Sterling", "Beau Zenith"]);
  });

  it("normalizes the stored form: capitals, single spaces, lowercase meaning", () => {
    const r = filterNameSuggestions([{ name: "  wren   asher ", meaning: "  Little Songbird Blessed " }], [], "two-word");
    expect(r.fresh).toEqual([{ name: "Wren Asher", meaning: "little songbird blessed" }]);
  });

  it("people check: hand-made words and mother-of-pearl are fine, hands and parents are not", () => {
    const base = { title: "A", backdrop: "smooth seamless sage studio backdrop", lighting: "soft light", palette: "sage, cream" };
    for (const ok of ["hand-knitted cream romper", "hand-stitched linen set", "romper with mother-of-pearl buttons"]) {
      expect(unsafeThemeWording({ ...base, outfit: ok, props: "felt fox toy" })).toBeNull();
    }
    expect(unsafeThemeWording({ ...base, outfit: "knit romper", props: "hand-carved wooden rattle" })).toBeNull();
    expect(unsafeThemeWording({ ...base, outfit: "knit romper", props: "felt fox toy held in a hand" })).toBeTruthy();
    expect(unsafeThemeWording({ ...base, outfit: "knit romper", props: "felt fox toy, mother's quilt" })).toBeTruthy();
  });

  it("drops names that break the style, the name rules or the meaning rules", () => {
    const r = filterNameSuggestions([
      { name: "Orion", meaning: "rising hunter star" }, // single in a two-word batch
      { name: "Kai Rowan Lee", meaning: "three names here" }, // three words
      { name: "R2 Dee", meaning: "has a digit" },
      { name: "Averyveryveryverylong Namethatkeepsgoingon", meaning: "too long a name" },
      { name: "Ezra Vale", meaning: "" },
      { name: "Ezra Moss", meaning: "peace" }, // one word
      { name: "Ezra Fenn", meaning: "one two three four five six seven" }, // seven words
      { name: "Ezra Pike", meaning: "helper of the sharp ridge" },
    ], existing, "two-word");
    expect(r.fresh.map((n) => n.name)).toEqual(["Ezra Pike"]);
    expect(r.invalid).toBe(7);
  });

  it("single style keeps one-word names only", () => {
    const r = filterNameSuggestions([{ name: "Orion", meaning: "rising hunter star" }, { name: "luna", meaning: "the moon" }, { name: "Ivo Lake", meaning: "yew tree lake" }], existing, "single");
    expect(r.fresh.map((n) => n.name)).toEqual(["Orion"]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toBe(1);
  });
});

describe("propsKey", () => {
  it("ignores order, case, spacing, articles and simple plurals", () => {
    expect(propsKey("Small pine cones, a felt fox toy,  mossy log slice")).toBe(propsKey("mossy log slice, felt fox toy, small pine cone"));
    expect(propsKey("wooden berries, glass boxes, tiny daisies")).toBe(propsKey("tiny daisy, glass box, wooden berry"));
    expect(propsKey("brass anchor and coiled rope")).toBe(propsKey("coiled rope, brass anchor"));
  });
  it("keeps different props different", () => {
    expect(propsKey("felt fox toy, pine cones")).not.toBe(propsKey("felt fox toy, acorns"));
    expect(propsKey("glass")).not.toBe(propsKey("glas"));
  });
});

describe("themeTitleKey", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(themeTitleKey("  Little  Captain! ")).toBe(themeTitleKey("little captain"));
    expect(themeTitleKey("Rock-a-Bye")).toBe(themeTitleKey("rock a bye"));
  });
});

describe("unsafeThemeWording", () => {
  it("flags negative wording and things the image model would draw", () => {
    expect(unsafeThemeWording(t("A", "toy boat, no clutter"))).toMatch(/no/);
    expect(unsafeThemeWording(t("A", "toy boat", { lighting: "softbox light without harsh shadows" }))).toBeTruthy();
    expect(unsafeThemeWording(t("A", "letter blocks spelling a name"))).toBeTruthy();
    expect(unsafeThemeWording(t("A", "vintage camera, film reel"))).toBeTruthy();
    expect(unsafeThemeWording(t("A", "toy boat", { backdrop: "smooth seamless navy studio backdrop on a stand" }))).toBeTruthy();
  });
  it("passes a clean, positive theme", () => {
    expect(unsafeThemeWording(t("Little Captain", "small wooden toy sailboat, coiled rope, little brass anchor"))).toBeNull();
  });
});

describe("filterThemeSuggestions", () => {
  const existing = [{ title: "Little Captain", props: "small wooden toy sailboat, coiled rope, little brass anchor" }];

  it("drops a theme whose title or props set already exists; colors and concept may repeat", () => {
    const r = filterThemeSuggestions([
      t("little captain", "seashells, starfish"), // same title
      t("Sea Sailor", "Coiled rope, small wooden toy sailboats, little brass anchor"), // same props set
      t("Harbor Dreams", "small wooden toy sailboat, knitted whale toy"), // shares one prop, same concept: fine
      t("Harbor Dreams!", "felt lighthouse toy"), // same title within the batch
      t("Tide Pool", "knitted whale toy, small wooden toy sailboat"), // same props set within the batch
    ], existing, "boy");
    expect(r.fresh.map((x) => x.title)).toEqual(["Harbor Dreams"]);
    expect(r.duplicates).toBe(4);
  });

  it("drops themes that fail validation or use unsafe wording; trims every field", () => {
    const r = filterThemeSuggestions([
      t("", "toy drum"),
      t("Way Too Long A Title For A Theme That Keeps Going And Going On", "toy drum"),
      t("Clean Set", "toy drum, no clutter"),
      t("  Drum Parade ", " toy drum, felt star garland "),
    ], existing, "boy");
    expect(r.invalid).toBe(3);
    expect(r.fresh).toEqual([{ ...t("Drum Parade", "toy drum, felt star garland"), gender: "boy" }]);
  });
});

describe("sampleForPrompt", () => {
  it("keeps short lists whole and caps long ones", () => {
    expect(sampleForPrompt(["a", "b"], 5)).toEqual({ items: ["a", "b"], sampled: false });
    const big = Array.from({ length: 900 }, (_, i) => `n${i}`);
    const s = sampleForPrompt(big, 600);
    expect(s.sampled).toBe(true);
    expect(s.items).toHaveLength(600);
    expect(new Set(s.items).size).toBe(600);
  });
});
