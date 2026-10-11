// The server-side guarantee behind "Suggest with AI": whatever Gemini returns, only valid,
// never-seen names and themes survive. Pure functions (no I/O) so they are easy to test.
import type { Gender, NameStyle } from "@/lib/db/types";
import { nameKey, normalizeName, styleOf } from "@/lib/actions/helpers";
import { validateName, validateTheme, type ThemeInput } from "@/lib/actions/validate";
import { letterOf } from "@/lib/series/az";
import { isCommonName, negativeMeaning, notAGivenName, otherGenderName } from "./common-names";
import { plainWordsProblem } from "./plain-words";
import { initialsOf } from "@/lib/series/initials";
import { groundingProblem, stiffProblem } from "./meaning-grounding";

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
export function filterNameSuggestions(cands: NameSuggestion[], existing: Iterable<string>, style: NameStyle, maxWords: number = MEANING_MAX_WORDS): FilterResult<NameSuggestion> {
  const have = new Set<string>();
  for (const n of existing) have.add(nameKey(n));
  const fresh: NameSuggestion[] = [];
  let duplicates = 0;
  let invalid = 0;
  for (const c of cands) {
    const name = normalizeName(typeof c?.name === "string" ? c.name : "");
    const meaning = cleanMeaning(typeof c?.meaning === "string" ? c.meaning : "");
    const words = meaning ? meaning.split(" ").length : 0;
    if (validateName(name, meaning) || styleOf(name) !== style || name.split(" ").length > 2 || words < MEANING_MIN_WORDS || words > maxWords) {
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
/** What Gemini returns for a letter: the name, its accepted meaning, and who it is given to. */
export interface LetterCandidate extends NameSuggestion { origin?: string; gender?: string }
export interface LetterFilterResult extends FilterResult<LetterSuggestion> {
  /** Valid and new, but another letter, or more than wanted. */
  offLetter: number;
  /** Very common for this gender (US/PH top 100, classics) or not a given name (a brand, a coinage). */
  blocked: number;
  /** Said (by Gemini, or by the common lists) to be the other gender's name. */
  wrongGender: number;
  /** A sad or harsh meaning ("wounded", "bitter"...). */
  negative: number;
}

/**
 * Names for a post by letter: the usual name filter for the style (valid, a meaning of 2 to 6 words, new
 * against every name in the database and earlier in the batch, case-insensitive), then out go very common
 * names, non-names, the other gender's names and unkind meanings; of the rest, names that start with the
 * letter (a two-word name: its first name), at most `want`, in Gemini's order (it lists the best first).
 * For a two-word name the common check reads the first name; the gender and non-name checks read both words.
 */
export function filterLetterSuggestions(cands: LetterCandidate[], existing: Iterable<string>, need: { letter: string; want: number; style: NameStyle }, gender: Gender): LetterFilterResult {
  const said = new Map(cands.map((c) => [typeof c?.name === "string" ? nameKey(c.name) : "", typeof c?.gender === "string" ? c.gender.trim().toLowerCase() : ""]));
  const other = gender === "boy" ? "girl" : "boy";
  const { fresh, duplicates, invalid: bad } = filterNameSuggestions(cands, existing, need.style);
  let invalid = bad;
  let left = need.want;
  const kept: LetterSuggestion[] = [];
  let offLetter = 0, blocked = 0, wrongGender = 0, negative = 0;
  for (const s of fresh) {
    const words = s.name.split(" ");
    if (HEDGE.test(s.meaning)) { invalid++; continue; }
    if (isCommonName(words[0], gender) || words.some(notAGivenName)) { blocked++; continue; }
    if (said.get(nameKey(s.name)) === other || words.some((w) => otherGenderName(w, gender))) { wrongGender++; continue; }
    if (negativeMeaning(s.meaning)) { negative++; continue; }
    if (letterOf(s.name) !== need.letter || left <= 0) { offLetter++; continue; }
    left--;
    kept.push({ ...s, letter: need.letter });
  }
  return { fresh: kept, duplicates, invalid, offLetter, blocked, wrongGender, negative };
}

// ---------------------------------------------------------------- posts by initials (017): fresh AI combos
/** What the AI returns for initials: the full name, who it is for, each part's standard meaning and the blended card meaning. */
export interface InitialsCandidate extends NameSuggestion { gender?: string; part1_meaning?: string; part2_meaning?: string }
/** A fresh two-word name that passed, with the part meanings its card meaning is built from. */
export interface InitialsSuggestion extends NameSuggestion { parts: [string, string] }
export interface InitialsFilterResult extends FilterResult<InitialsSuggestion> {
  /** Valid and new, but other initials, or more than wanted. */
  offInitials: number;
  /** Not a given name (a brand, a coinage) or a Filipino / Tagalog word or jargon in the name or meaning. */
  blocked: number;
  /** A very common name for one part (US / PH top 100, classics) on a page of unique names: in `relaxed`, not `fresh`. */
  common: number;
  /** Otherwise valid names that only pass with the common-name rule relaxed (the plan takes them after names used before). */
  relaxed: InitialsSuggestion[];
  /** Said (by the AI, or by the common lists) to be the other gender's name. */
  wrongGender: number;
  /** A sad or harsh meaning (the card meaning or a part's). */
  negative: number;
  /** The card meaning adds words that are in neither part's meaning (invented imagery), or a part meaning is missing. */
  ungrounded: number;
  /** Grounded but stiff (a pile of words, no grammar): sent back once for a natural rewrite (`stiffNames`). */
  stiff: number;
  stiffNames: { name: string; meaning: string; parts: [string, string] }[];
}

/** A card meaning of a post by initials: 2 to 7 words (one more than other cards, for a natural phrase with "of", "the"). */
export const INITIALS_MEANING_MAX_WORDS = 7;

/** Letters with few real names: on a unique-names page the common-name rule is relaxed for a part with one of these. */
export const RARE_INITIALS = ["Q", "U", "X", "Y", "Z"] as const;
const PART_MEANING_MAX_WORDS = 4;

export interface InitialsFilterOptions {
  initials: string;
  /** At most this many are kept (in the AI's order). */
  want: number;
  /** Unique names (Unique Names): very common names go to `relaxed` for BOTH parts, except a rare initial's part. */
  unique?: boolean;
  /** The owner's own meanings of single names (lowercase name → meaning): a part found here uses this meaning. */
  knownParts?: Map<string, string>;
}

/**
 * Fresh two-word names for a post by initials: the usual name filter (a valid two-word name, a meaning of 2 to 6
 * lowercase words, new against `existing` = every name in the database plus any to skip, and earlier in the batch,
 * case-insensitive), then out go hedged meanings ("x or y"), non-names, Filipino / Tagalog words and jargon, the other
 * gender's names, unkind meanings, other initials, and card meanings not grounded in the two part meanings (the owner's
 * own meaning of a part wins over the AI's). On a unique-names page very common names are out for both parts, except a
 * part with a rare initial; when that leaves fewer than `need`, the rule is relaxed for the part(s) that blocked, and
 * those names come after the uncommon ones. At most `want`, otherwise in the AI's order (it lists the best first).
 */
export function filterInitialsCombos(cands: InitialsCandidate[], existing: Iterable<string>, o: InitialsFilterOptions, gender: Gender): InitialsFilterResult {
  const list = Array.isArray(cands) ? cands.filter((c) => c && typeof c === "object") : [];
  const said = new Map(list.map((c) => [typeof c.name === "string" ? nameKey(c.name) : "", c]));
  const other = gender === "boy" ? "girl" : "boy";
  const { fresh, duplicates, invalid: bad } = filterNameSuggestions(list, existing, "two-word", INITIALS_MEANING_MAX_WORDS);
  const r: InitialsFilterResult = { fresh: [], duplicates, invalid: bad, offInitials: 0, blocked: 0, common: 0, wrongGender: 0, negative: 0, ungrounded: 0, stiff: 0, stiffNames: [], relaxed: [] };
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!]+$/, "") : "");
  const strictPart = o.initials.split("").map((l) => !!o.unique && !(RARE_INITIALS as readonly string[]).includes(l));
  type Ok = InitialsSuggestion & { commonParts: boolean[] };
  const passed: Ok[] = [];
  for (const s of fresh) {
    const words = s.name.split(" ");
    const c = said.get(nameKey(s.name));
    const parts = words.map((w, i) => o.knownParts?.get(w.toLowerCase()) ?? str(i === 0 ? c?.part1_meaning : c?.part2_meaning)) as [string, string];
    if (s.name.length > 40 || s.meaning.length > 80 || HEDGE.test(s.meaning)) { r.invalid++; continue; }
    if (words.some(notAGivenName) || plainWordsProblem(s.name) || plainWordsProblem(s.meaning)) { r.blocked++; continue; }
    if (str(c?.gender) === other || words.some((w) => otherGenderName(w, gender))) { r.wrongGender++; continue; }
    if (negativeMeaning(s.meaning) || parts.some(negativeMeaning)) { r.negative++; continue; }
    if (initialsOf(s.name) !== o.initials) { r.offInitials++; continue; }
    if (parts.some((p) => !p || p.split(" ").length > PART_MEANING_MAX_WORDS + 2) || groundingProblem(s.meaning, parts[0], parts[1])) { r.ungrounded++; continue; }
    if (stiffProblem(s.meaning)) { r.stiff++; r.stiffNames.push({ name: s.name, meaning: s.meaning, parts }); continue; }
    passed.push({ ...s, parts, commonParts: words.map((w) => isCommonName(w, gender)) });
  }
  const allowed = (x: Ok, relax: boolean[]) => x.commonParts.every((isCommon, i) => !isCommon || !strictPart[i] || relax[i]);
  const strict = passed.filter((x) => allowed(x, [false, false]));
  // Common only: relaxing the part that blocked the most names comes first (names common in that part only), then the
  // other part, then both. The plan takes these last, after the owner's names used before.
  const blocked = passed.filter((x) => !strict.includes(x));
  const blockedBy = [0, 1].map((i) => blocked.filter((x) => x.commonParts[i] && strictPart[i]).length);
  const top = blockedBy[0] >= blockedBy[1] ? [true, false] : [false, true];
  const rank = (x: Ok) => (allowed(x, top) ? 0 : allowed(x, [!top[0], !top[1]]) ? 1 : 2);
  const relaxed = [...blocked].sort((a, b) => rank(a) - rank(b));
  r.common = relaxed.length;
  const out = (x: Ok) => ({ name: x.name, meaning: x.meaning, parts: x.parts });
  for (const x of strict) {
    if (r.fresh.length >= o.want) { r.offInitials++; continue; }
    r.fresh.push(out(x));
  }
  r.relaxed = relaxed.slice(0, o.want).map(out);
  return r;
}
