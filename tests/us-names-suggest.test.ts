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

const { suggestForLetter, NAMES_SYSTEM, LETTER_SYSTEM } = await import("@/lib/ai/suggest");
const { suggestForInitials, INITIALS_SYSTEM } = await import("@/lib/ai/initials");
const { suggestNamesAction, cardNameIdeasAction } = await import("@/lib/actions/suggest");
const { autopilotDeps } = await import("@/lib/autopilot/wiring");
const { NAMES_JUDGE_SYSTEM } = await import("@/lib/autopilot/judge-names");
const { US_LIST } = await import("@/lib/names/us-list");

beforeEach(() => {
  generateJson.mockReset();
  fake = fakeSupabase((q) => respond(q));
  respond = () => undefined;
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
});

describe("Autopilot suggest (theme branch)", () => {
  it("returns only US-range names", async () => {
    autopilotDeps(fakeSupabase(() => ({ data: null })).client as never);
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
});
