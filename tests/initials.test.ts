import { describe, expect, it } from "vitest";
import {
  firstInitialCounts, hasInitials, initialsAiWanted, initialsCounts, initialsLabel, initialsOf, initialsWanted, isInitials,
  leastRecentlyUsed, pickInitialsNames, secondInitialCounts, sourceSummary,
} from "@/lib/series/initials";
import { postLabel } from "@/lib/series/letter";
import { filterInitialsCombos } from "@/lib/ai/suggest-filter";

describe("initials helpers", () => {
  it("reads a two-word name's initials, accents dropped; anything else has none", () => {
    expect(initialsOf("Arjay Royce")).toBe("AR");
    expect(initialsOf("  élan   rhys ")).toBe("ER");
    expect(initialsOf("Arlo")).toBeNull();
    expect(initialsOf("Mary Jo Rae")).toBeNull();
    expect(initialsOf("1st Rhys")).toBeNull();
    expect(hasInitials("Mira Jade", "MJ")).toBe(true);
    expect(hasInitials("Mira Jade", "JM")).toBe(false);
  });

  it("validates and labels posts.initials", () => {
    expect(isInitials("AR")).toBe(true);
    for (const bad of ["ar", "A", "ARJ", "", null, 3]) expect(isInitials(bad)).toBe(false);
    expect(initialsLabel({ initials: "AR" })).toBe("A·R");
    expect(initialsLabel({ initials: null })).toBeNull();
    expect(postLabel({ initials: "MJ" })).toBe("M·J");
    expect(postLabel({ letter: "K", initials: null })).toBe("Letter K");
    expect(postLabel({})).toBeNull();
  });

  it("counts pairs, the first-name row and the middle-name row", () => {
    const pairs = initialsCounts([{ name: "Arlo Reed" }, { name: "Amos Rhett" }, { name: "Axel Jude" }, { name: "Milo" }, { name: "Mira Jade" }]);
    expect(pairs).toEqual({ AR: 2, AJ: 1, MJ: 1 });
    expect(firstInitialCounts(pairs)).toMatchObject({ A: 3, M: 1, B: 0 });
    expect(secondInitialCounts(pairs, "A")).toMatchObject({ R: 2, J: 1, M: 0 });
    expect(Object.values(secondInitialCounts(pairs, null)).every((n) => n === 0)).toBe(true);
  });

  it("picks strictly new first: unused, then fresh AI, then used (as ordered); never a name twice", () => {
    const plan = pickInitialsNames({
      want: 5,
      available: [{ id: "a1", name: "Arlo Reed", meaning: "eagle and red" }],
      fresh: [{ name: "Asher Rowan", meaning: "happy little tree" }, { name: "arlo reed", meaning: "dup" }, { name: "Axel Reid", meaning: "father of peace" }],
      used: [{ id: "u1", name: "Amos Rhett", meaning: "carried by god" }, { id: "u2", name: "Abel Ross", meaning: "breath of the headland" }, { id: "u3", name: "Ari Rune", meaning: "lion of secrets" }],
    });
    expect(plan.picks.map((p) => [p.source, p.name, p.name_id])).toEqual([
      ["available", "Arlo Reed", "a1"], ["new", "Asher Rowan", null], ["new", "Axel Reid", null], ["used", "Amos Rhett", "u1"], ["used", "Abel Ross", "u2"],
    ]);
    expect(plan.counts).toEqual({ available: 1, new: 2, used: 2 });
    expect(plan.short).toBe(0);
    expect(sourceSummary(plan.counts)).toBe("1 unused · 2 new AI · 2 reused");
  });

  it("says how short a post is when every source runs out", () => {
    const plan = pickInitialsNames({ want: 9, available: [{ id: "a1", name: "Xavi Quinn", meaning: "new house wise" }], fresh: [], used: [] });
    expect(plan.picks).toHaveLength(1);
    expect(plan.short).toBe(8);
  });

  it("asks the AI for a few more than missing, within a cap; none when nothing is missing", () => {
    expect(initialsAiWanted(0)).toBe(0);
    expect(initialsAiWanted(-2)).toBe(0);
    expect(initialsAiWanted(1)).toBe(4);
    expect(initialsAiWanted(7)).toBe(10);
    expect(initialsAiWanted(40)).toBe(16);
  });

  it("Auto picks a stable count in min–max per date, gender and initials", () => {
    const s = { min_images: 9, max_images: 13 };
    const k = { postDate: "2026-10-11", gender: "boy" as const, initials: "AR" };
    const n = initialsWanted(null, s, k);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(13);
    expect(initialsWanted(null, s, k)).toBe(n);
    expect(initialsWanted(11, s, k)).toBe(11);
  });

  it("orders names used before least recently used first (unknown dates first)", () => {
    const rows = [
      { name: "B", lastUsed: "2026-10-05T00:00:00Z" }, { name: "A", lastUsed: "2026-09-01T00:00:00Z" }, { name: "C", lastUsed: null }, { name: "D", lastUsed: "2026-09-01T00:00:00Z" },
    ];
    expect(leastRecentlyUsed(rows).map((r) => r.name)).toEqual(["C", "A", "D", "B"]);
  });
});

describe("filterInitialsCombos", () => {
  const cand = (name: string, meaning = "noble and kingly", o: Record<string, string> = {}) => ({ name, meaning, gender: "boy", first_meaning: "noble", second_meaning: "king", ...o });

  it("keeps valid new pairs with the right initials, in the AI's order, at most `want`", () => {
    const r = filterInitialsCombos([
      cand("asher rowan", "Happy Little Tree."), cand("Arlo Reed"), cand("Axel Reid"), cand("Amos Rhett"),
    ], ["Arlo Reed"], { initials: "AR", want: 2 }, "boy");
    expect(r.fresh).toEqual([{ name: "Asher Rowan", meaning: "happy little tree" }, { name: "Axel Reid", meaning: "noble and kingly" }]);
    expect(r.duplicates).toBe(1);
    expect(r.offInitials).toBe(1);
  });

  it("drops wrong initials, one-word or three-word names, hedges, long or short meanings, repeats in the batch", () => {
    const r = filterInitialsCombos([
      cand("Reid Axel"), cand("Arlo"), cand("Arlo Jay Reed"), cand("Arlo Rhys", "lion or bear"), cand("Arlo Rex", "king"),
      cand("Arlo Ryan", "one two three four five six seven"), cand("Atlas Rome"), cand("atlas rome"),
    ], [], { initials: "AR", want: 10 }, "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Atlas Rome"]);
    expect(r.offInitials).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toBe(5);
  });

  it("drops brands, Tagalog words, the other gender's names and unkind meanings (card or part)", () => {
    const r = filterInitialsCombos([
      cand("Armani Reed"), cand("Abel Mahal", "breath and love"), cand("Asher Rose"), cand("Aaron Rhys", "the shining one", { gender: "girl" }),
      cand("Amos Reese", "bitter little king"), cand("Arlo Rafe", "noble wolf counsel", { second_meaning: "wolf of sorrow" }), cand("Ansel Roan"),
    ], [], { initials: "AR", want: 10 }, "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Ansel Roan"]);
    expect(r.blocked).toBe(2);
    expect(r.wrongGender).toBe(2);
    expect(r.negative).toBe(2);
    expect(r.offInitials).toBe(0);
  });

  it("never throws on junk", () => {
    expect(filterInitialsCombos(null as unknown as [], [], { initials: "AR", want: 3 }, "girl").fresh).toEqual([]);
    expect(filterInitialsCombos([{} as never, { name: 3 } as never], [], { initials: "AR", want: 3 }, "girl").fresh).toEqual([]);
  });
});
