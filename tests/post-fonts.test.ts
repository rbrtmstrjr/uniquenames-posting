import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fontsOf, hasFontColumns, restampFonts, sameFonts, validateFonts } from "@/lib/fonts/post-fonts";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson: vi.fn(async () => ({ ok: false, error: "off" })) }));
const { createPostAction, restampPostAction } = await import("@/lib/actions/posts");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const FONTS = { title_font: "quicksand", meaning_font: "comfortaa", mark_font: "poppins" };

describe("post font helpers", () => {
  it("fontsOf takes the first catalog font per key, else Poppins", () => {
    expect(fontsOf({ title_font: "lora", meaning_font: null }, { title_font: "playfair", meaning_font: "montserrat", mark_font: "nope" }))
      .toEqual({ title_font: "lora", meaning_font: "montserrat", mark_font: "poppins" });
    expect(fontsOf(undefined, null)).toEqual({ title_font: "poppins", meaning_font: "poppins", mark_font: "poppins" });
  });
  it("validateFonts needs all three catalog ids and names the bad one", () => {
    expect(validateFonts(FONTS)).toBeNull();
    expect(validateFonts({ ...FONTS, meaning_font: "comic" })).toMatch(/Meaning font: "comic" is not in the font list/);
    expect(validateFonts({ title_font: "lora" })).toMatch(/Meaning font/);
    expect(validateFonts(null)).toMatch(/Pick the fonts/);
  });
  it("sameFonts / hasFontColumns", () => {
    expect(sameFonts(FONTS, { ...FONTS })).toBe(true);
    expect(sameFonts(FONTS, { ...FONTS, mark_font: "lora" })).toBe(false);
    expect(hasFontColumns({ title_font: null, meaning_font: null, mark_font: null })).toBe(true);
    expect(hasFontColumns({ id: "x" })).toBe(false);
  });
});

const theme: ThemeRow = {
  id: THEME_ID, title: "Ocean", gender: "boy", backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c",
  status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const names: NameRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `n${i}`, name: `Name${String.fromCharCode(65 + i)} Kai`, meaning: "calm", gender: "boy", style: "two-word", status: "available",
  post_id: null, position: null, created_at: "", updated_at: "",
}));
const settings = { id: 1, caption_template: "Hi {gender}", hashtags: "#x", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1080, sound_on: true,
  caption_ai: false, title_font: "playfair", meaning_font: "lora", mark_font: "poppins" };
const input = { gender: "boy" as const, style: "two-word" as const, count: null, postDate: "2026-10-05", themeId: THEME_ID, requestId: REQ };

describe("createPostAction fonts", () => {
  let settingsUpdate: Respond = () => undefined;
  beforeEach(() => {
    settingsUpdate = () => undefined;
    fake = fakeSupabase((q) => respond(q));
    respond = (q: Query) => {
      if (q.table === "settings" && isUpdate(q)) return settingsUpdate(q);
      if (q.table === "settings") return { data: settings };
      if (q.table === "names") return { data: names };
      if (q.table === "themes") return { data: [theme] };
      if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
      if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
      return undefined;
    };
  });
  const p = () => (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: Record<string, unknown> }).p;
  const settingsWrites = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1]);

  it("passes the fonts to create_post and saves them as the last-used fonts", async () => {
    expect(await createPostAction({ ...input, fonts: FONTS })).toEqual({ ok: true, postId: POST_ID });
    expect(p()).toMatchObject(FONTS);
    expect(settingsWrites()).toEqual([FONTS]);
  });

  it("does not write settings when the fonts did not change", async () => {
    await createPostAction({ ...input, fonts: { title_font: "playfair", meaning_font: "lora", mark_font: "poppins" } });
    expect(settingsWrites()).toEqual([]);
  });

  it("rejects an unknown font before planning anything", async () => {
    const r = await createPostAction({ ...input, fonts: { ...FONTS, title_font: "comic" } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Name font: "comic"/) });
    expect(fake.rpcs).toHaveLength(0);
    expect(fake.queries).toHaveLength(0);
  });

  it("a failed last-used save never fails the post", async () => {
    settingsUpdate = () => ({ error: { message: "boom" } });
    expect(await createPostAction({ ...input, fonts: FONTS })).toEqual({ ok: true, postId: POST_ID });
  });

  it("no fonts given: create_post gets none and settings are untouched", async () => {
    await createPostAction(input);
    expect(p()).not.toHaveProperty("title_font");
    expect(settingsWrites()).toEqual([]);
  });

  it("saves the last-used fonts BEFORE create_post (pre-003 the PC must never stamp card 1 with the old fonts)", async () => {
    const order: string[] = [];
    respond = ((inner) => (q: Query) => {
      if (q.table === "rpc:create_post" || (q.table === "settings" && isUpdate(q))) order.push(q.table === "settings" ? "settings-update" : "create_post");
      return inner(q);
    })(respond);
    await createPostAction({ ...input, fonts: FONTS });
    expect(order).toEqual(["settings-update", "create_post"]);
  });

  it("a conflict retry saves the fonts only once", async () => {
    let n = 0;
    respond = ((inner) => (q: Query) => (q.table === "rpc:create_post" ? { data: n++ === 0 ? { status: "conflict" } : { status: "ok", post_id: POST_ID } } : inner(q)))(respond);
    expect((await createPostAction({ ...input, fonts: FONTS })).ok).toBe(true);
    expect(fake.rpcs.filter((r) => r.fn === "create_post")).toHaveLength(2);
    expect(settingsWrites()).toEqual([FONTS]);
  });
});

