import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRow, NameRow, PostRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { listSwapNamesAction, swapCardNameAction } = await import("@/lib/actions/swap-name");

const CARD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const POST = "33333333-3333-4333-8333-333333333333";
const card: CardRow = {
  id: CARD, post_id: POST, theme_id: "t1", kind: "post", position: 2, name_id: "old-name", name: "Arlo", meaning: "strong",
  shot: "s", prompt: "p", seed: 12345, status: "done", error: null, photo_path: "photos/x/v3.jpg", card_path: "cards/x/v3.jpg", version: 3,
  selected: true, order_index: 2, queued_at: "", claimed_at: null, started_at: null, finished_at: null, attempts: 1, created_at: "", updated_at: "",
};
const post = { id: POST, gender: "boy", style: "single", status: "ready", letter: null } as unknown as PostRow;
const name = (over: Partial<NameRow> = {}): NameRow => ({
  id: NEW, name: "Cyrus", meaning: "sun", gender: "boy", style: "single", status: "available", post_id: null, position: null,
  created_at: "", updated_at: "", ...over,
});
const workerRow = (h: "ready" | "offline") => ({ id: 1, last_seen: new Date(Date.now() - (h === "offline" ? 600_000 : 3_000)).toISOString(), comfyui_ok: true });

type World = {
  card?: CardRow | null; post?: Partial<PostRow> | null; name?: NameRow | null; names?: Partial<NameRow>[]; postCards?: { name_id: string | null }[];
  rpc?: { data?: unknown; error?: { message: string; code?: string } }; health?: "ready" | "offline";
  nameClaim?: boolean; cardUpdate?: boolean; otherUsers?: boolean;
};
function world(w: World = {}) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "worker_status") return { data: workerRow(w.health ?? "ready") };
    if (q.table === "rpc:swap_card_name") return w.rpc ?? { data: { status: "ok", mode: "restamp" } };
    if (q.table === "posts") return { data: w.post === undefined ? post : w.post };
    if (q.table === "cards" && isUpdate(q)) return { data: w.cardUpdate === false ? [] : [{ id: CARD }] };
    if (q.table === "cards" && op(q, "eq")?.[1] === "post_id") return { data: w.postCards ?? [{ name_id: "old-name" }, { name_id: "n-other" }] };
    if (q.table === "cards" && op(q, "eq")?.[1] === "name_id") return { data: w.otherUsers ? [{ id: "x" }] : [] };
    if (q.table === "cards") return { data: w.card === undefined ? card : w.card };
    if (q.table === "names" && isUpdate(q)) return { data: w.nameClaim === false && (op(q, "update")![1] as { status: string }).status !== "available" ? [] : [{ id: NEW }] };
    if (q.table === "names" && op(q, "maybeSingle")) return { data: w.name === undefined ? name() : w.name };
    if (q.table === "names") return { data: w.names ?? [] };
    return undefined;
  };
}
const nameList = () => fake.queries.find((q) => q.table === "names" && !op(q, "maybeSingle"))!;
const has = (q: Query, ...o: unknown[]) => q.ops.some((x) => JSON.stringify(x) === JSON.stringify(o));

beforeEach(() => world());
afterEach(() => { delete process.env.NICHE; });

