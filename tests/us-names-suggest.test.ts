import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

// Task 2 of the US names feature: every suggestion path keeps only US names (best SSA rank 101-2,000;
// two-word: both words in the top 5,000, first not in the top 100), and the prompts aim at the US, Canada, the UK and Australia.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const pickNames = vi.hoisted(() => vi.fn(async () => ({ kind: "ok", nameIds: [], usage: {}, added: [], skipped: [] })));
vi.mock("@/lib/autopilot/names-step", () => ({ pickNames }));
vi.mock("@/lib/facebook/publish", () => ({ publishPost: vi.fn() }));
vi.mock("@/lib/posts/create", () => ({ createPostCore: vi.fn() }));
vi.mock("@/lib/cards/remake", () => ({ remakeCard: vi.fn() }));
vi.mock("@/lib/autopilot/judge-photos", () => ({ judgeCard: vi.fn(), judgeLookAlike: vi.fn() }));
delete process.env.AI_PROVIDER;

const { suggestForLetter, letterPrompt, namesPrompt, NAMES_SYSTEM, LETTER_SYSTEM } = await import("@/lib/ai/suggest");
const { suggestForInitials, initialsPrompt, INITIALS_SYSTEM } = await import("@/lib/ai/initials");
const { suggestNamesAction, cardNameIdeasAction } = await import("@/lib/actions/suggest");
const { autopilotDeps } = await import("@/lib/autopilot/wiring");
const { NAMES_JUDGE_SYSTEM } = await import("@/lib/autopilot/judge-names");
const { US_LIST, usCandidates } = await import("@/lib/names/us-list");
const { UNIQUE_NAMES_SUGGEST } = await import("@/packs/unique-names/suggest");

beforeEach(() => {
  generateJson.mockReset();
  fake = fakeSupabase((q) => respond(q));
  respond = () => undefined;
});

/** The block that makes the AI pick from the US list (brief 2026-11-25, verbatim). */
const CHOICES = "Choose ONLY from these real names that US parents give (pick the ones a mom in the US, Canada, the UK or Australia would love, and give each its true meaning):";
const promptOf = (k = 0) => (generateJson.mock.calls[k][0] as { prompt: string }).prompt;
const offeredIn = (prompt: string) => prompt.split(`${CHOICES}\n`)[1]?.split("\n\n")[0].split(", ") ?? [];
async function onNameNest(fn: () => Promise<void>) {
  const saved = process.env.NICHE;
  process.env.NICHE = "name-nest";
  try { await fn(); } finally { if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved; }
}

