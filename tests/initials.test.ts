import { describe, expect, it } from "vitest";
import {
  firstInitialCounts, hasInitials, initialsAiWanted, initialsCounts, initialsLabel, initialsOf, initialsWanted, isInitials,
  leastRecentlyUsed, pickInitialsNames, secondInitialCounts, sourceSummary,
} from "@/lib/series/initials";
import { postLabel } from "@/lib/series/letter";
import { filterInitialsCombos } from "@/lib/ai/suggest-filter";
import { groundingProblem } from "@/lib/ai/meaning-grounding";

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
  // [name, card meaning, first name's meaning, middle name's meaning]
  const cand = (name: string, meaning: string, p1: string, p2: string, o: Record<string, string> = {}) => ({ name, meaning, gender: "boy", part1_meaning: p1, part2_meaning: p2, ...o });
  const opts = (o: Partial<Parameters<typeof filterInitialsCombos>[2]> = {}) => ({ initials: "AR", want: 10, ...o });

  it("keeps valid new pairs with the right initials and grounded meanings, in the AI's order, at most `want`", () => {
    const r = filterInitialsCombos([
      cand("alaric rhys", "Ardor Of The Ruler.", "ruler of all", "ardor"), cand("Arlo Reed", "x y", "x", "y"),
      cand("Anselm Rafe", "divine helmet of counsel", "divine helmet", "wolf counsel"), cand("Aldo Remy", "old and wise oarsman", "old and wise", "oarsman"),
    ], ["Arlo Reed"], opts({ want: 2 }), "boy");
    expect(r.fresh).toEqual([
      { name: "Alaric Rhys", meaning: "ardor of the ruler", parts: ["ruler of all", "ardor"] },
      { name: "Anselm Rafe", meaning: "divine helmet of counsel", parts: ["divine helmet", "wolf counsel"] },
    ]);
    expect([r.duplicates, r.offInitials]).toEqual([1, 1]);
  });

  it("rejects a card meaning with imagery in neither part, or with nothing from one part (Andrew Russell)", () => {
    const r = filterInitialsCombos([
      cand("Andrew Russell", "brave little fox", "manly and strong", "little red one"),
      cand("Andre Russ", "strong little red one", "manly and strong", "little red one"),
      cand("Alden Roy", "old friend", "old friend", "king"),
      cand("Amos Roald", "carried", "carried by god", "famous ruler"),
      cand("Abel Royce", "breath of the king", "breath", ""),
    ], [], opts(), "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Andre Russ"]);
    expect(r.ungrounded).toBe(3);
    expect(r.invalid).toBe(1); // a one-word card meaning
  });

  it("the owner's own meaning of a part wins over the AI's", () => {
    const knownParts = new Map([["rafe", "wise wolf"]]);
    const ok = cand("Anselm Rafe", "divine wise wolf", "divine helmet", "wolf counsel");
    const bad = cand("Alden Rafe", "old friend of counsel", "old friend", "wolf counsel");
    const r = filterInitialsCombos([ok, bad], [], opts({ knownParts }), "boy");
    expect(r.fresh).toEqual([{ name: "Anselm Rafe", meaning: "divine wise wolf", parts: ["divine helmet", "wise wolf"] }]);
    expect(r.ungrounded).toBe(1);
  });

  it("unique pages: very common names are out for either part while enough uncommon ones pass", () => {
    const list = [
      cand("Aaron Rhett", "lofty advice", "lofty", "advice"), cand("Alaric Ryan", "ruler and king", "ruler of all", "little king"),
      cand("Ansel Roan", "divine red", "divine helmet", "red"), cand("Amos Rhodes", "carried by roses", "carried by god", "roses"),
    ];
    const strict = filterInitialsCombos(list, [], opts({ unique: true, need: 2 }), "boy");
    expect(strict.fresh.map((f) => f.name)).toEqual(["Ansel Roan", "Amos Rhodes"]);
    expect(strict.common).toBe(2);
    // name-nest (not unique): common names are fine
    expect(filterInitialsCombos(list, [], opts(), "boy").fresh).toHaveLength(4);
  });

  it("too few uncommon: relaxes only the part that blocked, uncommon ones first", () => {
    const list = [
      cand("Aaron Rhett", "lofty advice", "lofty", "advice"), cand("Adam Reed", "earth and red", "earth", "red"),
      cand("Alaric Ryan", "ruler and king", "ruler of all", "little king"), cand("Ansel Roan", "divine red", "divine helmet", "red"),
    ];
    const r = filterInitialsCombos(list, [], opts({ unique: true, need: 3 }), "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Ansel Roan", "Aaron Rhett", "Adam Reed"]);
    expect(r.common).toBe(1); // Alaric Ryan: the middle name's rule never had to relax
  });

  it("rare initials (Q, U, X, Y, Z) relax the rule for that part only", () => {
    const r = filterInitialsCombos([
      cand("Xavier Zion", "new house of zion", "new house", "zion"), cand("Xavier Zeke", "new house of god", "new house", "god strengthens"),
    ], [], opts({ initials: "XZ", unique: true, need: 1 }), "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Xavier Zion", "Xavier Zeke"]);
    const a = filterInitialsCombos([cand("Aaron Zion", "lofty zion", "lofty", "zion"), cand("Alaric Zev", "ruler of the wolf", "ruler of all", "wolf")],
      [], opts({ initials: "AZ", unique: true, need: 1 }), "boy");
    expect(a.fresh.map((f) => f.name)).toEqual(["Alaric Zev"]);
  });

  it("drops wrong initials, one-word or three-word names, hedges, repeats in the batch", () => {
    const r = filterInitialsCombos([
      cand("Reid Alaric", "red ruler", "red", "ruler"), cand("Arlo", "x y", "x", "y"), cand("Arlo Jay Reed", "x y", "x", "y"),
      cand("Arlo Rhys", "army or ardor", "army", "ardor"), cand("Alaric Rhys", "ardor of the ruler", "ruler of all", "ardor"), cand("alaric rhys", "ardor of the ruler", "ruler of all", "ardor"),
    ], [], opts(), "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Alaric Rhys"]);
    expect([r.offInitials, r.duplicates, r.invalid]).toEqual([1, 1, 3]);
  });

  it("drops brands, Tagalog words, the other gender's names and unkind meanings (card or part)", () => {
    const r = filterInitialsCombos([
      cand("Armani Reed", "x red", "x", "red"), cand("Abel Mahal", "breath and love", "breath", "love"), cand("Ansel Rose", "divine rose", "divine helmet", "rose"),
      cand("Arlo Rhys", "army ardor", "army", "ardor", { gender: "girl" }), cand("Amos Reese", "bitter carried", "carried by god", "bitter"),
      cand("Alaric Rhys", "ardor of the ruler", "ruler of all", "ardor"),
    ], [], opts(), "boy");
    expect(r.fresh.map((f) => f.name)).toEqual(["Alaric Rhys"]);
    expect([r.blocked, r.wrongGender, r.negative]).toEqual([2, 2, 1]);
  });

  it("never throws on junk", () => {
    expect(filterInitialsCombos(null as unknown as [], [], { initials: "AR", want: 3 }, "girl").fresh).toEqual([]);
    expect(filterInitialsCombos([{} as never, { name: 3 } as never], [], { initials: "AR", want: 3 }, "girl").fresh).toEqual([]);
  });
});

