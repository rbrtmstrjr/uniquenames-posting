import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gender, NameStatus, NameStyle } from "@/lib/db/types";
import { US_LIST } from "@/lib/names/us-list";

export interface CleanupRow { id: string; name: string; gender: Gender; style: NameStyle; status: NameStatus; autopilot_note?: string | null }

/** The names the US check looks at: available ones and pending ones (made before the check existed, never checked). */
export const CHECKABLE: NameStatus[] = ["available", "pending"];
const PAGE = 1000; // PostgREST's default max-rows

/**
 * Which available or pending names are not US names. Used, reserved and skipped names are never checked, and a name
 * with any note is kept: it was skipped once and brought back by the owner ("Not a US name", or one of Autopilot's
 * own skips: names-step's "any note = restored" rule).
 */
export function usCleanupPlan(rows: CleanupRow[]): { skip: string[]; checked: number } {
  const skip: string[] = [];
  let checked = 0;
  for (const r of rows) {
    if (!CHECKABLE.includes(r.status)) continue;
    checked++;
    if (r.autopilot_note) continue;
    const ok = r.style === "two-word" ? US_LIST.isUsTwoWord(r.name, r.gender) : US_LIST.isUsName(r.name, r.gender);
    if (!ok) skip.push(r.id);
  }
  return { skip, checked };
}

/** Every available or pending name, read in pages of 1,000 (a single select is capped there). Throws on a read error. */
export async function readCheckableNames(sb: SupabaseClient): Promise<CleanupRow[]> {
  const out: CleanupRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("names").select("id, name, gender, style, status, autopilot_note")
      .in("status", CHECKABLE).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as CleanupRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}
