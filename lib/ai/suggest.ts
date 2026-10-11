import "server-only";
import type { Gender, NameStyle } from "@/lib/db/types";
import type { GeminiSchema, GenerateJsonResult } from "./gemini";
import { aiJson } from "./provider";
import { activePack } from "@/packs";
import { MEANING_MAX_WORDS, MEANING_MIN_WORDS, VIBE_MAX, filterLetterSuggestions, sampleForPrompt, type LetterCandidate, type LetterFilterResult, type NameSuggestion, type ThemeFields } from "./suggest-filter";

/** The active niche pack's suggestion prompts (packs/<id>/suggest.ts). */
const SUGGEST = activePack().suggest;

/** The owner waits on this with a spinner; a long list can take Gemini a while. */
export const SUGGEST_TIMEOUT_MS = 50000;
/** Longest existing-list the prompt carries; beyond it a random sample is sent (the server filter is the real guarantee). */
export const PROMPT_NAMES_CAP = 600;
export const PROMPT_THEMES_CAP = 150;

/** Ask for ~1.5x so the uniqueness filter still leaves enough. */
export const overAsk = (count: number) => Math.ceil(count * 1.5);

export interface SuggestNamesInput { gender: Gender; style: NameStyle; count: number; vibe?: string; existing: string[] }
export interface SuggestThemesInput { gender: Gender; count: number; vibe?: string; existing: { title: string; props: string }[] }

const clip = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, VIBE_MAX);

export const NAMES_SYSTEM = SUGGEST.namesSystem({ min: MEANING_MIN_WORDS, max: MEANING_MAX_WORDS });

const NAMES_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "The full name, capitalized" },
          meaning: { type: "STRING", description: `${MEANING_MIN_WORDS}-${MEANING_MAX_WORDS} lowercase English words` },
        },
        required: ["name", "meaning"],
      },
    },
  },
  required: ["names"],
};

export function namesPrompt(i: SuggestNamesInput, rng?: () => number): string {
  const want = overAsk(i.count);
  const { items, sampled } = sampleForPrompt(i.existing, PROMPT_NAMES_CAP, rng);
  const kind = i.style === "two-word" ? "two-word (first + middle) baby" : "single-word baby";
  const vibe = clip(i.vibe);
  return [
    `Suggest ${want} new ${kind} ${i.gender} names.`,
    vibe ? `The owner's wish for this batch: ${vibe}` : SUGGEST.namesDefaultVibe,
    items.length
      ? `${sampled ? `Some of the ${i.existing.length} names already on the page (a random sample; the full list is longer, so be extra creative and avoid common picks)` : "Names already on the page (do not repeat any)"}:\n${items.join(", ")}`
      : "The page has no names of this kind yet.",
    `Return exactly ${want} names.`,
  ].join("\n\n");
}

export const THEMES_SYSTEM = SUGGEST.themesSystem;

const THEMES_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    themes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" }, backdrop: { type: "STRING" }, outfit: { type: "STRING" },
          props: { type: "STRING", description: "2-4 small low props, comma-separated" }, lighting: { type: "STRING" }, palette: { type: "STRING" },
        },
        required: ["title", "backdrop", "outfit", "props", "lighting", "palette"],
      },
    },
  },
  required: ["themes"],
};

export function themesPrompt(i: SuggestThemesInput, rng?: () => number): string {
  const want = overAsk(i.count);
  const { items, sampled } = sampleForPrompt(i.existing, PROMPT_THEMES_CAP, rng);
  const vibe = clip(i.vibe);
  return [
    `Design ${want} new baby ${i.gender} photoshoot themes.`,
    vibe ? `The owner's wish for this batch: ${vibe}` : SUGGEST.themesDefaultVibe,
    items.length
      ? `${sampled ? "Some of the existing themes (a random sample of a longer list)" : "Existing themes (do not repeat a title or a props set)"}:\n${items.map((e) => `- ${e.title}: ${e.props.replace(/\s+/g, " ").trim()}`).join("\n")}`
      : "There are no existing themes yet.",
    `Return exactly ${want} themes.`,
  ].join("\n\n");
}

const arrayOf = <T>(key: string) => (raw: unknown): T[] | null => {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : null;
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : null;
};

/** Gemini's name ideas (unfiltered: run filterNameSuggestions on them). Never throws. */
export function suggestNames(i: SuggestNamesInput): Promise<GenerateJsonResult<NameSuggestion[]>> {
  return aiJson<NameSuggestion[]>({
    task: "small", system: NAMES_SYSTEM, prompt: namesPrompt(i), schema: NAMES_SCHEMA, temperature: 1, timeoutMs: SUGGEST_TIMEOUT_MS, parse: arrayOf<NameSuggestion>("names"),
  });
}

