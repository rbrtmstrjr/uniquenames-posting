// The server-side guarantee behind "Suggest with AI": whatever Gemini returns, only valid,
// never-seen names and themes survive. Pure functions (no I/O) so they are easy to test.
import type { Gender, NameStyle } from "@/lib/db/types";
import { nameKey, normalizeName, styleOf } from "@/lib/actions/helpers";
import { validateName, validateTheme, type ThemeInput } from "@/lib/actions/validate";
import { letterOf } from "@/lib/series/az";
import { isCommonName, negativeMeaning, notAGivenName, otherGenderName } from "./common-names";

export interface NameSuggestion { name: string; meaning: string }
export type ThemeFields = Omit<ThemeInput, "gender">;
export interface FilterResult<T> { fresh: T[]; duplicates: number; invalid: number }

/** How many suggestions one request may ask for, and the longest optional "idea" text (shared by UI and actions). */
export const NAME_COUNT = { min: 5, max: 50 } as const;
export const THEME_COUNT = { min: 3, max: 15 } as const;
export const VIBE_MAX = 120;
export const MEANING_MIN_WORDS = 2;
export const MEANING_MAX_WORDS = 6;
/** Longest theme field we accept from the model (the prompt repeats every field on every card). */
export const THEME_FIELD_MAX = 240;

const cleanMeaning = (m: string) => m.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").toLowerCase();

/**
 * Keep suggestions that are valid names of the requested style, with a short lowercase
 * meaning, and whose full name (case/space-insensitive) is in neither `existing` (every
 * name in the database, any gender or status) nor earlier in the batch. A two-word name may
 * share its first OR second word with another name: only the full name must be new.
 */
export function filterNameSuggestions(cands: NameSuggestion[], existing: Iterable<string>, style: NameStyle): FilterResult<NameSuggestion> {
  const have = new Set<string>();
  for (const n of existing) have.add(nameKey(n));
  const fresh: NameSuggestion[] = [];
  let duplicates = 0;
  let invalid = 0;
  for (const c of cands) {
    const name = normalizeName(typeof c?.name === "string" ? c.name : "");
    const meaning = cleanMeaning(typeof c?.meaning === "string" ? c.meaning : "");
    const words = meaning ? meaning.split(" ").length : 0;
    if (validateName(name, meaning) || styleOf(name) !== style || name.split(" ").length > 2 || words < MEANING_MIN_WORDS || words > MEANING_MAX_WORDS) {
      invalid++;
      continue;
    }
    const k = nameKey(name);
    if (have.has(k)) { duplicates++; continue; }
    have.add(k);
    fresh.push({ name, meaning });
  }
  return { fresh, duplicates, invalid };
}

/** Theme titles compare by letters and digits only: "Rock-a-Bye!" = "rock a bye". */
export const themeTitleKey = (title: string): string =>
  title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes|zzes)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  return w.endsWith("s") ? w.slice(0, -1) : w;
}

/**
 * A theme's props as a comparable set: comma (or "and") separated items, lowercased,
 * without a leading article, each word singular, sorted. Two themes with the same set are
 * the same photoshoot even if the title, colors or wording around them differ.
 */
export function propsKey(props: string): string {
  const items = props
    .toLowerCase()
    .split(/,|;|\s+and\s+|\s+&\s+/)
    .map((s) => s.replace(/[^\p{L}\p{N}\s-]+/gu, " ").replace(/\s+/g, " ").trim().replace(/^(a|an|the)\s+/, ""))
    .filter(Boolean)
    .map((s) => s.split(" ").map(singular).join(" "));
  return [...new Set(items)].sort().join("|");
}

// The image model runs with no negative prompt (cfg 1): every word in a theme field is
// something it may draw. Negations ("no clutter") and naming things that must stay out of
// frame (cameras, stands, text) make them appear, so such suggestions are dropped.
const UNSAFE: { re: RegExp; why: string }[] = [
  { re: /\b(no|not|without|avoid|never|free of|instead of)\b/i, why: "negative wording (no/without)" },
  { re: /\b(text|letters?|lettering|alphabet|words?|signs?|signage|banners?|logos?|labels?|titles?|names?|numbers?|writing|written|calligraphy|monogram|books?|storybooks?|newspapers?|maps?|tubes?|cans?|cartons?|packages?|packets?)\b/i, why: "text-like objects" },
  { re: /\b(cameras?|tripods?|stands?|softbox(es)?|reflectors?|lamps?|spotlights?|flash|lens(es)?|paper roll|studio lights?|light fixtures?)\b/i, why: "studio equipment" },
  // (?!-) keeps hand-knitted / hand-carved / mother-of-pearl: craft words, not people.
  { re: /\b(hands?|mom|mother|dad|father|parents?|adults?|person|people)\b(?!-)/i, why: "people in frame" },
];
const TALL = /\b(tall|towering|giant|huge|oversized|life-size|large)\b/i;

