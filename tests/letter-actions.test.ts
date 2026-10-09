import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

// Posts by letter: createPostAction with a letter (names, caption, posts.letter), Rewrite caption and
// Add card on a letter post, and the Suggest with AI ideas. Gemini mocked at generateJson.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { addCardAction, createPostAction, rewriteCaptionAction } = await import("@/lib/actions/posts");
const { letterNameIdeasAction, cardNameIdeasAction } = await import("@/lib/actions/suggest");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "44444444-4444-4444-8444-444444444444";
const theme: ThemeRow = {
  id: THEME_ID, title: "Ocean Breeze", gender: "boy", backdrop: "sandy beach", outfit: "sailor romper", props: "tiny sailboat and seashells",
  lighting: "soft morning light", palette: "navy, white, sand", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const nm = (name: string, i: number): NameRow => ({
  id: `n-${name}`, name, meaning: "calm sea", gender: "boy", style: "single", status: "available", post_id: null, position: null, created_at: `2026-10-0${1 + (i % 9)}`, updated_at: "",
});
// 11 K names (one with an accent-free lower-case slip is still K), 12 names on other letters.
const K = ["Kael", "Kenji", "Kirin", "Koa", "Kade", "Keon", "Kian", "Kobe", "Kylo", "Kasim", "kenzo"];
const OTHER = ["Arlo", "Bodhi", "Cyrus", "Dax", "Ezra", "Felix", "Gideon", "Hugo", "Ivo", "Jude", "Leo", "Milo"];
const names = [...K, ...OTHER].map(nm);
const settings = {
  id: 1, caption_template: "Lovely names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true,
  hashtags_always: "#uniquenames", hashtag_pool: "#babynames #babyboynames #momlife #newmom",
};
const NEEDS_013 = { message: "Could not find the 'letter' column of 'posts' in the schema cache", code: "PGRST204" };

function world(o: { pre013?: boolean; post?: Record<string, unknown>; cards?: Record<string, unknown>[]; dbNames?: unknown[] } = {}) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return undefined;
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: o.dbNames ?? names };
    if (q.table === "themes") return { data: op(q, "maybeSingle") || op(q, "single") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "rpc:add_card") return { data: { status: "ok", card_id: CARD_ID } };
    if (q.table === "posts" && isUpdate(q)) {
      if (o.pre013 && "letter" in (op(q, "update")![1] as object)) return { error: NEEDS_013 };
      return { data: [{ id: POST_ID }] };
    }
    if (q.table === "posts" && op(q, "limit")) return { data: [] }; // caption history
    if (q.table === "posts") return { data: o.post ?? null };
    if (q.table === "cards" && op(q, "insert")) return { data: [{ id: "cta" }] };
    if (q.table === "cards") return { data: op(q, "single") ? { id: "c1", post_id: POST_ID, theme_id: THEME_ID, kind: "post" } : (o.cards ?? []) };
    return undefined;
  };
}
const input = { gender: "boy" as const, style: "single" as const, count: 10, postDate: "2026-10-09", themeId: THEME_ID, requestId: REQ };
const created = () => (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: { caption: string; cards: { name: string }[] } }).p;
const postUpdates = () => fake.queries.filter((q) => q.table === "posts" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);

beforeEach(() => { generateJson.mockReset(); world(); vi.spyOn(Math, "random").mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); });

describe("createPostAction by letter", () => {
  it("picks only names starting with the letter, tells the caption AI, adds the letter tag and stores posts.letter", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Sea breezes and sailboats for baby boy names that start with K.", tags: ["#seasidebaby"] } });
    expect(await createPostAction({ ...input, letter: "K" })).toEqual({ ok: true, postId: POST_ID });
    const p = created();
    expect(p.cards).toHaveLength(10);
    expect(p.cards.every((c) => c.name.toUpperCase().startsWith("K"))).toBe(true);
    const prompt = generateJson.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Every name in this post starts with the letter K");
    expect(p.caption).toBe("Sea breezes and sailboats for baby boy names that start with K.\n\n#uniquenames #namesstartingwithk #seasidebaby #babynames");
    expect(postUpdates()).toEqual(expect.arrayContaining([{ letter: "K" }, expect.objectContaining({ hashtag_set: "#uniquenames #namesstartingwithk #seasidebaby #babynames" })]));
  });

  it("a caption that never says the letter gets a corrective retry", async () => {
    generateJson
      .mockResolvedValueOnce({ ok: true, data: { caption: "Sea breezes and sailboats for these baby boy names.", tags: [] } })
      .mockResolvedValueOnce({ ok: true, data: { caption: "Baby boy names starting with K, by the sea.", tags: [] } });
    expect((await createPostAction({ ...input, letter: "K" })).ok).toBe(true);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/does not say the names start with the letter K/);
    expect(created().caption).toMatch(/^Baby boy names starting with K, by the sea\./);
  });

  it("the template fallback names the letter", async () => {
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    expect((await createPostAction({ ...input, letter: "K" })).ok).toBe(true);
    expect(created().caption).toMatch(/^Baby boy names starting with K\. Lovely names for your baby boy\.\n\n#uniquenames #namesstartingwithk /);
  });

  it("refuses when the letter has fewer available names than the count (no write)", async () => {
    const r = await createPostAction({ ...input, count: 12, letter: "K" });
    expect(r).toEqual({ ok: false, error: "Only 11 unused boy single names start with K; this post needs 12. Use Suggest with AI on Today to add more." });
    expect(fake.rpcs).toHaveLength(0);
  });

  it("Auto uses the minimum as the need and caps the cards at the letter's names", async () => {
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    expect((await createPostAction({ ...input, count: null, letter: "K" })).ok).toBe(true);
    const n = created().cards.length;
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
  });

  it("before 013 the post is still made, just without its letter", async () => {
    world({ pre013: true });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await createPostAction({ ...input, letter: "K" })).toEqual({ ok: true, postId: POST_ID });
    expect(err).not.toHaveBeenCalledWith(expect.stringMatching(/letter/), expect.anything());
  });

  it("rejects a bad letter before any database call; a normal post stores no letter", async () => {
    expect(await createPostAction({ ...input, letter: "k" })).toEqual({ ok: false, error: "Pick a letter A to Z." });
    expect(fake.queries).toHaveLength(0);
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(postUpdates().some((u) => "letter" in u)).toBe(false);
  });
});

