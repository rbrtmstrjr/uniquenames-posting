import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createPostAction, rewriteCaptionAction, updateCaptionAction } = await import("@/lib/actions/posts");
const { saveSettingsAction } = await import("@/lib/actions/settings");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const theme: ThemeRow = {
  id: THEME_ID, title: "Ocean Breeze", gender: "boy", backdrop: "sandy beach", outfit: "sailor romper", props: "tiny sailboat and seashells",
  lighting: "soft morning light", palette: "navy, white, sand", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const names: NameRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `n${i}`, name: `Name${String.fromCharCode(65 + i)} Kai`, meaning: "calm sea", gender: "boy", style: "two-word", status: "available",
  post_id: null, position: null, created_at: "", updated_at: "",
}));
const legacySettings = { id: 1, caption_template: "Lovely names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true };

const s009 = { ...legacySettings, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #babygirlnames #babyboynames #momlife #newmom" };
const NEEDS_COL = { message: "Could not find the 'caption_style' column of 'posts' in the schema cache", code: "PGRST204" };
/** The post being rewritten (009 columns unless `pre009`). */
const POST = { id: POST_ID, gender: "boy", style: "two-word", theme_id: THEME_ID, caption: "Old seaside words. Which one?\n\n#uniquenames #babynames",
  caption_style: "story", hashtag_set: "#uniquenames #babynames" };
const CARDS = [{ name: "Marina", meaning: "of the sea", position: 1 }, { name: "Kai", meaning: "sea, Hawaiian", position: 2 }];

function world(settings: Record<string, unknown> = legacySettings, o: { history?: Record<string, unknown>[]; pre009?: boolean } = {}) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return undefined;
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: names };
    if (q.table === "themes") return { data: op(q, "maybeSingle") ? theme : [theme] };
    if (q.table === "cards") return { data: CARDS };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "posts" && isUpdate(q)) {
      if (o.pre009 && "caption_style" in (op(q, "update")![1] as object)) return { error: NEEDS_COL };
      return { data: [{ id: POST_ID }] };
    }
    // The caption history (latest posts).
    if (q.table === "posts" && op(q, "limit")) {
      if (o.pre009 && String(op(q, "select")![1]).includes("caption_style")) return { error: NEEDS_COL };
      return { data: o.history ?? [] };
    }
    if (q.table === "posts") {
      if (!o.pre009) return { data: POST };
      const { caption_style: _s, hashtag_set: _h, ...old } = POST;
      void _s; void _h;
      return { data: old };
    }
    return undefined;
  };
}
const postUpdates = () => fake.queries.filter((q) => q.table === "posts" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);
const createInput = { gender: "boy" as const, style: "two-word" as const, count: null, postDate: "2026-10-05", themeId: THEME_ID, requestId: REQ };
const createdCaption = () => (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: { caption: string } }).p.caption;

// Math.random only breaks caption-style ties: 0 = the first unused style ("story" with no history).
beforeEach(() => { generateJson.mockReset(); world(); vi.spyOn(Math, "random").mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); });

