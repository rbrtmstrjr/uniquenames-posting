import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";
import { filterLetterSuggestions } from "@/lib/ai/suggest-filter";

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
  it("keeps valid new single names for the asked letters, at most `want` each", () => {
    const r = filterLetterSuggestions([
      { name: "Dashiell", meaning: "page boy" },
      { name: "Declan", meaning: "full of goodness" },
      { name: "Dov", meaning: "a bear" }, // already in the database
      { name: "Darius", meaning: "holder of the good" }, // D is full
      { name: "Quentin", meaning: "the fifth" },
      { name: "Oren", meaning: "pine tree" }, // letter not asked
      { name: "Quill Ray", meaning: "feather ray" }, // two words
      { name: "Quill", meaning: "a long winding meaning of far too many words" }, // meaning over 6 words
      { name: "Quade", meaning: "fourth" }, // a one-word meaning is fine here
    ], ["Dov", "Aven"], [{ letter: "D", want: 2 }, { letter: "Q", want: 3 }]);
    expect(r.fresh).toEqual([
      { name: "Dashiell", meaning: "page boy", letter: "D" },
      { name: "Declan", meaning: "full of goodness", letter: "D" },
      { name: "Quentin", meaning: "the fifth", letter: "Q" },
      { name: "Quade", meaning: "fourth", letter: "Q" },
    ]);
    expect(r).toMatchObject({ duplicates: 1, invalid: 2, offLetter: 2 });
  });
});

describe("lettersPrompt", () => {
  it("asks per letter with spares, lists the existing names, and insists on real names and true meanings", () => {
    const p = lettersPrompt({ gender: "boy", needs: [{ letter: "D", want: 1 }, { letter: "Q", want: 3 }], existing: ["Aven", "Dax"] });
    expect(p).toContain("start with these letters (how many in brackets): D (3), Q (5).");
    expect(p).toContain("Aven, Dax");
    expect(p).toContain("at most 8 names");
    expect(LETTERS_SYSTEM).toMatch(/Never invent a name/);
    expect(LETTERS_SYSTEM).toMatch(/commonly accepted meaning/);
    expect(LETTERS_SYSTEM).toMatch(/A single name is exactly one word/);
  });
});

describe("fillMissingLettersAction", () => {
  it("asks only for the missing letters (topped up to 3, counting pending), saves the survivors as pending", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Declan", meaning: "full of goodness" },
      { name: "Dashiell", meaning: "page boy" }, // D wants only 1 more
      { name: "Quentin", meaning: "the fifth" },
      { name: "quinn", meaning: "wise counsel" }, // in the database (girl): never twice
      { name: "Quincy", meaning: "estate of the fifth son" },
    ] });
    const r = await fillMissingLettersAction({ gender: "boy" });
    expect(r).toEqual({ ok: true, added: 3, letters: [{ letter: "D", added: 1 }, { letter: "Q", added: 2 }], short: ["Q"] });
    const call = generateJson.mock.calls[0][0];
    expect(call.prompt).toContain("D (3), Q (5)");
    expect(call.prompt).not.toContain("Dario Vale"); // two-word names are not this kind
    expect(call.prompt).not.toContain("Quinn"); // other gender
    expect(inserted()).toEqual([
      { name: "Declan", meaning: "full of goodness", gender: "boy", style: "single", status: "pending" },
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
