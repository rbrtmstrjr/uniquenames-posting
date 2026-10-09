import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_SETTINGS_DEFAULTS, type ReelThemeRow } from "@/lib/db/types";
import { validateSettings } from "@/lib/actions/validate";
import { byThemeOrder, needsPreview, previewBusy, previewPath, previewShown, THEME_LABEL, themeName } from "@/lib/reels/themes";
import { lineMood } from "@/lib/reels/labels";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
let owner: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => owner }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const A = await import("@/lib/actions/reel-themes");
const { saveSettingsAction } = await import("@/lib/actions/settings");

type Row = Pick<ReelThemeRow, "id" | "version" | "preview_status">;
const eqv = (q: Query, col: string) => q.ops.find((x) => x[0] === "eq" && x[1] === col)?.[2];
const updates = () => fake.queries.filter((q) => q.table === "reel_themes" && isUpdate(q));

let rows: Row[];
let missesUpdate = false;
let readError: { message: string; code?: string } | null = null;
function world(list: Row[]) {
  rows = list.map((r) => ({ ...r }));
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table !== "reel_themes") return undefined;
    if (readError) return { error: readError };
    if (isUpdate(q)) {
      const r = rows.find((x) => x.id === eqv(q, "id") && x.version === eqv(q, "version"));
      if (!r || missesUpdate) return { data: [] };
      Object.assign(r, op(q, "update")![1] as object);
      return { data: [{ id: r.id }] };
    }
    if (eqv(q, "id")) return { data: rows.find((x) => x.id === eqv(q, "id")) ?? null };
    return { data: rows.map((r) => ({ ...r })) };
  };
}
beforeEach(() => { owner = { id: "owner" }; missesUpdate = false; readError = null; world([]); });

describe("queueThemePreviewAction", () => {
  it("queues one theme: status queued, error + claim cleared, version bumped, guarded on the version read", async () => {
    world([{ id: "clay", version: 4, preview_status: "ready" }]);
    expect(await A.queueThemePreviewAction("clay")).toEqual({ ok: true });
    const u = updates();
    expect(u).toHaveLength(1);
    expect(op(u[0], "update")![1]).toEqual({ preview_status: "queued", error: null, claimed_at: null, version: 5 });
    expect(eqv(u[0], "id")).toBe("clay");
    expect(eqv(u[0], "version")).toBe(4);
  });

  it("refuses an unknown id, one already in line / being made, and a theme that just changed", async () => {
    world([{ id: "clay", version: 1, preview_status: "queued" }, { id: "anime", version: 1, preview_status: "making" }, { id: "sketch", version: 1, preview_status: "failed" }]);
    expect(await A.queueThemePreviewAction("nope")).toEqual({ ok: false, error: "Pick a theme from the list." });
    expect(await A.queueThemePreviewAction("knitted")).toEqual({ ok: false, error: "Pick a theme from the list." }); // no row
    expect(await A.queueThemePreviewAction("clay")).toMatchObject({ ok: false, error: expect.stringMatching(/already in line/) });
    expect(await A.queueThemePreviewAction("anime")).toMatchObject({ ok: false, error: expect.stringMatching(/already in line/) });
    expect(updates()).toHaveLength(0);
    missesUpdate = true;
    expect(await A.queueThemePreviewAction("sketch")).toMatchObject({ ok: false, error: expect.stringMatching(/just changed/) });
  });

  it("before migration 007: the setup message; signed out: throws", async () => {
    readError = { message: 'relation "public.reel_themes" does not exist', code: "42P01" };
    expect(await A.queueThemePreviewAction("clay")).toMatchObject({ ok: false, error: expect.stringMatching(/007_reel_themes\.sql/) });
    expect(await A.queueAllThemePreviewsAction()).toMatchObject({ ok: false, error: expect.stringMatching(/007_reel_themes\.sql/) });
    owner = null;
    await expect(A.queueThemePreviewAction("clay")).rejects.toThrow(/Not signed in/);
    await expect(A.queueAllThemePreviewsAction()).rejects.toThrow(/Not signed in/);
  });
});