describe("createPostAction captions", () => {
  it("uses the Gemini caption + hashtags, with the theme in the prompt (caption_ai undefined = on); style + set saved", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Sea breezes and tiny sailboats set the scene for these baby boy names ⛵" } });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    // Before 009 settings: the always-tag #uniquenames + the least recently used pool tag.
    expect(createdCaption()).toBe("Sea breezes and tiny sailboats set the scene for these baby boy names ⛵\n\n#uniquenames #babynames");
    expect(generateJson.mock.calls[0][0].prompt).toContain("tiny sailboat and seashells");
    expect(postUpdates()).toEqual([{ caption_style: "story", hashtag_set: "#uniquenames #babynames" }]);
  });

  it("writes against the latest captions: another style, their words in the prompt, Gemini's theme tag, a set not in the last 10", async () => {
    const history = [
      { id: "p1", caption: "Seashells and sailboats for baby boy names.\n\n#uniquenames #seaside #babynames", caption_style: "story", hashtag_set: "#uniquenames #seaside #babynames" },
      { id: "p2", caption: "Which name feels like home?\n\n#uniquenames #babyboynames", caption_style: "question", hashtag_set: null },
    ];
    world(s009, { history });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Marina means of the sea, a sweet match for these baby boy names.", tags: ["#seaside", "#babygirlnames"] } });
    expect((await createPostAction(createInput)).ok).toBe(true);
    const prompt = generateJson.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("1. Seashells and sailboats for baby boy names.");
    expect(prompt).toContain("2. Which name feels like home?");
    expect(prompt).toMatch(/Do not start with any of these words: seashells, which\./);
    const [meta] = postUpdates();
    expect(meta.caption_style).not.toBe("story");
    // #seaside kept, the girl tag dropped; #babynames (+ #seaside) was used by p1, so the pool rotates on.
    expect(meta.hashtag_set).toBe("#uniquenames #seaside #momlife");
    expect(createdCaption()).toMatch(/\n\n#uniquenames #seaside #momlife$/);
  });

  it("before 009: history from the caption text only, and the style/set write is skipped quietly", async () => {
    world(legacySettings, { pre009: true, history: [{ id: "p1", caption: "Old words.\n\n#parenting #uniquenames #fypシ" }] });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Sailboats bob on the sand for these baby boy names." } });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(generateJson.mock.calls[0][0].prompt).toContain("1. Old words.");
    expect(err).not.toHaveBeenCalled();
  });

  it("falls back to the template when Gemini fails — the post is still created", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(createdCaption()).toBe("Lovely names for your baby boy.\n\n#uniquenames #babynames #babyboynames");
    expect(postUpdates()).toEqual([{ caption_style: "template", hashtag_set: "#uniquenames #babynames #babyboynames" }]);
  });

  it("skips Gemini when caption_ai is off", async () => {
    world({ ...legacySettings, ...TEXT_SETTINGS_DEFAULTS, caption_ai: false });
    expect((await createPostAction(createInput)).ok).toBe(true);
    expect(generateJson).not.toHaveBeenCalled();
    expect(createdCaption()).toBe("Lovely names for your baby boy.\n\n#uniquenames #babynames #babyboynames");
  });

  it("a conflict retry on the same theme asks Gemini only once", async () => {
    let n = 0;
    const inner = respond;
    respond = (q) => (q.table === "rpc:create_post" ? { data: n++ === 0 ? { status: "conflict" } : { status: "ok", post_id: POST_ID } } : inner(q));
    generateJson.mockResolvedValue({ ok: true, data: { caption: "Salty air and seashells for these baby boy names." } });
    expect((await createPostAction(createInput)).ok).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("one AI deadline covers the action: a retry on another theme only gets the time left", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const theme2: ThemeRow = { ...theme, id: "44444444-4444-4444-8444-444444444444", title: "Forest Friends", sort_order: 2 };
      let n = 0;
      const inner = respond;
      respond = (q) => {
        if (q.table === "rpc:create_post") return { data: n++ === 0 ? { status: "conflict" } : { status: "ok", post_id: POST_ID } };
        // The first theme is taken by the conflicting post, so the retry plans the next one.
        if (q.table === "themes") return { data: n === 0 ? [theme, theme2] : [theme2] };
        return inner(q);
      };
      generateJson.mockImplementation(async () => { now += 7000; return { ok: true, data: { caption: "Woodland baby boy names with soft moss and tiny acorns." } }; });
      const { themeId: _t, ...auto } = createInput;
      void _t;
      expect((await createPostAction(auto)).ok).toBe(true);
      expect(generateJson).toHaveBeenCalledTimes(2);
      expect(generateJson.mock.calls[0][0].timeoutMs).toBe(9000);
      expect(generateJson.mock.calls[1][0].timeoutMs).toBe(2000);
    } finally { spy.mockRestore(); }
  });

  it("with the deadline spent, a retry on another theme uses the template without calling Gemini", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const theme2: ThemeRow = { ...theme, id: "44444444-4444-4444-8444-444444444444", sort_order: 2 };
      let n = 0;
      const inner = respond;
      respond = (q) => {
        if (q.table === "rpc:create_post") return { data: n++ === 0 ? { status: "conflict" } : { status: "ok", post_id: POST_ID } };
        if (q.table === "themes") return { data: n === 0 ? [theme, theme2] : [theme2] };
        return inner(q);
      };
      generateJson.mockImplementation(async () => { now += 9000; return { ok: false, error: "Gemini timed out." }; });
      const { themeId: _t, ...auto } = createInput;
      void _t;
      expect((await createPostAction(auto)).ok).toBe(true);
      expect(generateJson).toHaveBeenCalledTimes(1);
      expect(createdCaption()).toBe("Lovely names for your baby boy.\n\n#uniquenames #babynames #babyboynames");
    } finally { spy.mockRestore(); }
  });
});

