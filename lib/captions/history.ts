import { DEDUPE_WINDOW, splitCaption, tagsInText } from "./hashtags";

/** How many earlier captions a new one is written against. */
export const HISTORY_CAPTIONS = 15;

/** The latest captions, newest first: their words (no hashtags), styles and hashtag sets. */
export interface CaptionHistory { ids: (string | null)[]; texts: string[]; styles: (string | null)[]; sets: string[][] }
export const EMPTY_HISTORY: CaptionHistory = { ids: [], texts: [], styles: [], sets: [] };

type PostCaptionRow = { id?: string | null; caption?: string | null; caption_style?: string | null; hashtag_set?: string | null };
type ReelCaptionRow = { id?: string | null; caption?: string | null; hashtags?: string | null };

/** Posts newest first; a post from before 009 has its hashtags read from the end of its caption. */
export function postHistory(rows: PostCaptionRow[]): CaptionHistory {
  const h: CaptionHistory = { ids: [], texts: [], styles: [], sets: [] };
  for (const r of rows) {
    const { text, tags } = splitCaption(r.caption ?? "");
    h.ids.push(r.id ?? null);
    h.texts.push(text);
    h.styles.push(r.caption_style ?? null);
    h.sets.push(r.hashtag_set?.trim() ? tagsInText(r.hashtag_set) : tags);
  }
  return h;
}

/** Reels newest first (only the ones with a caption). */
export function reelHistory(rows: ReelCaptionRow[]): CaptionHistory {
  const h: CaptionHistory = { ids: [], texts: [], styles: [], sets: [] };
  for (const r of rows) {
    if (!r.caption?.trim()) continue;
    h.ids.push(r.id ?? null);
    h.texts.push(r.caption.trim());
    h.styles.push(null);
    h.sets.push(tagsInText(r.hashtags ?? ""));
  }
  return h;
}

/** The history without one row (the post / reel being rewritten). */
export function withoutId(h: CaptionHistory, id: string): CaptionHistory {
  const keep = h.ids.map((x) => x !== id);
  const f = <T>(xs: T[]) => xs.filter((_, i) => keep[i]);
  return { ids: f(h.ids), texts: f(h.texts), styles: f(h.styles), sets: f(h.sets) };
}

/** The history with one row put first (a rewrite differs from the caption it replaces). */
export function withFirst(h: CaptionHistory, row: { id: string | null; text: string; style: string | null; set: string[] }): CaptionHistory {
  return { ids: [row.id, ...h.ids], texts: [row.text, ...h.texts], styles: [row.style, ...h.styles], sets: [row.set, ...h.sets] };
}

/** The hashtags of the latest sets (Gemini is asked to suggest others). */
export const recentTags = (h: CaptionHistory) => [...new Set(h.sets.slice(0, DEDUPE_WINDOW).flat())];
