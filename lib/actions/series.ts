"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { planAzSeries, type AgeChoice } from "@/lib/planner";
import type { Gender, NameRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { validateCreatePost } from "./helpers";
import { generateLockReason } from "./generate-guard";
import { fail, requireOwner, type ActionResult } from "./result";
import { aiCaptionLine, CAPTION_TIMEOUT_MS, captionAiOn, composePostCaption, type AiCaption, type PostCaption } from "@/lib/ai/caption";
import { loadPostHistory } from "@/lib/captions/load";
import { recentTags, withFirst, type CaptionHistory } from "@/lib/captions/history";
import { splitCaption } from "@/lib/captions/hashtags";
import { NAME_STYLES, pickStyle, type CaptionName, type CaptionStyle } from "@/lib/captions/styles";
import { fontsOf, sameFonts, validateFonts, type PostFonts } from "@/lib/fonts/post-fonts";
import { addClosingCard } from "@/lib/cta/card";
import type { AzPart } from "@/lib/series/az";

const NEEDS_011 = "The A–Z series needs a database update first: run supabase/migrations/011_az_series.sql in Supabase. Nothing was made.";
const missingRpc = (e: { message: string; code?: string }) => e.code === "PGRST202" || /could not find the function|create_series/i.test(e.message);

/**
 * "Make A–Z" on Today (migration 011): one available single name per letter (the oldest-added),
 * Part 1 = A–M and Part 2 = N–Z, both on the same theme and child, made in ONE create_series call
 * (a name is never used twice; a double press makes one series). Each part is an ordinary post
 * after that: its own caption that says its part (in its own style, with the series tag and a
 * different hashtag set) and its closing card. Generate lock and caption deadline as a normal post.
 */
export async function createAzSeriesAction(input: {
  gender: Gender; postDate: string; themeId?: string; requestId: string; fonts?: PostFonts; subjectAge?: AgeChoice;
}): Promise<ActionResult<{ postIds: string[] }>> {
  await requireOwner();
  const badInput = validateCreatePost({ ...input, style: "single", count: null }) ?? (input.fonts !== undefined ? validateFonts(input.fonts) : null);
  if (badInput) return fail(badInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate ?? "")) return fail("Pick a valid date.");
  const fonts = input.fonts ? fontsOf(input.fonts) : null;
  const age: AgeChoice = input.subjectAge ?? "random";
  const sb = await createClient();
  // One caption deadline for the whole action (both parts' lines run in parallel); past it, the template.
  const aiDeadline = Date.now() + CAPTION_TIMEOUT_MS;
  const lines = new Map<string, Promise<AiCaption | null>>();
  const historyRead = loadPostHistory(sb);
  const lineFor = (theme: ThemeRow, part: AzPart, names: CaptionName[], style: CaptionStyle, h: CaptionHistory) => {
    const key = `${theme.id}|${part}|${style}|${NAME_STYLES.includes(style) ? names.map((n) => n.name).join(",") : ""}`;
    const left = aiDeadline - Date.now();
    if (!lines.has(key)) {
      if (left < 500) return Promise.resolve(null);
      lines.set(key, aiCaptionLine({ theme, gender: input.gender, style: "single", captionStyle: style, names, recent: h.texts, recentTags: recentTags(h), series: { part } }, left));
    }
    return lines.get(key)!;
  };
  let styles: CaptionStyle[] | null = null;
  let fontsSaved = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [{ data: settings }, { data: names }, { data: themes }, lock, h] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      // Oldest first: the series uses each letter's longest-waiting name (and a capped read keeps the oldest).
      sb.from("names").select("*").eq("gender", input.gender).eq("style", "single").eq("status", "available").order("created_at").order("id"),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
      attempt === 0 ? generateLockReason(sb) : Promise.resolve(null),
      historyRead,
    ]);
    if (lock) return fail(lock);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const s = settings as SettingsRow;
    const themeRows = (themes ?? []) as ThemeRow[];
    const plan = planAzSeries({ gender: input.gender, postDate: input.postDate, age, names: (names ?? []) as NameRow[], themes: themeRows, themeId: input.themeId });
    if (!plan.ok) return fail(plan.reason);
    const theme = themeRows.find((t) => t.id === plan.theme_id)!;
    const partNames = plan.parts.map((p) => p.cards.map((c) => ({ name: c.name, meaning: c.meaning })));
    // Two different styles: never the previous post's, and Part 2 never Part 1's.
    if (!styles) {
      const first = pickStyle(h.styles, partNames[0]);
      styles = [first, pickStyle([first, ...h.styles], partNames[1])];
    }
    const aiOn = captionAiOn(s);
    const ais = aiOn ? await Promise.all(plan.parts.map((p, k) => lineFor(theme, p.part, partNames[k], styles![k], h))) : [null, null];
    // Part 2's hashtags are picked against Part 1's (and its words count as the newest caption).
    const captions: PostCaption[] = [];
    let history = h;
    for (const [k, p] of plan.parts.entries()) {
      const c = composePostCaption({ ai: ais[k], aiOn, captionStyle: styles[k], gender: input.gender, settings: s, history, series: { part: p.part } });
      captions.push(c);
      history = withFirst(history, { id: null, text: splitCaption(c.caption).text, style: c.caption_style, set: c.hashtag_set.split(" ").filter(Boolean) });
    }
    // The fonts become the "last used" ones before the cards exist (as for a normal post). Best effort.
    if (fonts && !fontsSaved && !sameFonts(fonts, fontsOf(s))) {
      const { error: saveErr } = await sb.from("settings").update(fonts).eq("id", 1);
      if (saveErr) console.error("createAzSeriesAction: could not save the last-used fonts", saveErr.message);
    }
    fontsSaved = true;
    const { data, error } = await sb.rpc("create_series", { p: {
      request_id: input.requestId, post_date: input.postDate, gender: input.gender, theme_id: plan.theme_id, subject_age: age, ...fonts,
      parts: plan.parts.map((p, k) => ({ caption: captions[k].caption, caption_style: captions[k].caption_style, hashtag_set: captions[k].hashtag_set, cards: p.cards })),
    } });
    if (error) return fail(missingRpc(error) ? NEEDS_011 : `Could not create the series: ${error.message}`);
    const r = data as { status: string; post_ids?: string[]; reason?: string };
    if (r.status === "ok" && r.post_ids?.length) {
      // Closing cards one after the other, so Part 2's message differs from Part 1's (the rotation reads the latest).
      for (const id of r.post_ids) {
        const closing = await addClosingCard(sb, { post: { id, post_date: input.postDate, gender: input.gender, style: "single", theme_id: plan.theme_id, subject_age: age }, theme, settings: s });
        if (closing.status === "error") console.error("createAzSeriesAction: could not add the closing card", closing.message);
      }
      revalidatePath("/", "layout");
      return { ok: true, postIds: r.post_ids };
    }
    if (r.status !== "conflict") return fail(r.reason ?? "Could not create the series.");
  }
  return fail("Those names or that theme were just used by another post. Try again.");
}