describe("updateCaptionAction (hand edits and Undo)", () => {
  it("new words: the hashtag set is read from the saved text (lower-cased) and the style is cleared", async () => {
    expect(await updateCaptionAction(POST_ID, "My own seaside words.\n\n#UniqueNames #momlife")).toEqual({ ok: true });
    expect(postUpdates()).toEqual([{ caption: "My own seaside words.\n\n#UniqueNames #momlife", hashtag_set: "#uniquenames #momlife", caption_style: null }]);
  });
  it("only the hashtags changed: the generated style is kept, the set follows the text", async () => {
    expect(await updateCaptionAction(POST_ID, "Old seaside words.   Which one?\n\n#newmom #uniquenames")).toEqual({ ok: true });
    expect(postUpdates()).toEqual([{ caption: "Old seaside words.   Which one?\n\n#newmom #uniquenames", hashtag_set: "#newmom #uniquenames", caption_style: "story" }]);
  });
  it("no hashtags left: the set is empty (null)", async () => {
    await updateCaptionAction(POST_ID, "Old seaside words. Which one?");
    expect(postUpdates()).toEqual([{ caption: "Old seaside words. Which one?", hashtag_set: null, caption_style: "story" }]);
  });
  it("before 009: saves the caption alone", async () => {
    world(legacySettings, { pre009: true });
    expect(await updateCaptionAction(POST_ID, "Mine now #babynames")).toEqual({ ok: true });
    expect(postUpdates().at(-1)).toEqual({ caption: "Mine now #babynames" });
  });
  it("a missing post or an over-long caption writes nothing", async () => {
    const inner = respond;
    respond = (q) => (q.table === "posts" && !isUpdate(q) ? { data: null } : inner(q));
    expect(await updateCaptionAction(POST_ID, "Hi")).toEqual({ ok: false, error: "Post not found." });
    expect(await updateCaptionAction(POST_ID, "x".repeat(5001))).toMatchObject({ ok: false });
    expect(postUpdates()).toHaveLength(0);
  });
});

