import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

// Posts by initials on Name Nest (NICHE=name-nest): US prompts and style examples, real well-loved US names allowed (no
// common-name rejection), the names table's SSA meanings and origins used for the parts, the origin line on the card
// ("English · Latin", no US rank for a pair), and one use of each part per post (near-duplicates too).
const savedNiche = process.env.NICHE;
process.env.NICHE = "name-nest";
afterAll(() => { if (savedNiche === undefined) delete process.env.NICHE; else process.env.NICHE = savedNiche; });

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { planInitialsAction, createInitialsPostAction } = await import("@/lib/actions/initials");
const { INITIALS_SYSTEM, INITIALS_UNIQUE } = await import("@/lib/ai/initials");

const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const theme: ThemeRow = {
  id: THEME_ID, title: "Spring Garden", gender: "girl", backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c",
  status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
// The Name Nest seed: SSA single names with AI meanings + origins, 'pending' until approved. No two-word girl names yet.
const ssa = (name: string, meaning: string, origin: string, us_rank: number): NameRow => ({
  id: `n-${name}`, name, meaning, origin, us_rank, us_year: 2025, gender: "girl", style: "single", status: "pending",
  post_id: null, position: null, created_at: "2026-10-01", updated_at: "",
});
const NAMES = [
  ssa("Hazel", "the hazel tree", "English", 30), ssa("June", "born in june", "Latin", 160), ssa("Hannah", "favor and grace", "Hebrew", 40),
  ssa("Jane", "god is gracious", "Hebrew", 300), ssa("Josephine", "god will increase", "Hebrew", 90),
];
const settings = { id: 1, caption_template: "Baby {gender} names.", hashtags: "", handle: "@namenest", min_images: 3, max_images: 13, caption_ai: false };
function world() {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "rpc:create_initials_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "settings") return isUpdate(q) ? undefined : { data: settings };
    if (q.table === "names") return { data: NAMES };
    if (q.table === "themes") return { data: [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "posts" && op(q, "select")?.[1] === "initials") return { data: [] };
    if (q.table === "posts") return { data: [] };
    if (q.table === "cards") return { data: [] };
    return undefined;
  };
}
// [name, card meaning, first name's meaning (AI), middle name's meaning (AI)]
const combos = (...xs: [string, string, string, string][]) => ({ ok: true, data: xs.map(([name, meaning, part1_meaning, part2_meaning]) => ({ name, meaning, gender: "girl", part1_meaning, part2_meaning })) });
const base = { gender: "girl" as const, first: "H", second: "J", count: 3, postDate: "2026-10-11" };

beforeEach(() => { generateJson.mockReset(); world(); vi.spyOn(Math, "random").mockReturnValue(0); });

describe("posts by initials on Name Nest", () => {
  it("US prompt: Name Nest's system, its own style examples when it has no two-word names, the SSA meanings as part meanings", async () => {
    expect(INITIALS_UNIQUE).toBe(false);
    expect(INITIALS_SYSTEM).toContain("Name Nest");
    expect(INITIALS_SYSTEM).toContain("American parents");
    generateJson.mockResolvedValueOnce(combos(["Hazel June", "the hazel tree born in june", "hazelnut", "young"]));
    await planInitialsAction(base);
    const { system, prompt } = generateJson.mock.calls[0][0] as { system: string; prompt: string };
    expect(system).toBe(INITIALS_SYSTEM);
    expect(prompt).toContain("for example: Hazel June, Eloise Kate, Nora Claire");
    expect(prompt).toContain("Hazel = the hazel tree");
    expect(prompt).toContain("June = born in june");
  });

  it("well-loved US names are fine; the names table's meanings and origins win; no part twice (nor a near-duplicate)", async () => {
    generateJson.mockResolvedValueOnce(combos(
      ["Hazel June", "the hazel tree born in june", "hazelnut", "young"],
      ["Holly June", "holly born in june", "holly", "young"],
      ["Hannah Jane", "favor and grace from a gracious god", "grace", "god is gracious"],
      ["Hanna Jo", "grace of god", "grace", "god will increase"],
      ["Harper Josephine", "a harp player whom god will increase", "harp player", "god will increase"],
    ));
    const r = await planInitialsAction(base);
    expect(r.ok && r.names.map((n) => `${n.name} — ${n.meaning} (${n.parts?.join(" / ")}) [${n.source}]`)).toEqual([
      "Hazel June — the hazel tree born in june (the hazel tree / born in june) [new]",
      "Hannah Jane — favor and grace from a gracious god (favor and grace / god is gracious) [new]",
      "Harper Josephine — a harp player whom god will increase (harp player / god will increase) [new]",
    ]);
    expect(r.ok && r.fresh.map((f) => f.origin ?? null)).toEqual(["English · Latin", "Hebrew", null]);
  });

  it("Generate: a fresh name carries its origin line to the card (no US rank for a pair)", async () => {
    generateJson.mockResolvedValue({ ok: false, error: "caption off" });
    const fresh = [
      { name: "Hazel June", meaning: "the hazel tree born in june", parts: ["the hazel tree", "born in june"] as [string, string] },
      { name: "Hannah Jane", meaning: "favor and grace from a gracious god", parts: ["favor and grace", "god is gracious"] as [string, string] },
    ];
    const r = await createInitialsPostAction({ ...base, count: 3, themeId: THEME_ID, requestId: "11111111-1111-4111-8111-111111111111", fresh });
    expect(r).toEqual({ ok: true, postId: POST_ID, cards: 2, short: 1 });
    const p = (fake.rpcs.find((x) => x.fn === "create_initials_post")!.args as { p: { cards: Record<string, unknown>[]; caption: string } }).p;
    expect(p.cards.map((c) => [c.name, c.origin ?? null, "us_rank" in c])).toEqual([["Hazel June", "English · Latin", false], ["Hannah Jane", "Hebrew", false]]);
    expect(p.caption).toMatch(/^Baby girl names with the initials H & J\./);
  });
});