describe("restampPostAction fonts", () => {
  let postUpdate: Respond = () => undefined;
  beforeEach(() => {
    postUpdate = () => ({ data: [{ id: POST_ID }] });
    fake = fakeSupabase((q) => respond(q));
    respond = (q: Query) => {
      if (q.table === "posts" && isUpdate(q)) return postUpdate(q);
      if (q.table === "cards" && isUpdate(q)) return { data: [{ id: "a" }] };
      if (q.table === "cards") return { data: [{ id: "a", status: "done", photo_path: "photos/a/v1.jpg", version: 1 }] };
      return undefined;
    };
  });
  const cardWrites = () => fake.queries.filter((q) => q.table === "cards" && isUpdate(q));
  const postWrites = () => fake.queries.filter((q) => q.table === "posts" && isUpdate(q));

  it("saves the post's fonts, then re-stamps", async () => {
    expect(await restampPostAction(POST_ID, FONTS)).toMatchObject({ ok: true, restamped: 1 });
    expect(op(postWrites()[0], "update")![1]).toEqual(FONTS);
    expect(postWrites()[0].ops).toContainEqual(["eq", "id", POST_ID]);
    expect(cardWrites()).toHaveLength(1);
  });

  it("fonts saved but the re-stamp fails: the message says the fonts were saved", async () => {
    respond = ((inner) => (q: Query) => (q.table === "cards" && isUpdate(q) ? { error: { message: "network down" } } : inner(q)))(respond);
    expect(await restampPostAction(POST_ID, FONTS)).toEqual({ ok: false, error: "The fonts were saved for this post, but nothing was re-stamped: network down" });
    respond = ((inner) => (q: Query) => (q.table === "cards" && !isUpdate(q) ? { data: [] } : inner(q)))(respond);
    expect(await restampPostAction(POST_ID, FONTS)).toMatchObject({ ok: false, error: expect.stringMatching(/^The fonts were saved for this post.*No finished cards/) });
  });

  it("without fonts a failure keeps the plain message", async () => {
    respond = ((inner) => (q: Query) => (q.table === "cards" && isUpdate(q) ? { error: { message: "network down" } } : inner(q)))(respond);
    expect(await restampPostAction(POST_ID)).toEqual({ ok: false, error: "network down" });
  });

  it("without fonts it only re-stamps (works before 003)", async () => {
    expect((await restampPostAction(POST_ID)).ok).toBe(true);
    expect(postWrites()).toHaveLength(0);
  });

  it("rejects an unknown font with no writes", async () => {
    expect(await restampPostAction(POST_ID, { ...FONTS, mark_font: "wingdings" })).toMatchObject({ ok: false, error: expect.stringMatching(/Watermark font/) });
    expect(fake.queries).toHaveLength(0);
  });

  it("before 003 (missing columns): a clear 'run 003' message, nothing re-stamped", async () => {
    postUpdate = () => ({ error: { message: "Could not find the 'title_font' column of 'posts' in the schema cache", code: "PGRST204" } });
    const r = await restampPostAction(POST_ID, FONTS);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/003_post_fonts\.sql/) });
    expect(cardWrites()).toHaveLength(0);
  });

  it("post not found", async () => {
    postUpdate = () => ({ data: [] });
    expect(await restampPostAction(POST_ID, FONTS)).toMatchObject({ ok: false, error: "Post not found." });
    expect(cardWrites()).toHaveLength(0);
  });
});

describe("restampFonts", () => {
  const prefill = { title_font: "playfair", meaning_font: "lora", mark_font: "poppins" };
  it("sends the picked fonts when the post has the 003 columns", () => {
    expect(restampFonts({ title_font: null, meaning_font: null, mark_font: null }, prefill, prefill)).toEqual(prefill);
    expect(restampFonts({ title_font: "a", meaning_font: null, mark_font: null }, prefill, FONTS)).toEqual(FONTS);
  });
  it("before 003: nothing when unchanged (re-stamp keeps working), the fonts when changed (server says run 003)", () => {
    expect(restampFonts({ id: "x" }, prefill, { ...prefill })).toBeUndefined();
    expect(restampFonts({ id: "x" }, prefill, FONTS)).toEqual(FONTS);
  });
});
