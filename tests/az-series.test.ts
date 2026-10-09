import { describe, expect, it } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { AZ_LETTERS, azCoverage, fillNeeds, letterOf, missingLetters, partRange, pickAzNames, seriesLabel } from "@/lib/series/az";
import { NO_TEXT, planAzSeries } from "@/lib/planner";

const nm = (name: string, o: Partial<NameRow> = {}): NameRow => ({
  id: `id-${name}`, name, meaning: "a true meaning", gender: "boy", style: "single", status: "available",
  post_id: null, position: null, created_at: "2026-10-01T00:00:00Z", updated_at: "", ...o,
});
const theme = (id: string, o: Partial<ThemeRow> = {}): ThemeRow => ({
  id, title: `Theme ${id}`, gender: "boy", backdrop: "smooth seamless sage studio backdrop", outfit: "cream knit romper", props: "wicker basket, felt moon",
  lighting: "soft warm light from the left", palette: "sage, cream, oat", status: "available", sort_order: 1, used_on: null, preview_card_id: null,
  created_at: "", updated_at: "", ...o,
});
const fullAlphabet = (o: Partial<NameRow> = {}) => AZ_LETTERS.map((l) => nm(`${l}ren${l.toLowerCase()}`, o));

describe("letters and labels", () => {
  it("reads the first letter A–Z, dropping accents; anything else has no letter", () => {
    expect(letterOf("Élodie")).toBe("E");
    expect(letterOf("  zane")).toBe("Z");
    expect(letterOf("Øyvind")).toBeNull();
    expect(letterOf("'Iolana")).toBeNull();
    expect(letterOf("")).toBeNull();
  });

  it("labels series posts only", () => {
    expect(seriesLabel({ series: "az", series_part: 1 })).toBe("A–Z Part 1 (A–M)");
    expect(seriesLabel({ series: "az", series_part: 2 })).toBe("A–Z Part 2 (N–Z)");
    expect(seriesLabel({})).toBeNull();
    expect(seriesLabel({ series: null, series_part: null })).toBeNull();
    expect(partRange(1)).toBe("A to M");
    expect(partRange(2)).toBe("N to Z");
  });
});

describe("coverage", () => {
  const names = [nm("Arlo"), nm("Atlas"), nm("Bodhi"), nm("Dax", { status: "pending" }), nm("Dov", { status: "pending" }), nm("Cyrus", { status: "used" }), nm("Ezra", { status: "skip" })];
  it("counts available and pending names per letter", () => {
    const c = azCoverage(names);
    expect(c).toHaveLength(26);
    expect(c[0]).toEqual({ letter: "A", available: 2, pending: 0 });
    expect(c[2]).toEqual({ letter: "C", available: 0, pending: 0 });
    expect(c[3]).toEqual({ letter: "D", available: 0, pending: 2 });
    expect(missingLetters(c)).toEqual(AZ_LETTERS.filter((l) => !"AB".includes(l)));
  });
  it("Fill missing letters tops each missing letter up to 3 ideas, counting the pending ones", () => {
    const needs = fillNeeds(azCoverage([...names, nm("Dane", { status: "pending" })]));
    expect(needs.find((n) => n.letter === "D")).toBeUndefined(); // 3 waiting already
    expect(needs.find((n) => n.letter === "C")).toEqual({ letter: "C", want: 3 });
    expect(needs.find((n) => n.letter === "A")).toBeUndefined();
    const two = fillNeeds(azCoverage(names));
    expect(two.find((n) => n.letter === "D")).toEqual({ letter: "D", want: 1 });
  });
});

