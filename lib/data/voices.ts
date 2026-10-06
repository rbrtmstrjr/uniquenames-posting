import { createClient } from "@/lib/supabase/server";
import type { ReelVoiceRow, SettingsRow } from "@/lib/db/types";
import { byVoiceOrder, speedOf, VOICE_DEFAULT } from "@/lib/reels/voices";

/** What the review page's narrator picker needs; null before migration 006 (no voices yet). */
export interface Narrator { voices: ReelVoiceRow[]; defaultId: string; speed: number }

/** Every narrator voice (built-in first, then by name); null before migration 006. */
export async function getVoices(sb?: Awaited<ReturnType<typeof createClient>>): Promise<ReelVoiceRow[] | null> {
  const client = sb ?? (await createClient());
  const { data, error } = await client.from("reel_voices").select("*");
  if (error) return null;
  return [...((data ?? []) as ReelVoiceRow[])].sort(byVoiceOrder);
}

/** The voices, the Settings default narrator and the narration speed; null before migration 006. */
export async function getNarrator(): Promise<Narrator | null> {
  const sb = await createClient();
  const [voices, { data }] = await Promise.all([getVoices(sb), sb.from("settings").select("*").eq("id", 1).maybeSingle()]);
  const s = data as SettingsRow | null;
  if (!voices || s?.reel_voice_id === undefined) return null;
  return { voices, defaultId: s.reel_voice_id || VOICE_DEFAULT, speed: speedOf(s.reel_speed) };
}
