"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BABY_SHOTS, PREVIEW_MEANING, PREVIEW_NAME, buildPrompt, hashSeed } from "@/lib/planner";
import type { ThemeRow } from "@/lib/db/types";
import { validateTheme, type ThemeInput } from "./validate";
import { generateLockReason } from "./generate-guard";
import { badIds, chunks } from "./helpers";
import { bulkFail, fail, requireOwner, type ActionResult, type BulkResult } from "./result";

export async function saveThemeAction(input: ThemeInput & { id?: string }): Promise<ActionResult<{ id: string }>> {
  await requireOwner();
  const bad = validateTheme(input);
  if (bad) return fail(bad);
  const sb = await createClient();
  const row = { title: input.title.trim(), gender: input.gender, backdrop: input.backdrop.trim(), outfit: input.outfit.trim(), props: input.props.trim(), lighting: input.lighting.trim(), palette: input.palette.trim() };
  if (input.id) {
    const { error } = await sb.from("themes").update(row).eq("id", input.id);
    if (error) return fail(error.message.includes("title") ? "Another theme already has that title." : error.message);
    revalidatePath("/", "layout");
    revalidatePath("/themes");
    return { ok: true, id: input.id };
  }
  const { data: last } = await sb.from("themes").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { data, error } = await sb.from("themes").insert({ ...row, sort_order: ((last?.[0]?.sort_order as number) ?? 0) + 1 }).select("id").single();
  if (error) return fail(error.message.includes("title") ? "Another theme already has that title." : error.message);
  revalidatePath("/", "layout");
  revalidatePath("/themes");
  return { ok: true, id: data.id as string };
}

export async function setArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  // Restoring puts the theme at the END of the queue so it does not jump to "Next".
  const patch: { status: string; sort_order?: number } = { status: archived ? "archived" : "available" };
  if (!archived) {
    const { data: last } = await sb.from("themes").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    patch.sort_order = ((last?.[0]?.sort_order as number) ?? 0) + 1;
  }
  // Archive from available, restore from archived. Never touches used or pending (AI-suggested,
  // waiting for approval) themes, so a suggestion cannot become "available" from here.
  const { data, error } = await sb.from("themes").update(patch).eq("id", id).in("status", archived ? ["available"] : ["archived"]).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(archived ? "Only themes in Up next can be archived. Used themes stay in Used." : "Only archived themes can be restored.");
  revalidatePath("/", "layout");
  revalidatePath("/themes");
  return { ok: true };
}

export async function reorderThemesAction(orderedIds: string[]): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const rs = await Promise.all(orderedIds.map((id, i) => sb.from("themes").update({ sort_order: i + 1 }).eq("id", id)));
  const err = rs.find((r) => r.error)?.error;
  if (err) return fail(err.message);
  revalidatePath("/themes");
  revalidatePath("/");
  return { ok: true };
}

export async function moveThemeNextAction(id: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data: first } = await sb.from("themes").select("sort_order").order("sort_order", { ascending: true }).limit(1);
  // Only a theme in Up next can jump the line (never a pending, used or archived one).
  const { data, error } = await sb.from("themes").update({ sort_order: ((first?.[0]?.sort_order as number) ?? 1) - 1 }).eq("id", id).eq("status", "available").select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Only themes in Up next can be moved.");
  revalidatePath("/themes");
  revalidatePath("/");
  return { ok: true };
}

/** A sanity cap only: "Approve all"/"Reject all" send every pending theme, in chunks. */
const MAX_THEMES = 2000;
const THEME_CHUNK = 50;

/**
 * Approve AI-suggested themes: pending -> available, placed at the END of Up next in the
 * order given (themes added since the suggestion stay ahead of them). Only pending rows change.
 */
