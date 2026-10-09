import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRow, NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";
import { CTA_MESSAGES_DEFAULT, parseCtaMessages } from "@/lib/cta/messages";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
let owner: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => owner }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { addClosingCardAction, createPostAction, rewriteCaptionAction } = await import("@/lib/actions/posts");
const { ctaTextAction, regenerateCardAction, restampCardAction } = await import("@/lib/actions/cards");
const { cardNameIdeasAction } = await import("@/lib/actions/suggest");
const { saveSettingsAction } = await import("@/lib/actions/settings");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "44444444-4444-4444-8444-444444444444";
const theme: ThemeRow = {
  id: THEME_ID, title: "Cotton Clouds", gender: "boy", backdrop: "pastel sky-blue backdrop with cotton clouds", outfit: "white knit romper",
  props: "a woven basket and cotton clouds", lighting: "soft window light", palette: "sky blue, white", status: "available", sort_order: 1,
  used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const names: NameRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `n${i}`, name: `Name${String.fromCharCode(65 + i)}`, meaning: "calm sky", gender: "boy", style: "single", status: "available",
  post_id: null, position: null, created_at: "", updated_at: "",
}));
const base = { id: 1, caption_template: "Names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 9,
  width: 1080, height: 1080, sound_on: true, caption_ai: false };
const s010 = { ...base, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", cta_enabled: true, cta_messages: "First / one\nSecond {gender} / two\nThird" };
const POST = { id: POST_ID, post_date: "2026-10-09", gender: "boy", style: "single", theme_id: THEME_ID, caption: "c", status: "ready", subject_age: "1" };
const ctaCard = { id: CARD_ID, post_id: POST_ID, theme_id: THEME_ID, kind: "cta", position: 10, name_id: null, name: "First / one", meaning: "",
  shot: "closing card: x", prompt: "p", seed: 5, status: "done", error: null, photo_path: "photos/c/v1.jpg", card_path: "cards/c/v1.jpg", version: 1,
  selected: true, order_index: 10, queued_at: "", claimed_at: null, started_at: null, finished_at: null, attempts: 1, created_at: "", updated_at: "" } as CardRow;

type World = {
  settings?: Record<string, unknown>; recent?: { name: string }[]; own?: { id: string; kind: string; position: number }[];
  insertError?: { message: string; code?: string }; card?: CardRow; postCards?: Record<string, unknown>[]; settingsError?: (patch: Record<string, unknown>) => { message: string; code?: string } | null;
};
function world(w: World = {}) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return { error: w.settingsError?.(op(q, "update")![1] as Record<string, unknown>) ?? null };
    if (q.table === "settings") return { data: w.settings ?? s010 };
    if (q.table === "names") return { data: names };
    if (q.table === "themes") return { data: op(q, "maybeSingle") || op(q, "single") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "cards" && op(q, "insert")) return w.insertError ? { error: w.insertError } : { data: [{ id: CARD_ID }] };
    if (q.table === "cards" && isUpdate(q)) return { data: [{ id: CARD_ID }] };
    if (q.table === "cards" && q.ops.some((o) => o[0] === "eq" && o[1] === "kind" && o[2] === "cta")) return { data: w.recent ?? [] };
    if (q.table === "cards" && q.ops.some((o) => o[0] === "eq" && o[1] === "id")) return { data: w.card ?? ctaCard };
    if (q.table === "cards" && q.ops.some((o) => o[0] === "eq" && o[1] === "kind" && o[2] === "post")) return { data: w.postCards ?? [] };
    if (q.table === "cards") return { data: w.own ?? Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, kind: "post", position: i + 1 })) };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts" && op(q, "limit")) return { data: [] };
    if (q.table === "posts") return { data: POST };
    return undefined;
  };
}
const inserts = () => fake.queries.filter((q) => q.table === "cards" && op(q, "insert")).map((q) => op(q, "insert")![1] as Record<string, unknown>);
const createInput = { gender: "boy" as const, style: "single" as const, count: null, postDate: "2026-10-09", themeId: THEME_ID, requestId: REQ, subjectAge: "1" as const };

