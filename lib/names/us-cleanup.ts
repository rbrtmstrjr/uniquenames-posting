import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gender, NameStatus, NameStyle } from "@/lib/db/types";
import { US_LIST, US_NOTE } from "@/lib/names/us-list";

export interface CleanupRow { id: string; name: string; gender: Gender; style: NameStyle; status: NameStatus; autopilot_note?: string | null }

const PAGE = 1000; // PostgREST's default max-rows

/**
 * Which available names are not US names. Used and skipped names are never checked, and an available
 * name that carries the skip note was restored by the owner, so it is kept.
 */
export function usCleanupPlan(rows: CleanupRow[]): { skip: string[]; checked: number } {
  const skip: string[] = [];
  let checked = 0;
  for (const r of rows) {
    if (r.status !== "available") continue;
    checked++;
    if (r.autopilot_note === US_NOTE) continue;
    const ok = r.style === "two-word" ? US_LIST.isUsTwoWord(r.name, r.gender) : US_LIST.isUsName(r.name, r.gender);
    if (!ok) skip.push(r.id);
  }
  return { skip, checked };
}

/** Every available name, read in pages of 1,000 (a single select is capped there). Throws on a read error. */
export async function readAvailableNames(sb: SupabaseClient): Promise<CleanupRow[]> {
  const out: CleanupRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("names").select("id, name, gender, style, status, autopilot_note")
      .eq("status", "available").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as CleanupRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}
