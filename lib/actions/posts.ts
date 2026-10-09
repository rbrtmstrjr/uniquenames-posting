"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { planExtraCard, planPost, storedAge, subjectKey, type AgeChoice } from "@/lib/planner";
import type { CardRow, Gender, NameRow, NameStyle, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { restampSelection, UUID_RE, validateCreatePost } from "./helpers";
import { generateLockReason } from "./generate-guard";
import { aiCaptionLine, CAPTION_TIMEOUT_MS, captionAiOn, composePostCaption, REWRITE_TIMEOUT_MS, type AiCaption } from "@/lib/ai/caption";
import { loadPostHistory, missingColumn as missing009 } from "@/lib/captions/load";
import { recentTags, withFirst, withoutId, type CaptionHistory } from "@/lib/captions/history";
import { splitCaption, tagsInText } from "@/lib/captions/hashtags";
import { NAME_STYLES, pickStyle, type CaptionName, type CaptionStyle } from "@/lib/captions/styles";
import { fail, requireOwner, type ActionResult } from "./result";
import { fontsOf, sameFonts, validateFonts, type PostFonts } from "@/lib/fonts/post-fonts";
import { addClosingCard } from "@/lib/cta/card";
import { seriesPart } from "@/lib/series/az";
import { isLetter } from "@/lib/series/letter";

const NEEDS_003 = "Changing a post's fonts needs a database update first: run supabase/migrations/003_post_fonts.sql in Supabase. Nothing was re-stamped.";
const missingColumn = (e: { message: string; code?: string }) => e.code === "PGRST204" || /schema cache/i.test(e.message);

export async function createPostAction(input: {
  gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string;
  /** Chosen on Today; stored on the post (migration 003; an older create_post ignores them). */
  fonts?: PostFonts;
  /** The child's age chosen on Today (default Random). Stored on the post (migration 004; an older create_post ignores it). */
  subjectAge?: AgeChoice;
  /** A post by letter (Today > By letter): every name starts with it; stored as posts.letter (013) for the label. */
  letter?: string;
}): Promise<ActionResult<{ postId: string }>> {
  await requireOwner();
  const badInput = validateCreatePost(input) ?? (input.fonts !== undefined ? validateFonts(input.fonts) : null)
    ?? (input.letter !== undefined && !isLetter(input.letter) ? "Pick a letter A to Z." : null);
  if (badInput) return fail(badInput);
  const letter = input.letter ?? null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate)) return fail("Pick a valid date.");
  const fonts = input.fonts ? fontsOf(input.fonts) : null;
  const age: AgeChoice = input.subjectAge ?? "random";
  const sb = await createClient();
  // The AI caption needs the theme (and names) the planner picks, so it runs right after the
  // (parallel) reads and before create_post. It never throws, and ONE deadline (CAPTION_TIMEOUT_MS)
  // covers the whole action, so a conflict retry on a different theme only gets the time left;
  // past it the template is used: a post is never blocked or failed by AI. A retry on the same
  // theme (and, for a style that names names, the same names) reuses the line.
  const aiDeadline = Date.now() + CAPTION_TIMEOUT_MS;
  const lines = new Map<string, Promise<AiCaption | null>>();
  // Read once, in parallel with the first round of reads (no extra round trip).
  const historyRead = loadPostHistory(sb);
  let captionStyle: CaptionStyle | null = null;
  const lineFor = (theme: ThemeRow, names: CaptionName[], style: CaptionStyle, h: CaptionHistory) => {
    const key = `${theme.id}|${NAME_STYLES.includes(style) ? names.map((n) => n.name).join(",") : ""}`;
    const left = aiDeadline - Date.now();
    if (!lines.has(key)) {
      if (left < 500) return Promise.resolve(null);
      lines.set(key, aiCaptionLine({ theme, gender: input.gender, style: input.style, captionStyle: style, names, recent: h.texts, recentTags: recentTags(h), letter }, left));
    }
    return lines.get(key)!;
  };
  let fontsSaved = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    // The Generate lock is read in parallel with the first round of reads (no extra round trip).
    const [{ data: settings }, { data: names }, { data: themes }, lock, h] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("names").select("*").eq("gender", input.gender).eq("style", input.style).eq("status", "available"),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
      attempt === 0 ? generateLockReason(sb) : Promise.resolve(null),
      historyRead,
    ]);
    if (lock) return fail(lock);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const s = settings as SettingsRow;
    const themeRows = (themes ?? []) as ThemeRow[];
    const plan = planPost({
      request: { gender: input.gender, style: input.style, count: input.count, postDate: input.postDate, age, letter },
      names: (names ?? []) as NameRow[], themes: themeRows, settings: s, themeId: input.themeId,
    });
    if (!plan.ok) return fail(plan.reason);
    const theme = themeRows.find((t) => t.id === plan.theme_id);
    const postNames: CaptionName[] = plan.cards.map((c) => ({ name: c.name, meaning: c.meaning }));
    // One style per action: the previous post's style is never repeated, the least recently used preferred.
    captionStyle ??= pickStyle(h.styles, postNames);
    const aiOn = captionAiOn(s);
    const ai = theme && aiOn ? await lineFor(theme, postNames, captionStyle, h) : null;
    const { caption, caption_style, hashtag_set } = composePostCaption({ ai, aiOn, captionStyle, gender: input.gender, settings: s, history: h, letter });
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
      // The style and hashtag set (009) let the next post differ. create_post doesn't take them, so they
      // follow in a second write; best effort: before 009, or on an error, the post is simply without them.
      // The closing "follow" card (010) is queued after the name cards, also best effort: before 010, or on
      // an error, the post simply has none (the owner can add it on the post page). A post by letter stores its
      // letter (013) the same way: before 013 it is simply made without its "Letter A" label.
      const [{ error: metaErr }, closing, letterSaved] = await Promise.all([
        sb.from("posts").update({ caption_style, hashtag_set }).eq("id", r.post_id),
        theme ? addClosingCard(sb, { post: { id: r.post_id, post_date: input.postDate, gender: input.gender, style: input.style, theme_id: plan.theme_id, subject_age: age }, theme, settings: s })
          : Promise.resolve(null),
        letter ? sb.from("posts").update({ letter }).eq("id", r.post_id) : Promise.resolve(null),
      ]);
      if (metaErr && !missing009(metaErr)) console.error("createPostAction: could not save the caption style", metaErr.message);
      if (letterSaved?.error && !missing009(letterSaved.error)) console.error("createPostAction: could not save the letter", letterSaved.error.message);
      if (closing?.status === "error") console.error("createPostAction: could not add the closing card", closing.message);
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