beforeEach(() => { owner = { id: "owner" }; generateJson.mockReset(); world(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("createPostAction adds the closing card", () => {
  it("queues one closing card after the name cards: same set, the least recently used message, no meaning", async () => {
    world({ recent: [{ name: "First / one" }] });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    const [cta] = inserts();
    expect(inserts()).toHaveLength(1);
    expect(cta).toMatchObject({ post_id: POST_ID, theme_id: THEME_ID, kind: "cta", position: 10, order_index: 10, name: "Second boy / two", meaning: "" });
    expect(String(cta.prompt)).toContain(theme.backdrop);
    expect(String(cta.prompt)).toMatch(/1-year-old baby boy/);
    expect(String(cta.prompt)).not.toMatch(/camera/i);
    // the closing card is never planned as a name card
    const planned = (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: { cards: { name: string }[] } }).p.cards;
    expect(planned).toHaveLength(9);
    expect(planned.every((c) => c.name.startsWith("Name"))).toBe(true);
  });

  it("before 010 (no cta columns in settings) nothing is added and nothing extra is read", async () => {
    world({ settings: base });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(inserts()).toHaveLength(0);
    expect(fake.queries.some((q) => q.table === "cards")).toBe(false);
  });

  it("switched off in Settings: none", async () => {
    world({ settings: { ...s010, cta_enabled: false } });
    expect((await createPostAction(createInput)).ok).toBe(true);
    expect(inserts()).toHaveLength(0);
  });

  it("a refused insert (old check, a database error) never fails the post", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    world({ insertError: { message: 'new row for relation "cards" violates check constraint "cards_kind_check"', code: "23514" } });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(err).not.toHaveBeenCalled();
    world({ insertError: { message: "boom" } });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(err).toHaveBeenCalledWith("createPostAction: could not add the closing card", "boom");
  });

  it("a retried Generate (the post already has its closing card) adds no second one", async () => {
    world({ own: [{ id: "a", kind: "post", position: 1 }, { id: "b", kind: "cta", position: 2 }] });
    expect((await createPostAction(createInput)).ok).toBe(true);
    expect(inserts()).toHaveLength(0);
  });
});

describe("addClosingCardAction", () => {
  it("adds it to a post without one, even with the closing card switched off", async () => {
    world({ settings: { ...s010, cta_enabled: false }, own: [{ id: "a", kind: "post", position: 1 }, { id: "b", kind: "post", position: 4 }] });
    expect(await addClosingCardAction(POST_ID)).toEqual({ ok: true, cardId: CARD_ID });
    expect(inserts()[0]).toMatchObject({ kind: "cta", position: 5, name: "First / one", meaning: "" });
  });

  it("explains: already there / needs 010 / bad id; owner only", async () => {
    world({ own: [{ id: "b", kind: "cta", position: 2 }] });
    expect(await addClosingCardAction(POST_ID)).toEqual({ ok: false, error: "This post already has a closing card." });
    world({ settings: base });
    expect(await addClosingCardAction(POST_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/010_cta_card\.sql/) });
    world({ insertError: { message: "x", code: "23505" } });
    expect(await addClosingCardAction(POST_ID)).toEqual({ ok: false, error: "This post already has a closing card." });
    expect(await addClosingCardAction("nope")).toMatchObject({ ok: false });
    owner = null;
    await expect(addClosingCardAction(POST_ID)).rejects.toThrow(/Not signed in/);
  });
});

