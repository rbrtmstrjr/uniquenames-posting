import { createClient } from "@/lib/supabase/server";
import type { CardRow, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";

export const STOCK_KEYS = [
  { gender: "boy", style: "two-word", label: "Boy · two-word" }, { gender: "boy", style: "single", label: "Boy · single" },
  { gender: "girl", style: "two-word", label: "Girl · two-word" }, { gender: "girl", style: "single", label: "Girl · single" },
] as const;

export async function getTodayData() {
  const sb = await createClient();
  const [{ data: settings }, { data: themes }, { data: names }, { data: active }] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("themes").select("*").eq("status", "available").order("sort_order").order("title"),
    sb.from("names").select("gender, style").eq("status", "available"),
    sb.from("posts").select("*").order("created_at", { ascending: false }).limit(1),
  ]);
  const stock = STOCK_KEYS.map((k) => ({ ...k, count: (names ?? []).filter((n) => n.gender === k.gender && n.style === k.style).length }));
  const latest = (active?.[0] ?? null) as PostRow | null;
  // Show the latest post on Today while it is generating, or for 12 h after it finished.
  const show = latest && (latest.status === "generating" || Date.now() - Date.parse(latest.updated_at) < 12 * 3600_000) ? latest : null;
  const { data: cards } = show ? await sb.from("cards").select("*").eq("post_id", show.id).order("position") : { data: [] };
  return { settings: settings as SettingsRow, themes: (themes ?? []) as ThemeRow[], stock, activePost: show, activeCards: (cards ?? []) as CardRow[] };
}
