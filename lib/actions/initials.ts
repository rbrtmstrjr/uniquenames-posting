"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Gender, NameRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { planInitialsPost, type AgeChoice } from "@/lib/planner";
import { aiCaptionLine, CAPTION_TIMEOUT_MS, captionAiOn, composePostCaption, type AiCaption } from "@/lib/ai/caption";
import { loadPostHistory, missingColumn as missing009 } from "@/lib/captions/load";
import { recentTags } from "@/lib/captions/history";
import { pickStyle, type CaptionName } from "@/lib/captions/styles";
import { fontsOf, sameFonts, validateFonts, type PostFonts } from "@/lib/fonts/post-fonts";
import { addClosingCard } from "@/lib/cta/card";
import { has017, missingFunction, planInitialsNames } from "@/lib/data/initials";
import {
  INITIAL_LETTERS, initialsText, initialsWanted, sourceSummary,
  type InitialsCombo, type InitialsSource, type SourceCounts,
} from "@/lib/series/initials";
import { validateCreatePost } from "./helpers";
import { generateLockReason } from "./generate-guard";
import { fail, requireOwner, type ActionResult } from "./result";

// Posts by initials (Today > Initials, migration 017): plan (a preview the owner sees: how many names come from each
// source, and which) and create (re-plans atomically, double-press safe). Names: unused first, then fresh AI names,
// then names used before, least recently used first.

const KEEP_MAX = 30;
const SKIP_MAX = 120;

export interface InitialsRequest {
  gender: Gender;
  /** The first name's initial and the middle name's initial, A–Z. */
  first: string; second: string;
  /** Cards wanted; null = Auto (a stable pick in min–max). */
  count: number | null;
  postDate: string;
}

export type InitialsPreviewName = { source: InitialsSource; name: string; meaning: string };
export type InitialsPlanResult = ActionResult<{
  initials: string; want: number; names: InitialsPreviewName[]; counts: SourceCounts; summary: string; short: number;
  /** The fresh AI names in the plan: send them back with Generate (no new AI call then). */
  fresh: InitialsCombo[];
  /** Why the AI added no (or too few) names, when it failed; the plan used what is unused / used instead. */
  aiNote: string | null;
  /** False before migration 017: names used before can't be reused yet. */
  reuse: boolean;
}>;

const isLetter = (x: unknown): x is string => typeof x === "string" && INITIAL_LETTERS.includes(x);

function badRequest(i: InitialsRequest): string | null {
  if (i.gender !== "boy" && i.gender !== "girl") return "Pick Boy or Girl.";
  if (!isLetter(i.first) || !isLetter(i.second)) return "Pick both initials, A to Z.";
  if (i.count !== null && !Number.isInteger(i.count)) return "The card count must be a whole number.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.postDate ?? "")) return "Pick a valid date.";
  return null;
}

/** Names from the client (shown names to keep or skip): strings of a sane size, a bounded list. */
function badCombos(list: unknown, max: number): string | null {
  if (list === undefined) return null;
  if (!Array.isArray(list) || list.length > max) return "Too many names. Reload and try again.";
  const ok = list.every((c) => c && typeof c === "object" && typeof c.name === "string" && typeof c.meaning === "string" && c.name.length <= 40 && c.meaning.length <= 80);
  return ok ? null : "Bad names. Reload and try again.";
}
function badSkip(list: unknown): string | null {
  if (list === undefined) return null;
  return Array.isArray(list) && list.length <= SKIP_MAX && list.every((s) => typeof s === "string" && s.length <= 40) ? null : "Too many names. Reload and try again.";
}

function countProblem(count: number | null, s: Pick<SettingsRow, "min_images" | "max_images">): string | null {
  return count !== null && (count < s.min_images || count > s.max_images) ? `Number of cards must be ${s.min_images} to ${s.max_images}.` : null;
}

/**
 * The preview on Today before Generate: which names the post would get and from where ("3 unused · 7 new AI · 0
 * reused"). Unused names first; then `keep` (fresh names already shown, re-checked) and, when still short, ONE AI call
 * for a few more (never one of `skip`: Shuffle skips the names it showed); then names used before. Nothing is saved.
 */
