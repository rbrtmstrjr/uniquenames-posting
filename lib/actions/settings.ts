"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { TEXT_SETTING_KEYS, validateSettings, type SettingsInput } from "./validate";
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
  const { error } = await sb.from("settings").update({ ...base, ...text, caption_ai: s.caption_ai !== false }).eq("id", 1);
  if (error) {
    // Before migration 002 these columns do not exist: save everything else so the owner's
    // other changes are not lost, and say what did not stick (the defaults stay in use).
    const named = V2_COLUMNS.some((c) => error.message.includes(c));
    const missingColumn = named && (error.code === "PGRST204" || /schema cache/i.test(error.message));
    if (!missingColumn) return fail(error.message);
    const { error: again } = await sb.from("settings").update(base).eq("id", 1);
    if (again) return fail(again.message);
    revalidatePath("/", "layout");
    const lost = [
      s.caption_ai === false && "\"Write captions with AI\"",
      SAVED_TEXT_KEYS.some((k) => s[k] !== TEXT_SETTINGS_DEFAULTS[k]) && "the card text settings",
    ].filter(Boolean);
    return lost.length ? fail(NEEDS_MIGRATION(lost.join(" and "))) : { ok: true };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