describe("closing card text", () => {
  const patch = () => op(fake.queries.find((q) => q.table === "cards" && isUpdate(q))!, "update")![1] as Record<string, unknown>;

  it("re-stamps the photo with the new message ({gender} = the post's), no meaning, version-guarded", async () => {
    expect(await ctaTextAction(CARD_ID, "More {gender} names / tomorrow")).toEqual({ ok: true, mode: "restamp" });
    expect(patch()).toMatchObject({ name: "More boy names / tomorrow", meaning: "", status: "restamp", version: 2 });
    expect(fake.queries.some((q) => q.table === "names")).toBe(false);
  });

  it("New picture with the message remakes the photo", async () => {
    expect(await ctaTextAction(CARD_ID, "Follow / for more", true)).toEqual({ ok: true, mode: "regenerate" });
    expect(patch()).toMatchObject({ name: "Follow / for more", status: "queued", attempts: 0 });
    expect(patch().seed).not.toBe(ctaCard.seed);
  });

  it("validates the message and only takes closing cards", async () => {
    expect(await ctaTextAction(CARD_ID, " / ")).toMatchObject({ ok: false });
    expect(await ctaTextAction(CARD_ID, "a / b / c / d")).toMatchObject({ ok: false, error: expect.stringMatching(/3 lines/) });
    world({ card: { ...ctaCard, kind: "post" } });
    expect(await ctaTextAction(CARD_ID, "Follow")).toEqual({ ok: false, error: "Only the closing card has a message." });
  });

  it("the name paths refuse the closing card; a plain New picture works", async () => {
    expect(await restampCardAction(CARD_ID, "Arlo", "strong")).toMatchObject({ ok: false, error: expect.stringMatching(/Message field/) });
    expect(await regenerateCardAction(CARD_ID, { name: "Arlo", meaning: "strong" })).toMatchObject({ ok: false });
    expect(await regenerateCardAction(CARD_ID)).toEqual({ ok: true });
    expect(await cardNameIdeasAction(CARD_ID)).toMatchObject({ ok: false });
  });
});

describe("captions ignore the closing card", () => {
  it("Rewrite caption reads name cards only (kind = post) and drops any closing card row", async () => {
    world({ postCards: [{ name: "Arlo", meaning: "strong", position: 1, kind: "post" }, { name: "Follow for more / ideas", meaning: "x", position: 2, kind: "cta" }] });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Arlo means strong, a bright pick among these baby boy names." } });
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect((await rewriteCaptionAction(POST_ID)).ok).toBe(true);
    const read = fake.queries.find((q) => q.table === "cards" && !isUpdate(q))!;
    expect(read.ops).toContainEqual(["eq", "kind", "post"]);
    const prompt = generateJson.mock.calls[0][0].prompt as string;
    expect(prompt).not.toMatch(/Follow for more/);
  });
});

describe("Settings: closing card", () => {
  const form = { caption_template: "x {gender}", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, caption_ai: true,
    title_font: "poppins", meaning_font: "poppins", mark_font: "poppins", title_size: 95, meaning_size: 37, mark_size: 21, text_position: "auto" as const };
  const saved = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);

  it("saves on/off and the messages tidy (one per line, no blanks or repeats)", async () => {
    expect(await saveSettingsAction({ ...form, cta_enabled: false, cta_messages: " Follow   us \n\nfollow us\nMore / soon " })).toEqual({ ok: true });
    expect(saved()[0]).toMatchObject({ cta_enabled: false, cta_messages: "Follow us\nMore / soon" });
  });

  it("rejects bad messages", async () => {
    expect(await saveSettingsAction({ ...form, cta_messages: "\n" })).toMatchObject({ ok: false, error: expect.stringMatching(/at least one/) });
    expect(await saveSettingsAction({ ...form, cta_messages: "a / b / c / d" })).toMatchObject({ ok: false });
    expect(saved()).toHaveLength(0);
  });

  it("before 010 the rest is saved and the owner is told", async () => {
    world({ settingsError: (p) => ("cta_enabled" in p ? { message: "Could not find the 'cta_enabled' column of 'settings' in the schema cache", code: "PGRST204" } : null) });
    const r = await saveSettingsAction({ ...form, cta_enabled: true, cta_messages: CTA_MESSAGES_DEFAULT });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/010_cta_card\.sql/) });
    expect(saved()).toHaveLength(2);
    expect(saved()[1]).not.toHaveProperty("cta_enabled");
    expect(parseCtaMessages(CTA_MESSAGES_DEFAULT).length).toBeGreaterThan(1);
  });
});
