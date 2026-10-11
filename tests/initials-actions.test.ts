import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRow, NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

// Posts by initials (017): the plan preview, Generate (create_initials_post; the pre-017 fallback), Add card, My names
// and the card's AI ideas on an initials post, and Rewrite caption. The AI is mocked at generateJson (Gemini).
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { planInitialsAction, createInitialsPostAction } = await import("@/lib/actions/initials");
const { addCardAction, rewriteCaptionAction } = await import("@/lib/actions/posts");
const { listSwapNamesAction, swapCardNameAction } = await import("@/lib/actions/swap-name");
const { cardNameIdeasAction } = await import("@/lib/actions/suggest");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "44444444-4444-4444-8444-444444444444";
const OLD_POST = "55555555-5555-4555-8555-555555555555";
const theme: ThemeRow = {
  id: THEME_ID, title: "Ocean Breeze", gender: "boy", backdrop: "sandy beach", outfit: "sailor romper", props: "tiny sailboat and seashells",
  lighting: "soft morning light", palette: "navy, white, sand", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
let seq = 0;
const nm = (name: string, o: Partial<NameRow> = {}): NameRow => ({
  id: `n-${name.replace(/\s/g, "")}`, name, meaning: `${name.toLowerCase()} kind meaning`, gender: "boy", style: "two-word", status: "available",
  post_id: null, position: null, created_at: `2026-10-0${1 + (seq++ % 9)}`, updated_at: "", ...o,
});
// 2 unused A·R names, 2 used before (Amos Rhett on an older post), 1 used on a girl, others with other initials.
const NAMES = () => [
  nm("Arlo Reed", { created_at: "2026-10-02" }), nm("Ansel Roan", { created_at: "2026-10-01" }),
  nm("Amos Rhett", { status: "used", post_id: OLD_POST }), nm("Abel Ross", { status: "used", post_id: "p-newer" }),
  nm("Ava Rose", { gender: "girl" }), nm("Milo James"), nm("Arlo", { style: "single" }), nm("Ari Rune", { status: "skip" }), nm("Axel Ryder", { status: "pending" }),
];
const settings = {
  id: 1, caption_template: "Lovely names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 3, max_images: 13, width: 1080, height: 1350, sound_on: true,
  caption_ai: true, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #babyboynames #momlife #newmom",
};
const MISSING_COL = { message: "Could not find the 'initials' column of 'posts' in the schema cache", code: "PGRST204" };
const MISSING_FN = { message: "Could not find the function public.create_initials_post(p) in the schema cache", code: "PGRST202" };

type World = {
  names?: NameRow[]; pre017?: boolean; post?: Record<string, unknown> | null; postCards?: Record<string, unknown>[]; card?: Record<string, unknown> | null;
  rpc?: Record<string, { data?: unknown; error?: { message: string; code?: string } }[]>; reusedCards?: { name: string; created_at: string }[];
};
function world(w: World = {}) {
  fake = fakeSupabase((q) => respond(q));
  const rpcCalls: Record<string, number> = {};
  respond = (q: Query) => {
    if (q.table.startsWith("rpc:")) {
      const fn = q.table.slice(4);
      const list = w.rpc?.[fn];
      const k = rpcCalls[fn] = (rpcCalls[fn] ?? 0) + 1;
      if (list) return list[Math.min(k, list.length) - 1];
      if (fn === "create_initials_post" || fn === "create_post") return { data: { status: "ok", post_id: POST_ID } };
      if (fn === "add_initials_card") return { data: { status: "ok", card_id: CARD_ID } };
      if (fn === "swap_initials_card_name") return { data: { status: "ok", mode: "restamp" } };
      return undefined;
    }
    if (q.table === "settings" && isUpdate(q)) return undefined;
    if (q.table === "settings") return { data: settings };
    if (q.table === "names" && op(q, "insert")) return { data: (op(q, "insert")![1] as { name: string }[]).map((r) => ({ id: `ins-${r.name}`, name: r.name })) };
    if (q.table === "names" && op(q, "maybeSingle")) return { data: w.names?.find((n) => n.id === op(q, "eq")![2]) ?? null };
    if (q.table === "names") return { data: w.names ?? NAMES() };
    if (q.table === "themes") return { data: op(q, "maybeSingle") || op(q, "single") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "posts" && op(q, "select")?.[1] === "initials") return w.pre017 ? { error: MISSING_COL } : { data: [] };
    if (q.table === "posts" && op(q, "in")) return { data: [{ id: OLD_POST, status: "posted", created_at: "2026-09-01T00:00:00Z" }, { id: "p-newer", status: "ready", created_at: "2026-10-05T00:00:00Z" }] };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts" && op(q, "limit")) return { data: [] }; // caption history
    if (q.table === "posts") return { data: w.post ?? null };
    if (q.table === "cards" && op(q, "is")) return { data: w.reusedCards ?? [] };
    if (q.table === "cards" && op(q, "insert")) return { data: [{ id: "cta" }] };
    if (q.table === "cards" && (op(q, "single") || op(q, "maybeSingle"))) return { data: w.card === undefined ? null : w.card };
    if (q.table === "cards") return { data: w.postCards ?? [] };
    return undefined;
  };
}
const base = { gender: "boy" as const, first: "A", second: "R", count: 6, postDate: "2026-10-11" };
const isNamesCall = (c: unknown[]) => /initials [A-Z] and [A-Z]: the first name/.test((c[0] as { prompt: string }).prompt);
// [name, card meaning, first name's meaning, middle name's meaning]
const combos = (...xs: [string, string, string, string][]) => ({ ok: true, data: xs.map(([name, meaning, part1_meaning, part2_meaning]) => ({ name, meaning, gender: "boy", part1_meaning, part2_meaning })) });
const ALARIC: [string, string, string, string] = ["Alaric Rhys", "ardor of the ruler", "ruler of all", "ardor"];
const ANSELM: [string, string, string, string] = ["Ambrose Rafe", "divine wolf of counsel", "immortal and divine", "wolf counsel"];
const ARI: [string, string, string, string] = ["Ari Raphael", "lion healed by god", "lion", "god heals"];
const ALDO: [string, string, string, string] = ["Aldo Remy", "old and wise oarsman", "old and wise", "oarsman"];
const MILO: [string, string, string, string] = ["Milo Rex", "soldier king", "soldier", "king"];
const combo = (c: [string, string, string, string]) => ({ name: c[0], meaning: c[1], parts: [c[2], c[3]] as [string, string] });
const rpc = (fn: string) => fake.rpcs.filter((r) => r.fn === fn).map((r) => r.args as Record<string, unknown>);
type Planned = { source: string; name: string; name_id: string | null; position: number };

beforeEach(() => { generateJson.mockReset(); world(); vi.spyOn(Math, "random").mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); });