/** Why a theme's visual fields could summon unwanted things in the picture, or null when clean. */
export function unsafeThemeWording(t: ThemeFields): string | null {
  for (const k of ["backdrop", "outfit", "props", "lighting", "palette"] as const) {
    for (const u of UNSAFE) if (u.re.test(t[k])) return `${k}: ${u.why}`;
  }
  if (TALL.test(t.props)) return "props: not low";
  return null;
}

/**
 * Keep suggestions that pass validateTheme and the wording check, whose title and props set
 * are both new (against every theme in the database, any status, and earlier in the batch).
 * Colors and concepts may repeat.
 */
export function filterThemeSuggestions(cands: ThemeFields[], existing: { title: string; props: string }[], gender: Gender): FilterResult<ThemeInput> {
  const titles = new Set(existing.map((e) => themeTitleKey(e.title)));
  const propSets = new Set(existing.map((e) => propsKey(e.props)));
  const fresh: ThemeInput[] = [];
  let duplicates = 0;
  let invalid = 0;
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  for (const c of cands) {
    const t: ThemeInput = {
      title: str(c?.title), gender, backdrop: str(c?.backdrop), outfit: str(c?.outfit), props: str(c?.props), lighting: str(c?.lighting), palette: str(c?.palette),
    };
    const tooLong = (["backdrop", "outfit", "props", "lighting", "palette"] as const).some((k) => t[k].length > THEME_FIELD_MAX);
    if (validateTheme(t) || tooLong || unsafeThemeWording(t)) { invalid++; continue; }
    const tk = themeTitleKey(t.title);
    const pk = propsKey(t.props);
    if (!tk || !pk) { invalid++; continue; }
    if (titles.has(tk) || propSets.has(pk)) { duplicates++; continue; }
    titles.add(tk);
    propSets.add(pk);
    fresh.push(t);
  }
  return { fresh, duplicates, invalid };
}

/** Up to `cap` items for the prompt: all of them, or a random sample when the list is long. */
export function sampleForPrompt<T>(items: T[], cap: number, rng: () => number = Math.random): { items: T[]; sampled: boolean } {
  if (items.length <= cap) return { items: [...items], sampled: false };
  const a = [...items];
  for (let i = 0; i < cap; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return { items: a.slice(0, cap), sampled: true };
}

export interface LetterSuggestion extends NameSuggestion { letter: string }
/** "lady or sun": a hedge between two readings. */
const HEDGE = /\bor\b/i;
/** What Gemini returns for the letter fill: the name, its accepted meaning, and who it is given to. */
export interface LetterCandidate extends NameSuggestion { origin?: string; gender?: string }
export interface LetterFilterResult extends FilterResult<LetterSuggestion> {
  /** Valid and new, but the letter was not asked or is already full. */
  offLetter: number;
  /** Very common for this gender (US/PH top 100, classics) or not a given name (a brand, a coinage). */
  blocked: number;
  /** Said (by Gemini, or by the common lists) to be the other gender's name. */
  wrongGender: number;
  /** A sad or harsh meaning ("wounded", "bitter"...). */
  negative: number;
}

/**
 * "Fill missing letters" (A–Z series): the usual single-name filter (valid, a meaning of 2 to 6 words, new
 * against every name in the database and earlier in the batch, case-insensitive), then out go very common
 * names, non-names, the other gender's names and unkind meanings; of the rest, names that start with a
 * requested letter, at most `want` per letter, in Gemini's order (it lists each letter's best first).
 */
export function filterLetterSuggestions(cands: LetterCandidate[], existing: Iterable<string>, needs: { letter: string; want: number }[], gender: Gender): LetterFilterResult {
  const said = new Map(cands.map((c) => [typeof c?.name === "string" ? nameKey(c.name) : "", typeof c?.gender === "string" ? c.gender.trim().toLowerCase() : ""]));
  const other = gender === "boy" ? "girl" : "boy";
  const { fresh, duplicates, invalid: bad } = filterNameSuggestions(cands, existing, "single");
  let invalid = bad;
  const room = new Map(needs.map((n) => [n.letter, n.want]));
  const kept: LetterSuggestion[] = [];
  let offLetter = 0, blocked = 0, wrongGender = 0, negative = 0;
  for (const s of fresh) {
    if (HEDGE.test(s.meaning)) { invalid++; continue; }
    if (isCommonName(s.name, gender) || notAGivenName(s.name)) { blocked++; continue; }
    if (said.get(nameKey(s.name)) === other || otherGenderName(s.name, gender)) { wrongGender++; continue; }
    if (negativeMeaning(s.meaning)) { negative++; continue; }
    const letter = letterOf(s.name);
    const left = letter ? room.get(letter) ?? 0 : 0;
    if (!letter || left <= 0) { offLetter++; continue; }
    room.set(letter, left - 1);
    kept.push({ ...s, letter });
  }
  return { fresh: kept, duplicates, invalid, offLetter, blocked, wrongGender, negative };
}
