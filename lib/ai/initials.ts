import "server-only";
import type { Gender } from "@/lib/db/types";
import type { GeminiSchema, GenerateJsonResult } from "./gemini";
import { aiJson } from "./provider";
import { activePack } from "@/packs";
import { MEANING_MAX_WORDS, MEANING_MIN_WORDS, filterInitialsCombos, sampleForPrompt, type InitialsCandidate, type InitialsFilterResult } from "./suggest-filter";
import { PROMPT_NAMES_CAP } from "./suggest";

// Fresh two-word names for a post by initials (migration 017): ONE small AI call (Claude Haiku / Gemini, task "small")
// asks for a few more than missing; the deterministic filter keeps only valid, new, kind names with the right initials
// and a card meaning grounded in the two parts' standard meanings (unique pages: no very common names either).

/** A plan waits on this with a spinner on Today; past it the plan goes on without AI names. */
export const INITIALS_TIMEOUT_MS = 30000;

export const INITIALS_SYSTEM = activePack().suggest.initialsSystem;
/** Unique Names: very common names are out for both parts (rare initials excepted). */
export const INITIALS_UNIQUE = activePack().suggest.initialsUnique;
/** Style examples (the owner's own two-word names) and known part meanings (per initial) shown in the prompt. */
export const STYLE_EXAMPLES = 10;
export const PART_HINTS = 30;

const INITIALS_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "First name + middle name, capitalized" },
          gender: { type: "STRING", enum: ["boy", "girl", "unisex"], description: "Who the name is given to in real use" },
          part1_meaning: { type: "STRING", description: "The first name's standard meaning, 1-4 plain words" },
          part2_meaning: { type: "STRING", description: "The middle name's standard meaning, 1-4 plain words" },
          meaning: { type: "STRING", description: `${MEANING_MIN_WORDS}-${MEANING_MAX_WORDS} lowercase words built only from the two part meanings` },
        },
        required: ["name", "gender", "part1_meaning", "part2_meaning", "meaning"],
      },
    },
  },
  required: ["names"],
};

export interface SuggestInitialsInput {
  gender: Gender;
  /** Two capitals: the first name's and the middle name's initial ("AR"). */
  initials: string;
  count: number;
  /** Names with these initials already on the page (any status) and names just shown: never repeated. */
  existing: string[];
  /** A few of the owner's own two-word names of this gender: the style to follow. */
  examples?: string[];
  /** The owner's meanings of single names starting with either initial: used when the AI picks one of them. */
  partHints?: { name: string; meaning: string }[];
}

export function initialsPrompt(i: SuggestInitialsInput, rng?: () => number): string {
  const [a, b] = [i.initials[0], i.initials[1]];
  const { items, sampled } = sampleForPrompt(i.existing, PROMPT_NAMES_CAP, rng);
  const examples = (i.examples ?? []).slice(0, STYLE_EXAMPLES);
  const hints = (i.partHints ?? []).slice(0, PART_HINTS * 2);
  return [
    `Suggest ${i.count} two-word baby ${i.gender} names with the initials ${a} and ${b}: the first name starts with ${a} and the middle name starts with ${b}.`,
    `List the best names first. Aim for all ${i.count}: most pairs of letters have many real names across origins (Latin, Greek, Hebrew, Celtic, Norse, Germanic, French, Italian, Spanish, Arabic, Hawaiian and more); return fewer only if you truly know no more real ones.`,
    `Each first name and each middle name is a real given name used for ${i.gender}s (or a unisex name often given to ${i.gender}s), and the pair sounds good together.`,
    ...(examples.length ? [`Match the style of the page's own two-word ${i.gender} names, for example: ${examples.join(", ")}.`] : []),
    ...(hints.length ? [`If you use one of these names as a part, its part meaning is exactly this (the page's own meaning):\n${hints.map((h) => `${h.name} = ${h.meaning}`).join("\n")}`] : []),
    items.length
      ? `${sampled ? `Some of the ${i.existing.length} ${a}·${b} names already on the page (a random sample)` : `${a}·${b} names already on the page or just shown (do not repeat any)`}:\n${items.join(", ")}`
      : `The page has no ${i.gender} names with the initials ${a}·${b} yet.`,
  ].join("\n\n");
}

const namesOf = (raw: unknown): InitialsCandidate[] | null => {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>).names : null;
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as InitialsCandidate[]) : null;
};

/** The AI's two-word names for these initials (unfiltered). Never throws. */
export function suggestInitialsNames(i: SuggestInitialsInput): Promise<GenerateJsonResult<InitialsCandidate[]>> {
  return aiJson<InitialsCandidate[]>({
    task: "small", system: INITIALS_SYSTEM, prompt: initialsPrompt(i), schema: INITIALS_SCHEMA, temperature: 0.6, thinkingBudget: 2048,
    timeoutMs: INITIALS_TIMEOUT_MS, parse: namesOf,
  });
}

/** Up to PART_HINTS known part meanings per initial (the owner's single names), for the prompt. */
export function partHintsFor(knownParts: Map<string, string> | undefined, initials: string): { name: string; meaning: string }[] {
  const out: { name: string; meaning: string }[] = [];
  for (const l of new Set([initials[0], initials[1]])) {
    const mine = [...(knownParts ?? new Map<string, string>()).entries()].filter(([n]) => n.charAt(0).toUpperCase() === l).slice(0, PART_HINTS);
    out.push(...mine.map(([n, meaning]) => ({ name: n.charAt(0).toUpperCase() + n.slice(1), meaning })));
  }
  return out;
}

/**
 * Fresh names for a post by initials, without touching the database: the AI's names, filtered (valid two-word names
 * with a 2-6 word kind meaning grounded in the part meanings, the right initials, new against `allNames` = every name
 * in the database plus `skip`; unique pages: no very common names unless too few pass), at most `want`. `need` = how
 * many the plan is missing (the common-name rule relaxes below it). Never throws.
 */
export async function suggestForInitials(i: {
  gender: Gender; initials: string; want: number; need?: number; ask: number; allNames: string[]; existing: string[]; skip?: string[];
  examples?: string[]; knownParts?: Map<string, string>;
}): Promise<{ ok: true; result: InitialsFilterResult } | { ok: false; error: string }> {
  const ai = await suggestInitialsNames({
    gender: i.gender, initials: i.initials, count: i.ask, existing: [...i.existing, ...(i.skip ?? [])], examples: i.examples,
    partHints: partHintsFor(i.knownParts, i.initials),
  });
  if (!ai.ok) return { ok: false, error: ai.error };
  return { ok: true, result: filterInitialsCombos(ai.data, [...i.allNames, ...(i.skip ?? [])],
    { initials: i.initials, want: i.want, need: i.need, unique: INITIALS_UNIQUE, knownParts: i.knownParts }, i.gender) };
}
