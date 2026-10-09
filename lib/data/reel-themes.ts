import { createClient } from "@/lib/supabase/server";
import type { ReelThemeId, ReelThemeRow, SettingsRow } from "@/lib/db/types";
import { byThemeOrder, DEFAULT_THEME_ID, isActiveTheme, isThemeId } from "@/lib/reels/themes";

/** What the review page's theme picker needs; null before migration 007. */
export interface ThemeChoice { themes: ReelThemeRow[]; defaultId: ReelThemeId }

/** The offered visual themes in display order (012: Crayon + Red Thread; before it all 8); null before migration 007. */
export async function getReelThemes(sb?: Awaited<ReturnType<typeof createClient>>): Promise<ReelThemeRow[] | null> {
  const client = sb ?? (await createClient());
  const { data, error } = await client.from("reel_themes").select("*");
  if (error) return null;
  return ((data ?? []) as ReelThemeRow[]).filter(isActiveTheme).sort(byThemeOrder);
}

/** The themes and the Settings default theme; null before migration 007. */
export async function getThemeChoice(): Promise<ThemeChoice | null> {
  const sb = await createClient();
  const [themes, { data }] = await Promise.all([getReelThemes(sb), sb.from("settings").select("*").eq("id", 1).maybeSingle()]);
  const s = data as SettingsRow | null;
  if (!themes?.length || s?.reel_theme_id === undefined) return null;
  return { themes, defaultId: isThemeId(s.reel_theme_id) ? s.reel_theme_id : DEFAULT_THEME_ID };
}
