"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { planExtraCard, planPost, storedAge, subjectKey, type AgeChoice } from "@/lib/planner";
import type { CardRow, Gender, NameRow, NameStyle, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { restampSelection, UUID_RE, validateCreatePost } from "./helpers";
import { generateLockReason } from "./generate-guard";
import { aiCaptionLine, CAPTION_TIMEOUT_MS, captionAiOn, composeCaption, REWRITE_TIMEOUT_MS, withHashtags } from "@/lib/ai/caption";
import { fail, requireOwner, type ActionResult } from "./result";
import { fontsOf, sameFonts, validateFonts, type PostFonts } from "@/lib/fonts/post-fonts";

const NEEDS_003 = "Changing a post's fonts needs a database update first: run supabase/migrations/003_post_fonts.sql in Supabase. Nothing was re-stamped.";
const missingColumn = (e: { message: string; code?: string }) => e.code === "PGRST204" || /schema cache/i.test(e.message);

export async function createPostAction(input: {
  gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string;
  /** Chosen on Today; stored on the post (migration 003; an older create_post ignores them). */
  fonts?: PostFonts;
  /** The child's age chosen on Today (default Random). Stored on the post (migration 004; an older create_post ignores it). */
  subjectAge?: AgeChoice;
}): Promise<ActionResult<{ postId: string }>> {
  await requireOwner();
  const badInput = validateCreatePost(input) ?? (input.fonts !== undefined ? validateFonts(input.fonts) : null);
  if (badInput) return fail(badInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate)) return fail("Pick a valid date.");
  const fonts = input.fonts ? fontsOf(input.fonts) : null;
  const age: AgeChoice = input.subjectAge ?? "random";
  const sb = await createClient();
  // The AI caption needs the theme the planner picks, so it runs right after the (parallel)
  // reads and before create_post. It never throws, and ONE deadline (CAPTION_TIMEOUT_MS) covers
  // the whole action, so a conflict retry on a different theme only gets the time left; past it
  // the template is used: a post is never blocked or failed by AI. A retry on the same theme
  // reuses the line instead of asking Gemini twice.
  const aiDeadline = Date.now() + CAPTION_TIMEOUT_MS;
  const lines = new Map<string, Promise<string | null>>();
  const lineFor = (theme: ThemeRow) => {
    const left = aiDeadline - Date.now();
    if (!lines.has(theme.id)) {
      if (left < 500) return Promise.resolve(null);
      lines.set(theme.id, aiCaptionLine({ theme, gender: input.gender, style: input.style }, left));
    }
    return lines.get(theme.id)!;
  };
  let fontsSaved = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    // The Generate lock is read in parallel with the first round of reads (no extra round trip).
    const [{ data: settings }, { data: names }, { data: themes }, lock] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("names").select("*").eq("gender", input.gender).eq("style", input.style).eq("status", "available"),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
      attempt === 0 ? generateLockReason(sb) : Promise.resolve(null),
    ]);
    if (lock) return fail(lock);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const s = settings as SettingsRow;
    const themeRows = (themes ?? []) as ThemeRow[];
    const plan = planPost({
      request: { gender: input.gender, style: input.style, count: input.count, postDate: input.postDate, age },
      names: (names ?? []) as NameRow[], themes: themeRows, settings: s, themeId: input.themeId,
    });
    if (!plan.ok) return fail(plan.reason);
    const theme = themeRows.find((t) => t.id === plan.theme_id);
    const line = theme && captionAiOn(s) ? await lineFor(theme) : null;
    const caption = composeCaption(line, input.gender, s).caption;
    // Remember the fonts as the "last used" ones (Today's defaults, theme previews) BEFORE the
    // cards exist: without migration 003 the PC stamps with the settings fonts, so card 1 must
    // never be claimed with the previous fonts. Best effort: a failed save never blocks the post.
    if (fonts && !fontsSaved && !sameFonts(fonts, fontsOf(s))) {
      const { error: saveErr } = await sb.from("settings").update(fonts).eq("id", 1);
      if (saveErr) console.error("createPostAction: could not save the last-used fonts", saveErr.message);
    }
    fontsSaved = true;
    const { data, error } = await sb.rpc("create_post", { p: {
      request_id: input.requestId, post_date: input.postDate, gender: input.gender, style: input.style,
      theme_id: plan.theme_id, caption, cards: plan.cards, ...fonts, subject_age: age,
    } });
    if (error) return fail(`Could not create the post: ${error.message}`);
    const r = data as { status: string; post_id?: string; reason?: string };
    if (r.status === "ok" && r.post_id) {
      revalidatePath("/", "layout");
      return { ok: true, postId: r.post_id };
    }
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

/**
 * "Rewrite caption": a fresh Gemini caption for the post's theme + the owner's hashtags,
 * saved and returned. The owner asked for AI explicitly, so this works even with the
 * "Write captions with AI" switch off. On any AI failure the saved caption is unchanged.
 */