export async function planInitialsAction(i: InitialsRequest & { keep?: InitialsCombo[]; skip?: string[] }): Promise<InitialsPlanResult> {
  await requireOwner();
  const bad = badRequest(i) ?? badCombos(i.keep, KEEP_MAX) ?? badSkip(i.skip);
  if (bad) return fail(bad);
  const initials = `${i.first}${i.second}`;
  const sb = await createClient();
  const [{ data: settings }, reuse] = await Promise.all([sb.from("settings").select("*").eq("id", 1).single(), has017(sb)]);
  if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
  const s = settings as SettingsRow;
  const badCount = countProblem(i.count, s);
  if (badCount) return fail(badCount);
  const want = initialsWanted(i.count, s, { postDate: i.postDate, gender: i.gender, initials });
  const r = await planInitialsNames(sb, { gender: i.gender, initials, want, keep: i.keep, skip: i.skip, ai: true, reuse });
  if (!r.ok) return fail(r.error);
  const { plan, fresh, aiError } = r.result;
  return {
    ok: true, initials, want, short: plan.short, counts: plan.counts, summary: sourceSummary(plan.counts), fresh, reuse,
    names: plan.picks.map((p) => ({ source: p.source, name: p.name, meaning: p.meaning })),
    aiNote: aiError ? `${aiError.replace(/\.$/, "")}. Using your unused${reuse ? " and earlier" : ""} names instead.` : null,
  };
}

/**
 * "Generate A·R post": re-plans with fresh reads (no new AI call: the shown AI names are re-checked and used), makes
 * the post in one transaction (create_initials_post, idempotent per requestId) and queues the closing card. A name
 * taken meanwhile re-plans once. Before migration 017 the post is made from unused and AI names only (the AI names are
 * added as unused names first), without its "A·R" label. A post with fewer names than wanted is still made.
 */
