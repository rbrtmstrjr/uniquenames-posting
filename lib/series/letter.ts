// Posts by letter (Today > By letter): a normal post where every name starts with one chosen letter
// (for a two-word name, the first name). Pure helpers shared by Today, the actions, the planner and captions.
import type { Gender, NameStyle } from "@/lib/db/types";
import { AZ_LETTERS, letterOf, seriesLabel } from "./az";

export const LETTERS = AZ_LETTERS;

/** One capital letter A–Z (what posts.letter stores, migration 013). */
export const isLetter = (x: unknown): x is string => typeof x === "string" && /^[A-Z]$/.test(x);

/** Does this name start with the letter (accents dropped: "Élodie" starts with E)? */
export const startsWith = (name: string, letter: string) => letterOf(name) === letter;

/** Per letter A–Z: how many of these names start with it (pass one gender + style's available names). */
export function letterCounts(names: { name: string }[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(LETTERS.map((l) => [l, 0]));
  for (const n of names) {
    const l = letterOf(n.name);
    if (l) out[l]++;
  }
  return out;
}

/** Posts by letter on Today: per "gender|style" (e.g. "boy|single"), the available names per letter A–Z. */
export type LetterStock = Record<`${Gender}|${NameStyle}`, Record<string, number>>;
export const letterKey = (gender: Gender, style: NameStyle) => `${gender}|${style}` as const;

/** The label a post by letter shows ("Letter A"); null otherwise (or before 013). */
export const letterLabel = (p: { letter?: string | null }) => (isLetter(p.letter) ? `Letter ${p.letter}` : null);

/** A post's small label on Posts / the post page / Today: its A–Z part (old series posts) or its letter. */
export const postLabel = (p: { series?: string | null; series_part?: number | null; letter?: string | null }) => seriesLabel(p) ?? letterLabel(p);

/** The hashtag a post by letter carries in a theme-tag slot: #namesstartingwitha. */
export const letterTag = (letter: string) => `#namesstartingwith${letter.toLowerCase()}`;

/** AI ideas offered when a letter is short: a few more than needed so the owner can choose. */
export const LETTER_IDEAS = { extra: 3, min: 5, max: 12 } as const;
export const ideasWanted = (need: number) => Math.min(LETTER_IDEAS.max, Math.max(LETTER_IDEAS.min, need + LETTER_IDEAS.extra));