describe("the AI picks from the US list (Unique Names)", () => {
  it("letterPrompt and namesPrompt add the choices block only when given; without it they are as before", () => {
    const li = { gender: "girl", style: "single", letter: "Z", count: 5, existing: ["Zelda"] } as const;
    expect(letterPrompt({ ...li, choices: [] })).toBe(letterPrompt(li));
    expect(letterPrompt({ ...li, choices: ["Zora", "Zoya"] })).toBe(`${letterPrompt(li)}\n\n${CHOICES}\nZora, Zoya`);
    const ni = { gender: "boy", style: "single", count: 7, existing: ["Desmond"] } as const;
    const plain = namesPrompt(ni);
    expect(namesPrompt({ ...ni, choices: [] })).toBe(plain);
    expect(namesPrompt({ ...ni, choices: ["Yosef", "Yuri"] })).toBe(plain.replace("\n\nReturn exactly", `\n\n${CHOICES}\nYosef, Yuri\n\nReturn exactly`));
    expect(plain).not.toContain("Choose ONLY");
  });
  it("suggestForLetter offers the letter's US names minus the library's (single style, gate on)", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [] });
    await suggestForLetter({ gender: "girl", style: "single", letter: "Z", count: 8, existing: ["Zelda"], allNames: ["Zelda", "Willa"] });
    const offered = offeredIn(promptOf());
    expect(offered).toHaveLength(44); // the 45 girls' Z names ranked 101-2,000, less Zelda
    expect(offered).toContain("Zora");
    expect(offered).not.toContain("Zelda");
  });
  it("no choices for two-word names, or with the gate off (Name Nest)", async () => {
    generateJson.mockResolvedValue({ ok: true, data: [] });
    await suggestForLetter({ gender: "girl", style: "two-word", letter: "Z", count: 8, existing: [], allNames: [] });
    expect(promptOf(0)).not.toContain("Choose ONLY");
    await onNameNest(async () => {
      await suggestForLetter({ gender: "girl", style: "single", letter: "Z", count: 8, existing: [], allNames: [] });
    });
    expect(promptOf(1)).not.toContain("Choose ONLY");
  });
  it("a letter with no US names left: no AI call, ok with no names", async () => {
    const all = usCandidates("girl", { letter: "X", exclude: [], limit: 10_000 });
    expect(all.length).toBeGreaterThan(0);
    const r = await suggestForLetter({ gender: "girl", style: "single", letter: "X", count: 8, existing: [], allNames: all });
    expect(generateJson).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, result: { fresh: [], duplicates: 0, invalid: 0, offLetter: 0, blocked: 0, wrongGender: 0, negative: 0 } });
  });
  it("an AI that answers from the choices gets every one of them kept", async () => {
    const pick = ["Zora", "Zoya", "Zelda", "Zinnia", "Zariah", "Zola", "Ziva", "Zadie"];
    generateJson.mockImplementationOnce(async (input: { prompt: string }) => {
      const offered = offeredIn(input.prompt);
      return { ok: true, data: pick.filter((n) => offered.includes(n)).map((name) => ({ name, origin: "Hebrew", gender: "girl", meaning: "bright morning light" })) };
    });
    const r = await suggestForLetter({ gender: "girl", style: "single", letter: "Z", count: 8, existing: [], allNames: [] });
    expect(r.ok && r.result.fresh.map((n) => n.name)).toEqual(pick);
  });
  it("Names page, card ideas and Autopilot themes offer the US names (single style), minus the library's", async () => {
    respond = (q: Query) => (op(q, "insert") ? { error: null } : q.table === "names" ? { data: [{ name: "Willa", gender: "girl", style: "single" }] } : undefined);
    generateJson.mockResolvedValue({ ok: true, data: [] });
    await suggestNamesAction({ gender: "girl", style: "single", count: 5 });
    expect(offeredIn(promptOf(0))).toHaveLength(300);
    expect(offeredIn(promptOf(0))).not.toContain("Willa");
    await suggestNamesAction({ gender: "girl", style: "two-word", count: 5 });
    expect(promptOf(1)).not.toContain("Choose ONLY");

    const CARD = "00000000-0000-4000-8000-000000000001";
    respond = (q: Query) => {
      if (q.table === "cards") return { data: { id: CARD, post_id: "p1", theme_id: "t1", kind: "post" } };
      if (q.table === "posts") return { data: { gender: "girl", style: "single" } };
      if (q.table === "themes") return { data: { title: "Garden" } };
      if (q.table === "names") return { data: [{ name: "Willa", gender: "girl", style: "single" }] };
      return undefined;
    };
    await cardNameIdeasAction(CARD);
    expect(offeredIn(promptOf(2))).toHaveLength(300);
    expect(offeredIn(promptOf(2))).not.toContain("Willa");

    await autopilotDeps(fakeSupabase(() => ({ data: null })).client as never).pickNames({} as never, null);
    const deps = (pickNames.mock.calls.at(-1) as unknown as unknown[])[0] as { suggest: (i: unknown) => Promise<unknown> };
    await deps.suggest({ gender: "girl", target: { kind: "theme", title: "Garden", hint: null }, want: 8, allNames: ["Willa"], existing: ["Willa"] });
    expect(offeredIn(promptOf(3))).toHaveLength(300);
    expect(offeredIn(promptOf(3))).not.toContain("Willa");
  });
});