describe("meaning grounding", () => {
  it("allows the parts' words in any order and form, small joining words and close synonyms; nothing else", () => {
    expect(groundingProblem("strong little red one", "manly and strong", "little red one")).toBeNull();
    expect(groundingProblem("gracious song", "grace", "melody")).toBeNull();
    expect(groundingProblem("noble and kingly", "noble", "king")).toBeNull();
    expect(groundingProblem("brave little fox", "manly and strong", "little red one")).toBe('"brave fox" is in neither part\'s meaning');
    expect(groundingProblem("priceless ray of light", "priceless", "wise protector")).toMatch(/ray light/);
    expect(groundingProblem("little red one", "manly and strong", "little red one")).toBe("nothing from the first name's meaning");
    expect(groundingProblem("manly one", "manly", "")).toBe("a part meaning is missing");
  });
});

describe("one use of each part per post", () => {
  it("skips a name whose first or middle name is already in the post (or on it)", () => {
    const plan = pickInitialsNames({
      want: 5, takenParts: ["Amos Jude"],
      available: [{ id: "a1", name: "Mila June", meaning: "dear youth" }, { id: "a2", name: "Maya June", meaning: "x y" }],
      fresh: [{ name: "Mabel Jane", meaning: "lovable grace" }, { name: "Mila Joy", meaning: "x y" }, { name: "Mira Jude", meaning: "x y" }, { name: "Maeve Josie", meaning: "x y" }],
      used: [],
    });
    expect(plan.picks.map((p) => p.name)).toEqual(["Mila June", "Mabel Jane", "Maeve Josie"]);
    expect(plan.short).toBe(2);
  });
});

describe("captions for a post by initials", async () => {
  const { captionProblem, captionPrompt, templateLine } = await import("@/lib/ai/caption");
  const theme = { title: "Ocean", backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c" };

  it("the prompt tells the AI the initials; a line that never says them earns a retry", () => {
    expect(captionPrompt({ theme, gender: "girl", captionStyle: "story", initials: "MJ" })).toContain("baby girl names with the initials M & J");
    const input = { captionStyle: "story" as const, initials: "MJ" };
    for (const ok of ["Baby girl names with the initials M & J.", "Sweet picks for M and J!", "Names for little M.J. fans", "Initials M·J, all of them lovely"]) {
      expect(captionProblem(ok, input)).toBeNull();
    }
    expect(captionProblem("Sweet names for your little girl.", input)).toBe("does not say the names have the initials M & J");
    expect(captionProblem("Many joyful names.", input)).not.toBeNull();
  });

  it("the template names the initials; other posts are unchanged", () => {
    expect(templateLine("boy", "Lovely names.", undefined, null, "AR")).toBe("Baby boy names with the initials A & R. Lovely names.");
    expect(templateLine("boy", "Lovely names.")).toBe("Lovely names.");
  });
});
