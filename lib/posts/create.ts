import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planPost, withNameOrder, type AgeChoice } from "@/lib/planner";
import { RANK_TIMEOUT_MS, bestFirstOn, bestFirstOrder, rankNames } from "@/lib/ai/rank-names";
import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { validateCreatePost } from "@/lib/actions/helpers";
import { generateLockReason } from "@/lib/actions/generate-guard";
import { aiCaptionLine, CAPTION_TIMEOUT_MS, captionAiOn, composePostCaption, type AiCaption } from "@/lib/ai/caption";
import { loadPostHistory, missingColumn as missing009 } from "@/lib/captions/load";
import { recentTags, type CaptionHistory } from "@/lib/captions/history";
import { NAME_STYLES, pickStyle, type CaptionName, type CaptionStyle } from "@/lib/captions/styles";
import { fail, type ActionResult } from "@/lib/actions/result";
import { fontsOf, sameFonts, validateFonts, type PostFonts } from "@/lib/fonts/post-fonts";
import { addClosingCard } from "@/lib/cta/card";
import { addCoverCard } from "@/lib/cover/card";
import { isLetter } from "@/lib/series/letter";
import type { NameTheme } from "@/lib/autopilot/name-themes";

export interface CreatePostInput {
  gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string;
  /** Chosen on Today; stored on the post (migration 003; an older create_post ignores them). */
  fonts?: PostFonts;
  /** The child's age chosen on Today (default Random). */
  subjectAge?: AgeChoice;
  /** A post by letter: every name starts with it; stored as posts.letter (013). */
  letter?: string;
  /** Autopilot: exactly these available names (count must be null). */
  nameIds?: string[];
  /** Autopilot: a name-theme post (stored as posts.name_theme, 022; the caption names it). */
  nameTheme?: NameTheme | null;
}