describe("queueAllThemePreviewsAction", () => {
  it("queues only missing + failed themes and counts what moved", async () => {
    world([
      { id: "knitted", version: 1, preview_status: "missing" }, { id: "clay", version: 2, preview_status: "failed" },
      { id: "anime", version: 1, preview_status: "ready" }, { id: "sketch", version: 1, preview_status: "queued" },
      { id: "cinematic", version: 1, preview_status: "making" },
    ]);
    expect(await A.queueAllThemePreviewsAction()).toEqual({ ok: true, queued: 2 });
    expect(updates().map((q) => eqv(q, "id")).sort()).toEqual(["clay", "knitted"]);
    expect(rows.find((r) => r.id === "clay")).toMatchObject({ preview_status: "queued", version: 3 });
    // Nothing left to do.
    expect(await A.queueAllThemePreviewsAction()).toEqual({ ok: true, queued: 0 });
  });
});

describe("saveSettingsAction: reel_theme_id (migration 007)", () => {
  const input = { caption_template: "Hi {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, ...TEXT_SETTINGS_DEFAULTS };
  const settingsUpdates = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);
  const failFirst = (error: { message: string; code?: string }) => {
    let first = true;
    respond = (q: Query) => (q.table === "settings" && isUpdate(q) && first ? ((first = false), { error }) : undefined);
  };

  it("sends the theme when the form has it, and leaves it out when it doesn't", async () => {
    expect(await saveSettingsAction({ ...input, reel_theme_id: "anime" })).toEqual({ ok: true });
    expect(settingsUpdates()[0].reel_theme_id).toBe("anime");
    expect(await saveSettingsAction(input)).toEqual({ ok: true });
    expect(settingsUpdates()[1]).not.toHaveProperty("reel_theme_id");
  });

  it("validation: an unknown theme is refused before the database", async () => {
    expect(validateSettings({ ...input, reel_theme_id: "glitter" })).toBe("Pick a theme from the list.");
    expect(await saveSettingsAction({ ...input, reel_theme_id: "glitter" })).toEqual({ ok: false, error: "Pick a theme from the list." });
    expect(settingsUpdates()).toHaveLength(0);
  });

  it("pre-007 (PGRST204 naming reel_theme_id): saves everything else, then says the theme didn't stick", async () => {
    failFirst({ message: "Could not find the 'reel_theme_id' column of 'settings' in the schema cache", code: "PGRST204" });
    const r = await saveSettingsAction({ ...input, reel_voice_id: "kore", reel_theme_id: "clay" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/except the default theme.*007_reel_themes\.sql/) });
    const [first, second] = settingsUpdates();
    expect(first.reel_theme_id).toBe("clay");
    expect(second).not.toHaveProperty("reel_theme_id");
    expect(second.reel_voice_id).toBe("kore"); // the 006 group still saved
  });

  it("a theme id the database doesn't know (foreign key) reads as pick a theme", async () => {
    failFirst({ message: 'insert or update on table "settings" violates foreign key constraint "settings_reel_theme_id_fkey"', code: "23503" });
    expect(await saveSettingsAction({ ...input, reel_voice_id: "kore", reel_theme_id: "clay" })).toEqual({ ok: false, error: "Pick a theme from the list." });
    failFirst({ message: 'insert or update on table "settings" violates foreign key constraint "settings_reel_voice_id_fkey"', code: "23503" });
    expect(await saveSettingsAction({ ...input, reel_voice_id: "kore", reel_theme_id: "clay" })).toEqual({ ok: false, error: "Pick a narrator voice from the list." });
  });
});

