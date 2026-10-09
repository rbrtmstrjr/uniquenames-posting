import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";
import { filterLetterSuggestions } from "@/lib/ai/suggest-filter";
import { COMMON_BOY_NAMES, COMMON_GIRL_NAMES, isCommonName, negativeMeaning, notAGivenName } from "@/lib/ai/common-names";

// "Fill missing letters" (A–Z series): Gemini mocked at generateJson, the database is the fake.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { fillMissingLettersAction } = await import("@/lib/actions/suggest");
const { lettersPrompt, LETTERS_SYSTEM } = await import("@/lib/ai/suggest");

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
// Every boy letter covered except D and Q; D has 2 suggestions waiting already.
const dbNames = [
  ...AZ.filter((l) => l !== "D" && l !== "Q").map((l) => ({ name: `${l}ven`, gender: "boy", style: "single", status: "available" })),
  { name: "Dax", gender: "boy", style: "single", status: "pending" },
  { name: "Dov", gender: "boy", style: "single", status: "pending" },
  { name: "Quinn", gender: "girl", style: "single", status: "available" }, // other gender: Q is still missing for boys
  { name: "Dario Vale", gender: "boy", style: "two-word", status: "available" }, // two-word: does not cover D
];
const inserted = () => fake.queries.find((q) => op(q, "insert"))?.ops.find((o) => o[0] === "insert")?.[1] as Record<string, unknown>[] | undefined;

beforeEach(() => {
  generateJson.mockReset();
  revalidatePath.mockReset();
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (op(q, "insert")) return { error: null };
    if (q.table === "names") return { data: dbNames };
    return undefined;
  };
});