/** The post itself (the owner's Generate and Autopilot): plan, caption, create_post, front and closing cards, labels. */
export async function createPostCore(sb: SupabaseClient, input: CreatePostInput): Promise<ActionResult<{ postId: string }>> {
  const badInput = validateCreatePost(input) ?? (input.fonts !== undefined ? validateFonts(input.fonts) : null)
    ?? (input.letter !== undefined && !isLetter(input.letter) ? "Pick a letter A to Z." : null)
    ?? (input.nameIds && input.count !== null ? "Chosen names need an automatic card count." : null);
  if (badInput) return fail(badInput);
  const letter = input.letter ?? null;
  const nameTheme = input.nameTheme ?? null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate)) return fail("Pick a valid date.");
  const fonts = input.fonts ? fontsOf(input.fonts) : null;
  const age: AgeChoice = input.subjectAge ?? "random";
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
      lines.set(key, aiCaptionLine({ theme, gender: input.gender, style: input.style, captionStyle: style, names, recent: h.texts, recentTags: recentTags(h), letter, nameTheme }, left));
    }
    return lines.get(key)!;
  };
  // The 3 best names first (Today, from 023): ONE ranking call per set of names, alongside the caption, under its own
  // deadline (RANK_TIMEOUT_MS) for the whole action; past it, or on any failure, today's order. Autopilot's chosen names
  // come ranked already, so it never asks.
  const rankDeadline = Date.now() + RANK_TIMEOUT_MS;
  const ranks = new Map<string, Promise<number[] | null>>();
  const rankFor = (names: { name: string; meaning: string }[]) => {
    const key = names.map((n) => n.name).join(",");
    if (!ranks.has(key)) {
      const left = rankDeadline - Date.now();
      if (left < 500) return Promise.resolve(null);
      ranks.set(key, rankNames({ gender: input.gender, names }, left));
    }
    return ranks.get(key)!;
  };
  let fontsSaved = false;
  // Chosen names (Autopilot) are read by id: the whole available pool can pass PostgREST's 1000-row cap, and a chosen
  // name beyond it would look "no longer available".
  const namesRead = () => {
    const q = sb.from("names").select("*").eq("gender", input.gender).eq("style", input.style).eq("status", "available");
    return input.nameIds ? q.in("id", input.nameIds) : q;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    // The Generate lock is read in parallel with the first round of reads (no extra round trip).
    const [{ data: settings }, { data: names }, { data: themes }, lock, h] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      namesRead(),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
      attempt === 0 ? generateLockReason(sb) : Promise.resolve(null),
      historyRead,
    ]);
    if (lock) return fail(lock);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const s = settings as SettingsRow;
    const themeRows = (themes ?? []) as ThemeRow[];
    const plan = planPost({
      request: { gender: input.gender, style: input.style, count: input.count, postDate: input.postDate, age, letter, nameIds: input.nameIds ?? null },
      names: (names ?? []) as NameRow[], themes: themeRows, settings: s, themeId: input.themeId,
    });
    if (!plan.ok) return fail(plan.reason);
    const theme = themeRows.find((t) => t.id === plan.theme_id);
    // Name Nest (015): the name's origin and US rank go to the caption as facts; Unique Names has none (no change).
    const rowById = new Map(((names ?? []) as NameRow[]).map((n) => [n.id, n]));
    const postNames: CaptionName[] = plan.cards.map((c) => {
      const row = c.name_id ? rowById.get(c.name_id) : undefined;
      return row?.origin || row?.us_rank ? { name: c.name, meaning: c.meaning, origin: row.origin ?? null, usRank: row.us_rank ?? null } : { name: c.name, meaning: c.meaning };
    });
    // One style per action: the previous post's style is never repeated, the least recently used preferred.
    captionStyle ??= pickStyle(h.styles, postNames);
    const aiOn = captionAiOn(s);
    // The caption and the ranking run side by side: Generate waits for the slower one, never for both in turn.
    const [ai, top] = await Promise.all([
      theme && aiOn ? lineFor(theme, postNames, captionStyle, h) : Promise.resolve(null),
      !input.nameIds && bestFirstOn(s) ? rankFor(plan.cards) : Promise.resolve(null),
    ]);
    // The AI's top names lead; every position keeps its photo plan (the session's cover shot first, still lifes spread).
    const ordered = top ? withNameOrder(plan.cards, bestFirstOrder(top, plan.cards.length)) : plan.cards;
    const { caption, caption_style, hashtag_set } = composePostCaption({ ai, aiOn, captionStyle, gender: input.gender, settings: s, history: h, letter, nameTheme: nameTheme?.title ?? null });
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
      theme_id: plan.theme_id, caption, cards: ordered, ...fonts, subject_age: age,
    } });
    if (error) return fail(`Could not create the post: ${error.message}`);
    const r = data as { status: string; post_id?: string; reason?: string };
    if (r.status === "ok" && r.post_id) {
      // The style and hashtag set (009) let the next post differ. create_post doesn't take them, so they
      // follow in a second write; best effort: before 009, or on an error, the post is simply without them.
      // The closing "follow" card (010) is queued after the name cards, also best effort: before 010, or on
      // an error, the post simply has none (the owner can add it on the post page). A post by letter stores its
      // letter (013) the same way: before 013 it is simply made without its "Letter A" label.
      // The front card (023) is queued the same way, best effort: before 023, switched off, or on an error, the post
      // simply has none (a post is never failed for it).
      const newPost = { id: r.post_id, post_date: input.postDate, gender: input.gender, style: input.style, theme_id: plan.theme_id, subject_age: age };
      const [{ error: metaErr }, closing, front, letterSaved, themeSaved] = await Promise.all([
        sb.from("posts").update({ caption_style, hashtag_set }).eq("id", r.post_id),
        theme ? addClosingCard(sb, { post: newPost, theme, settings: s }) : Promise.resolve(null),
        theme ? addCoverCard(sb, { post: newPost, theme, settings: s, title: { letter, nameTheme: nameTheme?.title ?? null } }) : Promise.resolve(null),
        letter ? sb.from("posts").update({ letter }).eq("id", r.post_id) : Promise.resolve(null),
        nameTheme ? sb.from("posts").update({ name_theme: nameTheme.title }).eq("id", r.post_id) : Promise.resolve(null),
      ]);
      if (metaErr && !missing009(metaErr)) console.error("createPostAction: could not save the caption style", metaErr.message);
      if (letterSaved?.error && !missing009(letterSaved.error)) console.error("createPostAction: could not save the letter", letterSaved.error.message);
      if (themeSaved?.error) console.error("createPostCore: could not save the name theme", themeSaved.error.message);
      if (closing?.status === "error") console.error("createPostAction: could not add the closing card", closing.message);
      if (front?.status === "error") console.error("createPostCore: could not add the front card", front.message);
      revalidatePath("/", "layout");
      return { ok: true, postId: r.post_id };
    }
    if (r.status !== "conflict") return fail(r.reason ?? "Could not create the post.");
  }
  return fail("Those names or that theme were just used by another post. Try again.");
}