describe("pickAzNames", () => {
  it("one available single name per letter, the oldest-added first, deterministic", () => {
    const names = [
      ...fullAlphabet(),
      nm("Abel", { created_at: "2026-09-01T00:00:00Z" }), // older than Aren(a): wins A
      nm("Aaron", { created_at: "2026-09-01T00:00:00Z" }), // same age: alphabetical wins
      nm("Adam", { created_at: "2026-08-01T00:00:00Z", status: "pending" }), // not approved
      nm("Ace", { created_at: "2026-08-01T00:00:00Z", style: "two-word" }),
    ];
    const r = pickAzNames(names);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.names.map((n) => letterOf(n.name))).toEqual(AZ_LETTERS);
    expect(r.names[0].name).toBe("Aaron");
    expect(pickAzNames([...names].reverse())).toEqual(r);
  });
  it("lists the letters with no available name", () => {
    const r = pickAzNames(fullAlphabet().filter((n) => !["D", "Q", "X"].includes(n.name[0])));
    expect(r).toEqual({ ok: false, missing: ["D", "Q", "X"] });
  });
});

describe("planAzSeries", () => {
  const input = { gender: "boy" as const, postDate: "2026-10-09", age: "random" as const, names: fullAlphabet(), themes: [theme("t2", { sort_order: 2 }), theme("t1")] };

  it("Part 1 = A–M and Part 2 = N–Z in strict alphabetical order, one theme (the next one) for both", () => {
    const r = planAzSeries(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.theme_id).toBe("t1");
    expect(r.parts.map((p) => p.part)).toEqual([1, 2]);
    expect(r.parts[0].cards.map((c) => c.name[0])).toEqual(AZ_LETTERS.slice(0, 13));
    expect(r.parts[1].cards.map((c) => c.name[0])).toEqual(AZ_LETTERS.slice(13));
    for (const p of r.parts) expect(p.cards.map((c) => c.position)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    // Every card: the theme's set, positive-only (NO_TEXT the one negative), never the word camera.
    for (const c of r.parts.flatMap((p) => p.cards)) {
      expect(c.prompt).toContain("wicker basket, felt moon");
      expect(c.prompt).toContain(NO_TEXT);
      if (!/props-only/.test(c.shot)) expect(c.prompt.replace(NO_TEXT, "")).not.toMatch(/\b(no|not|without)\b/i);
      expect(c.prompt).not.toMatch(/camera/i);
    }
    // Each part is its own gallery: different shot orders, distinct seeds.
    expect(r.parts[0].cards.map((c) => c.shot)).not.toEqual(r.parts[1].cards.map((c) => c.shot));
    const seeds = r.parts.flatMap((p) => p.cards.map((c) => c.seed));
    expect(new Set(seeds).size).toBe(26);
    expect(planAzSeries(input)).toEqual(r);
  });

  it("a fixed age keeps one child across both parts", () => {
    const r = planAzSeries({ ...input, age: "2" });
    if (!r.ok) throw new Error(r.reason);
    const subjects = new Set(r.parts.flatMap((p) => p.cards).filter((c) => !/props-only/.test(c.shot)).map((c) => c.prompt.match(/^Subject.*$/m)?.[0]));
    expect(subjects.size).toBe(1);
    expect([...subjects][0]).toMatch(/the same toddler in every photo/);
  });

  it("uses the theme picked on Today, and refuses an unavailable or other-gender one", () => {
    const r = planAzSeries({ ...input, themeId: "t2" });
    expect(r.ok && r.theme_id).toBe("t2");
    expect(planAzSeries({ ...input, themes: [theme("g", { gender: "girl" })], themeId: "g" })).toMatchObject({ ok: false, reason: expect.stringMatching(/not available for a boy post/) });
    expect(planAzSeries({ ...input, themes: [] })).toMatchObject({ ok: false, reason: expect.stringMatching(/No unused boy theme/) });
  });

  it("names the missing letters, ignoring other genders' names", () => {
    const names = [...fullAlphabet().filter((n) => !n.name.startsWith("Q")), nm("Quinn", { gender: "girl" })];
    expect(planAzSeries({ ...input, names })).toMatchObject({ ok: false, missing: ["Q"], reason: expect.stringMatching(/for Q\. Use Fill missing letters/) });
  });
});