describe("listSwapNamesAction: the names that fit the card's post", () => {
  it("available names of the post's gender and style, never one already on the post, oldest first", async () => {
    world({ names: [{ id: "a", name: "Cyrus", meaning: "sun" }] });
    const r = await listSwapNamesAction(CARD);
    expect(r).toEqual({ ok: true, names: [{ id: "a", name: "Cyrus", meaning: "sun", detail: null }], next: null });
    const q = nameList();
    expect(has(q, "eq", "gender", "boy")).toBe(true);
    expect(has(q, "eq", "style", "single")).toBe(true);
    expect(has(q, "eq", "status", "available")).toBe(true);
    expect(has(q, "not", "id", "in", "(old-name,n-other)")).toBe(true);
    expect(q.ops.filter((o) => o[0] === "order").map((o) => o[1])).toEqual(["created_at", "id"]);
    expect(q.ops.some((o) => o[0] === "ilike")).toBe(false);
    expect(has(q, "range", 0, 20)).toBe(true);
  });

  it("a post by letter: only names starting with its letter", async () => {
    world({ post: { ...post, letter: "K" } });
    await listSwapNamesAction(CARD);
    expect(has(nameList(), "ilike", "name", "K%")).toBe(true);
  });

  it("a two-word girl post asks for two-word girl names", async () => {
    world({ post: { ...post, gender: "girl", style: "two-word" } });
    await listSwapNamesAction(CARD);
    expect(has(nameList(), "eq", "gender", "girl")).toBe(true);
    expect(has(nameList(), "eq", "style", "two-word")).toBe(true);
  });

  it("search filters by name or meaning on the server, with PostgREST syntax stripped", async () => {
    await listSwapNamesAction(CARD, { q: '  Ar,(lo)"%  ' });
    expect(has(nameList(), "or", 'name.ilike."%Ar lo%",meaning.ilike."%Ar lo%"')).toBe(true);
  });

  it("pages 20 at a time: 21 rows means there is more, from the cursor on", async () => {
    world({ names: Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, meaning: "m" })) });
    const r = await listSwapNamesAction(CARD, { cursor: 40 });
    expect(has(nameList(), "range", 40, 60)).toBe(true);
    expect(r.ok && r.names).toHaveLength(20);
    expect(r.ok && r.next).toBe(60);
  });

  it("Name Nest: best US rank first, with the '#rank · origin' line", async () => {
    process.env.NICHE = "name-nest";
    world({ names: [{ id: "a", name: "Olivia", meaning: "olive tree", us_rank: 1, us_year: 2024, origin: "Latin" }] });
    const r = await listSwapNamesAction(CARD);
    expect(r.ok && r.names[0].detail).toBe("#1 in the US (2024) · Latin");
    const orders = nameList().ops.filter((o) => o[0] === "order");
    expect(orders[0]).toEqual(["order", "us_rank", { ascending: true, nullsFirst: false }]);
    expect(orders.map((o) => o[1])).toEqual(["us_rank", "created_at", "id"]);
  });

  it("bad input and cards that take no name", async () => {
    expect(await listSwapNamesAction("nope")).toEqual({ ok: false, error: "Card not found." });
    expect((await listSwapNamesAction(CARD, { cursor: -1 })).ok).toBe(false);
    expect((await listSwapNamesAction(CARD, { q: "x".repeat(61) })).ok).toBe(false);
    world({ card: { ...card, kind: "cta" } });
    expect((await listSwapNamesAction(CARD)).ok).toBe(false);
    world({ card: null });
    expect(await listSwapNamesAction(CARD)).toEqual({ ok: false, error: "Card not found." });
  });
});

