import type { Gender } from "@/lib/db/types";

/**
 * Hashtags per post / reel (migration 009). Facebook asks for fewer than 5 hashtags and demotes
 * repetitive content, so a post gets the owner's "always" tags + 1–2 tags for its theme + 1 tag
 * rotated from the pool (least recently used), at most 4, and never the exact set of one of the
 * last 10 posts. Pure: shared by the server actions and the Settings form.
 */
export const HASHTAGS_ALWAYS_DEFAULT = "#uniquenames";
export const HASHTAG_POOL_DEFAULT =
  "#babynames #babygirlnames #babyboynames #uniquebabynames #namemeaning #momlife #newmom #pregnancy #momtobe #babynameideas";
export const MAX_TAGS = 4;
export const TAG_MAX_LEN = 24;
export const ALWAYS_MAX = 2;
export const POOL_MIN = 3;
export const POOL_MAX = 30;
/** A new set must differ from the sets of this many earlier posts (or reels). */
export const DEDUPE_WINDOW = 10;

const TAG_RE = /^#[a-z0-9]+$/;
/** Engagement-bait / spam tags (kept in step with the filter in 009_captions.sql). */
export const BAIT_TAG_RE = /^#(fyp|foryou|follow|like4like|likeforlike|l4l|f4f|tagafriend|viral|highlight)/;
/** Other platforms' tags (#momsoftiktok, #instagood, #reelsfb, …): noise on a Facebook post (also in 009's filter). */
export const PLATFORM_TAG_RE = /tiktok|instagram|insta|youtube|reelsfb|fbreels|shorts$/;

const normalize = (raw: string) => {
  const t = raw.trim().toLowerCase().replace(/^#+/, "");
  return t ? `#${t}` : "";
};

/** Why a (normalised) tag can't be used, or null when it is fine. */
export function tagProblem(raw: string): string | null {
  const t = normalize(raw);
  if (!t) return "Type a hashtag.";
  if (!TAG_RE.test(t)) return `${t} can only have letters and numbers.`;
  if (t.length > TAG_MAX_LEN) return `${t} is longer than ${TAG_MAX_LEN} characters.`;
  if (BAIT_TAG_RE.test(t)) return `${t} reads as engagement bait to Facebook. Leave it out.`;
  if (PLATFORM_TAG_RE.test(t)) return `${t} is another platform's tag. Leave it out.`;
  return null;
}

/** The tag lower-cased with one leading #, or null when it is invalid or bait. */
export const cleanTag = (raw: string): string | null => (tagProblem(raw) ? null : normalize(raw));

const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Space/comma separated tags, cleaned; invalid ones and repeats are dropped. */
export function parseTags(text: string | null | undefined): string[] {
  return uniq((text ?? "").split(/[\s,]+/).map(cleanTag).filter((t): t is string => !!t));
}

/** A Settings field: every tag valid, and between min and max of them. */
export function validateTagList(text: string, label: string, min: number, max: number): string | null {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    const p = tagProblem(t);
    if (p) return `${label}: ${p}`;
  }
  const n = uniq(tokens.map(normalize)).length;
  if (n > max) return `${label}: at most ${max} hashtags.`;
  if (n < min) return `${label}: add at least ${min} hashtags.`;
  return null;
}

/** No boy tags on girl posts and no girl tags on boy posts; null (reels) = neither. */
export const fitsGender = (tag: string, gender: Gender | null) =>
  gender === "girl" ? !tag.includes("boy") : gender === "boy" ? !tag.includes("girl") : !/boy|girl/.test(tag);

/** "#babyboyname" and "#babyboynames" are the same tag to a reader. */
const stem = (t: string) => t.toLowerCase().replace(/s$/, "");
/** Gemini's suggestions without tags already in play (or in the pool: those rotate on their own) and near-repeats of them. */
const freshSuggestions = (tags: string[], known: string[]) => {
  const seen = new Set(known.map(stem));
  return uniq(tags.map(cleanTag).filter((t): t is string => !!t)).filter((t) => {
    if (seen.has(stem(t))) return false;
    seen.add(stem(t));
    return true;
  });
};

/** Order- and case-insensitive key of a set. */
export const setKey = (tags: string[]) => uniq(tags.map((t) => t.toLowerCase())).sort().join(" ");

/** Every hashtag in a text, lower-cased (old captions carry theirs at the end). */
export const tagsInText = (text: string) => uniq((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.toLowerCase()));

/** A post caption's words (hashtags removed) and its hashtags. */
export function splitCaption(caption: string): { text: string; tags: string[] } {
  const text = caption.replace(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu, "").replace(/[ \t]+$/gm, "").replace(/\s+$/, "").trim();
  return { text, tags: tagsInText(caption) };
}

/**
 * The pool before migration 009: the default pool + the owner's old single hashtags field without
 * bait (#fyp…, #follower, #highlights), the always-tag and repeats. 009 runs the same merge in SQL.
 */
