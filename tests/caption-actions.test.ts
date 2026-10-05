import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createPostAction, rewriteCaptionAction } = await import("@/lib/actions/posts");
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

function world(settings: Record<string, unknown> = legacySettings) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return undefined;
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: names };
    if (q.table === "themes") return { data: op(q, "maybeSingle") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts") return { data: { id: POST_ID, gender: "boy", style: "two-word", theme_id: THEME_ID } };
    return undefined;
  };
}
const createInput = { gender: "boy" as const, style: "two-word" as const, count: null, postDate: "2026-10-05", themeId: THEME_ID, requestId: REQ };
const createdCaption = () => (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: { caption: string } }).p.caption;

beforeEach(() => { generateJson.mockReset(); world(); });

describe("createPostAction captions", () => {
  it("uses the Gemini caption + hashtags, with the theme in the prompt (caption_ai undefined = on)", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Sea breezes and tiny sailboats set the scene for these baby boy names ⛵" } });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(createdCaption()).toBe("Sea breezes and tiny sailboats set the scene for these baby boy names ⛵\n\n#babynames");
    expect(generateJson.mock.calls[0][0].prompt).toContain("tiny sailboat and seashells");
  });

  it("falls back to the template when Gemini fails — the post is still created", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await createPostAction(createInput)).toEqual({ ok: true, postId: POST_ID });
    expect(createdCaption()).toBe("Lovely names for your baby boy.\n\n#babynames");
  });

  it("skips Gemini when caption_ai is off", async () => {
    world({ ...legacySettings, ...TEXT_SETTINGS_DEFAULTS, caption_ai: false });
    expect((await createPostAction(createInput)).ok).toBe(true);
    expect(generateJson).not.toHaveBeenCalled();
    expect(createdCaption()).toBe("Lovely names for your baby boy.\n\n#babynames");
  });

  it("a conflict retry on the same theme asks Gemini only once", async () => {
    let n = 0;
    const inner = respond;
    respond = (q) => (q.table === "rpc:create_post" ? { data: n++ === 0 ? { status: "conflict" } : { status: "ok", post_id: POST_ID } } : inner(q));
    generateJson.mockResolvedValue({ ok: true, data: { caption: "Salty air and seashells for these baby boy names." } });
    expect((await createPostAction(createInput)).ok).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe("rewriteCaptionAction", () => {
  it("writes, saves and returns a new caption with the hashtags", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Little sailors, big dreams: baby boy names for the beach lovers. Which is your favorite?" } });
    const r = await rewriteCaptionAction(POST_ID);
    const caption = "Little sailors, big dreams: baby boy names for the beach lovers. Which is your favorite?\n\n#babynames";
    expect(r).toEqual({ ok: true, caption });
    const upd = fake.queries.find((q) => q.table === "posts" && isUpdate(q))!;
    expect(op(upd, "update")![1]).toEqual({ caption });
  });

  it("works even with caption_ai off (explicit request)", async () => {
    world({ ...legacySettings, caption_ai: false });
    generateJson.mockResolvedValueOnce({ ok: true, data: { caption: "Beach-day baby boy names with a fresh sea breeze." } });
    expect((await rewriteCaptionAction(POST_ID)).ok).toBe(true);
  });

  it("on AI failure leaves the saved caption alone", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini error 500" });
    expect(await rewriteCaptionAction(POST_ID)).toMatchObject({ ok: false, error: expect.stringMatching(/unchanged/) });
    expect(fake.queries.filter((q) => q.table === "posts" && isUpdate(q))).toHaveLength(0);
  });

  it("rejects a bad id without touching the database", async () => {
    expect(await rewriteCaptionAction("nope")).toMatchObject({ ok: false });
    expect(fake.queries).toHaveLength(0);
  });
});

describe("saveSettingsAction caption_ai", () => {
  const input = { caption_template: "Hi {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, caption_ai: false };
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
});
