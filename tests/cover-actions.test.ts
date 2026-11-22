import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";
import { packById } from "@/packs";

// The front card is queued when a post is made (Today and Autopilot), before 023 never, and never fails a post.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createPostAction } = await import("@/lib/actions/posts");
const { saveSettingsAction } = await import("@/lib/actions/settings");
const { createPostCore } = await import("@/lib/posts/create");
const { addCoverCard } = await import("@/lib/cover/card");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COVER_ID = "55555555-5555-4555-8555-555555555555";
const theme: ThemeRow = {
  id: THEME_ID, title: "Cotton Clouds", gender: "boy", backdrop: "pastel sky-blue backdrop with cotton clouds", outfit: "white knit romper",
  props: "a woven basket and cotton clouds", lighting: "soft window light", palette: "sky blue, white", status: "available", sort_order: 1,
  used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const nm = (name: string): NameRow => ({ id: `n-${name}`, name, meaning: "calm sky", gender: "boy", style: "single", status: "available",
  post_id: null, position: null, created_at: "", updated_at: "" });
const NAMES = ["Kai", "Kael", "Knox", "Kian", "Kade", "Kellan", "Kobe", "Kyler", "Kenzo", "Milo", "Noah", "Owen"].map(nm);
const base = { id: 1 as const, caption_template: "Names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 9,
  width: 1080, height: 1080, sound_on: true, caption_ai: false, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", cta_enabled: false };
const s023 = { ...base, cover_enabled: true };
const poses = packById("unique-names").cards.cover!.poses;

type World = {
  settings?: Record<string, unknown>; recent?: { shot: string; title_pos: string | null }[]; own?: { id: string; kind: string; position: number }[];
  insertError?: { message: string; code?: string }; settingsError?: (patch: Record<string, unknown>) => { message: string; code?: string } | null;
};
function world(w: World = {}) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return { error: w.settingsError?.(op(q, "update")![1] as Record<string, unknown>) ?? null };
    if (q.table === "settings") return { data: w.settings ?? s023 };
    if (q.table === "names") return { data: NAMES };
    if (q.table === "themes") return { data: op(q, "maybeSingle") || op(q, "single") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "cards" && op(q, "insert")) return w.insertError ? { error: w.insertError } : { data: [{ id: COVER_ID }] };
    if (q.table === "cards" && q.ops.some((o) => o[0] === "eq" && o[1] === "kind" && o[2] === "cover")) return { data: w.recent ?? [] };
    if (q.table === "cards") return { data: w.own ?? [] };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts" && op(q, "limit")) return { data: [] };
    if (q.table === "posts") return { data: null };
    return undefined;
  };
}
const covers = () => fake.queries.filter((q) => q.table === "cards" && op(q, "insert"))
  .map((q) => op(q, "insert")![1] as Record<string, unknown>).filter((c) => c.kind === "cover");
const input = { gender: "boy" as const, style: "single" as const, count: null, postDate: "2026-11-22", themeId: THEME_ID, requestId: REQ, subjectAge: "1" as const };

