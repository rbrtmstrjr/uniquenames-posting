import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";
import { planPost } from "@/lib/planner";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createPostCore } = await import("@/lib/posts/create");
const { remakeCard } = await import("@/lib/cards/remake");
const { publishPost } = await import("@/lib/facebook/publish");

const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const theme: ThemeRow = {
  id: THEME_ID, title: "Olive Grove", gender: "girl", backdrop: "olive trees", outfit: "linen dress", props: "olive branch and a clay jar",
  lighting: "soft light", palette: "olive, cream", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const nm = (name: string): NameRow => ({ id: `n-${name}`, name, meaning: "god is gracious", gender: "girl", style: "single", status: "available", post_id: null, position: null, created_at: "", updated_at: "" });
const names = ["Abigail", "Hannah", "Naomi", "Ruth", "Esther", "Miriam", "Leah", "Rachel", "Sarah", "Deborah", "Eden", "Lydia"].map(nm);
const settings = { id: 1, caption_template: "Lovely names.", hashtags: "", handle: "@unique_names", min_images: 6, max_images: 26, width: 1080, height: 1080, sound_on: true,
  hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", caption_ai: true, cta_enabled: false };

beforeEach(() => {
  generateJson.mockReset();
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: names };
    if (q.table === "themes") return { data: op(q, "single") || op(q, "maybeSingle") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts") return { data: [] };
    if (q.table === "cards" && isUpdate(q)) return { data: [{ id: "c1" }] };
    return undefined;
  };
});
afterEach(() => vi.restoreAllMocks());

describe("planPost with chosen names", () => {
  it("uses exactly those names", () => {
    const ids = names.slice(0, 9).map((n) => n.id);
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", age: "random", nameIds: ids }, names, themes: [theme], settings });
    expect(r.ok && r.cards.map((c) => c.name_id).sort()).toEqual([...ids].sort());
  });
  it("keeps the chosen names in their order (Autopilot sends the best first): card 1 is the first name", () => {
    const ids = [names[5], names[0], names[9], names[2], names[7], names[1], names[3], names[4], names[6]].map((n) => n.id);
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", age: "random", nameIds: ids }, names, themes: [theme], settings });
    expect(r.ok && r.cards.map((c) => c.name_id)).toEqual(ids);
    expect(r.ok && r.cards.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("fails when a chosen name was taken meanwhile", () => {
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", nameIds: ["n-Abigail", "n-gone"] }, names, themes: [theme], settings });
    expect(r).toEqual({ ok: false, reason: "1 of the chosen names is no longer available." });
  });
  it("fails on an empty list of chosen names", () => {
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", nameIds: [] }, names, themes: [theme], settings });
    expect(r).toEqual({ ok: false, reason: "No names were chosen for this post." });
  });
  it("8 chosen names are enough even when Settings ask for more cards (min_images), letter or not", () => {
    const ids = names.slice(0, 8).map((n) => n.id);
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", nameIds: ids }, names, themes: [theme], settings: { ...settings, min_images: 9 } });
    expect(r.ok && r.cards).toHaveLength(8);
    const letterNames = ["Sabina", "Selah", "Sienna", "Sloane", "Stella", "Sage", "Sora", "Saoirse"].map(nm);
    const byLetter = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", letter: "S", nameIds: letterNames.map((n) => n.id) },
      names: letterNames, themes: [theme], settings: { ...settings, min_images: 9 } });
    expect(byLetter.ok && byLetter.cards).toHaveLength(8);
  });
  it("fails when more names are chosen than a post can have", () => {
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", nameIds: names.slice(0, 8).map((n) => n.id) }, names, themes: [theme], settings: { ...settings, max_images: 7 } });
    expect(r).toEqual({ ok: false, reason: "This post has more chosen names than the 7 cards a post can have." });
  });
});

describe("createPostCore for Autopilot", () => {
  it("makes a name-theme post from the chosen names: the caption names the theme, the tag is in, posts.name_theme is saved", async () => {
    // Every caption call answers the same line (it names the theme and two of the names, so any caption style passes).
    generateJson.mockResolvedValue({ ok: true, data: { caption: "Biblical baby girl names like Abigail and Hannah, with gentle meanings.", tags: ["#faith"] } });
    const ids = names.slice(0, 10).map((n) => n.id);
    const r = await createPostCore(fake.client as never, { gender: "girl", style: "single", count: null, postDate: "2026-11-21", requestId: "44444444-4444-4444-8444-444444444444",
      subjectAge: "random", nameIds: ids, nameTheme: { title: "Biblical", hint: null } });
    expect(r).toEqual({ ok: true, postId: POST_ID });
    const p = (fake.rpcs.find((x) => x.fn === "create_post")!.args as { p: { caption: string; cards: { name_id: string }[] } }).p;
    expect(p.cards.map((c) => c.name_id).sort()).toEqual([...ids].sort());
    expect(p.caption).toContain("#biblicalnames");
    expect((generateJson.mock.calls[0][0] as { prompt: string }).prompt).toContain("biblical names");
    const updates = fake.queries.filter((q) => q.table === "posts" && isUpdate(q)).map((q) => op(q, "update")![1]);
    expect(updates).toContainEqual({ name_theme: "Biblical" });
  });
  it("reads the chosen names by id (still available, of the gender and style), not the whole pool", async () => {
    generateJson.mockResolvedValue({ ok: false, error: "off" });
    const ids = names.slice(0, 10).map((n) => n.id);
    await createPostCore(fake.client as never, { gender: "girl", style: "single", count: null, postDate: "2026-11-21", requestId: "44444444-4444-4444-8444-444444444444",
      subjectAge: "random", nameIds: ids });
    const reads = fake.queries.filter((q) => q.table === "names" && !isUpdate(q));
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) {
      expect(q.ops).toContainEqual(["in", "id", ids]);
      expect(q.ops).toContainEqual(["eq", "gender", "girl"]);
      expect(q.ops).toContainEqual(["eq", "style", "single"]);
      expect(q.ops).toContainEqual(["eq", "status", "available"]);
    }
  });
});

describe("remakeCard", () => {
  it("puts the card back in line with a new seed, guarded by its version", async () => {
    expect(await remakeCard(fake.client as never, { id: "c1", version: 3, seed: 42 }, { check_state: "pending", remakes: 1 })).toBe(true);
    const q = fake.queries.find((x) => x.table === "cards" && isUpdate(x))!;
    const patch = op(q, "update")![1] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "queued", version: 4, check_state: "pending", remakes: 1, attempts: 0 });
    expect(patch.seed).not.toBe(42);
    expect(q.ops).toContainEqual(["eq", "version", 3]);
    expect(q.ops).toContainEqual(["neq", "status", "generating"]);
  });
});

