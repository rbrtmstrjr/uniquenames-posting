"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { REEL_IMAGES_DEFAULT, TEXT_SETTING_KEYS, validateSettings, type SettingsInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";
import { FONT_KEYS } from "@/lib/fonts/post-fonts";
import { roundSpeed } from "@/lib/reels/voices";
import { parseTags } from "@/lib/captions/hashtags";

/** The settings columns added by migration 002; a database without them refuses an update naming them. */
const V2_COLUMNS = ["caption_ai", ...TEXT_SETTING_KEYS] as const;
/** The narrator + music columns added by migration 006. */
const V6_COLUMNS = ["reel_voice_id", "reel_speed", "reel_music", "reel_music_volume"] as const;
/** The default visual theme (migration 007). */
const V7_COLUMN = "reel_theme_id";
/** The hashtag fields (migration 009). */
const V9_COLUMNS = ["hashtags_always", "hashtag_pool"] as const;
const SAVED_TEXT_KEYS = TEXT_SETTING_KEYS.filter((k) => !(FONT_KEYS as readonly string[]).includes(k));
const NEEDS_MIGRATION = (what: string) =>
  `Saved, except ${what}: the database needs the v2 update first (run supabase/migrations/002_v2.sql). The defaults stay in use until then.`;

export async function saveSettingsAction(s: SettingsInput): Promise<ActionResult> {
  await requireOwner();
  const bad = validateSettings(s);
  if (bad) return fail(bad);
  const sb = await createClient();
  const base = {
    caption_template: s.caption_template.trim(), handle: s.handle.trim(),
    min_images: s.min_images, max_images: s.max_images, sound_on: s.sound_on,
    // The old single field: only an older caller still sends it.
    ...(s.hashtags === undefined ? {} : { hashtags: s.hashtags.trim() }),
  };
  // Fonts are chosen per post on Today, which saves them here as the "last used" fonts: a
  // Settings save never writes them (a stale Settings tab would undo Today's choice).
  const text = Object.fromEntries(SAVED_TEXT_KEYS.map((k) => [k, s[k]]));
  const v2: Record<string, unknown> = { ...text, caption_ai: s.caption_ai !== false };
  // Images per reel (migration 005) is only sent when the form has it.
  const reel: Record<string, unknown> = s.reel_max_images === undefined ? {} : { reel_max_images: s.reel_max_images };
  // Narrator + music (migration 006): only the fields the form has (it leaves them out before 006).
  const v6: Record<string, unknown> = Object.fromEntries(V6_COLUMNS.filter((k) => s[k] !== undefined)
    .map((k) => [k, k === "reel_speed" ? roundSpeed(s.reel_speed!) : s[k]]));
  // Default theme (migration 007): only when the form has it.
  const v7: Record<string, unknown> = s.reel_theme_id === undefined ? {} : { [V7_COLUMN]: s.reel_theme_id };
  // Hashtags (migration 009), saved tidy: lower case, one # each, one space apart, no repeats.
  const v9: Record<string, unknown> = Object.fromEntries(V9_COLUMNS.filter((k) => s[k] !== undefined).map((k) => [k, parseTags(s[k]).join(" ")]));
  let v2Missing = false, reelMissing = false, v6Missing = false, v7Missing = false, v9Missing = false;
  for (;;) {
    const { error } = await sb.from("settings").update({ ...base, ...(v2Missing ? {} : v2), ...(reelMissing ? {} : reel), ...(v6Missing ? {} : v6), ...(v7Missing ? {} : v7), ...(v9Missing ? {} : v9) }).eq("id", 1);
    if (!error) break;
    // A narrator or theme id that isn't in its table (foreign key).
    if (error.code === "23503") {
      if (V7_COLUMN in v7 && !v7Missing && /theme/i.test(`${error.message} ${(error as { details?: string }).details ?? ""}`)) return fail("Pick a theme from the list.");
      if ("reel_voice_id" in v6) return fail("Pick a narrator voice from the list.");
    }
    // A database without the 002 / 005 columns refuses an update naming them: drop that group
    // and save everything else so the owner's other changes are not lost, then say what did not stick.
    const missing = error.code === "PGRST204" || /schema cache/i.test(error.message);
    if (missing && !v9Missing && V9_COLUMNS.some((c) => c in v9 && error.message.includes(c))) { v9Missing = true; continue; }
    if (missing && !v7Missing && V7_COLUMN in v7 && error.message.includes(V7_COLUMN)) { v7Missing = true; continue; }
    if (missing && !v6Missing && V6_COLUMNS.some((c) => c in v6 && error.message.includes(c))) { v6Missing = true; continue; }
    if (missing && !reelMissing && "reel_max_images" in reel && error.message.includes("reel_max_images")) { reelMissing = true; continue; }
    if (missing && !v2Missing && V2_COLUMNS.some((c) => error.message.includes(c))) { v2Missing = true; continue; }
    return fail(error.message);
  }
  revalidatePath("/", "layout");
  const notes: string[] = [];
  if (v2Missing) {
    const lost = [
      s.caption_ai === false && "\"Write captions with AI\"",
      SAVED_TEXT_KEYS.some((k) => s[k] !== TEXT_SETTINGS_DEFAULTS[k]) && "the card text settings",
    ].filter(Boolean);
    if (lost.length) notes.push(NEEDS_MIGRATION(lost.join(" and ")));
  }
  if (reelMissing && s.reel_max_images !== REEL_IMAGES_DEFAULT)
    notes.push(`Saved, except images per reel: the database needs the Reels update first (run supabase/migrations/005_reels.sql). ${REEL_IMAGES_DEFAULT} stays in use until then.`);
  if (v6Missing)
    notes.push("Saved, except the narrator and music settings: the database needs the voices update first (run supabase/migrations/006_reel_voices.sql).");
  if (v7Missing)
    notes.push("Saved, except the default theme: the database needs the themes update first (run supabase/migrations/007_reel_themes.sql).");
  if (v9Missing)
    notes.push("Saved, except the hashtags: the database needs the captions update first (run supabase/migrations/009_captions.sql).");
  return notes.length ? fail(notes.join(" ")) : { ok: true };
}
