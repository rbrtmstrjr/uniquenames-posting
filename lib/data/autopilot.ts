import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AutopilotItemRow, AutopilotRunRow, CardCheckState, SettingsRow } from "@/lib/db/types";
import { DEFAULT_NAME_THEMES } from "@/lib/autopilot/name-themes";
import { missing022 } from "@/lib/autopilot/prepare";

export interface CardStats { total: number; done: number; passed: number; remade: number; removed: number }

/** The Autopilot page: the latest run, its planned posts, card counts per post, the name-theme list. */
export async function getAutopilotData(): Promise<{ needs022: boolean; run: AutopilotRunRow | null; items: AutopilotItemRow[]; stats: Record<string, CardStats>; nameThemes: string }> {
  const sb = await createClient();
  const [{ data: runs, error }, { data: settings, error: settingsErr }] = await Promise.all([
    sb.from("autopilot_runs").select("*").order("created_at", { ascending: false }).limit(1),
    sb.from("settings").select("*").eq("id", 1).single(),
  ]);
  const nameThemes = (settings as SettingsRow | null)?.autopilot_name_themes ?? DEFAULT_NAME_THEMES.join("\n");
  if (error) {
    if (missing022(error)) return { needs022: true, run: null, items: [], stats: {}, nameThemes };
    throw new Error(`Could not load Autopilot: ${error.message}`);
  }
  if (settingsErr) throw new Error(`Could not load Autopilot: ${settingsErr.message}`);
  const run = ((runs ?? []) as AutopilotRunRow[])[0] ?? null;
  if (!run) return { needs022: false, run, items: [], stats: {}, nameThemes };
  const { data: itemRows, error: itemsErr } = await sb.from("autopilot_items").select("*").eq("run_id", run.id).order("scheduled_for");
  if (itemsErr) throw new Error(`Could not load Autopilot: ${itemsErr.message}`);
  const items = (itemRows ?? []) as AutopilotItemRow[];
  const postIds = items.flatMap((i) => (i.post_id ? [i.post_id] : []));
  const stats: Record<string, CardStats> = {};
  if (postIds.length) {
    const { data: cards, error: cardsErr } = await sb.from("cards").select("post_id, status, check_state, remakes").in("post_id", postIds);
    if (cardsErr) throw new Error(`Could not load Autopilot: ${cardsErr.message}`);
    for (const c of (cards ?? []) as { post_id: string; status: string; check_state: CardCheckState | null; remakes: number }[]) {
      const s = (stats[c.post_id] ??= { total: 0, done: 0, passed: 0, remade: 0, removed: 0 });
      s.total++;
      if (c.status === "done") s.done++;
      if (c.check_state === "passed") s.passed++;
      if (c.check_state === "removed") s.removed++;
      if (c.remakes > 0) s.remade++;
    }
  }
  return { needs022: false, run, items, stats, nameThemes };
}