describe("rewriteCaptionAction", () => {
  it("writes, saves and returns a new caption: a new style and a new hashtag set (never the post's own)", async () => {
    world(s009);
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Little sailors, big dreams: baby boy names for the beach lovers. Which is your favorite?" } });
    const r = await rewriteCaptionAction(POST_ID);
    const caption = "Little sailors, big dreams: baby boy names for the beach lovers. Which is your favorite?\n\n#uniquenames #babyboynames";
    expect(r).toEqual({ ok: true, caption });
    expect(postUpdates()).toEqual([{ caption, caption_style: "spotlight", hashtag_set: "#uniquenames #babyboynames" }]);
    // The post's own words come first in the history, and its names (with meanings) reach a name style.
    const prompt = generateJson.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("1. Old seaside words. Which one?");
    expect(prompt).toContain("- Marina: of the sea");
  });

  it("before 009: saves the caption alone", async () => {
    world(legacySettings, { pre009: true });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Sandy toes and sailboats for these baby boy names. Which one?" } });
    const r = await rewriteCaptionAction(POST_ID);
    expect(r).toMatchObject({ ok: true });
    expect(postUpdates()).toHaveLength(2);
    expect(Object.keys(postUpdates()[1])).toEqual(["caption"]);
  });

  it("works even with caption_ai off (explicit request)", async () => {
    world({ ...legacySettings, caption_ai: false });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Beach-day baby boy names with a fresh sea breeze." } });
    expect((await rewriteCaptionAction(POST_ID)).ok).toBe(true);
  });

  it("an A–Z series part keeps saying its part (prompt + series tag)", async () => {
    world(s009);
    const inner = respond;
    respond = (q) => (q.table === "posts" && op(q, "maybeSingle") ? { data: { ...POST, series: "az", series_id: REQ, series_part: 2 } } : inner(q));
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Part 2 of our A to Z baby boy names, N to Z, by the sea.", tags: [] } });
    const r = await rewriteCaptionAction(POST_ID);
    expect(r).toMatchObject({ ok: true, caption: expect.stringMatching(/^Part 2 of our A to Z[\s\S]*#atozbabynames/) });
    expect(generateJson.mock.calls[0][0].prompt).toContain("Part 2 of 2 of an A to Z series");
  });

  it("on AI failure leaves the saved caption alone", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini error 500" });
    expect(await rewriteCaptionAction(POST_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/unchanged/) });
    expect(fake.queries.filter((q) => q.table === "posts" && isUpdate(q))).toHaveLength(0);
  });

  it("a failed settings read returns an error and writes nothing (no caption without hashtags)", async () => {
    const inner = respond;
    respond = (q) => (q.table === "settings" ? { error: { message: "timeout" } } : inner(q));
    generateJson.mockResolvedValue({ ok: true, data: { caption: "Beach-day baby boy names with a fresh sea breeze." } });
    expect(await rewriteCaptionAction(POST_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/settings/) });
    expect(fake.queries.filter((q) => q.table === "posts" && isUpdate(q))).toHaveLength(0);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("rejects a bad id without touching the database", async () => {
    expect(await rewriteCaptionAction("nope")).toMatchObject({ ok: false });
    expect(fake.queries).toHaveLength(0);
  });
});

describe("saveSettingsAction caption_ai", () => {
  const input = { caption_template: "Hi {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, caption_ai: false };
  const settingsUpdates = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);

  it("saves caption_ai with the rest", async () => {
    expect(await saveSettingsAction(input)).toEqual({ ok: true });
    expect(settingsUpdates()[0]).toMatchObject({ caption_ai: false, caption_template: "Hi {gender}" });
  });

  it("before migration 002: saves the other fields and explains why the switch did not stick", async () => {
    const inner = respond;
    let first = true;
    respond = (q) => {
      if (q.table === "settings" && isUpdate(q) && first) { first = false; return { error: { message: "Could not find the 'caption_ai' column of 'settings' in the schema cache" } }; }
      return inner(q);
    };
    const r = await saveSettingsAction(input);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/002_v2\.sql/) });
    expect(settingsUpdates()).toHaveLength(2);
    expect(settingsUpdates()[1]).not.toHaveProperty("caption_ai");
    first = true;
    expect(await saveSettingsAction({ ...input, caption_ai: true })).toEqual({ ok: true });
  });

  it("a PGRST204 code alone also counts as the missing column", async () => {
    const inner = respond;
    let first = true;
    respond = (q) => {
      if (q.table === "settings" && isUpdate(q) && first) { first = false; return { error: { message: "column caption_ai not found", code: "PGRST204" } as { message: string } }; }
      return inner(q);
    };
    expect(await saveSettingsAction({ ...input, caption_ai: true })).toEqual({ ok: true });
    expect(settingsUpdates()).toHaveLength(2);
  });

  it("saves the card text sizes and position with the rest, never the fonts (they are the last-used fonts from Today)", async () => {
    const text = { title_size: 120, meaning_size: 40, mark_size: 24, text_position: "bottom-right" as const };
    expect(await saveSettingsAction({ ...input, ...text, title_font: "playfair", meaning_font: "lora", mark_font: "greatvibes" })).toEqual({ ok: true });
    expect(settingsUpdates()[0]).toMatchObject(text);
    for (const k of ["title_font", "meaning_font", "mark_font"]) expect(settingsUpdates()[0]).not.toHaveProperty(k);
  });

  it("rejects a bad text size before writing", async () => {
    expect(await saveSettingsAction({ ...input, mark_size: 99 })).toMatchObject({ ok: false, error: expect.stringMatching(/Watermark size/) });
    expect(settingsUpdates()).toHaveLength(0);
  });

  it("a stale/unknown font id never blocks Save (fonts are not edited in Settings) and is not written", async () => {
    expect(await saveSettingsAction({ ...input, title_font: "comic", mark_font: "" })).toEqual({ ok: true });
    expect(settingsUpdates()).toHaveLength(1);
    expect(settingsUpdates()[0]).not.toHaveProperty("title_font");
  });

  it("before migration 002: changed text settings are saved without, with a clear message; defaults are fine", async () => {
    const inner = respond;
    let first = true;
    respond = (q) => {
      if (q.table === "settings" && isUpdate(q) && first) { first = false; return { error: { message: "Could not find the 'title_font' column of 'settings' in the schema cache", code: "PGRST204" } }; }
      return inner(q);
    };
    const r = await saveSettingsAction({ ...input, caption_ai: true, text_position: "top-left" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/card text settings.*002_v2\.sql/) });
    expect(settingsUpdates()[1]).not.toHaveProperty("title_font");
    expect(settingsUpdates()[1]).toMatchObject({ caption_template: "Hi {gender}" });
    first = true;
    expect(await saveSettingsAction({ ...input, caption_ai: true })).toEqual({ ok: true });
  });

  it("any other error that mentions caption_ai is returned as is, with no second write", async () => {
    const inner = respond;
    respond = (q) => (q.table === "settings" && isUpdate(q)
      ? { error: { message: "null value in column \"caption_ai\" violates not-null constraint", code: "23502" } as { message: string } } : inner(q));
    expect(await saveSettingsAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/not-null/) });
    expect(settingsUpdates()).toHaveLength(1);
  });

  it("saves images per reel with the rest", async () => {
    expect(await saveSettingsAction({ ...input, reel_max_images: 12 })).toEqual({ ok: true });
    expect(settingsUpdates()).toHaveLength(1);
    expect(settingsUpdates()[0]).toMatchObject({ reel_max_images: 12, caption_ai: false });
  });

  it("rejects images per reel out of 10..40 before writing", async () => {
    expect(await saveSettingsAction({ ...input, reel_max_images: 50 })).toMatchObject({ ok: false, error: expect.stringMatching(/Images per reel/) });
    expect(settingsUpdates()).toHaveLength(0);
  });

  it("before migration 005: saves the rest (incl. v2 fields) without reel_max_images and says to run 005 when changed", async () => {
    const inner = respond;
    respond = (q) => {
      if (q.table === "settings" && isUpdate(q) && "reel_max_images" in (op(q, "update")![1] as object))
        return { error: { message: "Could not find the 'reel_max_images' column of 'settings' in the schema cache", code: "PGRST204" } };
      return inner(q);
    };
    const r = await saveSettingsAction({ ...input, reel_max_images: 20 });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/images per reel.*005_reels\.sql/) });
    expect(settingsUpdates()).toHaveLength(2);
    expect(settingsUpdates()[1]).not.toHaveProperty("reel_max_images");
    expect(settingsUpdates()[1]).toMatchObject({ caption_ai: false, title_size: input.title_size });
    // Untouched (default 40): a quiet success.
    expect(await saveSettingsAction({ ...input, reel_max_images: 40 })).toEqual({ ok: true });
  });

  it("before 002 and 005: drops both groups one at a time and still saves the base fields", async () => {
    const inner = respond;
    respond = (q) => {
      if (q.table === "settings" && isUpdate(q)) {
        const body = op(q, "update")![1] as Record<string, unknown>;
        if ("reel_max_images" in body) return { error: { message: "Could not find the 'reel_max_images' column of 'settings' in the schema cache", code: "PGRST204" } };
        if ("caption_ai" in body) return { error: { message: "Could not find the 'caption_ai' column of 'settings' in the schema cache", code: "PGRST204" } };
      }
      return inner(q);
    };
    const r = await saveSettingsAction({ ...input, reel_max_images: 20 });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/002_v2\.sql.*005_reels\.sql/s) });
    expect(settingsUpdates()).toHaveLength(3);
    expect(Object.keys(settingsUpdates()[2]).sort()).toEqual(["caption_template", "handle", "hashtags", "max_images", "min_images", "sound_on"]);
  });
});

