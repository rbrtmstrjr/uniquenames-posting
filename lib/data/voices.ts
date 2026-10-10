import { createClient } from "@/lib/supabase/server";
import type { ReelVoiceRow, SettingsRow } from "@/lib/db/types";
import { byVoiceOrder, houseDefault, speedOf } from "@/lib/reels/voices";

/** What the review page's narrator picker needs; null before migration 006 (no voices yet). The picker shows only the house voices. */
export interface Narrator { voices: ReelVoiceRow[]; defaultId: string; speed: number }

/** Every narrator voice (built-in first, then by name); null before migration 006. */
export async function getVoices(sb?: Awaited<ReturnType<typeof createClient>>): Promise<ReelVoiceRow[] | null> {
  const client = sb ?? (await createClient());
  const { data, error } = await client.from("reel_voices").select("*");
  if (error) return null;
  return [...((data ?? []) as ReelVoiceRow[])].sort(byVoiceOrder);
}

/** Settings → Background music is on (false before migration 006: no music step then). */
export async function musicOn(): Promise<boolean> {
  const sb = await createClient();
  const { data } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  return (data as SettingsRow | null)?.reel_music === true;
}

/** The voices, the Settings default narrator and the narration speed; null before migration 006. */
export async function getNarrator(): Promise<Narrator | null> {
  const sb = await createClient();
  const [voices, { data }] = await Promise.all([getVoices(sb), sb.from("settings").select("*").eq("id", 1).maybeSingle()]);
  const s = data as SettingsRow | null;
  if (!voices || s?.reel_voice_id === undefined) return null;
  // A Settings narrator outside the house voices counts as Gacrux (the worker does the same).
  return { voices, defaultId: houseDefault(s.reel_voice_id), speed: speedOf(s.reel_speed) };
}
