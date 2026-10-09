import { describe, expect, it } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { letterOf, partRange, seriesLabel } from "@/lib/series/az";
import { ideasWanted, isLetter, letterCounts, letterLabel, letterTag, postLabel, startsWith } from "@/lib/series/letter";
import { planExtraCard, planPost } from "@/lib/planner";
import { postSummary } from "@/lib/today/summary";

const nm = (name: string, o: Partial<NameRow> = {}): NameRow => ({
  id: `id-${name}`, name, meaning: "a true meaning", gender: "boy", style: "single", status: "available",
  post_id: null, position: null, created_at: "2026-10-01T00:00:00Z", updated_at: "", ...o,
});
const theme: ThemeRow = {
  id: "t1", title: "Theme", gender: "boy", backdrop: "smooth seamless sage studio backdrop", outfit: "cream knit romper", props: "wicker basket, felt moon",
  lighting: "soft warm light from the left", palette: "sage, cream, oat", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const settings = { caption_template: "x", hashtags: "", min_images: 9, max_images: 13 };

describe("letters and labels", () => {
  it("reads the first letter A–Z, dropping accents; anything else has no letter", () => {
    expect(letterOf("Élodie")).toBe("E");
    expect(letterOf("  zane")).toBe("Z");
    expect(letterOf("Øyvind")).toBeNull();
    expect(letterOf("'Iolana")).toBeNull();
    expect(letterOf("")).toBeNull();
    expect(startsWith("Kaia Wren", "K")).toBe(true);
    expect(startsWith("Wren Kaia", "K")).toBe(false);
    expect(isLetter("K")).toBe(true);
    for (const x of ["k", "KK", "", "1", null, 3]) expect(isLetter(x)).toBe(false);
  });

  it("labels old A–Z series posts by part and posts by letter by their letter", () => {
    expect(seriesLabel({ series: "az", series_part: 1 })).toBe("A–Z Part 1 (A–M)");
    expect(partRange(2)).toBe("N to Z");
    expect(letterLabel({ letter: "A" })).toBe("Letter A");
    expect(letterLabel({ letter: null })).toBeNull();
    expect(letterLabel({})).toBeNull();
    expect(postLabel({ series: "az", series_part: 2 })).toBe("A–Z Part 2 (N–Z)");
    expect(postLabel({ letter: "K" })).toBe("Letter K");
    expect(postLabel({})).toBeNull();
    expect(letterTag("A")).toBe("#namesstartingwitha");
  });

  it("counts names per letter (all 26, zeros included)", () => {
    const c = letterCounts([nm("Arlo"), nm("Atlas"), nm("Élan"), nm("'Iolana")]);
    expect(Object.keys(c)).toHaveLength(26);
    expect(c).toMatchObject({ A: 2, E: 1, I: 0, Z: 0 });
  });

  it("asks AI for a few more ideas than needed, 5 to 12", () => {
    expect(ideasWanted(1)).toBe(5);
    expect(ideasWanted(4)).toBe(7);
    expect(ideasWanted(13)).toBe(12);
  });

  it("the Today summary names the letter after the cards", () => {
    expect(postSummary({ count: "10", min: 9, max: 13, gender: "girl", style: "single", age: "random", themeTitle: "Bloom", letter: "K" }))
      .toBe("10 cards · names starting with K · Girl · Single · Random ages · Bloom");
    expect(postSummary({ count: "auto", min: 9, max: 13, gender: "boy", style: "two-word", age: "random" })).toBe("9–13 cards · Boy · Two-word · Random ages");
  });
});

describe("planner by letter", () => {
  const ks = ["Kael", "Kenji", "Kirin", "Koa", "Kade", "Keon", "Kian", "Kobe", "Kylo", "Kasim"].map((n) => nm(n));
  const others = ["Arlo", "Bodhi", "Cyrus", "Dax", "Ezra", "Felix", "Gideon", "Hugo", "Ivo", "Jude"].map((n) => nm(n));
  const req = { gender: "boy" as const, style: "single" as const, count: 10, postDate: "2026-10-09", age: "random" as const };

  it("a post by letter uses only names starting with it, picked the usual way", () => {
    const r = planPost({ request: { ...req, letter: "K" }, names: [...ks, ...others], themes: [theme], settings });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards.map((c) => c.name).sort()).toEqual(ks.map((n) => n.name).sort());
    expect(planPost({ request: { ...req, letter: "K" }, names: [...others, ...ks], themes: [theme], settings })).toEqual(r);
  });

  it("refuses when the letter is short of the count (or of the minimum for Auto)", () => {
    expect(planPost({ request: { ...req, count: 11, letter: "K" }, names: [...ks, ...others], themes: [theme], settings }))
      .toEqual({ ok: false, reason: "Only 10 unused boy single names start with K; this post needs 11. Use Suggest with AI on Today to add more." });
    expect(planPost({ request: { ...req, count: null, letter: "K" }, names: ks.slice(0, 8), themes: [theme], settings }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^Only 8 unused boy single names start with K; this post needs 9\./) });
  });

  it("two-word names go by the first name", () => {
    const two = ["Kaia Wren", "Kenna Rose", "Wren Kaia"].map((n) => nm(n, { style: "two-word" }));
    const r = planPost({ request: { ...req, style: "two-word", count: 9, letter: "K" }, names: two, themes: [theme], settings: { ...settings, min_images: 2 } });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^Only 2 unused boy two-word names start with K/) });
  });

  it("an added card keeps to the letter", () => {
    const base = { theme, gender: "boy" as const, style: "single" as const, nextPosition: 11, salt: "s", age: "random" as const };
    const r = planExtraCard({ ...base, names: [...ks, ...others], usedNameIds: ks.slice(0, 9).map((n) => n.id), letter: "K" });
    expect(r.ok && r.card.name).toBe("Kasim");
    expect(planExtraCard({ ...base, names: [...ks, ...others], usedNameIds: ks.map((n) => n.id), letter: "K" }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/starting with K left/) });
  });
});