/** A caption's words (no hashtags), whitespace collapsed: "is this still the generated text?" */
const captionWords = (caption: string | null | undefined) => splitCaption(caption ?? "").text.replace(/\s+/g, " ");

/**
 * Save a caption edited by hand (or put back by Undo). The stored hashtag set (009) becomes the tags
 * actually in the text, so the "never the set of the last 10 posts" check stays honest; the caption
 * style is kept only while the words still match the generated caption (a hashtag-only edit), else null.
 */
export async function updateCaptionAction(postId: string, caption: string): Promise<ActionResult> {
  await requireOwner();
  if (caption.length > 5000) return fail("The caption is too long.");
  const sb = await createClient();
  const { data: post, error: readError } = await sb.from("posts").select("*").eq("id", postId).maybeSingle();
  if (readError) return fail(readError.message);
  if (!post) return fail("Post not found.");
  const p = post as Partial<PostRow>;
  const tags = tagsInText(caption);
  const meta = {
    hashtag_set: tags.length ? tags.join(" ") : null,
    caption_style: captionWords(caption) === captionWords(p.caption) ? (p.caption_style ?? null) : null,
  };
  let { data, error } = await sb.from("posts").update({ caption, ...meta }).eq("id", postId).select("id");
  // Before 009 there is no style / hashtag set column: save the caption alone.
  if (missing009(error)) ({ data, error } = await sb.from("posts").update({ caption }).eq("id", postId).select("id"));
  if (error) return fail(error.message);
  return data?.length ? { ok: true } : fail("Post not found.");
}

/**
 * "Rewrite caption": a fresh Gemini caption in a new style (never the post's current one or the
 * previous post's), written against the latest captions, with new hashtags (never the post's
 * current set or one of the last 10), saved and returned. The owner asked for AI explicitly, so
 * this works even with the "Write captions with AI" switch off. On any AI failure the saved caption
 * is unchanged.
 */