it("the fixtures are what the tests assume (real SSA data)", () => {
  expect(US_LIST.isUsName("Vivienne", "girl", "V")).toBe(true);
  expect(US_LIST.isUsName("Willa", "girl")).toBe(true);
  expect(US_LIST.isUsName("Sakura", "girl")).toBe(false);
  expect(US_LIST.isUsName("Olivia", "girl")).toBe(false);
  expect(US_LIST.isUsName("Vikram", "girl", "V")).toBe(false);
  expect(US_LIST.isUsName("Desmond", "boy")).toBe(true);
  expect(US_LIST.isUsTwoWord("Soren Lennox", "boy")).toBe(true);
  expect(US_LIST.isUsTwoWord("Soren Lumos", "boy")).toBe(false);
});

describe("suggestForLetter", () => {
  it("keeps only US names and counts the others as invalid", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Vivienne", origin: "Latin", gender: "girl", meaning: "full of life" },
      { name: "Vikram", origin: "Sanskrit", gender: "girl", meaning: "valor and strength" },
    ] });
    const r = await suggestForLetter({ gender: "girl", style: "single", letter: "V", count: 5, existing: [], allNames: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.fresh.map((n) => n.name)).toEqual(["Vivienne"]);
    expect(r.result.invalid).toBe(1);
  });
  it("gates before the cap: the first `count` answers are not US names, the later ones fill the post", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Vikram", origin: "Sanskrit", gender: "girl", meaning: "valor and strength" },
      { name: "Vedika", origin: "Sanskrit", gender: "girl", meaning: "the sacred altar" },
      { name: "Vivienne", origin: "French", gender: "girl", meaning: "full of life" },
      { name: "Vienna", origin: "Latin", gender: "girl", meaning: "from the wine country" },
      { name: "Vera", origin: "Slavic", gender: "girl", meaning: "faith and truth" },
    ] });
    const r = await suggestForLetter({ gender: "girl", style: "single", letter: "V", count: 2, existing: [], allNames: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.fresh.map((n) => n.name)).toEqual(["Vivienne", "Vienna"]);
    expect(r.result.invalid).toBe(2); // Vikram, Vedika: not US names
    expect(r.result.offLetter).toBe(1); // Vera: more than wanted
  });
});

describe("suggestNamesAction", () => {
  it("saves only the US-range names", async () => {
    respond = (q: Query) => (op(q, "insert") ? { error: null } : q.table === "names" ? { data: [] } : undefined);
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Olivia", meaning: "the olive tree" },
      { name: "Willa", meaning: "resolute protector" },
      { name: "Sakura", meaning: "cherry blossom tree" },
    ] });
    const r = await suggestNamesAction({ gender: "girl", style: "single", count: 5 });
    expect(r).toMatchObject({ ok: true, added: 1 });
    const rows = fake.queries.find((q) => op(q, "insert"))?.ops.find((o) => o[0] === "insert")?.[1] as { name: string }[];
    expect(rows.map((x) => x.name)).toEqual(["Willa"]);
    expect(r.ok && r.invalid).toBeGreaterThanOrEqual(1);
  });
});

describe("cardNameIdeasAction", () => {
  it("returns only US names", async () => {
    const CARD = "00000000-0000-4000-8000-000000000001";
    respond = (q: Query) => {
      if (q.table === "cards") return { data: { id: CARD, post_id: "p1", theme_id: "t1", kind: "post" } };
      if (q.table === "posts") return { data: { gender: "girl", style: "single" } };
      if (q.table === "themes") return { data: { title: "Garden" } };
      if (q.table === "names") return { data: [] };
      return undefined;
    };
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Sakura", meaning: "cherry blossom tree" },
      { name: "Willa", meaning: "resolute protector" },
    ] });
    const r = await cardNameIdeasAction(CARD);
    expect(r).toEqual({ ok: true, ideas: [{ name: "Willa", meaning: "resolute protector" }] });
  });
  it("says so when every idea was dropped as not a US name", async () => {
    const CARD = "00000000-0000-4000-8000-000000000001";
    respond = (q: Query) => {
      if (q.table === "cards") return { data: { id: CARD, post_id: "p1", theme_id: "t1", kind: "post" } };
      if (q.table === "posts") return { data: { gender: "girl", style: "single" } };
      if (q.table === "themes") return { data: { title: "Garden" } };
      if (q.table === "names") return { data: [{ name: "Willa", gender: "girl", style: "single" }] };
      return undefined;
    };
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Sakura", meaning: "cherry blossom tree" }, { name: "Olivia", meaning: "the olive tree" }] });
    expect(await cardNameIdeasAction(CARD)).toEqual({ ok: false, error: "None of the ideas were US names. Try again." });
    // every idea is already a name: the old message
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Willa", meaning: "resolute protector" }] });
    expect(await cardNameIdeasAction(CARD)).toEqual({ ok: false, error: "Every idea Gemini had is already one of your names. Try again." });
  });
});