describe("saveSettingsAction hashtags (009)", () => {
  const input = { caption_template: "Hi {gender}", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, caption_ai: true };
  const settingsUpdates = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);

  it("saves the always + pool fields tidied (lower case, one #, no repeats) and no longer needs the old field", async () => {
    expect(await saveSettingsAction({ ...input, hashtags_always: "#UniqueNames", hashtag_pool: "#BabyNames, momlife #newmom #momlife" })).toEqual({ ok: true });
    expect(settingsUpdates()[0]).toMatchObject({ hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife #newmom" });
    expect(settingsUpdates()[0]).not.toHaveProperty("hashtags");
  });

  it("rejects bait, bad tags, too many always-tags and a pool under 3 before writing", async () => {
    expect(await saveSettingsAction({ ...input, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #fyp #momlife" })).toMatchObject({ ok: false, error: expect.stringMatching(/#fyp.*bait/) });
    expect(await saveSettingsAction({ ...input, hashtags_always: "#unique-names", hashtag_pool: "#a #b #c" })).toMatchObject({ ok: false, error: expect.stringMatching(/Always: #unique-names/) });
    expect(await saveSettingsAction({ ...input, hashtags_always: "#a #b #c", hashtag_pool: "#x #y #z" })).toMatchObject({ ok: false, error: expect.stringMatching(/at most 2/) });
    expect(await saveSettingsAction({ ...input, hashtags_always: "#a", hashtag_pool: "#x #y" })).toMatchObject({ ok: false, error: expect.stringMatching(/Pool: add at least 3/) });
    expect(settingsUpdates()).toHaveLength(0);
  });

  it("before 009: saves everything else and says to run 009", async () => {
    const inner = respond;
    respond = (q) => {
      if (q.table === "settings" && isUpdate(q) && "hashtag_pool" in (op(q, "update")![1] as object))
        return { error: { message: "Could not find the 'hashtag_pool' column of 'settings' in the schema cache", code: "PGRST204" } };
      return inner(q);
    };
    const r = await saveSettingsAction({ ...input, hashtags_always: "#uniquenames", hashtag_pool: "#a #b #c" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/hashtags.*009_captions\.sql/) });
    expect(settingsUpdates()).toHaveLength(2);
    expect(settingsUpdates()[1]).not.toHaveProperty("hashtag_pool");
    expect(settingsUpdates()[1]).toMatchObject({ caption_template: "Hi {gender}", caption_ai: true });
  });
});