export function legacyPool(hashtags: string | null | undefined, always = HASHTAGS_ALWAYS_DEFAULT): string {
  const have = new Set([...HASHTAG_POOL_DEFAULT.split(" "), ...always.split(" ")]);
  const tagged = (hashtags ?? "").split(/[\s,]+/).filter((t) => t.startsWith("#")).join(" ");
  const extra = parseTags(tagged).filter((t) => !have.has(t));
  return [HASHTAG_POOL_DEFAULT, ...extra].join(" ");
}

export interface TagSettings { always: string[]; pool: string[] }

/** The always-tags and the pool from a settings row; before 009 they come from the defaults + the old hashtags. */
export function tagSettings(row: { hashtags?: string | null; hashtags_always?: string | null; hashtag_pool?: string | null }): TagSettings {
  const alwaysText = row.hashtags_always ?? HASHTAGS_ALWAYS_DEFAULT;
  return {
    always: parseTags(alwaysText).slice(0, ALWAYS_MAX),
    pool: parseTags(row.hashtag_pool ?? legacyPool(row.hashtags, alwaysText)),
  };
}

/** Pool tags not excluded and right for the gender, least recently used first (never used = first, in pool order). */
export function rotatePool(pool: string[], history: string[][], exclude: Set<string>, gender: Gender | null): string[] {
  const lastUse = (t: string) => {
    const i = history.findIndex((set) => set.some((x) => x.toLowerCase() === t));
    return i < 0 ? Infinity : i;
  };
  return uniq(pool.map(cleanTag).filter((t): t is string => !!t && !exclude.has(t) && fitsGender(t, gender)))
    .map((t, i) => ({ t, i, last: lastUse(t) }))
    .sort((a, b) => (b.last === a.last ? a.i - b.i : b.last - a.last))
    .map((x) => x.t);
}

/** Every n-element combination of xs, in order (the first ones use the earliest items). */
function* combos(xs: string[], n: number, from = 0): Generator<string[]> {
  if (n <= 0) { yield []; return; }
  for (let i = from; i <= xs.length - n; i++) for (const rest of combos(xs, n - 1, i + 1)) yield [xs[i], ...rest];
}

const recentKeys = (history: string[][]) => new Set(history.slice(0, DEDUPE_WINDOW).map(setKey));

/**
 * A post's hashtags: always-tags + 1–2 valid theme tags (gender-appropriate) + `poolCount` pool
 * tags (1; 2 for the template fallback) rotated least-recently-used, ≤ 4 in all. A set used by
 * one of the last 10 posts (`history`, newest first) swaps its pool tag, then gives up theme tags.
 */
export function pickPostTags(o: { always: string[]; themeTags: string[]; pool: string[]; gender: Gender; history: string[][]; poolCount?: number }): string[] {
  const base = uniq(o.always.map(cleanTag).filter((t): t is string => !!t)).slice(0, MAX_TAGS);
  const room = MAX_TAGS - base.length;
  const poolN = Math.max(0, Math.min(o.poolCount ?? 1, room));
  const taken = new Set(base);
  // Theme tags are the post's own: generic pool tags Gemini suggests are left to the rotation.
  const theme = freshSuggestions(o.themeTags, [...base, ...o.pool]).filter((t) => fitsGender(t, o.gender))
    .slice(0, Math.max(0, Math.min(2, room - poolN)));
  const recent = recentKeys(o.history);
  let first: string[] | null = null;
  for (let k = theme.length; k >= 0; k--) {
    const head = [...base, ...theme.slice(0, k)];
    const cands = rotatePool(o.pool, o.history, new Set(head), o.gender);
    const n = Math.min(poolN + (theme.length - k), cands.length, MAX_TAGS - head.length);
    for (const c of combos(cands, n)) {
      const set = [...head, ...c];
      first ??= set;
      if (!recent.has(setKey(set))) return set;
    }
  }
  return first ?? base;
}

/**
 * A reel's hashtags: always-tags + 2–3 of the topic tags Gemini proposed (best first), ≤ 4. A set
 * used by one of the last 10 reels swaps its last topic tag for a spare one, then for a neutral
 * pool tag (no boy/girl name tags), then drops it.
 */
export function pickReelTags(o: { always: string[]; topicTags: string[]; pool: string[]; history: string[][] }): string[] {
  const base = uniq(o.always.map(cleanTag).filter((t): t is string => !!t)).slice(0, MAX_TAGS);
  const taken = new Set(base);
  const topic = freshSuggestions(o.topicTags, base);
  const k = Math.min(3, MAX_TAGS - base.length, topic.length);
  const keep = topic.slice(0, Math.max(0, k - 1));
  const cands: string[][] = [topic.slice(0, k)];
  if (k > 0) {
    for (const t of topic.slice(k)) cands.push([...keep, t]);
    for (const t of rotatePool(o.pool, o.history, new Set([...base, ...topic.slice(0, k)]), null)) cands.push([...keep, t]);
    if (keep.length) cands.push(keep);
  } else {
    for (const c of combos(rotatePool(o.pool, o.history, taken, null), Math.min(2, MAX_TAGS - base.length))) cands.push(c);
  }
  const recent = recentKeys(o.history);
  const pick = cands.find((c) => !recent.has(setKey([...base, ...c]))) ?? cands[0];
  return [...base, ...pick];
}
