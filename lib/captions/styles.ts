/**
 * Caption styles for name-card posts (migration 009 stores the style on the post). Each post gets
 * a style the previous post did not use, preferring the least recently used, so the captions on
 * the page don't all read alike.
 */
export const CAPTION_STYLES = ["story", "spotlight", "question", "choice", "fact", "compliment"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export interface CaptionName { name: string; meaning: string }

export const isCaptionStyle = (s: unknown): s is CaptionStyle => (CAPTION_STYLES as readonly unknown[]).includes(s);

/** Styles that put names in the caption (they get the post's names + real meanings). */
export const NAME_STYLES: readonly CaptionStyle[] = ["spotlight", "choice", "fact"];

const ORIGIN_RE = /\b(latin|greek|hebrew|irish|gaelic|welsh|scottish|celtic|french|german|italian|spanish|portuguese|japanese|hawaiian|arabic|sanskrit|norse|old english|english|persian|turkish|filipino|tagalog|hindi|slavic|russian|african|swahili|chinese|korean|native american)\b/i;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** A meaning a fun fact can come from: it names an origin, or says a little more than one or two words. */
const factMeaning = (m: string) => ORIGIN_RE.test(m) || words(m) >= 3;

/** The styles this post's names allow: name styles need names with meanings (A-or-B needs two). */
export function usableStyles(names: CaptionName[]): CaptionStyle[] {
  const withMeaning = names.filter((n) => n.name.trim() && n.meaning.trim());
  return CAPTION_STYLES.filter((s) =>
    s === "spotlight" ? withMeaning.length >= 1
      : s === "choice" ? withMeaning.length >= 2
        : s === "fact" ? withMeaning.some((n) => factMeaning(n.meaning))
          : true);
}

/**
 * The style for the next caption. `recent` = the styles of the latest posts, newest first (unknown
 * entries such as 'template' are ignored); never the newest one or one in `avoid`, the least
 * recently used of the rest, ties broken by `rand`.
 */
export function pickStyle(recent: (string | null | undefined)[], names: CaptionName[], rand: () => number = Math.random, avoid: string[] = []): CaptionStyle {
  const usable = usableStyles(names);
  const banned = new Set([recent[0], ...avoid].filter(Boolean));
  const cands = usable.filter((s) => !banned.has(s));
  const pool = cands.length ? cands : usable;
  const lastUse = (s: CaptionStyle) => {
    const i = recent.indexOf(s);
    return i < 0 ? Infinity : i;
  };
  const best = Math.max(...pool.map(lastUse));
  const tied = pool.filter((s) => lastUse(s) === best);
  return tied[Math.min(tied.length - 1, Math.floor(rand() * tied.length))];
}
