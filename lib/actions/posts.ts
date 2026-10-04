"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { planExtraCard, planPost, subjectKey } from "@/lib/planner";
import type { Gender, NameRow, NameStyle, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { validateCreatePost } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

export async function createPostAction(input: {
  gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string;
}): Promise<ActionResult<{ postId: string }>> {
  await requireOwner();
  const badInput = validateCreatePost(input);
  if (badInput) return fail(badInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate)) return fail("Pick a valid date.");
  const sb = await createClient();
  for (let attempt = 0; attempt < 2; attempt++) {
    const [{ data: settings }, { data: names }, { data: themes }] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("names").select("*").eq("gender", input.gender).eq("style", input.style).eq("status", "available"),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
    ]);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const plan = planPost({
      request: { gender: input.gender, style: input.style, count: input.count, postDate: input.postDate },
      names: (names ?? []) as NameRow[], themes: (themes ?? []) as ThemeRow[], settings: settings as SettingsRow, themeId: input.themeId,
    });
    if (!plan.ok) return fail(plan.reason);
    const { data, error } = await sb.rpc("create_post", { p: {
      request_id: input.requestId, post_date: input.postDate, gender: input.gender, style: input.style,
      theme_id: plan.theme_id, caption: plan.caption, cards: plan.cards,
    } });
    if (error) return fail(`Could not create the post: ${error.message}`);
    const r = data as { status: string; post_id?: string; reason?: string };
    if (r.status === "ok" && r.post_id) { revalidatePath("/", "layout"); return { ok: true, postId: r.post_id }; }
    if (r.status !== "conflict") return fail(r.reason ?? "Could not create the post.");
  }
  return fail("Those names or that theme were just used by another post. Try again.");
}

export async function setPostedAction(postId: string, posted: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("id").eq("id", postId).single();
  if (!post) return fail("Post not found.");
  const { error } = posted
    ? await sb.from("posts").update({ status: "posted", posted_at: new Date().toISOString() }).eq("id", postId)
    : await sb.from("posts").update({ status: "ready", posted_at: null }).eq("id", postId);
  if (error) return fail(error.message);
  if (!posted) await sb.rpc("refresh_post", { p_post: postId });
  revalidatePath("/", "layout");
  revalidatePath("/posts");
  return { ok: true };
}

export async function updateCaptionAction(postId: string, caption: string): Promise<ActionResult> {
  await requireOwner();
  if (caption.length > 5000) return fail("The caption is too long.");
  const { data, error } = await (await createClient()).from("posts").update({ caption }).eq("id", postId).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true } : fail("Post not found.");
}

export async function deletePostAction(postId: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.rpc("delete_post", { p_post: postId });
  if (error) return fail(error.message);
  const paths = (data as { paths: string[] }).paths ?? [];
  if (paths.length) {
    const { error: re } = await sb.storage.from("cards").remove(paths);
    if (re) console.error("deletePostAction: storage cleanup failed", re.message);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addCardAction(postId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("*").eq("id", postId).single();
  if (!post) return fail("Post not found.");
  const p = post as PostRow;
  const [{ data: theme }, { data: names }, { data: cards }] = await Promise.all([
    sb.from("themes").select("*").eq("id", p.theme_id).single(),
    sb.from("names").select("*").eq("gender", p.gender).eq("style", p.style).eq("status", "available"),
    sb.from("cards").select("name_id, position").eq("post_id", postId),
  ]);
  const used = (cards ?? []).map((c) => c.name_id).filter(Boolean) as string[];
  const next = Math.max(0, ...(cards ?? []).map((c) => c.position as number)) + 1;
  const plan = planExtraCard({ theme: theme as ThemeRow, gender: p.gender, style: p.style, names: (names ?? []) as NameRow[], usedNameIds: used, nextPosition: next, salt: `${postId}|${Date.now()}`, subjectKey: subjectKey(p.post_date, p.gender, p.style) });
  if (!plan.ok) return fail(plan.reason);
  const { data, error } = await sb.rpc("add_card", { p_post: postId, c: plan.card });
  if (error) return fail(error.message);
  const r = data as { status: string; card_id?: string };
  if (r.status !== "ok" || !r.card_id) return fail("That name was just taken. Try again.");
  return { ok: true, cardId: r.card_id };
}
