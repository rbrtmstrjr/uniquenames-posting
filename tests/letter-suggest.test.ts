import { describe, expect, it, vi } from "vitest";
import { filterLetterSuggestions } from "@/lib/ai/suggest-filter";
import { COMMON_BOY_NAMES, COMMON_GIRL_NAMES, isCommonName, negativeMeaning, notAGivenName } from "@/lib/ai/common-names";

// Names for a post by letter: the hardened prompt and the offline checks (the action is in letter-actions.test.ts).
vi.mock("@/lib/ai/gemini", () => ({ generateJson: vi.fn() }));
const { letterPrompt, LETTER_SYSTEM, letterCandidates } = await import("@/lib/ai/suggest");

const single = (letter: string, want: number) => ({ letter, want, style: "single" as const });

describe("filterLetterSuggestions", () => {
  it("keeps real, uncommon, new single names of the gender starting with the letter, with a 2-6 word kind meaning, at most `want`", () => {
    const r = filterLetterSuggestions([
      { name: "Dylan", meaning: "son of the sea", gender: "boy" }, // too common (US/PH top 100)
      { name: "Dashiell", meaning: "page boy", gender: "boy" },
      { name: "Dov", meaning: "a little bear" }, // already in the database
      { name: "dov", meaning: "a little bear" }, // ... in any capitalization
      { name: "Delilah", meaning: "delicate and gentle", gender: "boy" }, // a common girl name: wrong gender
      { name: "Dariela", meaning: "holder of the good", gender: "girl" }, // Gemini itself says girl
      { name: "Oren", meaning: "pine tree", gender: "boy" }, // another letter
      { name: "Dax Ray", meaning: "water ray" }, // two words
      { name: "Darwin", meaning: "a long winding meaning of far too many words" }, // meaning over 6 words
      { name: "Dace", meaning: "fourth" }, // a one-word meaning: a loose gloss
      { name: "Dolan", meaning: "dark and wounded one", gender: "boy" }, // negative meaning
      { name: "Desmond", meaning: "man from south munster", gender: "unisex" }, // unisex is fine
      { name: "Darius", meaning: "holder of the good", gender: "boy" }, // over `want`
    ], ["Dov", "Aven"], single("D", 2), "boy");
    expect(r.fresh).toEqual([
      { name: "Dashiell", meaning: "page boy", letter: "D" },
      { name: "Desmond", meaning: "man from south munster", letter: "D" },
    ]);
    expect(r).toMatchObject({ duplicates: 2, invalid: 3, offLetter: 2, blocked: 1, wrongGender: 2, negative: 1 });
  });

  it("two-word: the first name gives the letter and the common check; every word the gender and non-name checks", () => {
    const r = filterLetterSuggestions([
      { name: "Kaia Wren", meaning: "pure little songbird", gender: "girl" },
      { name: "Wren Kaia", meaning: "little songbird so pure", gender: "girl" }, // the first name is not K
      { name: "Kinsley Mae", meaning: "the king's meadow", gender: "girl" }, // a top-100 first name
      { name: "Kalina Liam", meaning: "flower of strong will", gender: "girl" }, // a boy's name inside
      { name: "Keira Chanel", meaning: "little dark canal", gender: "girl" }, // a brand inside
      { name: "Kaia", meaning: "pure and bright" }, // one word
    ], [], { letter: "K", want: 5, style: "two-word" }, "girl");
    expect(r.fresh.map((f) => f.name)).toEqual(["Kaia Wren"]);
    expect(r).toMatchObject({ offLetter: 1, blocked: 2, wrongGender: 1, invalid: 1 });
  });

  it("rejects a meaning that hedges between two readings, and a name mostly given to the other gender even if Gemini says unisex", () => {
    const r = filterLetterSuggestions([
      { name: "Kira", meaning: "lady or sun", gender: "girl" },
      { name: "Kalinda", meaning: "the sun", gender: "girl" },
    ], [], single("K", 3), "girl");
    expect(r.fresh.map((f) => f.name)).toEqual(["Kalinda"]);
    expect(r.invalid).toBe(1);
    const boys = filterLetterSuggestions([{ name: "Yael", meaning: "mountain goat", gender: "unisex" }, { name: "Yannick", meaning: "god is gracious", gender: "boy" }], [], single("Y", 3), "boy");
    expect(boys.fresh.map((f) => f.name)).toEqual(["Yannick"]);
    expect(boys.wrongGender).toBe(1);
  });

  it("rejects meanings with sad or harsh words, and very common names for that gender", () => {
    const sad = ["bitter", "sorrowful", "death", "a mistress", "grief", "the lame one"].map((m, k) => ({ name: `Ux${"abcdef"[k]}an`, meaning: `${m} of the sea` }));
    expect(filterLetterSuggestions(sad, [], single("U", 9), "girl")).toMatchObject({ fresh: [], negative: 6 });
    const girls = filterLetterSuggestions([{ name: "Sofia", meaning: "wisdom and grace" }, { name: "Saoirse", meaning: "freedom and liberty" }], [], single("S", 3), "girl");
    expect(girls.fresh.map((f) => f.name)).toEqual(["Saoirse"]);
    expect(girls.blocked).toBe(1);
  });
});