export async function rewriteCaptionAction(postId: string): Promise<ActionResult<{ caption: string }>> {
  await requireOwner();
  if (!UUID_RE.test(postId ?? "")) return fail("Post not found.");
  const sb = await createClient();
  const [{ data: post }, { data: settings, error: settingsError }] = await Promise.all([
    sb.from("posts").select("id, gender, style, theme_id").eq("id", postId).maybeSingle(),
    sb.from("settings").select("hashtags").eq("id", 1).maybeSingle(),
  ]);
  if (!post) return fail("Post not found.");
  // Without the settings row the hashtags are unknown: writing would drop them, so stop here.
  if (settingsError || !settings) return fail("Could not read your settings. Your caption is unchanged — try again in a moment.");
  const p = post as Pick<PostRow, "id" | "gender" | "style" | "theme_id">;
  const { data: theme } = await sb.from("themes").select("*").eq("id", p.theme_id).maybeSingle();
  if (!theme) return fail("This post's theme was deleted, so there is nothing to write about.");
  const line = await aiCaptionLine({ theme: theme as ThemeRow, gender: p.gender, style: p.style }, REWRITE_TIMEOUT_MS);
  if (!line) return fail("Could not write a new caption right now. Your caption is unchanged — try again in a moment.");
  const caption = withHashtags(line, (settings as { hashtags?: string }).hashtags ?? "");
  const { data, error } = await sb.from("posts").update({ caption }).eq("id", postId).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true, caption } : fail("Post not found.");
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

/**
 * Re-stamp every finished card of a post with the current text settings, keeping each
 * photo. Only Pillow is needed, so this is not locked by the PC / ComfyUI state (the cards
 * wait in line while the PC is off). Each card update is version-guarded and only takes a
 * card that is still done/failed, so a card that changed meanwhile is simply skipped.
 */
export async function restampPostAction(postId: string, fonts?: PostFonts): Promise<ActionResult<{ restamped: number; noPhoto: number; skipped: number; ids: string[] }>> {
  await requireOwner();
  if (!UUID_RE.test(postId ?? "")) return fail("Post not found.");
  if (fonts !== undefined) {
    const bad = validateFonts(fonts);
    if (bad) return fail(bad);
  }
  const sb = await createClient();
  if (fonts) {
    // The post's own fonts first, so the PC stamps with them (claim_next_card returns them).
    const { data: saved, error: fontErr } = await sb.from("posts").update(fontsOf(fonts)).eq("id", postId).select("id");
    if (fontErr) return fail(missingColumn(fontErr) ? NEEDS_003 : fontErr.message);
    if (!saved?.length) return fail("Post not found.");
  }
  // Once the fonts are saved, a failure below must say so (they stay saved on the post).
  const failAfterFonts = (msg: string) => fail(fonts ? `The fonts were saved for this post, but nothing was re-stamped: ${msg}` : msg);
  const { data, error } = await sb.from("cards").select("id, status, photo_path, version").eq("post_id", postId);
  if (error) return failAfterFonts(error.message);
  const { restamp, noPhoto } = restampSelection((data ?? []) as Pick<CardRow, "id" | "status" | "photo_path" | "version">[]);
  if (!restamp.length) return failAfterFonts(noPhoto ? "These cards have no clean photo to re-stamp. Use New picture on a card instead." : "No finished cards to re-stamp yet.");
  const now = new Date().toISOString();
  const results = await Promise.all(restamp.map((c) =>
    sb.from("cards").update({ status: "restamp", claimed_at: null, error: null, version: c.version + 1, queued_at: now })
      .eq("id", c.id).eq("version", c.version).in("status", ["done", "failed"]).select("id")));
  const failed = results.find((r) => r.error)?.error;
  // The ids really queued: the client drops its optimistic "updating text" look on the rest.
  const ids = results.flatMap((r) => (r.error ? [] : ((r.data ?? []) as { id: string }[]).map((d) => d.id)));
  const restamped = ids.length;
  if (failed && !restamped) return failAfterFonts(failed.message);
  return { ok: true, restamped, noPhoto, skipped: restamp.length - restamped, ids };
}

export async function addCardAction(postId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  const sb = await createClient();
  const [{ data: post }, lock] = await Promise.all([sb.from("posts").select("*").eq("id", postId).single(), generateLockReason(sb)]);
  if (lock) return fail(lock);
  if (!post) return fail("Post not found.");
  const p = post as PostRow;
  const [{ data: theme }, { data: names }, { data: cards }] = await Promise.all([
    sb.from("themes").select("*").eq("id", p.theme_id).single(),
    sb.from("names").select("*").eq("gender", p.gender).eq("style", p.style).eq("status", "available"),
    sb.from("cards").select("name_id, position").eq("post_id", postId),
  ]);
  const used = (cards ?? []).map((c) => c.name_id).filter(Boolean) as string[];
  const next = Math.max(0, ...(cards ?? []).map((c) => c.position as number)) + 1;
  // The post's child age (004): Random = a new child of a random age, a fixed age = the post's
  // child. A post made before ages existed (or before 004 runs: no column) keeps its one baby.
  const plan = planExtraCard({ theme: theme as ThemeRow, gender: p.gender, style: p.style, names: (names ?? []) as NameRow[], usedNameIds: used, nextPosition: next,
    salt: `${postId}|${Date.now()}`, subjectKey: subjectKey(p.post_date, p.gender, p.style), age: storedAge(p.subject_age) });
  if (!plan.ok) return fail(plan.reason);
  const { data, error } = await sb.rpc("add_card", { p_post: postId, c: plan.card });
  if (error) return fail(error.message);
  const r = data as { status: string; card_id?: string };
  if (r.status !== "ok" || !r.card_id) return fail("That name was just taken. Try again.");
  return { ok: true, cardId: r.card_id };
}