export async function rewriteCaptionAction(postId: string): Promise<ActionResult<{ caption: string }>> {
  await requireOwner();
  if (!UUID_RE.test(postId ?? "")) return fail("Post not found.");
  const sb = await createClient();
  const [{ data: post }, { data: settings, error: settingsError }, latest, { data: cards }] = await Promise.all([
    sb.from("posts").select("*").eq("id", postId).maybeSingle(),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
    loadPostHistory(sb),
    // Name cards only: the closing card's message is not a name (010).
    sb.from("cards").select("name, meaning, position, kind").eq("post_id", postId).eq("kind", "post").order("position"),
  ]);
  if (!post) return fail("Post not found.");
  // Without the settings row the hashtags are unknown: writing would drop them, so stop here.
  if (settingsError || !settings) return fail("Could not read your settings. Your caption is unchanged — try again in a moment.");
  const p = post as PostRow;
  const { data: theme } = await sb.from("themes").select("*").eq("id", p.theme_id).maybeSingle();
  if (!theme) return fail("This post's theme was deleted, so there is nothing to write about.");
  const names: CaptionName[] = (Array.isArray(cards) ? (cards as { name?: string; meaning?: string; kind?: string }[]) : [])
    .filter((c) => c.name && c.meaning && (c.kind ?? "post") === "post").map((c) => ({ name: c.name!, meaning: c.meaning! }));
  // The post's own caption first: the new style and hashtag set differ from it; the previous post's style is avoided too.
  const others = withoutId(latest, postId);
  const own = splitCaption(p.caption ?? "");
  const history = withFirst(others, { id: postId, text: own.text, style: p.caption_style ?? null, set: p.hashtag_set ? tagsInText(p.hashtag_set) : own.tags });
  const captionStyle = pickStyle(history.styles, names, Math.random, others.styles[0] ? [others.styles[0]] : []);
  // A part of an A–Z series (011) keeps saying which part it is, with the series tag.
  const part = seriesPart(p);
  const series = part ? { part } : undefined;
  // A post by letter (013) keeps saying its letter, with its letter tag.
  const letter = isLetter(p.letter) ? p.letter : null;
  const ai = await aiCaptionLine({
    theme: theme as ThemeRow, gender: p.gender, style: p.style, captionStyle, names, recent: history.texts, recentTags: recentTags(history), series, letter,
  }, REWRITE_TIMEOUT_MS);
  if (!ai) return fail("Could not write a new caption right now. Your caption is unchanged — try again in a moment.");
  const { caption, caption_style, hashtag_set } = composePostCaption({ ai, aiOn: true, captionStyle, gender: p.gender, settings: settings as SettingsRow, history, series, letter });
  let { data, error } = await sb.from("posts").update({ caption, caption_style, hashtag_set }).eq("id", postId).select("id");
  // Before 009 there is no style / hashtag set column: save the caption alone.
  if (missing009(error)) ({ data, error } = await sb.from("posts").update({ caption }).eq("id", postId).select("id"));
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
    sb.from("cards").select("name_id, position, shot").eq("post_id", postId),
  ]);
  const used = (cards ?? []).map((c) => c.name_id).filter(Boolean) as string[];
  const next = Math.max(0, ...(cards ?? []).map((c) => c.position as number)) + 1;
  // The post's child age (004): Random = a new child of a random age, a fixed age = the post's
  // child. A post made before ages existed (or before 004 runs: no column) keeps its one baby.
  const plan = planExtraCard({ theme: theme as ThemeRow, gender: p.gender, style: p.style, names: (names ?? []) as NameRow[], usedNameIds: used, nextPosition: next,
    salt: `${postId}|${Date.now()}`, subjectKey: subjectKey(p.post_date, p.gender, p.style), age: storedAge(p.subject_age),
    // Every shot already in the post, so the new card is a new frame and not a near-copy.
    usedShots: (cards ?? []).map((c) => c.shot as string | null).filter((s): s is string => !!s),
    // A post by letter (013): the new name starts with the same letter.
    letter: isLetter(p.letter) ? p.letter : null });
  if (!plan.ok) return fail(plan.reason);
  const { data, error } = await sb.rpc("add_card", { p_post: postId, c: plan.card });
  if (error) return fail(error.message);
  const r = data as { status: string; card_id?: string };
  if (r.status !== "ok" || !r.card_id) return fail("That name was just taken. Try again.");
  return { ok: true, cardId: r.card_id };
}

const CLOSING_NEEDS_010 = "The closing card needs a database update first: run supabase/migrations/010_cta_card.sql in Supabase.";

/** "Add closing card" on a post that has none (made before 010, or deleted): the post's set and child, a rotated message. */
export async function addClosingCardAction(postId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  if (!UUID_RE.test(postId ?? "")) return fail("Post not found.");
  const sb = await createClient();
  const [{ data: post }, { data: settings }, lock] = await Promise.all([
    sb.from("posts").select("*").eq("id", postId).maybeSingle(),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
    generateLockReason(sb),
  ]);
  if (lock) return fail(lock);
  if (!post) return fail("Post not found.");
  const p = post as PostRow;
  const { data: theme } = await sb.from("themes").select("*").eq("id", p.theme_id).maybeSingle();
  if (!theme) return fail("This post's theme was deleted, so its photoshoot can't be matched.");
  const r = await addClosingCard(sb, { post: p, theme: theme as ThemeRow, settings: (settings ?? {}) as Partial<SettingsRow>, force: true });
  if (r.status === "added") return { ok: true, cardId: r.cardId };
  if (r.status === "exists") return fail("This post already has a closing card.");
  if (r.status === "needs010") return fail(CLOSING_NEEDS_010);
  return fail(r.status === "error" ? `Could not add the closing card: ${r.message}` : "Could not add the closing card.");
}
