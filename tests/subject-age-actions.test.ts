import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { isPropsOnly } from "@/lib/planner";
import { fakeSupabase, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson: vi.fn(async () => ({ ok: false, error: "off" })) }));
const { addCardAction, createPostAction } = await import("@/lib/actions/posts");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const theme: ThemeRow = {
  id: THEME_ID, title: "Ocean", gender: "boy", backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c",
  status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const names: NameRow[] = Array.from({ length: 14 }, (_, i) => ({
  id: `n${i}`, name: `Name${String.fromCharCode(65 + i)} Kai`, meaning: "calm", gender: "boy", style: "two-word", status: "available",
  post_id: null, position: null, created_at: "", updated_at: "",
}));
const settings = { id: 1, caption_template: "Hi {gender}", hashtags: "#x", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1080, sound_on: true,
  caption_ai: false, title_font: "playfair", meaning_font: "lora", mark_font: "poppins" };
const input = { gender: "boy" as const, style: "two-word" as const, count: 13, postDate: "2026-10-05", themeId: THEME_ID, requestId: REQ };

let post: Record<string, unknown> = {};
beforeEach(() => {
  fake = fakeSupabase((q) => respond(q));
  post = { id: POST_ID, post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: THEME_ID };
  respond = (q: Query) => {
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: names };
    if (q.table === "themes") return { data: q.ops.some((o) => o[0] === "single") ? theme : [theme] };
    if (q.table === "posts") return { data: post };
    if (q.table === "cards") return { data: [{ name_id: "n0", position: 1 }] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "rpc:add_card") return { data: { status: "ok", card_id: "c1" } };
    return undefined;
  };
});
const rpc = (fn: string) => fake.rpcs.find((r) => r.fn === fn)!.args as Record<string, Record<string, unknown>>;
const subjectLines = () => (rpc("create_post").p.cards as { shot: string; prompt: string }[])
  .filter((c) => !isPropsOnly(c.shot)).map((c) => c.prompt.split("\n")[1]);

describe("createPostAction subject age", () => {
  it("defaults to Random: stored as 'random', a spread of ages across the cards", async () => {
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(rpc("create_post").p.subject_age).toBe("random");
    expect(new Set(subjectLines()).size).toBeGreaterThan(3);
  });
  it("a fixed age is stored and used on every baby card", async () => {
    await createPostAction({ ...input, subjectAge: "6" });
    expect(rpc("create_post").p.subject_age).toBe("6");
    const lines = new Set(subjectLines());
    expect(lines.size).toBe(1);
    expect([...lines][0]).toContain("6-year-old boy");
  });
  it("rejects an unknown age before reading anything", async () => {
    const r = await createPostAction({ ...input, subjectAge: "9" as never });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/child age/i) });
    expect(fake.queries).toHaveLength(0);
    expect(fake.rpcs).toHaveLength(0);
  });
});

describe("addCardAction subject age", () => {
  const line = () => (rpc("add_card").c.prompt as string).split("\n")[1];
  it("fixed-age post: the post's child", async () => {
    post.subject_age = "3";
    expect(await addCardAction(POST_ID)).toEqual({ ok: true, cardId: "c1" });
    expect(line()).toMatch(/same toddler in every photo.*3-year-old boy/);
  });
  it("random post: a child of its own", async () => {
    post.subject_age = "random";
    await addCardAction(POST_ID);
    expect(line()).toMatch(/^Subject: a (newborn|\d-year-old)/);
  });
  it("post made before ages, or 004 not run yet (no column): the original baby", async () => {
    for (const age of [null, undefined]) {
      fake = fakeSupabase((q) => respond(q));
      post.subject_age = age;
      if (age === undefined) delete post.subject_age;
      await addCardAction(POST_ID);
      expect(line()).toMatch(/same baby in every photo of this session\): (a newborn baby boy, about 10 days old|an 8-month-old baby boy)/);
    }
  });
});