describe("a post by letter after it is made", () => {
  const POST = { id: POST_ID, gender: "boy", style: "single", theme_id: THEME_ID, post_date: "2026-10-09", subject_age: "random", caption: "Old.\n\n#uniquenames", letter: "K" };

  it("Add card picks another name starting with the letter", async () => {
    world({ post: POST, cards: [{ name_id: "n-Kael", position: 1, shot: null }] });
    expect(await addCardAction(POST_ID)).toEqual({ ok: true, cardId: CARD_ID });
    const c = (fake.rpcs.find((r) => r.fn === "add_card")!.args as { c: { name: string; name_id: string } }).c;
    expect(c.name.toUpperCase().startsWith("K")).toBe(true);
    expect(c.name_id).not.toBe("n-Kael");
  });

  it("Add card with no letter names left points to Suggest with AI", async () => {
    world({ post: POST, dbNames: OTHER.map(nm) });
    expect(await addCardAction(POST_ID)).toEqual({ ok: false,
      error: "No unused boy single names starting with K left. On Today, pick By letter and K, then Suggest with AI to add more." });
  });

  it("Rewrite caption keeps the letter (prompt + letter tag)", async () => {
    world({ post: POST, cards: [{ name: "Kael", meaning: "calm sea", position: 1, kind: "post" }] });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Kael and friends: baby boy names that begin with K.", tags: [] } });
    const r = await rewriteCaptionAction(POST_ID);
    expect(r.ok && r.caption).toMatch(/^Kael and friends: baby boy names that begin with K\.\n\n#uniquenames #namesstartingwithk/);
    expect(generateJson.mock.calls[0][0].prompt).toContain("starts with the letter K");
  });

  it("card dialog name ideas on a letter post start with its letter", async () => {
    world({ post: POST });
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Kalani", meaning: "the heavens", gender: "boy" },
      { name: "Bramwell", meaning: "bramble spring", gender: "boy" },
    ] });
    expect(await cardNameIdeasAction(CARD_ID)).toEqual({ ok: true, ideas: [{ name: "Kalani", meaning: "the heavens" }] });
    expect(generateJson.mock.calls[0][0].prompt).toContain("start with the letter K");
  });
});

describe("letterNameIdeasAction", () => {
  it("asks for names starting with the letter (a few spare candidates), filters them, saves nothing", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Kian", meaning: "ancient one", gender: "boy" }, // already in the database
      { name: "Kevin", meaning: "handsome at birth", gender: "boy" }, // too common
      { name: "Kalani", meaning: "the heavens", gender: "boy" },
      { name: "Bramwell", meaning: "bramble spring", gender: "boy" }, // other letter
      { name: "Keoni", meaning: "god is gracious", gender: "boy" },
      { name: "Kesler", meaning: "the cooper's son", gender: "boy" },
    ] });
    const r = await letterNameIdeasAction({ gender: "boy", style: "single", letter: "K", count: 2 });
    expect(r).toEqual({ ok: true, ideas: [{ name: "Kalani", meaning: "the heavens" }, { name: "Keoni", meaning: "god is gracious" }] });
    const call = generateJson.mock.calls[0][0];
    expect(call.prompt).toContain("Suggest 4 single-word baby boy names that start with the letter K.");
    expect(call.prompt).toContain("Kael, Kenji"); // the K names already on the page
    expect(call.prompt).not.toContain("Arlo");
    expect(fake.queries.some((q) => op(q, "insert"))).toBe(false);
  });

  it("two-word: the first name starts with the letter", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "Kaia Wren", meaning: "pure little songbird", gender: "girl" },
      { name: "Wren Kaia", meaning: "little songbird pure", gender: "girl" },
    ] });
    const r = await letterNameIdeasAction({ gender: "girl", style: "two-word", letter: "K", count: 5 });
    expect(r).toEqual({ ok: true, ideas: [{ name: "Kaia Wren", meaning: "pure little songbird" }] });
    expect(generateJson.mock.calls[0][0].prompt).toMatch(/two-word \(first \+ middle\) baby girl names whose FIRST name starts with the letter K/);
  });

  it("says so when nothing survives, passes on Gemini's failure, and validates first", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Kian", meaning: "ancient one" }] });
    expect(await letterNameIdeasAction({ gender: "boy", style: "single", letter: "K", count: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/no new real K names/) });
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await letterNameIdeasAction({ gender: "boy", style: "single", letter: "K", count: 3 })).toEqual({ ok: false, error: "Gemini could not suggest names: Gemini timed out." });
    world();
    expect(await letterNameIdeasAction({ gender: "boy", style: "single", letter: "kk", count: 3 })).toEqual({ ok: false, error: "Pick a letter A to Z." });
    expect(await letterNameIdeasAction({ gender: "boy", style: "single", letter: "K", count: 40 })).toEqual({ ok: false, error: "Ask for 1 to 12 names." });
    expect(fake.queries).toHaveLength(0);
  });
});
