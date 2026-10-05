"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { REEL_IMAGES_DEFAULT, TEXT_SETTING_KEYS, validateSettings, type SettingsInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";
import { FONT_KEYS } from "@/lib/fonts/post-fonts";

/** The settings columns added by migration 002; a database without them refuses an update naming them. */
const V2_COLUMNS = ["caption_ai", ...TEXT_SETTING_KEYS] as const;
const SAVED_TEXT_KEYS = TEXT_SETTING_KEYS.filter((k) => !(FONT_KEYS as readonly string[]).includes(k));
const NEEDS_MIGRATION = (what: string) =>
  `Saved, except ${what}: the database needs the v2 update first (run supabase/migrations/002_v2.sql). The defaults stay in use until then.`;

export async function saveSettingsAction(s: SettingsInput): Promise<ActionResult> {
  await requireOwner();
  const bad = validateSettings(s);
  if (bad) return fail(bad);
  const sb = await createClient();
  const base = {
    caption_template: s.caption_template.trim(), hashtags: s.hashtags.trim(), handle: s.handle.trim(),
    min_images: s.min_images, max_images: s.max_images, sound_on: s.sound_on,
  };
  // Fonts are chosen per post on Today, which saves them here as the "last used" fonts: a
  // Settings save never writes them (a stale Settings tab would undo Today's choice).
  const text = Object.fromEntries(SAVED_TEXT_KEYS.map((k) => [k, s[k]]));
  const v2: Record<string, unknown> = { ...text, caption_ai: s.caption_ai !== false };
  // Images per reel (migration 005) is only sent when the form has it.
  const reel: Record<string, unknown> = s.reel_max_images === undefined ? {} : { reel_max_images: s.reel_max_images };
  let v2Missing = false, reelMissing = false;
  for (;;) {
    const { error } = await sb.from("settings").update({ ...base, ...(v2Missing ? {} : v2), ...(reelMissing ? {} : reel) }).eq("id", 1);
    if (!error) break;
    // A database without the 002 / 005 columns refuses an update naming them: drop that group
    // and save everything else so the owner's other changes are not lost, then say what did not stick.
    const missing = error.code === "PGRST204" || /schema cache/i.test(error.message);
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
  return notes.length ? fail(notes.join(" ")) : { ok: true };
}