export async function approveThemesAction(ids: string[]): Promise<BulkResult> {
  await requireOwner();
  const bad = badIds(ids, MAX_THEMES);
  if (bad) return fail(bad);
  const sb = await createClient();
  const { data: last, error: le } = await sb.from("themes").select("sort_order").neq("status", "pending").order("sort_order", { ascending: false }).limit(1);
  if (le) return fail(le.message);
  const base = ((last?.[0]?.sort_order as number) ?? 0) + 1;
  const done: string[] = [];
  let err: string | null = null;
  // Each theme gets its own sort_order, so one update per id; at most THEME_CHUNK at a time.
  for (const [c, part] of chunks(ids, THEME_CHUNK).entries()) {
    const rs = await Promise.all(part.map((id, i) =>
      sb.from("themes").update({ status: "available", sort_order: base + c * THEME_CHUNK + i }).eq("id", id).eq("status", "pending").select("id")));
    for (const r of rs) for (const d of (r.data ?? []) as { id: string }[]) done.push(d.id);
    const e = rs.find((r) => r.error)?.error;
    if (e) { err = e.message; break; }
  }
  const count = done.length;
  if (count) { revalidatePath("/", "layout"); revalidatePath("/themes"); }
  if (err) return bulkFail(count ? `${err} (${count} were approved before this.)` : err, done);
  if (!count) return fail("These suggestions were already handled. Reload the page.");
  return { ok: true, count };
}

/**
 * Reject AI-suggested themes: deletes them (their preview card rows cascade). Only pending
 * themes. The preview images are removed from storage afterwards, best effort.
 */
export async function rejectThemesAction(ids: string[]): Promise<BulkResult> {
  await requireOwner();
  const bad = badIds(ids, MAX_THEMES);
  if (bad) return fail(bad);
  const sb = await createClient();
  let deleted: string[] = [];
  let err: string | null = null;
  const files = new Map<string, string[]>();
  for (const part of chunks(ids, THEME_CHUNK)) {
    // Read the preview files first: the card rows disappear with the theme.
    const { data: cards } = await sb.from("cards").select("theme_id, photo_path, card_path").in("theme_id", part).eq("kind", "preview");
    for (const c of (cards ?? []) as { theme_id: string; photo_path: string | null; card_path: string | null }[]) {
      files.set(c.theme_id, [...(files.get(c.theme_id) ?? []), ...[c.photo_path, c.card_path].filter((p): p is string => !!p)]);
    }
    const { data, error } = await sb.from("themes").delete().in("id", part).eq("status", "pending").select("id");
    if (error) { err = error.message; break; }
    deleted = deleted.concat(((data ?? []) as { id: string }[]).map((d) => d.id));
  }
  const paths = deleted.flatMap((id) => files.get(id) ?? []);
  if (paths.length) {
    const { error: re } = await sb.storage.from("cards").remove(paths);
    if (re) console.error("rejectThemesAction: storage cleanup failed", re.message);
  }
  if (deleted.length) revalidatePath("/themes");
  if (err) return bulkFail(deleted.length ? `${err} (${deleted.length} were rejected before this.)` : err, deleted);
  if (!deleted.length) return fail("These suggestions were already handled. Reload the page.");
  return { ok: true, count: deleted.length };
}

export async function makePreviewAction(themeId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  const sb = await createClient();
  const [{ data: theme }, lock] = await Promise.all([sb.from("themes").select("*").eq("id", themeId).single(), generateLockReason(sb)]);
  if (lock) return fail(lock);
  if (!theme) return fail("Theme not found.");
  const t = theme as ThemeRow;
  const { data: busy } = await sb.from("cards").select("id").eq("theme_id", themeId).eq("kind", "preview").in("status", ["queued", "generating"]).limit(1);
  if (busy?.length) return { ok: true, cardId: busy[0].id as string };
  const shot = BABY_SHOTS[0];
  const { data, error } = await sb.from("cards").insert({
    theme_id: themeId, kind: "preview", position: 1, name: PREVIEW_NAME, meaning: PREVIEW_MEANING, shot,
    prompt: buildPrompt(t, shot, t.gender), seed: hashSeed(`${themeId}|${Date.now()}`),
  }).select("id").single();
  if (error) return fail(error.message);
  return { ok: true, cardId: data.id as string };
}
