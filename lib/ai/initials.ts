import "server-only";
import type { Gender } from "@/lib/db/types";
import type { GeminiSchema, GenerateJsonResult } from "./gemini";
import { aiJson } from "./provider";
import { activePack } from "@/packs";
import { INITIALS_MEANING_MAX_WORDS, MEANING_MIN_WORDS, filterInitialsCombos, sampleForPrompt, type InitialsCandidate, type InitialsFilterResult } from "./suggest-filter";
import { PROMPT_NAMES_CAP } from "./suggest";

// Fresh two-word names for a post by initials (migration 017): ONE small AI call (Claude Haiku / Gemini, task "small")
// asks for a few more than missing; the deterministic filter keeps only valid, new, kind names with the right initials
// and a card meaning grounded in the two parts' standard meanings (unique pages: no very common names either).

/** A plan waits on this with a spinner on Today (both AI calls together, well inside the page's 60 s); past it the plan goes on without AI names. */
export const INITIALS_TIMEOUT_MS = 45000;
/** The rewrite of stiff meanings is only tried with at least this much of the budget left. */
export const REWRITE_MIN_MS = 6000;

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
          meaning: { type: "STRING", description: `A natural phrase of ${MEANING_MIN_WORDS}-${INITIALS_MEANING_MAX_WORDS} lowercase words built only from the two part meanings` },
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
export function suggestInitialsNames(i: SuggestInitialsInput, timeoutMs = INITIALS_TIMEOUT_MS): Promise<GenerateJsonResult<InitialsCandidate[]>> {
  return aiJson<InitialsCandidate[]>({
    task: "small", system: INITIALS_SYSTEM, prompt: initialsPrompt(i), schema: INITIALS_SCHEMA, temperature: 0.6, thinkingBudget: 2048,
    timeoutMs, parse: namesOf,
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

const REWRITE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: { names: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, meaning: { type: "STRING" } }, required: ["name", "meaning"] } } },
  required: ["names"],
};

/** The corrective ask for card meanings that read as a pile of words (one call, all of them at once). */
export function rewritePrompt(stiff: { name: string; meaning: string; parts: [string, string] }[]): string {
  return [
    "These card meanings are true but read as a pile of words. Rewrite each as a warm, natural English phrase of "
      + `${MEANING_MIN_WORDS} to ${INITIALS_MEANING_MAX_WORDS} lowercase words, using ONLY the words of its two part meanings (a word's other form is fine, like protected → protection or king → kingly), `
      + "joined with small grammar words (a, an, the, of, and, with, by, from, under, who, in, as, like, one, to). Never add new imagery or adjectives. Keep each name exactly.",
    "Example: Ansel Remy (protected by god / oarsman): \"protected god oarsman\" → \"an oarsman under god's protection\".",
    stiff.map((x) => `- ${x.name} (${x.parts[0]} / ${x.parts[1]}): "${x.meaning}"`).join("\n"),
  ].join("\n\n");
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
  const deadline = Date.now() + INITIALS_TIMEOUT_MS;
  const ai = await suggestInitialsNames({
    gender: i.gender, initials: i.initials, count: i.ask, existing: [...i.existing, ...(i.skip ?? [])], examples: i.examples,
    partHints: partHintsFor(i.knownParts, i.initials),
  });
  if (!ai.ok) return { ok: false, error: ai.error };
  const filter = (cands: InitialsCandidate[]) => filterInitialsCombos(cands, [...i.allNames, ...(i.skip ?? [])],
    { initials: i.initials, want: i.want, need: i.need, unique: INITIALS_UNIQUE, knownParts: i.knownParts }, i.gender);
  const first = filter(ai.data);
  const left = deadline - Date.now();
  if (!first.stiffNames.length || left < REWRITE_MIN_MS) return { ok: true, result: first };
  // One retry for stiff meanings only: the AI rewrites them as natural phrases, then the whole batch is checked again.
  const fix = await aiJson<{ name: string; meaning: string }[]>({
    task: "small", system: INITIALS_SYSTEM, prompt: rewritePrompt(first.stiffNames), schema: REWRITE_SCHEMA, temperature: 0.4, timeoutMs: left,
    parse: (raw) => namesOf(raw) as { name: string; meaning: string }[] | null,
  });
  if (!fix.ok) return { ok: true, result: first };
  const better = new Map(fix.data.filter((f) => typeof f.name === "string" && typeof f.meaning === "string").map((f) => [f.name.trim().toLowerCase(), f.meaning]));
  return { ok: true, result: filter(ai.data.map((c) => {
    const m = typeof c.name === "string" ? better.get(c.name.trim().toLowerCase()) : undefined;
    return m ? { ...c, meaning: m } : c;
  })) };
}