describe("common and negative checks", () => {
  it("knows the very common names per gender (case-insensitive) and the owner's rejects", () => {
    for (const n of ["William", "peter", "Patrick", "Owen", "Liam", "Nathaniel"]) expect(isCommonName(n, "boy")).toBe(true);
    for (const n of ["Olivia", "althea", "Princess", "Sofia"]) expect(isCommonName(n, "girl")).toBe(true);
    expect(isCommonName("Peregrine", "boy")).toBe(false);
    expect(isCommonName("Saoirse", "girl")).toBe(false);
    expect(notAGivenName("Yaelen")).toBe(true);
    expect(notAGivenName("Qiana")).toBe(true);
    expect(notAGivenName("Quentin")).toBe(false);
    expect(COMMON_BOY_NAMES.length).toBeGreaterThanOrEqual(100);
    expect(COMMON_GIRL_NAMES.length).toBeGreaterThanOrEqual(100);
  });

  it("flags meanings with negative words, not kind ones that merely contain the letters", () => {
    for (const m of ["wounded in the thigh", "bitter", "sea of sorrow", "child of death", "mistress", "a dead man"]) expect(negativeMeaning(m)).toBe(true);
    for (const m of ["the fifth one", "beloved friend", "bright and shining", "gift from god", "brave warrior"]) expect(negativeMeaning(m)).toBe(false);
  });
});

describe("letterPrompt", () => {
  it("asks spare candidates for one letter, lists that letter's names, and insists on real, uncommon names with accepted, kind meanings", () => {
    const p = letterPrompt({ gender: "boy", style: "single", letter: "I", count: 8, existing: ["Ivo", "Idris"] });
    expect(letterCandidates(8)).toBe(14);
    expect(p).toContain("Suggest 14 single-word baby boy names that start with the letter I.");
    expect(p).toContain("I names already on the page (do not repeat any):\nIvo, Idris");
    expect(p).toMatch(/given mainly to boys/);
    const two = letterPrompt({ gender: "girl", style: "two-word", letter: "K", count: 8, existing: [] });
    expect(two).toContain("Suggest 14 two-word (first + middle) baby girl names whose FIRST name starts with the letter K.");
    expect(two).toContain("The page has no two-word girl names starting with K yet.");
    expect(LETTER_SYSTEM).toMatch(/Never invent a name/);
    expect(LETTER_SYSTEM).toMatch(/attested/);
    expect(LETTER_SYSTEM).toMatch(/top 100/);
    expect(LETTER_SYSTEM).toMatch(/standard accepted etymological meaning/);
    expect(LETTER_SYSTEM).toMatch(/2 to 6 plain English words/);
    expect(LETTER_SYSTEM).toMatch(/"the fifth born"/);
    expect(LETTER_SYSTEM).toMatch(/never two synonyms/);
    expect(LETTER_SYSTEM).toMatch(/brand/);
    expect(LETTER_SYSTEM).toMatch(/negative/);
    expect(LETTER_SYSTEM).toMatch(/for a two-word name, the first name starts with it/);
  });
});