describe("planInitialsAction (the preview)", () => {
  it("unused first, then ONE AI call for a few more than missing, then names used before (least recently used first)", async () => {
    generateJson.mockResolvedValueOnce(combos(ALARIC, ["arlo reed", "dup meaning", "x", "y"], ANSELM, MILO, ARI));
    const r = await planInitialsAction(base);
    expect(r.ok && r.names.map((n) => `${n.name} [${n.source}]`)).toEqual([
      "Ansel Roan [available]", "Arlo Reed [available]", "Alaric Rhys [new]", "Ambrose Rafe [new]", "Ari Raphael [new]", "Amos Rhett [used]",
    ]);
    expect(r.ok && r.summary).toBe("2 unused · 3 new AI · 1 reused");
    expect(r.ok && r.fresh.map((f) => f.name)).toEqual(["Alaric Rhys", "Ambrose Rafe", "Ari Raphael"]);
    expect(r.ok && r.names[2].parts).toEqual(["ruler of all", "ardor"]);
    expect(r.ok && [r.want, r.short, r.aiNote, r.reuse]).toEqual([6, 0, null, true]);
    expect(generateJson).toHaveBeenCalledTimes(1);
    const call = generateJson.mock.calls[0][0] as { prompt: string; system: string };
    expect(call.prompt).toMatch(/^Suggest 6 two-word baby boy names with the initials A and R: the first name starts with A and the middle name starts with R\./);
    // the AI never repeats a name it can see: every A·R name in the database, any status or gender
    expect(call.prompt).toContain("Arlo Reed, Ansel Roan, Amos Rhett, Abel Ross, Ava Rose, Ari Rune, Axel Ryder");
    expect(call.system).toContain("@unique_names");
    expect(fake.rpcs).toHaveLength(0);
    expect(fake.queries.some((q) => isUpdate(q) || op(q, "insert"))).toBe(false);
  });

  it("Unique Names: the prompt shows the page's style and its own part meanings; common names are out while uncommon ones suffice", async () => {
    world({ names: [...NAMES(), nm("Rafe", { style: "single", meaning: "wise wolf" }), nm("Silas Wren"), nm("Ezra Vale")] });
    generateJson.mockResolvedValueOnce(combos(["Aaron Ryan", "lofty king", "lofty", "little king"], ["Ambrose Rafe", "a divine and wise wolf", "immortal and divine", "wolf counsel"], ALARIC));
    const r = await planInitialsAction({ ...base, count: 4 });
    const prompt = (generateJson.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toMatch(/Match the style of the page's own two-word boy names, for example: .*Silas Wren.*Ezra Vale/);
    expect(prompt).toContain("Rafe = wise wolf");
    expect(r.ok && r.names.filter((n) => n.source === "new").map((n) => [n.name, n.parts])).toEqual([
      ["Ambrose Rafe", ["immortal and divine", "wise wolf"]], ["Alaric Rhys", ["ruler of all", "ardor"]],
    ]);
  });

  it("only common names offered: the owner's used names come first, the common AI names only after them", async () => {
    generateJson.mockResolvedValueOnce(combos(["Aaron Rhys", "lofty ardor", "lofty", "ardor"]));
    const r = await planInitialsAction({ ...base, count: 3 });
    expect(r.ok && r.names.map((n) => `${n.name} [${n.source}]`)).toEqual(["Ansel Roan [available]", "Arlo Reed [available]", "Amos Rhett [used]"]);
    generateJson.mockResolvedValueOnce(combos(["Aaron Rhys", "lofty ardor", "lofty", "ardor"]));
    const more = await planInitialsAction({ ...base, count: 5 });
    expect(more.ok && more.names.map((n) => `${n.name} [${n.source}]`)).toEqual([
      "Ansel Roan [available]", "Arlo Reed [available]", "Amos Rhett [used]", "Abel Ross [used]", "Aaron Rhys [new]",
    ]);
    expect(more.ok && more.fresh.map((f) => f.name)).toEqual(["Aaron Rhys"]);
  });

  it("stiff meanings get ONE corrective rewrite call; the rewrite is checked again (grounded + natural)", async () => {
    generateJson
      .mockResolvedValueOnce(combos(ALARIC, ["Armand Ravi", "army man sun", "army man", "sun"], ["Aldo Remy", "old wise oarsman", "old and wise", "oarsman"]))
      .mockResolvedValueOnce({ ok: true, data: [{ name: "Armand Ravi", meaning: "army man of the sun" }, { name: "Aldo Remy", meaning: "a brave old oarsman" }] });
    const r = await planInitialsAction({ ...base, count: 5 });
    expect(generateJson).toHaveBeenCalledTimes(2);
    const fix = (generateJson.mock.calls[1][0] as { prompt: string }).prompt;
    expect(fix).toContain('- Armand Ravi (army man / sun): "army man sun"');
    expect(fix).toContain('- Aldo Remy (old and wise / oarsman): "old wise oarsman"');
    // "brave" is in neither part: the rewrite of Aldo Remy is still refused
    expect(r.ok && r.names.filter((n) => n.source === "new").map((n) => `${n.name} — ${n.meaning}`)).toEqual(["Alaric Rhys — ardor of the ruler", "Armand Ravi — army man of the sun"]);
  });

  it("no AI call when the unused names cover the post", async () => {
    world({ names: [...NAMES(), nm("Atlas Rome")] });
    const r = await planInitialsAction({ ...base, count: 3 });
    expect(r.ok && r.summary).toBe("3 unused · 0 new AI · 0 reused");
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("an AI failure falls back to the unused and used names and says so; short when even those run out", async () => {
    generateJson.mockResolvedValue({ ok: false, error: "The AI is busy" });
    const r = await planInitialsAction(base);
    expect(r.ok && r.names.map((n) => n.source)).toEqual(["available", "available", "used", "used"]);
    expect(r.ok && r.short).toBe(2);
    expect(r.ok && r.aiNote).toBe("The AI is busy. Using your unused and earlier names instead.");
  });

  it("Shuffle: skipped names are never offered again; kept names are re-checked and reused without asking more", async () => {
    generateJson.mockResolvedValueOnce(combos(ALARIC, ANSELM, ARI, ALDO));
    const r = await planInitialsAction({ ...base, skip: ["Alaric Rhys"] });
    expect(r.ok && r.fresh.map((f) => f.name)).toEqual(["Ambrose Rafe", "Ari Raphael", "Aldo Remy"]);
    expect((generateJson.mock.calls[0][0] as { prompt: string }).prompt).toContain("Alaric Rhys");
    generateJson.mockClear();
    const kept = await planInitialsAction({ ...base, count: 5, keep: [combo(ANSELM), { name: "Arlo Reed", meaning: "taken name", parts: ["x", "y"] }, combo(ALARIC), combo(ALDO), { name: "Ari Raphael", meaning: "brave fox", parts: ["lion", "god heals"] }] });
    // kept again: still new and grounded ("brave fox" is not in "lion" / "god heals")
    expect(kept.ok && kept.fresh.map((f) => f.name)).toEqual(["Ambrose Rafe", "Alaric Rhys", "Aldo Remy"]);
    expect(kept.ok && kept.counts).toEqual({ available: 2, new: 3, used: 0 });
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("before 017 the preview reuses nothing (and says so)", async () => {
    world({ pre017: true });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    const r = await planInitialsAction(base);
    expect(r.ok && [r.reuse, r.counts.used, r.aiNote]).toEqual([false, 0, "down. Using your unused names instead."]);
  });

  it("rejects bad input before any database call", async () => {
    for (const bad of [{ first: "a" }, { second: "RR" }, { gender: "cat" }, { count: 2.5 }, { postDate: "11/10" }, { skip: Array(200).fill("x") }, { keep: [{ name: 1 }] }]) {
      expect((await planInitialsAction({ ...base, ...bad } as never)).ok).toBe(false);
    }
    expect(fake.queries).toHaveLength(0);
    expect((await planInitialsAction({ ...base, count: 40 }))).toEqual({ ok: false, error: "Number of cards must be 3 to 13." });
  });
});

describe("createInitialsPostAction (Generate)", () => {
  const input = { ...base, themeId: THEME_ID, requestId: REQ, fresh: [combo(ALARIC), combo(ANSELM)] };
  const captionCall = () => generateJson.mock.calls.find((c) => !isNamesCall(c))?.[0] as { prompt: string } | undefined;

  it("re-plans with fresh reads (no AI names call) and makes it in one create_initials_post with sources, initials and caption", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Sea breezes for baby boy names with the initials A & R.", tags: ["#seasidebaby"] } });
    expect(await createInitialsPostAction(input)).toEqual({ ok: true, postId: POST_ID, cards: 6, short: 0 });
    expect(generateJson.mock.calls.some(isNamesCall)).toBe(false);
    const [args] = rpc("create_initials_post");
    const p = args.p as { initials: string; cards: Planned[]; caption: string; caption_style: string; hashtag_set: string; request_id: string; subject_age: string };
    expect(p.initials).toBe("AR");
    expect(p.request_id).toBe(REQ);
    expect(p.cards.map((c) => [c.position, c.source, c.name, c.name_id])).toEqual([
      [1, "available", "Ansel Roan", "n-AnselRoan"], [2, "available", "Arlo Reed", "n-ArloReed"], [3, "new", "Alaric Rhys", null], [4, "new", "Ambrose Rafe", null],
      [5, "used", "Amos Rhett", "n-AmosRhett"], [6, "used", "Abel Ross", "n-AbelRoss"],
    ]);
    expect(captionCall()!.prompt).toContain("Followers asked for names with the initials A and R");
    expect(p.caption).toMatch(/^Sea breezes for baby boy names with the initials A & R\.\n\n#uniquenames /);
    expect(p.hashtag_set.split(" ").length).toBeLessThanOrEqual(4);
    expect(p.subject_age).toBe("random");
  });

  it("a name used before by a card of a later post is less recently used: the older one first", async () => {
    world({ reusedCards: [{ name: "Amos Rhett", created_at: "2026-10-09T00:00:00Z" }] });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    await createInitialsPostAction({ ...input, fresh: [] });
    const p = rpc("create_initials_post")[0].p as { cards: Planned[]; caption: string };
    expect(p.cards.filter((c) => c.source === "used").map((c) => c.name)).toEqual(["Abel Ross", "Amos Rhett"]);
    expect(p.caption).toMatch(/^Baby boy names with the initials A & R\. Lovely names for your baby boy\./);
  });

  it("a conflict re-plans once; a fresh name now in the database is dropped (falls back to used)", async () => {
    world({ rpc: { create_initials_post: [{ data: { status: "conflict", reason: "names" } }, { data: { status: "ok", post_id: POST_ID } }] } });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    const r = await createInitialsPostAction({ ...input, fresh: [{ name: "Arlo Reed", meaning: "now a real name row" }] });
    expect(r).toEqual({ ok: true, postId: POST_ID, cards: 4, short: 2 });
    expect(rpc("create_initials_post")).toHaveLength(2);
  });

  it("before 017: fresh names are added as unused names, then create_post (no names used before, no label)", async () => {
    world({ pre017: true });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    expect(await createInitialsPostAction(input)).toEqual({ ok: true, postId: POST_ID, cards: 4, short: 2 });
    expect(rpc("create_initials_post")).toHaveLength(0);
    const ins = fake.queries.find((q) => q.table === "names" && op(q, "insert"))!;
    expect((op(ins, "insert")![1] as { name: string; status: string }[]).map((r) => [r.name, r.status])).toEqual([["Alaric Rhys", "available"], ["Ambrose Rafe", "available"]]);
    const p = rpc("create_post")[0].p as { style: string; cards: { name: string; name_id: string }[] };
    expect(p.style).toBe("two-word");
    expect(p.cards.map((c) => c.name_id)).toEqual(["n-AnselRoan", "n-ArloReed", "ins-Alaric Rhys", "ins-Ambrose Rafe"]);
  });

  it("017 functions missing although the column exists: falls back the same way", async () => {
    world({ rpc: { create_initials_post: [{ error: MISSING_FN }] } });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    expect((await createInitialsPostAction(input)).ok).toBe(true);
    expect(rpc("create_post")).toHaveLength(1);
  });

  it("nothing at all with those initials: a clear failure, no write", async () => {
    world({ names: [nm("Milo James")] });
    const r = await createInitialsPostAction({ ...input, first: "Q", second: "X", fresh: [] });
    expect(r).toEqual({ ok: false, error: "No boy names with the initials Q·X are left. Preview again to ask the AI for new ones." });
    expect(fake.rpcs).toHaveLength(0);
  });

  it("validates before any database call", async () => {
    expect((await createInitialsPostAction({ ...input, requestId: "x" })).ok).toBe(false);
    expect((await createInitialsPostAction({ ...input, second: "" })).ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });
});

describe("an initials post after it is made", () => {
  const POST = { id: POST_ID, gender: "boy", style: "two-word", theme_id: THEME_ID, post_date: "2026-10-11", subject_age: "random", caption: "Old.\n\n#uniquenames", initials: "AR", status: "ready" };
  const onPost = [{ name_id: "n-AnselRoan", position: 1, shot: null, name: "Ansel Roan", kind: "post" }, { name_id: null, position: 2, shot: null, name: "Amos Rhett", kind: "post" }];

  it("Add card takes the next unused A·R name, never one on the post (add_initials_card)", async () => {
    world({ post: POST, postCards: onPost });
    expect(await addCardAction(POST_ID)).toEqual({ ok: true, cardId: CARD_ID });
    const c = rpc("add_initials_card")[0].c as { name: string; name_id: string; source: string; position: number };
    expect([c.name, c.name_id, c.source, c.position]).toEqual(["Arlo Reed", "n-ArloReed", "available", 3]);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("Add card with no unused left asks the AI for one; when it fails, a name used before (not one on the post)", async () => {
    world({ post: POST, postCards: [...onPost, { name_id: "n-ArloReed", position: 3, shot: null, name: "Arlo Reed", kind: "post" }] });
    generateJson.mockResolvedValueOnce(combos(ALARIC));
    await addCardAction(POST_ID);
    expect(rpc("add_initials_card")[0].c).toMatchObject({ name: "Alaric Rhys", name_id: null, source: "new" });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    await addCardAction(POST_ID);
    expect(rpc("add_initials_card")[1].c).toMatchObject({ name: "Abel Ross", name_id: "n-AbelRoss", source: "used" });
  });

  it("My names lists unused A·R names first, then those used before (labelled), none already on the post", async () => {
    world({ post: POST, postCards: onPost, card: { id: CARD_ID, post_id: POST_ID, kind: "post", name_id: "n-AnselRoan", name: "Ansel Roan" } });
    const r = await listSwapNamesAction(CARD_ID);
    expect(r.ok && r.names.map((n) => [n.name, !!n.usedBefore])).toEqual([["Arlo Reed", false], ["Abel Ross", true]]);
    const q = await listSwapNamesAction(CARD_ID, { q: "ross" });
    expect(q.ok && q.names.map((n) => n.name)).toEqual(["Abel Ross"]);
  });

  it("My names puts a used name on the card through swap_initials_card_name; other initials are refused", async () => {
    const names = NAMES();
    world({ post: POST, postCards: onPost, names, card: { id: CARD_ID, post_id: POST_ID, kind: "post", name_id: "n-AnselRoan", name: "Ansel Roan", version: 2, seed: 5, status: "done", photo_path: "p" } });
    expect(await swapCardNameAction(CARD_ID, "n-AbelRoss" as string, "breath of the headland")).toEqual({ ok: false, error: "Pick a name from the list." });
    const id = "66666666-6666-4666-8666-666666666666";
    names.push(nm("Abel Ryan", { id, status: "used", post_id: OLD_POST }));
    expect(await swapCardNameAction(CARD_ID, id, "Breath Of The King")).toEqual({ ok: true, mode: "restamp" });
    expect(rpc("swap_initials_card_name")[0]).toMatchObject({ p_card: CARD_ID, p_name: id, p_version: 2, p_meaning: "breath of the king", p_mode: "restamp" });
    const other = "77777777-7777-4777-8777-777777777777";
    names.push(nm("Milo Ross", { id: other }));
    expect(await swapCardNameAction(CARD_ID, other, "m")).toEqual({ ok: false, error: "This post's names have the initials A·R. Pick a name with those initials." });
  });

  it("the card's AI ideas keep the initials", async () => {
    world({ post: POST, card: { id: CARD_ID, post_id: POST_ID, theme_id: THEME_ID, kind: "post" } });
    generateJson.mockResolvedValueOnce(combos(ALARIC, MILO));
    expect(await cardNameIdeasAction(CARD_ID)).toEqual({ ok: true, ideas: [{ name: "Alaric Rhys", meaning: "ardor of the ruler" }] });
  });

  it("Rewrite caption keeps saying the initials", async () => {
    world({ post: POST, postCards: [{ name: "Ansel Roan", meaning: "m", position: 1, kind: "post" }] });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Little sailors: baby boy names with the initials A & R.", tags: [] } });
    expect((await rewriteCaptionAction(POST_ID)).ok).toBe(true);
    expect((generateJson.mock.calls[0][0] as { prompt: string }).prompt).toContain("initials A and R");
  });
});
