"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateSettings, type SettingsInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

export async function saveSettingsAction(s: SettingsInput): Promise<ActionResult> {
  await requireOwner();
  const bad = validateSettings(s);
  if (bad) return fail(bad);
  const { error } = await (await createClient()).from("settings").update({
    caption_template: s.caption_template.trim(), hashtags: s.hashtags.trim(), handle: s.handle.trim(),
    min_images: s.min_images, max_images: s.max_images, sound_on: s.sound_on,
  }).eq("id", 1);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}