/** Gemini's theme ideas (unfiltered: run filterThemeSuggestions on them). Never throws. */
export function suggestThemes(i: SuggestThemesInput): Promise<GenerateJsonResult<ThemeFields[]>> {
  return aiJson<ThemeFields[]>({
    task: "small", system: THEMES_SYSTEM, prompt: themesPrompt(i), schema: THEMES_SCHEMA, temperature: 1, timeoutMs: SUGGEST_TIMEOUT_MS, parse: arrayOf<ThemeFields>("themes"),
  });
}

// ---------------------------------------------------------------- posts by letter: names that start with one letter
/** Candidates asked per name wanted: the filter keeps the best (first) ones that pass. */
export const letterCandidates = (count: number) => Math.ceil(count * 1.75);

export interface SuggestLetterInput {
  gender: Gender; style: NameStyle; letter: string; count: number;
  /** Names already on the page that the prompt lists (this gender + style, starting with the letter). */
  existing: string[];
}

export const LETTER_SYSTEM = SUGGEST.letterSystem;

const LETTER_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "The full name, capitalized" },
          origin: { type: "STRING", description: "The language or culture the name comes from" },
          gender: { type: "STRING", enum: ["boy", "girl", "unisex"], description: "Who the name is given to in real use" },
          meaning: { type: "STRING", description: `${MEANING_MIN_WORDS}-${MEANING_MAX_WORDS} lowercase English words: the standard accepted meaning` },
        },
        required: ["name", "origin", "gender", "meaning"],
      },
    },
  },
  required: ["names"],
};

export function letterPrompt(i: SuggestLetterInput, rng?: () => number): string {
  const { items, sampled } = sampleForPrompt(i.existing, PROMPT_NAMES_CAP, rng);
  const want = letterCandidates(i.count);
  const two = i.style === "two-word";
  return [
    two
      ? `Suggest ${want} two-word (first + middle) baby ${i.gender} names whose FIRST name starts with the letter ${i.letter}.`
      : `Suggest ${want} single-word baby ${i.gender} names that start with the letter ${i.letter}.`,
    `List the best names first, fewer only if you know no more real ones.`,
    two
      ? `Each first name is a real given name, given mainly to ${i.gender}s (or a unisex name often given to ${i.gender}s), and starts with ${i.letter}; the middle name is a real given name that suits a ${i.gender} and sounds good after it.`
      : `Each name is one word, capitalized, a real given name, given mainly to ${i.gender}s (or a unisex name often given to ${i.gender}s), starting with ${i.letter}.`,
    items.length
      ? `${sampled ? `Some of the ${i.existing.length} ${i.letter} names already on the page (a random sample)` : `${i.letter} names already on the page (do not repeat any)`}:\n${items.join(", ")}`
      : `The page has no ${two ? "two-word" : "single"} ${i.gender} names starting with ${i.letter} yet.`,
  ].join("\n\n");
}

/** Gemini's names for one letter (unfiltered). Never throws. */
export function suggestLetterNames(i: SuggestLetterInput): Promise<GenerateJsonResult<LetterCandidate[]>> {
  return aiJson<LetterCandidate[]>({
    task: "small",
    // Low temperature + some thinking: real names and true meanings matter more than variety here.
    system: LETTER_SYSTEM, prompt: letterPrompt(i), schema: LETTER_SCHEMA, temperature: 0.4, thinkingBudget: 2048,
    timeoutMs: SUGGEST_TIMEOUT_MS, parse: arrayOf<LetterCandidate>("names"),
  });
}

/**
 * Names for a post by letter, without touching the database: Gemini's candidates, filtered (valid names
 * of the style with a 2-6 word kind meaning, new against `allNames` = every name in the database, not very
 * common, not the other gender's, starting with the letter), at most `count`.
 */
export async function suggestForLetter(i: SuggestLetterInput & { allNames: string[] }): Promise<{ ok: true; result: LetterFilterResult } | { ok: false; error: string }> {
  const ai = await suggestLetterNames(i);
  if (!ai.ok) return { ok: false, error: ai.error };
  return { ok: true, result: filterLetterSuggestions(ai.data, i.allNames, { letter: i.letter, want: i.count, style: i.style }, i.gender) };
}
