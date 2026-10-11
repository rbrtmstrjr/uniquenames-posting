import "server-only";
import type { Gender } from "@/lib/db/types";
import type { GeminiSchema, GenerateJsonResult } from "./gemini";
import { aiJson } from "./provider";
import { activePack } from "@/packs";
import { MEANING_MAX_WORDS, MEANING_MIN_WORDS, filterInitialsCombos, sampleForPrompt, type InitialsCandidate, type InitialsFilterResult } from "./suggest-filter";
import { PROMPT_NAMES_CAP } from "./suggest";

// Fresh two-word names for a post by initials (migration 017): ONE small AI call (Claude Haiku / Gemini, task "small")
// asks for a few more than missing; the deterministic filter keeps only valid, new, kind names with the right initials.

/** A plan waits on this with a spinner on Today; past it the plan goes on without AI names. */
export const INITIALS_TIMEOUT_MS = 30000;

export const INITIALS_SYSTEM = activePack().suggest.initialsSystem;

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
          first_meaning: { type: "STRING", description: "The first name's accepted meaning" },
          second_meaning: { type: "STRING", description: "The middle name's accepted meaning" },
          meaning: { type: "STRING", description: `${MEANING_MIN_WORDS}-${MEANING_MAX_WORDS} lowercase words blending both meanings` },
        },
        required: ["name", "gender", "first_meaning", "second_meaning", "meaning"],
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
}

export function initialsPrompt(i: SuggestInitialsInput, rng?: () => number): string {
  const [a, b] = [i.initials[0], i.initials[1]];
  const { items, sampled } = sampleForPrompt(i.existing, PROMPT_NAMES_CAP, rng);
  return [
    `Suggest ${i.count} two-word baby ${i.gender} names with the initials ${a} and ${b}: the first name starts with ${a} and the middle name starts with ${b}.`,
    "List the best names first, fewer only if you know no more real ones.",
    `Each first name and each middle name is a real given name used for ${i.gender}s (or a unisex name often given to ${i.gender}s), and the pair sounds good together.`,
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

/**
 * Fresh names for a post by initials, without touching the database: the AI's names, filtered (valid two-word names
 * with a 2-6 word kind meaning, the right initials, new against `allNames` = every name in the database plus `skip`),
 * at most `want`. Never throws.
 */
export async function suggestForInitials(i: { gender: Gender; initials: string; want: number; ask: number; allNames: string[]; existing: string[]; skip?: string[] }):
  Promise<{ ok: true; result: InitialsFilterResult } | { ok: false; error: string }> {
  const ai = await suggestInitialsNames({ gender: i.gender, initials: i.initials, count: i.ask, existing: [...i.existing, ...(i.skip ?? [])] });
  if (!ai.ok) return { ok: false, error: ai.error };
  return { ok: true, result: filterInitialsCombos(ai.data, [...i.allNames, ...(i.skip ?? [])], { initials: i.initials, want: i.want }, i.gender) };
}
