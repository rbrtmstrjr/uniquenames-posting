import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, type Query, type Respond } from "./helpers/fake-supabase";

// Today's 3 best names first (spec 2026-11-21): one call to the app's AI, alongside the caption, checked in code, with
// today's order kept on any failure. The AI is mocked at the Gemini boundary (AI_PROVIDER unset).
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { RANK_SYSTEM, RANK_TIMEOUT_MS, bestFirstOn, bestFirstOrder, parseRanking, rankNames, rankPrompt } = await import("@/lib/ai/rank-names");
const { createPostCore } = await import("@/lib/posts/create");

type Call = { system: string; prompt: string; timeoutMs?: number };
const calls = () => generateJson.mock.calls.map((c) => c[0] as Call);
const rankCalls = () => calls().filter((c) => c.system === RANK_SYSTEM);

const names = [{ name: "Ruth", meaning: "friend" }, { name: "Naomi", meaning: "pleasant" }, { name: "Leah", meaning: "weary" }, { name: "Eden", meaning: "delight" }];

beforeEach(() => { generateJson.mockReset(); delete process.env.AI_PROVIDER; });

describe("checking the AI's answer", () => {
  it("only the post's own names, each once, at least 3 (or all of a shorter list); the first 3 are kept", () => {
    expect(parseRanking({ best: ["Eden", " ruth ", "Naomi"] }, names)).toEqual([3, 0, 1]);
    expect(parseRanking({ best: ["Eden", "Ruth", "Naomi", "Leah"] }, names)).toEqual([3, 0, 1]);
    expect(parseRanking({ best: ["Eden", "Zara", "Naomi"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Eden", "Eden", "Naomi"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Eden", "Ruth"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Leah", "Ruth"] }, names.slice(0, 2))).toBeNull();
    expect(parseRanking({ best: ["Naomi", "Ruth"] }, names.slice(0, 2))).toEqual([1, 0]);
    expect(parseRanking({ best: [3, "Ruth", "Naomi"] }, names)).toBeNull();
    expect(parseRanking({ best: "Ruth" }, names)).toBeNull();
    expect(parseRanking(null, names)).toBeNull();
  });

  it("only the first 3 entries are checked: a valid top 3 followed by anything is accepted, a bad one within the top 3 is not", () => {
    expect(parseRanking({ best: ["Eden", "Ruth", "Naomi", "Zara"] }, names)).toEqual([3, 0, 1]);
    expect(parseRanking({ best: ["Eden", "Ruth", "Naomi", 7, "Eden"] }, names)).toEqual([3, 0, 1]);
    expect(parseRanking({ best: ["Eden", "Zara", "Naomi", "Leah"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Eden", "Ruth", "Eden", "Leah"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Eden", "Ruth", 5, "Leah"] }, names)).toBeNull();
  });

  it("the full order: the top names first, then the others in today's order", () => {
    expect(bestFirstOrder([3, 0, 1], 4)).toEqual([3, 0, 1, 2]);
    expect(bestFirstOrder([2, 5], 6)).toEqual([2, 5, 0, 1, 3, 4]);
    expect(bestFirstOrder([], 3)).toEqual([0, 1, 2]);
  });

  it("the prompt lists the post's names with their meanings", () => {
    expect(rankPrompt({ gender: "girl", names })).toBe("Baby girl names for one post (name: meaning):\n- Ruth: friend\n- Naomi: pleasant\n- Leah: weary\n- Eden: delight\nPick the 3 best.");
    expect(RANK_SYSTEM).toMatch(/pretty, meaningful, easy to say and special/);
  });

  it("comes with the front card: once 023 has run (switch on or off), on a pack with front-card wording", () => {
    expect(bestFirstOn({ cover_enabled: true })).toBe(true);
    expect(bestFirstOn({ cover_enabled: false })).toBe(true);
    expect(bestFirstOn({})).toBe(false);
    expect(bestFirstOn(null)).toBe(false);
    const saved = process.env.NICHE;
    process.env.NICHE = "name-nest";
    try { expect(bestFirstOn({ cover_enabled: true })).toBe(false); } finally {
      if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved;
    }
  });
});

describe("rankNames", () => {
  it("asks the app's AI once and returns the post's top 3 as indexes, best first", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { best: ["Eden", "ruth", "Naomi"] } });
    expect(await rankNames({ gender: "girl", names })).toEqual([3, 0, 1]);
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(calls()[0]).toMatchObject({ system: RANK_SYSTEM, prompt: rankPrompt({ gender: "girl", names }), timeoutMs: RANK_TIMEOUT_MS });
  });

  it("an AI failure, a bad answer, a thrown error or a late answer is null (never throws)", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    generateJson.mockResolvedValueOnce({ ok: true, data: { best: ["Ruth", "Zara", "Eden"] } });
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    generateJson.mockRejectedValueOnce(new Error("boom"));
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    generateJson.mockImplementationOnce(() => new Promise((res) => setTimeout(() => res({ ok: true, data: { best: ["Ruth", "Naomi", "Eden"] } }), 300)));
    expect(await rankNames({ gender: "girl", names }, 50)).toBeNull();
  });

  it("something throwing synchronously inside is null too (never throws)", async () => {
    generateJson.mockImplementationOnce(() => { throw new Error("sync boom"); });
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    expect(await rankNames({ gender: "girl", names: null as never })).toBeNull();
  });

  it("one name: nothing to rank, no call", async () => {
    expect(await rankNames({ gender: "girl", names: names.slice(0, 1) })).toBeNull();
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("createPostCore on Today", () => {
  const THEME_ID = "22222222-2222-4222-8222-222222222222";
  const POST_ID = "33333333-3333-4333-8333-333333333333";
  const REQ = "44444444-4444-4444-8444-444444444444";
  const theme: ThemeRow = {
    id: THEME_ID, title: "Olive Grove", gender: "girl", backdrop: "olive trees", outfit: "linen dress", props: "olive branch and a clay jar",
    lighting: "soft light", palette: "olive, cream", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
  };
  const nm = (name: string): NameRow => ({ id: `n-${name}`, name, meaning: `${name.toLowerCase()} meaning`, gender: "girl", style: "single", status: "available",
    post_id: null, position: null, created_at: "", updated_at: "" });
  const NAMES = ["Abigail", "Hannah", "Naomi", "Ruth", "Esther", "Miriam", "Leah", "Rachel", "Sarah", "Deborah", "Eden", "Lydia"].map(nm);
  // 023 has run (cover_enabled is there), the front card is off and AI captions are off: only the ranking asks the AI.
  const settings = { id: 1, caption_template: "Lovely names.", hashtags: "", handle: "@unique_names", min_images: 9, max_images: 9, width: 1080, height: 1080,
    sound_on: true, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", caption_ai: false, cta_enabled: false, cover_enabled: false };
  let settingsRow: Record<string, unknown> = settings;
  type Planned = { position: number; name: string; name_id: string; shot: string; prompt: string; seed: number };
  const planned = () => (fake.rpcs.filter((r) => r.fn === "create_post").at(-1)!.args as { p: { cards: Planned[] } }).p.cards;
  const make = (o: Record<string, unknown> = {}) => createPostCore(fake.client as never,
    { gender: "girl", style: "single", count: null, postDate: "2026-11-22", requestId: REQ, subjectAge: "random", ...o });
  const rankWith = (best: unknown) => generateJson.mockImplementation(async (i: Call) => (i.system === RANK_SYSTEM ? { ok: true, data: { best } } : { ok: false, error: "off" }));
  const fresh = () => {
    fake = fakeSupabase((q) => respond(q));
    respond = (q: Query) => {
      if (q.table === "settings") return { data: settingsRow };
      if (q.table === "names") return { data: NAMES };
      if (q.table === "themes") return { data: [theme] };
      if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
      if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
      if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
      if (q.table === "posts") return { data: [] };
      return undefined;
    };
  };
  const todaysOrder = async () => {
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    fresh();
    await make();
    generateJson.mockReset();
    return planned();
  };
  beforeEach(() => { settingsRow = settings; fresh(); });

  it("the AI's top 3 come first, the rest keep today's order; every position keeps its photo plan", async () => {
    const today = await todaysOrder();
    expect(today).toHaveLength(9);
    fresh();
    rankWith([today[5].name, today[2].name.toUpperCase(), ` ${today[7].name} `]);
    expect(await make()).toEqual({ ok: true, postId: POST_ID });
    const ranked = planned();
    const rest = today.filter((_, k) => ![5, 2, 7].includes(k));
    expect(ranked.map((c) => c.name)).toEqual([today[5], today[2], today[7], ...rest].map((c) => c.name));
    expect(ranked.map((c) => c.name_id)).toEqual([today[5], today[2], today[7], ...rest].map((c) => c.name_id));
    expect(ranked.map((c) => [c.position, c.shot, c.prompt, c.seed])).toEqual(today.map((c) => [c.position, c.shot, c.prompt, c.seed]));
    expect(rankCalls()).toHaveLength(1);
    expect(rankCalls()[0].prompt).toContain(`- ${today[0].name}: ${today[0].name.toLowerCase()} meaning`);
    expect(rankCalls()[0].timeoutMs).toBeLessThanOrEqual(RANK_TIMEOUT_MS);
  });

  it("keeps today's order on an AI failure or a bad answer (unknown or repeated names, too few)", async () => {
    const today = (await todaysOrder()).map((c) => c.name);
    for (const bad of [["Nobody", today[1], today[2]], [today[1], today[1], today[2]], [today[1]], "Hannah"]) {
      fresh();
      rankWith(bad);
      expect((await make()).ok).toBe(true);
      expect(planned().map((c) => c.name)).toEqual(today);
    }
  });

  it("no ranking call for Autopilot's chosen names (already ranked) or before migration 023", async () => {
    rankWith(["Ruth", "Naomi", "Leah"]);
    expect((await make({ nameIds: NAMES.slice(0, 9).map((n) => n.id) })).ok).toBe(true);
    expect(rankCalls()).toHaveLength(0);
    const { cover_enabled: _c, ...before023 } = settings;
    void _c;
    settingsRow = before023;
    fresh();
    expect((await make()).ok).toBe(true);
    expect(rankCalls()).toHaveLength(0);
  });

  it("runs alongside the caption: both calls are out before either answers", async () => {
    settingsRow = { ...settings, caption_ai: true };
    fresh();
    const pending: (() => void)[] = [];
    let hold = true;
    generateJson.mockImplementation((i: Call) => {
      const answer = i.system === RANK_SYSTEM ? { ok: true, data: { best: ["Ruth", "Naomi", "Leah"] } } : { ok: false, error: "down" };
      return hold ? new Promise((res) => pending.push(() => res(answer))) : Promise.resolve(answer);
    });
    const made = make();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    hold = false;
    for (const go of pending) go();
    expect((await made).ok).toBe(true);
    expect(rankCalls()).toHaveLength(1);
  });
});
