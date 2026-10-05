"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateSettings, type SettingsInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

const CAPTION_AI_NEEDS_MIGRATION =
  "Saved, except \"Write captions with AI\": the database needs the v2 update first (run supabase/migrations/002_v2.sql). AI captions stay on until then.";

export async function saveSettingsAction(s: SettingsInput): Promise<ActionResult> {
  await requireOwner();
  const bad = validateSettings(s);
  if (bad) return fail(bad);
  const sb = await createClient();
  const base = {
    caption_template: s.caption_template.trim(), hashtags: s.hashtags.trim(), handle: s.handle.trim(),
    min_images: s.min_images, max_images: s.max_images, sound_on: s.sound_on,
  };
  const { error } = await sb.from("settings").update({ ...base, caption_ai: s.caption_ai !== false }).eq("id", 1);
  if (error) {
    // Before migration 002 the caption_ai column does not exist: save everything else so the
    // owner's other changes are not lost, and say what is missing (AI stays on, the default).
    const missingColumn = /caption_ai/.test(error.message) && (error.code === "PGRST204" || /schema cache/i.test(error.message));
    if (!missingColumn) return fail(error.message);
    const { error: again } = await sb.from("settings").update(base).eq("id", 1);
    if (again) return fail(again.message);
    revalidatePath("/", "layout");
    return s.caption_ai === false ? fail(CAPTION_AI_NEEDS_MIGRATION) : { ok: true };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
