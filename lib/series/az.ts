// The A–Z series (migration 011): one single name per letter, A–M in Part 1 and N–Z in Part 2, made
// together with one theme. Today no longer makes them (posts by letter replaced it), but series posts
// already made keep their Part label and Rewrite caption keeps their part. Pure helpers.

export const AZ_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export type AzPart = 1 | 2;
/** The letters of each part: Part 1 = A–M (13), Part 2 = N–Z (13). */
export const AZ_PARTS: { part: AzPart; letters: string[] }[] = [
  { part: 1, letters: AZ_LETTERS.slice(0, 13) },
  { part: 2, letters: AZ_LETTERS.slice(13) },
];
/** The series hashtag, put in a theme-tag slot of both parts' captions. */
export const AZ_SERIES_TAG = "#atozbabynames";

/** "A to M" / "N to Z" (captions) and "A–M" / "N–Z" (labels). */
export const partRange = (part: AzPart, sep = " to ") => {
  const l = AZ_PARTS[part - 1].letters;
  return `${l[0]}${sep}${l[l.length - 1]}`;
};

type SeriesFields = { series?: string | null; series_part?: number | null };
/** The A–Z part of a post (1 or 2); null for an ordinary post (or before 011). */
export const seriesPart = (p: SeriesFields): AzPart | null =>
  p.series === "az" && (p.series_part === 1 || p.series_part === 2) ? p.series_part : null;

/** The label a series post shows: "A–Z Part 1 (A–M)"; null for an ordinary post (or before 011). */
export function seriesLabel(p: SeriesFields): string | null {
  const part = seriesPart(p);
  return part ? `A–Z Part ${part} (${partRange(part, "–")})` : null;
}

/** A name's first letter A–Z, accents dropped ("Élodie" → E); null when it starts with anything else. */
export function letterOf(name: string): string | null {
  const c = name.trim().normalize("NFD").replace(/\p{M}/gu, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(c) ? c : null;
}

/**
 * A newest-first list with each A–Z series reading Part 1 above Part 2 (Part 2 is made 1 ms later, so
 * by time it would come first): the series' posts swap into their part order within the slots they
 * already hold; every other post keeps its place.
 */
export function partsInOrder<T extends SeriesFields & { series_id?: string | null }>(posts: T[]): T[] {
  const slots = new Map<string, number[]>();
  posts.forEach((p, k) => {
    if (seriesPart(p) && p.series_id) slots.set(p.series_id, [...(slots.get(p.series_id) ?? []), k]);
  });
  const out = [...posts];
  for (const at of slots.values()) {
    const parts = at.map((k) => posts[k]).sort((a, b) => (a.series_part ?? 0) - (b.series_part ?? 0));
    at.forEach((k, i) => { out[k] = parts[i]; });
  }
  return out;
}