describe("theme + line label helpers", () => {
  const t = (preview_status: ReelThemeRow["preview_status"], preview_path: string | null = null) => ({ preview_status, preview_path });
  it("needsPreview / previewBusy / previewPath", () => {
    expect([t("missing"), t("failed"), t("queued"), t("making"), t("ready", "p")].map(needsPreview)).toEqual([true, true, false, false, false]);
    expect([t("missing"), t("queued"), t("making"), t("ready", "p")].map(previewBusy)).toEqual([false, true, true, false]);
    expect(previewPath(t("ready", "themes/a/preview-v2.jpg"))).toBe("themes/a/preview-v2.jpg");
    expect(previewPath(t("ready"))).toBeNull();
    expect(previewPath(t("making", "themes/a/preview-v1.jpg"))).toBeNull();
    // "Make again": the old picture stays on the card while the new one waits / is made.
    expect(previewShown(t("queued", "themes/a/preview-v1.jpg"))).toBe("themes/a/preview-v1.jpg");
    expect(previewShown(t("making", "themes/a/preview-v1.jpg"))).toBe("themes/a/preview-v1.jpg");
    expect(previewShown(t("ready", "themes/a/preview-v2.jpg"))).toBe("themes/a/preview-v2.jpg");
    expect(previewShown(t("making"))).toBeNull();
    expect(previewShown(t("failed", "themes/a/preview-v1.jpg"))).toBeNull();
  });
  it("THEME_LABEL mirrors the seeds of migrations 012 (the 2 guide styles first) and 007 (label + emoji, in order)", () => {
    const seed = (f: string) => {
      const sql = readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8");
      return [...sql.matchAll(/^\s*\('([a-z0-9]+)', '([^']*)', '([^']*)', '/gm)].map((m) => [m[1], { label: m[2], emoji: m[3] }]);
    };
    expect(seed("012_two_styles.sql")).toEqual([["crayon", { label: "Crayon", emoji: "🖍️" }], ["redthread", { label: "Red Thread", emoji: "🧵" }]]);
    expect(seed("007_reel_themes.sql")).toHaveLength(8);
    expect(Object.entries(THEME_LABEL)).toEqual([...seed("012_two_styles.sql"), ...seed("007_reel_themes.sql")]);
  });
  it("order by sort then id; names fall back to knitted", () => {
    expect(([{ id: "clay", sort: 2 }, { id: "sketch", sort: 1 }, { id: "anime", sort: 2 }] as const).slice().sort(byThemeOrder).map((x) => x.id)).toEqual(["sketch", "anime", "clay"]);
    expect(themeName("anime")).toBe("🌸 Soft Anime");
    expect(themeName(null)).toBe("🧶 Knitted Doll");
    expect(themeName("gone")).toBe("🧶 Knitted Doll");
  });
  it("lineMood: emotion chip + shot/motion words; null without an emotion or a shot size", () => {
    expect(lineMood({ emotion: "Teary", shot: "low_angle", motion: "pull_out", key_moment: true }))
      .toEqual({ emotion: "teary", emoji: "😢", size: null, shot: "Low angle", motion: "Pull back", punch: null, key: true });
    expect(lineMood({ emotion: "proud", shot: null, motion: "spin" })).toEqual({ emotion: "proud", emoji: "🥹", size: null, shot: null, motion: null, punch: null, key: false });
    expect(lineMood({ emotion: null })).toBeNull();
    expect(lineMood({ emotion: "angry" })).toBeNull();
  });
  it("lineMood (008): the shot-size chip, the punch word (instead of 'key'), the hold move", () => {
    expect(lineMood({ emotion: "teary", shot_size: "broll", motion: "hold", punch: " last time ", key_moment: true }))
      .toEqual({ emotion: "teary", emoji: "😢", size: "B-roll", shot: null, motion: "Hold", punch: "last time", key: false });
    expect(lineMood({ shot_size: "close" })).toMatchObject({ emotion: null, emoji: null, size: "Close-up" });
  });
});
