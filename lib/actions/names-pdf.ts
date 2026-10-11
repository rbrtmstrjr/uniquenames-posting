"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { categorizeNames } from "@/lib/ai/categorize";
import { PDF_STATUSES } from "@/lib/pdf/plan";
import { storeGroups } from "@/lib/pdf/export";
import { missing018 } from "@/lib/pdf/migration";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

// Names > Export PDF: "Sorting names by meaning…" (each approved name gets its meaning group once, a round at a time,
// so every call stays well inside the function time limit) and the Past exports list's password reveal.

/** Names sorted per call: three AI batches of 100 at the same time. */
const SORT_ROUND = 300;

export type SortResult = ActionResult<{ sorted: number; remaining: number; needs018?: boolean }>;

/** Sort the next round of approved names that have no meaning group yet. Before migration 018: nothing to store. */
export async function sortNamesAction(): Promise<SortResult> {
  await requireOwner();
  const sb = await createClient();
  const todo: { id: string; name: string; meaning: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("names").select("id, name, meaning").in("status", [...PDF_STATUSES]).is("meaning_category", null)
      .order("name").order("id").range(from, from + 999);
    if (error) return missing018(error) ? { ok: true, sorted: 0, remaining: 0, needs018: true } : fail(error.message);
    todo.push(...((data ?? []) as typeof todo));
    if ((data?.length ?? 0) < 1000) break;
  }
  if (!todo.length) return { ok: true, sorted: 0, remaining: 0 };
  const round = todo.slice(0, SORT_ROUND);
  const r = await categorizeNames(round);
  const err = r.groups.size ? await storeGroups(sb, r.groups) : null;
  if (r.groups.size) revalidatePath("/names");
  if (err) return fail(err);
  if (r.error) return fail(r.groups.size ? `${r.error} (${r.groups.size} names were sorted before this.)` : r.error);
  return { ok: true, sorted: r.groups.size, remaining: todo.length - r.groups.size };
}

/** A past export's password, to send it to the buyer again. */
export async function revealExportPasswordAction(id: string): Promise<ActionResult<{ password: string }>> {
  await requireOwner();
  if (!UUID_RE.test(id)) return fail("Unknown export.");
  const sb = await createClient();
  const { data, error } = await sb.from("exports").select("password").eq("id", id).maybeSingle();
  if (error) return fail(missing018(error) ? "Run migration 018 first." : error.message);
  if (!data) return fail("This export is not in the log any more.");
  return { ok: true, password: (data as { password: string }).password };
}