describe("publishPost", () => {
  const FB = ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN", "FACEBOOK_APP_SECRET"];
  afterEach(() => { for (const k of FB) delete process.env[k]; });
  it("says what kind of failure it was", async () => {
    for (const k of FB) delete process.env[k];
    expect(await publishPost(fake.client as never, POST_ID, { caption: "x" })).toMatchObject({ ok: false, errorKind: "not_connected" });
  });

  /** A connected Page; the post's cards as given; the fb lock is refused, so nothing is ever sent. */
  const world = (cards: Record<string, unknown>[]) => {
    Object.assign(process.env, { FACEBOOK_PAGE_ID: "111", FACEBOOK_PAGE_TOKEN: "tok", FACEBOOK_APP_SECRET: "sec" });
    fake = fakeSupabase((q) => {
      if (q.table === "posts" && isUpdate(q)) return { data: [] };
      if (q.table === "posts") return { data: { id: POST_ID, caption: "c", fb_state: null } };
      if (q.table === "cards") return { data: cards };
      return undefined;
    });
  };
  const cardRow = (id: string, check_state: string | null, o: Record<string, unknown> = {}) =>
    ({ id, kind: "post", selected: true, status: "done", card_path: `cards/${id}.jpg`, order_index: 1, position: 1, check_state, ...o });
  const at = () => new Date(Date.now() + 3 * 3600_000).toISOString();

  it("with requireChecked, refuses when a selected card is not checked, before anything is locked or sent", async () => {
    for (const state of ["pending", "failed", "removed", null]) {
      world([cardRow("c1", "passed"), cardRow("c2", state), cardRow("off", "pending", { selected: false })]);
      expect(await publishPost(fake.client as never, POST_ID, { caption: "x", scheduledAt: at(), requireChecked: true }))
        .toEqual({ ok: false, errorKind: "invalid", error: "A card changed after it was checked; Autopilot will check it again." });
      expect(fake.queries.some((q) => q.table === "posts" && isUpdate(q))).toBe(false);
      expect(op(fake.queries.find((q) => q.table === "cards")!, "select")![1]).toContain("check_state");
    }
  });

  it("with every selected card passed it goes on (here to the lock); without requireChecked check_state is not read", async () => {
    world([cardRow("c1", "passed"), cardRow("off", "pending", { selected: false })]);
    const r = await publishPost(fake.client as never, POST_ID, { caption: "x", scheduledAt: at(), requireChecked: true });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/being sent to Facebook right now/) });
    world([cardRow("c1", "pending")]);
    await publishPost(fake.client as never, POST_ID, { caption: "x", scheduledAt: at() });
    expect(op(fake.queries.find((q) => q.table === "cards")!, "select")![1]).not.toContain("check_state");
  });
});