describe("Autopilot suggest (theme branch)", () => {
  it("returns only US-range names", async () => {
    await autopilotDeps(fakeSupabase(() => ({ data: null })).client as never).pickNames({} as never, null);
    const deps = (pickNames.mock.calls[0] as unknown as unknown[])[0] as { suggest: (i: unknown) => Promise<{ ok: boolean; names?: { name: string }[] }> };
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Sakura", meaning: "cherry blossom tree" },
      { name: "Willa", meaning: "resolute protector" },
    ] });
    const r = await deps.suggest({ gender: "girl", target: { kind: "theme", title: "Garden", hint: null }, want: 5, allNames: [], existing: [] });
    expect(r.names?.map((n) => n.name)).toEqual(["Willa"]);
  });
});

describe("suggestForInitials", () => {
  it("drops a two-word answer where one word is not on the list", async () => {
    const row = (name: string, p2: string) => ({ name, gender: "boy", meaning: `stern ${p2}`, part1_meaning: "stern", part2_meaning: p2 });
    generateJson.mockResolvedValueOnce({ ok: true, data: [row("Soren Lennox", "light"), row("Soren Lumos", "light")] });
    const r = await suggestForInitials({ gender: "boy", initials: "SL", want: 5, ask: 5, allNames: [], existing: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.result.fresh, ...r.result.relaxed].map((n) => n.name)).toEqual(["Soren Lennox"]);
  });
  it("gates before the cap: a non-US first answer does not crowd out a US one", async () => {
    const row = (name: string, p2: string) => ({ name, gender: "boy", meaning: `stern ${p2}`, part1_meaning: "stern", part2_meaning: p2 });
    generateJson.mockResolvedValueOnce({ ok: true, data: [row("Soren Lumos", "light"), row("Soren Lennox", "light"), row("Sterling Lane", "light")] });
    const r = await suggestForInitials({ gender: "boy", initials: "SL", want: 1, ask: 3, allNames: [], existing: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.fresh.map((n) => n.name)).toEqual(["Soren Lennox"]);
    expect(r.result.offInitials).toBeGreaterThanOrEqual(1); // Sterling Lane: more than wanted
  });
});

describe("prompts", () => {
  it("aim at the US, Canada, the UK and Australia", () => {
    for (const s of [NAMES_SYSTEM, LETTER_SYSTEM, INITIALS_SYSTEM]) {
      expect(s).toContain("the US, Canada, the UK and Australia");
      expect(s).not.toContain("Yoruba");
      expect(s).not.toContain("Sanskrit");
      expect(s).not.toContain("Filipino mom");
    }
    expect(NAMES_JUDGE_SYSTEM).toContain("a mom in the US, Canada, the UK or Australia");
    expect(NAMES_JUDGE_SYSTEM).toContain("an English-speaking family");
  });
  it("the names check turns down names mainly from other regions, never Hebrew or Biblical ones (brief 2026-11-25)", () => {
    expect(NAMES_JUDGE_SYSTEM.split("\n")).toContain(
      "- it is mainly a South Asian (Indian, Pakistani, Bangladeshi), Arabic, Persian or Turkish, East Asian (Chinese, Japanese, Korean, Vietnamese) or African name, even if some US parents use it. Hebrew and Biblical, Greek, Latin, European, Celtic and Spanish or Latin American names are fine: they are common in the US, Canada, the UK and Australia",
    );
    expect(NAMES_JUDGE_SYSTEM).toContain("Hebrew and Biblical");
    expect(NAMES_JUDGE_SYSTEM).not.toContain("Middle East");
  });
  it("the suggestion prompts say the Arab world, Iran or Turkey, not the Middle East", () => {
    const p = initialsPrompt({ gender: "girl", initials: "YZ", count: 6, existing: [] });
    for (const s of [NAMES_SYSTEM, LETTER_SYSTEM, INITIALS_SYSTEM, p]) expect(s).not.toContain("the Middle East");
    for (const s of [NAMES_SYSTEM, LETTER_SYSTEM, INITIALS_SYSTEM]) {
      expect(s).toContain("never names used mainly in South Asia, the Arab world, Iran or Turkey, East Asia or Africa".replace(/^never/, s === LETTER_SYSTEM ? "Never" : "never"));
    }
  });
  it("initials: US name traditions, the US top 100 only, no rare-initial exception", () => {
    expect(INITIALS_SYSTEM).toContain("from the name traditions common in the US, Canada, the UK and Australia");
    expect(INITIALS_SYSTEM).not.toContain("from any culture");
    expect(INITIALS_SYSTEM).toContain("Never use a name in the US top 100 for that gender");
    expect(INITIALS_SYSTEM).not.toContain("Philippine top 100");
    expect(INITIALS_SYSTEM).not.toContain("unless its initial is Q, U, X, Y or Z");
    const p = initialsPrompt({ gender: "girl", initials: "AR", count: 6, existing: [] });
    expect(p).not.toContain("Arabic");
    expect(p).toContain("the name traditions common in the US, Canada, the UK and Australia");
  });
  it("initials on Name Nest: the prompt is as before", () => {
    const saved = process.env.NICHE;
    process.env.NICHE = "name-nest";
    try {
      expect(initialsPrompt({ gender: "girl", initials: "AR", count: 6, existing: [] }))
        .toContain("most pairs of letters have many real names across origins (Latin, Greek, Hebrew, Celtic, Norse, Germanic, French, Italian, Spanish, Arabic, Hawaiian and more)");
    } finally { if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved; }
  });
});

describe("the Unique Names pack's example names", () => {
  // Every two-word example the prompts show, with the gender it is for: each must pass the US list's two-word check.
  const PROMPT_EXAMPLES: Record<string, "boy" | "girl"> = {
    "Arlo Zenith": "boy", "Esme Marigold": "girl",
    "Soren Blake": "boy", "Flora Wren": "girl", "Callum Ray": "boy", "Selah Rose": "girl",
    "Ansel Remy": "boy", "Amos Reid": "boy", "Arlo Ross": "boy", "Alden Rhys": "boy", "Ambrose Russell": "boy",
  };
  const systems = [UNIQUE_NAMES_SUGGEST.namesSystem({ min: 2, max: 6 }), UNIQUE_NAMES_SUGGEST.letterSystem, UNIQUE_NAMES_SUGGEST.initialsSystem];
  it("every prompt example is a US two-word name for its gender", () => {
    for (const [name, g] of Object.entries(PROMPT_EXAMPLES)) {
      expect([name, systems.some((s) => s.includes(name))]).toEqual([name, true]);
      expect([name, US_LIST.isUsTwoWord(name, g)]).toEqual([name, true]);
    }
  });
  it("the prompts show no other two-word example names", () => {
    // Two capitalised words in a row, minus the places and words named in the rules.
    const PLACES = new Set(["South Asia", "East Asia", "Middle East", "No Filipino"]);
    for (const s of systems) {
      for (const [m] of s.matchAll(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g)) {
        if (!PLACES.has(m)) expect([m, m in PROMPT_EXAMPLES]).toEqual([m, true]);
      }
    }
  });
  it("the style examples for initials posts pass for their gender", () => {
    for (const g of ["boy", "girl"] as const) {
      for (const name of UNIQUE_NAMES_SUGGEST.initialsExamples[g]) expect([name, US_LIST.isUsTwoWord(name, g)]).toEqual([name, true]);
    }
  });
});