beforeEach(() => { generateJson.mockReset(); generateJson.mockResolvedValue({ ok: false, error: "off" }); world(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("the front card on a new post", () => {
  it("is queued first (position 0): the post's set and child, the least recently used pose, the other title place, the title", async () => {
    world({ recent: [{ shot: `front card: ${poses[0].id}: ${poses[0].moment.sitter}`, title_pos: "top" }] });
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(covers()).toHaveLength(1);
    const [c] = covers();
    expect(c).toMatchObject({ post_id: POST_ID, theme_id: THEME_ID, kind: "cover", position: 0, order_index: 0, name: "Baby Boy Names", meaning: "", title_pos: "bottom" });
    // bottom title: the least recently used pose that allows a bottom title (not the top-only "face"), never the previous one
    expect(String(c.shot)).toMatch(new RegExp(`^front card: ${poses[2].id}: `));
    expect(poses[2].places).toBeUndefined();
    expect(String(c.prompt)).toContain(theme.backdrop);
    expect(String(c.prompt)).toMatch(/1-year-old baby boy/);
    expect(String(c.prompt)).toMatch(/lower third of the frame is calm/);
    // it is never planned as a name card
    const planned = (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: { cards: { name: string }[] } }).p.cards;
    expect(planned).toHaveLength(9);
  });

  it("reads the recent front cards newest first (the rotation and the place alternation depend on it)", async () => {
    expect((await createPostAction(input)).ok).toBe(true);
    const q = fake.queries.find((x) => x.table === "cards" && x.ops.some((o) => o[0] === "eq" && o[1] === "kind" && o[2] === "cover"))!;
    expect(op(q, "order")).toEqual(["order", "created_at", { ascending: false }]);
  });

  it("a post by letter says 'K' Names, for baby boy; the first front card ever has its title at the top", async () => {
    expect((await createPostAction({ ...input, letter: "K" })).ok).toBe(true);
    expect(covers()[0]).toMatchObject({ name: "'K' Names", meaning: "for baby boy", title_pos: "top" });
    expect(String(covers()[0].shot)).toMatch(new RegExp(`^front card: ${poses[0].id}: `));
  });

  it("an Autopilot name-theme post (chosen names) says Biblical Names", async () => {
    const r = await createPostCore(fake.client as never, { gender: "boy", style: "single", count: null, postDate: "2026-11-22", requestId: REQ,
      subjectAge: "random", nameIds: NAMES.slice(0, 9).map((n) => n.id), nameTheme: { title: "Biblical", hint: null } });
    expect(r).toEqual({ ok: true, postId: POST_ID });
    expect(covers()[0]).toMatchObject({ kind: "cover", name: "Biblical Names", meaning: "for baby boy" });
  });

  it("before 023 (no cover_enabled in settings): none, and nothing extra is read", async () => {
    world({ settings: base });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(covers()).toHaveLength(0);
    expect(fake.queries.some((q) => q.table === "cards")).toBe(false);
  });

  it("switched off in Settings: none", async () => {
    world({ settings: { ...s023, cover_enabled: false } });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(covers()).toHaveLength(0);
    expect(fake.queries.some((q) => q.table === "cards")).toBe(false);
  });

  it("a refused insert (old kind check) never fails the post; any other error is logged, the post is still made", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    world({ insertError: { message: 'new row for relation "cards" violates check constraint "cards_kind_check"', code: "23514" } });
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(err).not.toHaveBeenCalled();
    world({ insertError: { message: "boom" } });
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(err).toHaveBeenCalledWith("createPostCore: could not add the front card", "boom");
  });

  it("a retried Generate (the post already has its front card) adds no second one", async () => {
    world({ own: [{ id: "a", kind: "post", position: 1 }, { id: "f", kind: "cover", position: 0 }] });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(covers()).toHaveLength(0);
  });

  it("a pack without front-card wording (Name Nest) never gets one", async () => {
    const saved = process.env.NICHE;
    process.env.NICHE = "name-nest";
    try {
      const r = await addCoverCard(fake.client as never, { post: { id: POST_ID, post_date: "2026-11-22", gender: "boy", style: "single", theme_id: THEME_ID }, theme, settings: s023, title: {} });
      expect(r).toEqual({ status: "none" });
      expect(fake.queries).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved;
    }
  });
});

describe("Settings: front card", () => {
  const form = { caption_template: "x {gender}", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, caption_ai: true,
    title_font: "poppins", meaning_font: "poppins", mark_font: "poppins", title_size: 95, meaning_size: 37, mark_size: 21, text_position: "auto" as const };
  const saved = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);

  it("saves the switch", async () => {
    expect(await saveSettingsAction({ ...form, cover_enabled: false })).toEqual({ ok: true });
    expect(saved()[0]).toMatchObject({ cover_enabled: false });
  });

  it("rejects anything but on or off", async () => {
    expect(await saveSettingsAction({ ...form, cover_enabled: "yes" as unknown as boolean })).toEqual({ ok: false, error: "Turn the front card on or off." });
    expect(saved()).toHaveLength(0);
  });

  it("before 023 the rest is saved and the owner is told", async () => {
    world({ settingsError: (p) => ("cover_enabled" in p ? { message: "Could not find the 'cover_enabled' column of 'settings' in the schema cache", code: "PGRST204" } : null) });
    const r = await saveSettingsAction({ ...form, cover_enabled: true });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/023_front_card\.sql/) });
    expect(saved()).toHaveLength(2);
    expect(saved()[1]).not.toHaveProperty("cover_enabled");
  });
});