describe("filterLetterSuggestions", () => {
  it("keeps real, uncommon, new single names of the asked gender and letter, with a 2-6 word kind meaning, at most `want` each", () => {
    const r = filterLetterSuggestions([
      { name: "Dylan", meaning: "son of the sea", gender: "boy" }, // too common (US/PH top 100): never takes D's slot
      { name: "Dashiell", meaning: "page boy", gender: "boy" },
      { name: "Desmond", meaning: "man from south munster", gender: "boy" },
      { name: "Dov", meaning: "a little bear" }, // already in the database
      { name: "dov", meaning: "a little bear" }, // ... in any capitalization
      { name: "Darius", meaning: "holder of the good" }, // D is full
      { name: "Delilah", meaning: "delicate and gentle", gender: "boy" }, // a common girl name: wrong gender
      { name: "Quiana", meaning: "silky and soft", gender: "girl" }, // Gemini itself says girl
      { name: "Qiana", meaning: "silky and soft", gender: "boy" }, // a brand, not a given name
      { name: "Quentin", meaning: "the fifth one", gender: "boy" },
      { name: "Oren", meaning: "pine tree", gender: "boy" }, // letter not asked
      { name: "Quill Ray", meaning: "feather ray" }, // two words
      { name: "Quill", meaning: "a long winding meaning of far too many words" }, // meaning over 6 words
      { name: "Quade", meaning: "fourth" }, // a one-word meaning: a loose gloss, not the accepted one
      { name: "Ulysses", meaning: "wounded in the thigh", gender: "boy" }, // negative meaning
      { name: "Ugo", meaning: "bright mind and spirit", gender: "unisex" }, // unisex is fine
    ], ["Dov", "Aven"], [{ letter: "D", want: 2 }, { letter: "Q", want: 3 }, { letter: "U", want: 3 }], "boy");
    expect(r.fresh).toEqual([
      { name: "Dashiell", meaning: "page boy", letter: "D" },
      { name: "Desmond", meaning: "man from south munster", letter: "D" },
      { name: "Quentin", meaning: "the fifth one", letter: "Q" },
      { name: "Ugo", meaning: "bright mind and spirit", letter: "U" },
    ]);
    expect(r).toMatchObject({ duplicates: 2, invalid: 3, offLetter: 2, blocked: 2, wrongGender: 2, negative: 1 });
  });

  it("rejects a meaning that hedges between two readings, and a name mostly given to the other gender even if Gemini says unisex", () => {
    const r = filterLetterSuggestions([
      { name: "Kira", meaning: "lady or sun", gender: "girl" },
      { name: "Kalinda", meaning: "the sun", gender: "girl" },
    ], [], [{ letter: "K", want: 3 }], "girl");
    expect(r.fresh.map((f) => f.name)).toEqual(["Kalinda"]);
    expect(r.invalid).toBe(1);
    const boys = filterLetterSuggestions([{ name: "Yael", meaning: "mountain goat", gender: "unisex" }, { name: "Yannick", meaning: "god is gracious", gender: "boy" }], [], [{ letter: "Y", want: 3 }], "boy");
    expect(boys.fresh.map((f) => f.name)).toEqual(["Yannick"]);
    expect(boys.wrongGender).toBe(1);
  });

  it("rejects meanings with sad or harsh words, and very common names of either gender list for that gender", () => {
    const sad = ["bitter", "sorrowful", "death", "a mistress", "grief", "the lame one"].map((m, k) => ({ name: `Ux${"abcdef"[k]}an`, meaning: `${m} of the sea` }));
    expect(filterLetterSuggestions(sad, [], [{ letter: "U", want: 9 }], "girl")).toMatchObject({ fresh: [], negative: 6 });
    const girls = filterLetterSuggestions([{ name: "Sofia", meaning: "wisdom and grace" }, { name: "Saoirse", meaning: "freedom and liberty" }], [], [{ letter: "S", want: 3 }], "girl");
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

describe("lettersPrompt", () => {
  it("asks 5 candidates per letter, lists the existing names, and insists on real, uncommon names with accepted, kind meanings", () => {
    const p = lettersPrompt({ gender: "boy", needs: [{ letter: "D", want: 1 }, { letter: "Q", want: 3 }], existing: ["Aven", "Dax"] });
    expect(p).toContain("start with these letters: D, Q.");
    expect(p).toContain("exactly 5 names per letter (10 in total)");
    expect(p).toContain("Aven, Dax");
    expect(p).toMatch(/given mainly to boys/);
    expect(LETTERS_SYSTEM).toMatch(/Never invent a name/);
    expect(LETTERS_SYSTEM).toMatch(/attested/);
    expect(LETTERS_SYSTEM).toMatch(/top 100/);
    expect(LETTERS_SYSTEM).toMatch(/standard accepted etymological meaning/);
    expect(LETTERS_SYSTEM).toMatch(/2 to 6 plain English words/);
    expect(LETTERS_SYSTEM).toMatch(/"the fifth born"/); // a one-word meaning phrased in 2+ true words
    expect(LETTERS_SYSTEM).toMatch(/never two synonyms/);
    expect(LETTERS_SYSTEM).toMatch(/brand/);
    expect(LETTERS_SYSTEM).toMatch(/negative/);
    expect(LETTERS_SYSTEM).toMatch(/A single name is exactly one word/);
  });
});

describe("fillMissingLettersAction", () => {
  it("asks only for the missing letters (5 candidates each), keeps the best up to 3 counting pending, saves the survivors as pending", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Dylan", meaning: "son of the sea", gender: "boy" }, // too common: D's one slot stays open
      { name: "Desmond", meaning: "man from south munster" },
      { name: "Dashiell", meaning: "page boy" }, // D wants only 1 more
      { name: "Quentin", meaning: "the fifth" },
      { name: "quinn", meaning: "wise counsel" }, // in the database (girl): never twice
      { name: "Quincy", meaning: "estate of the fifth son" },
    ] });
    const r = await fillMissingLettersAction({ gender: "boy" });
    expect(r).toEqual({ ok: true, added: 3, letters: [{ letter: "D", added: 1 }, { letter: "Q", added: 2 }], short: ["Q"] });
    const call = generateJson.mock.calls[0][0];
    expect(call.prompt).toContain("start with these letters: D, Q.");
    expect(call.prompt).toContain("exactly 5 names per letter (10 in total)");
    expect(call.prompt).not.toContain("Dario Vale"); // two-word names are not this kind
    expect(call.prompt).not.toContain("Quinn"); // other gender
    expect(inserted()).toEqual([
      { name: "Desmond", meaning: "man from south munster", gender: "boy", style: "single", status: "pending" },
      { name: "Quentin", meaning: "the fifth", gender: "boy", style: "single", status: "pending" },
      { name: "Quincy", meaning: "estate of the fifth son", gender: "boy", style: "single", status: "pending" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/names");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("says so when every letter is covered, or every missing letter already has 3 ideas waiting (no Gemini call)", async () => {
    respond = (q) => (q.table === "names" ? { data: AZ.map((l) => ({ name: `${l}ven`, gender: "girl", style: "single", status: "available" })) } : undefined);
    expect(await fillMissingLettersAction({ gender: "girl" })).toEqual({ ok: false, error: "Every letter already has a girl name. Nothing to fill." });
    respond = (q) => (q.table === "names" ? { data: [...dbNames, { name: "Dane", gender: "boy", style: "single", status: "pending" },
      ...["Quade", "Quill", "Quinto"].map((name) => ({ name, gender: "boy", style: "single", status: "pending" }))] } : undefined);
    const r = await fillMissingLettersAction({ gender: "boy" });
    expect(!r.ok && r.error).toMatch(/already has 3 name ideas waiting for approval/);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("passes on Gemini's failure without writing", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await fillMissingLettersAction({ gender: "boy" })).toEqual({ ok: false, error: "Gemini could not suggest names: Gemini timed out." });
    expect(inserted()).toBeUndefined();
  });

  it("checks the owner first and rejects a bad gender", async () => {
    expect(await fillMissingLettersAction({ gender: "x" as "boy" })).toEqual({ ok: false, error: "Pick Boy or Girl." });
    expect(fake.queries).toHaveLength(0);
  });
});
