import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gender, PostRow, SettingsRow } from "@/lib/db/types";
import { dayLabel, firstDay, labelText, lastFacebook, planProblems, planRun, type PlannedItem } from "./plan";
import { parseNameThemes } from "./name-themes";

export const NEEDS_022 = "Autopilot needs a database update first: run supabase/migrations/022_autopilot.sql in Supabase.";
export const missing022 = (e: { message: string; code?: string }) => e.code === "PGRST204" || e.code === "42703" || e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message);

export interface RunPreview { range: string; posts: number; days: { day: string; dayLabel: string; label: string }[]; problems: string[] }

/** The plan for a run of `days` from today's database (preview and start use the same reading). */
export async function preparePlan(sb: SupabaseClient, days: number, rng: () => number, now: number):
  Promise<{ ok: true; first: string; items: PlannedItem[]; preview: RunPreview } | { ok: false; error: string }> {
  const [posts, settings, themes] = await Promise.all([
    sb.from("posts").select("fb_state, fb_scheduled_for, posted_at, letter, name_theme").in("fb_state", ["scheduled", "published"])
      .order("posted_at", { ascending: false, nullsFirst: false }).order("fb_scheduled_for", { ascending: false, nullsFirst: false }).limit(60),
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("themes").select("gender").eq("status", "available"),
  ]);
  const err = posts.error ?? settings.error ?? themes.error;
  if (err) return { ok: false, error: missing022(err) ? NEEDS_022 : err.message };
  const s = settings.data as SettingsRow;
  if (s.autopilot_name_themes === undefined) return { ok: false, error: NEEDS_022 };
  const last = lastFacebook((posts.data ?? []) as Pick<PostRow, "fb_state" | "fb_scheduled_for" | "posted_at" | "letter" | "name_theme">[]);
  const first = firstDay(last.at, now);
  const items = planRun({ firstDay: first, days, last: last.label, themes: parseNameThemes(s.autopilot_name_themes).map((t) => t.title),
    minImages: s.min_images, maxImages: s.max_images, rng });
  const left: Record<Gender, number> = { boy: 0, girl: 0 };
  for (const t of (themes.data ?? []) as { gender: Gender }[]) left[t.gender]++;
  const dayList = [...new Set(items.map((i) => i.day))].map((day) => ({ day, dayLabel: dayLabel(day), label: labelText(items.find((i) => i.day === day)!) }));
  const preview: RunPreview = {
    range: dayList.length > 1 ? `${dayList[0].dayLabel} – ${dayList.at(-1)!.dayLabel}` : dayList[0]?.dayLabel ?? "",
    posts: items.length, days: dayList, problems: planProblems(items, left, now),
  };
  return { ok: true, first, items, preview };
}
