"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ReelThemeRow } from "@/lib/db/types";
import { isThemeId, needsPreview, previewBusy } from "@/lib/reels/themes";
import { fail, requireOwner, type ActionResult } from "./result";

type SB = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string };

const NEEDS_007 = "Visual themes need the database update first (run supabase/migrations/007_reel_themes.sql).";
const PICK_THEME = "Pick a theme from the list.";

const missing007 = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703" ||
  /relation .* does not exist|schema cache/i.test(e.message);
const dbFail = (e: DbError) => fail(missing007(e) ? NEEDS_007 : e.message);

/**
 * Back in line for the PC: version bumped (a preview being made for the old version is discarded), guarded on
 * the version read, so two taps never queue it twice.
 */
const queuePreview = (sb: SB, t: Pick<ReelThemeRow, "id" | "version">) =>
  sb.from("reel_themes").update({ preview_status: "queued", error: null, claimed_at: null, version: t.version + 1 })
    .eq("id", t.id).eq("version", t.version).select("id");

/** "Make preview" on one theme card (also "Make again" on a ready one). Not while it is in line or being made. */
export async function queueThemePreviewAction(themeId: string): Promise<ActionResult> {
  await requireOwner();
  if (!isThemeId(themeId)) return fail(PICK_THEME);
  const sb = await createClient();
  const { data, error } = await sb.from("reel_themes").select("id, version, preview_status").eq("id", themeId).maybeSingle();
  if (error) return dbFail(error);
  const t = data as Pick<ReelThemeRow, "id" | "version" | "preview_status"> | null;
  if (!t) return fail(PICK_THEME);
  if (previewBusy(t)) return fail("This preview is already in line for your PC.");
  const { data: u, error: ue } = await queuePreview(sb, t);
  if (ue) return dbFail(ue);
  if (!u?.length) return fail("This theme just changed. Try again.");
  revalidatePath("/settings");
  return { ok: true };
}

/** "Make all previews": every theme with no preview yet or a failed one goes in line. */
export async function queueAllThemePreviewsAction(): Promise<ActionResult<{ queued: number }>> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.from("reel_themes").select("id, version, preview_status");
  if (error) return dbFail(error);
  const todo = ((data ?? []) as Pick<ReelThemeRow, "id" | "version" | "preview_status">[]).filter(needsPreview);
  const results = await Promise.all(todo.map((t) => queuePreview(sb, t)));
  const bad = results.find((r) => r.error)?.error;
  if (bad) return dbFail(bad);
  revalidatePath("/settings");
  return { ok: true, queued: results.filter((r) => r.data?.length).length };
}