export async function createInitialsPostAction(input: InitialsRequest & {
  themeId?: string; requestId: string; fonts?: PostFonts; subjectAge?: AgeChoice; fresh?: InitialsCombo[];
}): Promise<ActionResult<{ postId: string; cards: number; short: number }>> {
  await requireOwner();
  const bad = badRequest(input) ?? badCombos(input.fresh, KEEP_MAX)
    ?? validateCreatePost({ ...input, style: "two-word" }) ?? (input.fonts !== undefined ? validateFonts(input.fonts) : null);
  if (bad) return fail(bad);
  const initials = `${input.first}${input.second}`;
  const label = initialsText(initials);
  const fonts = input.fonts ? fontsOf(input.fonts) : null;
  const age: AgeChoice = input.subjectAge ?? "random";
  const sb = await createClient();
  const aiDeadline = Date.now() + CAPTION_TIMEOUT_MS;
  const lines = new Map<string, Promise<AiCaption | null>>();
  const historyRead = loadPostHistory(sb);
  let reuse = await has017(sb);
  let fontsSaved = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [{ data: settings }, { data: themes }, lock, h] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
      attempt === 0 ? generateLockReason(sb) : Promise.resolve(null),
      historyRead,
    ]);
    if (lock) return fail(lock);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const s = settings as SettingsRow;
    const badCount = countProblem(input.count, s);
    if (badCount) return fail(badCount);
    const want = initialsWanted(input.count, s, { postDate: input.postDate, gender: input.gender, initials });
    const named = await planInitialsNames(sb, { gender: input.gender, initials, want, keep: input.fresh, ai: false, reuse });
    if (!named.ok) return fail(named.error);
    const { plan, stock } = named.result;
    if (!plan.picks.length) return fail(`No ${input.gender} names with the initials ${label} are left. Preview again to ask the AI for new ones.`);
    const themeRows = (themes ?? []) as ThemeRow[];
    const gallery = planInitialsPost({ picks: plan.picks, themes: themeRows, themeId: input.themeId, gender: input.gender, postDate: input.postDate, age });
    if (!gallery.ok) return fail(gallery.reason);
    const theme = themeRows.find((t) => t.id === gallery.theme_id);

    // The caption: the post's names (Name Nest: with origin and US rank) and the initials.
    const rowById = new Map<string, NameRow>([...stock.available, ...stock.used].map((n) => [n.id, n]));
    const postNames: CaptionName[] = plan.picks.map((p) => {
      const row = p.name_id ? rowById.get(p.name_id) : undefined;
      return row?.origin || row?.us_rank ? { name: p.name, meaning: p.meaning, origin: row.origin ?? null, usRank: row.us_rank ?? null } : { name: p.name, meaning: p.meaning };
    });
    const captionStyle = pickStyle(h.styles, postNames);
    const aiOn = captionAiOn(s);
    let ai: AiCaption | null = null;
    if (theme && aiOn) {
      const key = `${theme.id}|${plan.picks.map((p) => p.name).join(",")}`;
      const left = aiDeadline - Date.now();
      if (!lines.has(key) && left >= 500) {
        lines.set(key, aiCaptionLine({ theme, gender: input.gender, style: "two-word", captionStyle, names: postNames, recent: h.texts, recentTags: recentTags(h), initials }, left));
      }
      ai = (await lines.get(key)) ?? null;
    }
    const { caption, caption_style, hashtag_set } = composePostCaption({ ai, aiOn, captionStyle, gender: input.gender, settings: s, history: h, initials });
    if (fonts && !fontsSaved && !sameFonts(fonts, fontsOf(s))) {
      const { error: saveErr } = await sb.from("settings").update(fonts).eq("id", 1);
      if (saveErr) console.error("createInitialsPostAction: could not save the last-used fonts", saveErr.message);
    }
    fontsSaved = true;
    const base = { request_id: input.requestId, post_date: input.postDate, gender: input.gender, theme_id: gallery.theme_id, caption, ...fonts, subject_age: age };

    let postId: string | null = null;
    if (reuse) {
      const { data, error } = await sb.rpc("create_initials_post", { p: {
        ...base, initials, caption_style, hashtag_set,
        cards: gallery.cards.map((c) => ({ position: c.position, source: c.source, name_id: c.name_id, name: c.name, meaning: c.meaning, shot: c.shot, prompt: c.prompt, seed: c.seed })),
      } });
      if (error) {
        if (!missingFunction(error)) return fail(`Could not create the post: ${error.message}`);
        reuse = false; // 017 not run yet: make it the pre-017 way
        continue;
      }
      const r = data as { status: string; post_id?: string; reason?: string };
      if (r.status === "conflict") continue;
      if (r.status !== "ok" || !r.post_id) return fail(r.reason ?? "Could not create the post.");
      postId = r.post_id;
    } else {
      // Before 017: the fresh AI names become unused names first, then create_post takes them like any other.
      const fresh = gallery.cards.filter((c) => c.source === "new");
      const ids = new Map<string, string>();
      if (fresh.length) {
        const { data: added, error: addErr } = await sb.from("names")
          .insert(fresh.map((c) => ({ name: c.name, meaning: c.meaning, gender: input.gender, style: "two-word", status: "available" }))).select("id, name");
        if (addErr) {
          if (addErr.code === "23505") continue;
          return fail(`Could not add the new names: ${addErr.message}`);
        }
        for (const a of (added ?? []) as { id: string; name: string }[]) ids.set(a.name, a.id);
      }
      const cards = gallery.cards.filter((c) => c.source !== "used").map((c) => ({
        position: c.position, name_id: c.name_id ?? ids.get(c.name)!, name: c.name, meaning: c.meaning, shot: c.shot, prompt: c.prompt, seed: c.seed,
      }));
      if (cards.some((c) => !c.name_id)) return fail("Could not add the new names. Try again.");
      const { data, error } = await sb.rpc("create_post", { p: { ...base, style: "two-word", cards } });
      if (error) return fail(`Could not create the post: ${error.message}`);
      const r = data as { status: string; post_id?: string; reason?: string };
      if (r.status === "conflict") continue;
      if (r.status !== "ok" || !r.post_id) return fail(r.reason ?? "Could not create the post.");
      postId = r.post_id;
      const { error: metaErr } = await sb.from("posts").update({ caption_style, hashtag_set }).eq("id", postId);
      if (metaErr && !missing009(metaErr)) console.error("createInitialsPostAction: could not save the caption style", metaErr.message);
    }

    const closing = theme
      ? await addClosingCard(sb, { post: { id: postId, post_date: input.postDate, gender: input.gender, style: "two-word", theme_id: gallery.theme_id, subject_age: age }, theme, settings: s })
      : null;
    if (closing?.status === "error") console.error("createInitialsPostAction: could not add the closing card", closing.message);
    revalidatePath("/", "layout");
    const made = reuse ? gallery.cards.length : gallery.cards.filter((c) => c.source !== "used").length;
    return { ok: true, postId, cards: made, short: Math.max(0, want - made) };
  }
  return fail("Those names or that theme were just used by another post. Try again.");
}
