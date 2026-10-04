"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BABY_SHOTS, PREVIEW_MEANING, PREVIEW_NAME, buildPrompt, hashSeed } from "@/lib/planner";
import type { ThemeRow } from "@/lib/db/types";
import { validateTheme, type ThemeInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

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
  const { data, error } = await sb.from("themes").update(patch).eq("id", id).neq("status", "used").select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Themes that were used in a post cannot be archived or restored.");
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
  const { error } = await sb.from("themes").update({ sort_order: ((first?.[0]?.sort_order as number) ?? 1) - 1 }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/themes");
  revalidatePath("/");
  return { ok: true };
}

export async function makePreviewAction(themeId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  const sb = await createClient();
  const { data: theme } = await sb.from("themes").select("*").eq("id", themeId).single();
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
