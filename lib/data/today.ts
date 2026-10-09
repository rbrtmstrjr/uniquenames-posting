import { createClient } from "@/lib/supabase/server";
import type { CardRow, Gender, NameStyle, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { letterCounts, letterKey, type LetterStock } from "@/lib/series/letter";

export const STOCK_KEYS = [
  { gender: "boy", style: "two-word", label: "Boy · two-word" }, { gender: "boy", style: "single", label: "Boy · single" },
  { gender: "girl", style: "two-word", label: "Girl · two-word" }, { gender: "girl", style: "single", label: "Girl · single" },
] as const;

const PAGE = 1000; // PostgREST's default max-rows
type SB = Awaited<ReturnType<typeof createClient>>;

/** Available names (every gender and style), every page: the By letter tiles count them per letter. */
async function availableNames(sb: SB): Promise<{ name: string; gender: Gender; style: NameStyle }[]> {
  const rows: { name: string; gender: Gender; style: NameStyle }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("names").select("name, gender, style").eq("status", "available")
      .order("id").range(from, from + PAGE - 1);
    if (error) return rows;
    rows.push(...((data ?? []) as typeof rows));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

export async function getTodayData() {
  const sb = await createClient();
  const [{ data: settings, error: settingsErr }, { data: themes }, counts, { data: active }, available] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("themes").select("*").eq("status", "available").order("sort_order").order("title"),
    // head count queries: exact counts, no 1000-row cap
    Promise.all(STOCK_KEYS.map((k) => sb.from("names").select("id", { count: "exact", head: true }).eq("status", "available").eq("gender", k.gender).eq("style", k.style))),
    sb.from("posts").select("*").order("created_at", { ascending: false }).limit(1),
    availableNames(sb),
  ]);
  if (settingsErr || !settings) throw new Error("Settings are missing. Run supabase/schema.sql.");
  const stock = STOCK_KEYS.map((k, i) => ({ ...k, count: counts[i].count ?? 0 }));
  const latest = (active?.[0] ?? null) as PostRow | null;
  // Show the latest post on Today while it is generating, or for 12 h after it finished.
  const show = latest && (latest.status === "generating" || Date.now() - Date.parse(latest.updated_at) < 12 * 3600_000) ? latest : null;
  // An A–Z series (made before posts by letter) shows both of its parts (Part 1 first).
  let shown: PostRow[] = show ? [show] : [];
  if (show?.series_id) {
    const { data: parts } = await sb.from("posts").select("*").eq("series_id", show.series_id).order("series_part");
    if (parts?.length) shown = parts as PostRow[];
  }
  const { data: cards } = shown.length ? await sb.from("cards").select("*").in("post_id", shown.map((p) => p.id)).order("position") : { data: [] };
  const allCards = (cards ?? []) as CardRow[];
  const activePosts = shown.map((post) => ({ post, cards: allCards.filter((c) => c.post_id === post.id) }));
  const letters = Object.fromEntries(STOCK_KEYS.map((k) =>
    [letterKey(k.gender, k.style), letterCounts(available.filter((n) => n.gender === k.gender && n.style === k.style))])) as LetterStock;
  return { settings: settings as SettingsRow, themes: (themes ?? []) as ThemeRow[], stock, activePosts, letters };
}