describe("swapCardNameAction: Save text with a name from the Names page", () => {
  it("one swap_card_name call: restamp (photo kept), the version guard, a fresh seed, the cleaned meaning", async () => {
    const r = await swapCardNameAction(CARD, NEW, "  Bright SUN ");
    expect(r).toEqual({ ok: true, mode: "restamp" });
    expect(fake.rpcs).toHaveLength(1);
    const args = fake.rpcs[0].args as Record<string, unknown>;
    expect(args).toMatchObject({ p_card: CARD, p_name: NEW, p_version: 3, p_meaning: "bright sun", p_mode: "restamp" });
    expect(args.p_seed).not.toBe(card.seed);
    expect(fake.queries.some(isUpdate)).toBe(false);
  });

  it("New picture with the chosen name regenerates; that needs the PC", async () => {
    expect(await swapCardNameAction(CARD, NEW, "sun", { newPicture: true })).toEqual({ ok: true, mode: "regenerate" });
    expect((fake.rpcs[0].args as { p_mode: string }).p_mode).toBe("regenerate");
    world({ health: "offline" });
    const r = await swapCardNameAction(CARD, NEW, "sun", { newPicture: true });
    expect(r.ok).toBe(false);
    expect(fake.rpcs).toHaveLength(0);
  });

  it("a card without a clean photo is remade (regenerate), like a typed name", async () => {
    world({ card: { ...card, photo_path: null } });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: true, mode: "regenerate" });
  });

  it("race: the name was just used -> a friendly error", async () => {
    world({ rpc: { data: { status: "taken" } } });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: false, error: "That name was just used — pick another." });
    world({ name: name({ status: "reserved" }) });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: false, error: "That name was just used — pick another." });
    expect(fake.rpcs).toHaveLength(0);
  });

  it("a second tap after it saved (the name is already this card's) is ok and writes nothing", async () => {
    world({ card: { ...card, name_id: NEW, status: "restamp" }, name: name({ status: "reserved", post_id: POST }) });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: true, mode: "restamp" });
    expect(fake.rpcs).toHaveLength(0);
  });

  it("stale card, busy card, wrong fit, wrong letter, bad meaning", async () => {
    world({ rpc: { data: { status: "stale" } } });
    expect((await swapCardNameAction(CARD, NEW, "sun")).ok).toBe(false);
    world({ card: { ...card, status: "generating" } });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: false, error: "This card is being made right now. Wait for it to finish." });
    world({ name: name({ gender: "girl" }) });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: false, error: "That name is for another kind of post (boy / girl or name style). Pick another." });
    world({ post: { ...post, letter: "K" } });
    expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: false, error: "This post's names start with K. Pick a K name." });
    expect(await swapCardNameAction(CARD, NEW, "  ")).toEqual({ ok: false, error: "Type the meaning." });
    expect(await swapCardNameAction(CARD, "bad", "sun")).toEqual({ ok: false, error: "Pick a name from the list." });
    expect(fake.rpcs).toHaveLength(0);
  });

  describe("before migration 016 (no swap_card_name): a guarded multi-step swap", () => {
    const missing = { error: { message: "Could not find the function public.swap_card_name(...) in the schema cache", code: "PGRST202" } };
    const updates = (t: string) => fake.queries.filter((q) => q.table === t && isUpdate(q));
    const patch = (q: Query) => op(q, "update")![1] as Record<string, unknown>;

    it("claims the new name (only while available), updates the card version-guarded, then frees the old name", async () => {
      world({ rpc: missing });
      expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: true, mode: "restamp" });
      const [claim, release] = updates("names");
      expect(patch(claim)).toEqual({ status: "reserved", post_id: POST, position: 2, meaning: "sun" });
      expect(has(claim, "eq", "status", "available")).toBe(true);
      const [c] = updates("cards");
      expect(patch(c)).toMatchObject({ name: "Cyrus", meaning: "sun", name_id: NEW, status: "restamp", version: 4 });
      expect(has(c, "eq", "version", 3)).toBe(true);
      expect(patch(release)).toEqual({ status: "available", post_id: null, position: null });
      expect(has(release, "eq", "id", "old-name")).toBe(true);
    });

    it("a posted post marks the new name used", async () => {
      world({ rpc: missing, post: { ...post, status: "posted" } });
      await swapCardNameAction(CARD, NEW, "sun");
      expect(patch(updates("names")[0]).status).toBe("used");
    });

    it("taken meanwhile: nothing else is written", async () => {
      world({ rpc: missing, nameClaim: false });
      expect(await swapCardNameAction(CARD, NEW, "sun")).toEqual({ ok: false, error: "That name was just used — pick another." });
      expect(updates("cards")).toHaveLength(0);
    });

    it("the card changed meanwhile: the new name is given back", async () => {
      world({ rpc: missing, cardUpdate: false });
      expect((await swapCardNameAction(CARD, NEW, "sun")).ok).toBe(false);
      const [, giveBack] = updates("names");
      expect(patch(giveBack)).toEqual({ status: "available", post_id: null, position: null, meaning: "sun" });
      expect(has(giveBack, "eq", "id", NEW)).toBe(true);
    });

    it("the old name is kept when another card still uses it", async () => {
      world({ rpc: missing, otherUsers: true });
      await swapCardNameAction(CARD, NEW, "sun");
      expect(updates("names")).toHaveLength(1);
    });
  });
});
