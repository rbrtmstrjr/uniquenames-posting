import "server-only";
import type { Gender, NameStyle } from "@/lib/db/types";
import { generateJson, type GeminiSchema, type GenerateJsonResult } from "./gemini";
import { MEANING_MAX_WORDS, MEANING_MIN_WORDS, VIBE_MAX, filterLetterSuggestions, sampleForPrompt, type LetterFilterResult, type NameSuggestion, type ThemeFields } from "./suggest-filter";

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

export const NAMES_SYSTEM = [
  "You suggest baby names for @unique_names, a Facebook page that shares unique, beautiful baby names with their meanings.",
  "Each name is shown on a photo card with its meaning underneath, so both must read well and be true.",
  "Names must be real, pronounceable given names that parents could actually choose: fresh and uncommon, not made-up strings or misspellings.",
  "A two-word name is a first name plus a middle name (like \"Arlo Zenith\" or \"Isla Marigold\"): exactly two words that sound good together.",
  "A single name is exactly one word.",
  "Use only letters, with an optional hyphen or apostrophe inside a word. No titles, numbers, emoji or nicknames in brackets.",
  `The meaning is ${MEANING_MIN_WORDS} to ${MEANING_MAX_WORDS} plain English words, all lowercase, no ending period. It must be true to the names' commonly accepted meanings or origins (for a two-word name, blend both words' meanings, like "peaceful valley of light"). Never invent a meaning.`,
  "Every suggestion must be new: never repeat a name from the existing list, in any spelling or capitalization, and never repeat one inside your own list.",
  "For two-word names you may reuse a first name from the existing list with a different second name, or a second name with a different first name, but never the same pair.",
  "Return JSON: {\"names\": [{\"name\": \"...\", \"meaning\": \"...\"}]}.",
].join("\n");

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
    vibe ? `The owner's wish for this batch: ${vibe}` : "Mix origins and sounds: nature, virtues, mythology, classic names with a fresh twist.",
    items.length
      ? `${sampled ? `Some of the ${i.existing.length} names already on the page (a random sample; the full list is longer, so be extra creative and avoid common picks)` : "Names already on the page (do not repeat any)"}:\n${items.join(", ")}`
      : "The page has no names of this kind yet.",
    `Return exactly ${want} names.`,
  ].join("\n\n");
}

export const THEMES_SYSTEM = [
  "You design baby photoshoot themes for @unique_names. Each theme is one complete studio set that an AI image model photographs: the baby (a newborn or an 8-month-old) poses on it in every picture of a post.",
  "Fields:",
  "- title: 2 to 4 words, a warm name for the set (at most 40 characters).",
  "- backdrop: always written as \"smooth seamless <color> studio backdrop\" (you may add one soft detail, like \"with a soft darker vignette\").",
  "- outfit: one baby outfit: fabric, color and one small detail (a bonnet, a collar, ears on a hood). Say \"knitted\", not \"hand-knitted\".",
  "- props: 2 to 4 small, LOW props, comma-separated, that sit on the floor or blanket beside a lying or sitting baby and stay below the baby's shoulders: baskets, plush or felt toys, wooden toys, cushions, flowers, fruit, knitted pieces. Every prop must be visual only.",
  "- lighting: the quality and direction of the light and the mood (for example \"soft warm light from the left, gentle shadows, cozy\"). Describe the light itself, never the equipment.",
  "- palette: 3 or 4 colors, like \"sage, cream, oat and soft gold\".",
  "The image model draws every word you write and cannot be told what to leave out, so describe ONLY what should be visible:",
  "never use negative wording (no, not, without, avoid, free of);",
  "never mention cameras, stands, lamps, softboxes, reflectors or any studio equipment;",
  "never mention anything with writing or print on it: letters, letter blocks, words, names, signs, banners, books, maps, labels, numbers, or packaged goods (tubes, cans, boxes of products);",
  "never mention people other than the baby (no hands, parents or adults);",
  "never use tall, large or oversized props.",
  "Every theme must be new: its title must differ from every existing title, and its set of props must differ from every existing theme's props. Colors and general concepts may repeat, but the props and other details must be fresh.",
  "Return JSON: {\"themes\": [{\"title\": \"...\", \"backdrop\": \"...\", \"outfit\": \"...\", \"props\": \"...\", \"lighting\": \"...\", \"palette\": \"...\"}]}.",
].join("\n");

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
    vibe ? `The owner's wish for this batch: ${vibe}` : "Vary the moods: seasons, nature, cozy, playful, elegant, fairytale-inspired.",
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
  return generateJson<NameSuggestion[]>({
    system: NAMES_SYSTEM, prompt: namesPrompt(i), schema: NAMES_SCHEMA, temperature: 1, timeoutMs: SUGGEST_TIMEOUT_MS, parse: arrayOf<NameSuggestion>("names"),
  });
}

/** Gemini's theme ideas (unfiltered: run filterThemeSuggestions on them). Never throws. */
export function suggestThemes(i: SuggestThemesInput): Promise<GenerateJsonResult<ThemeFields[]>> {
  return generateJson<ThemeFields[]>({
    system: THEMES_SYSTEM, prompt: themesPrompt(i), schema: THEMES_SCHEMA, temperature: 1, timeoutMs: SUGGEST_TIMEOUT_MS, parse: arrayOf<ThemeFields>("themes"),
  });
}

// ---------------------------------------------------------------- A–Z series: names for missing letters
/** Extra ideas asked per letter, so the uniqueness filter still leaves enough. */
export const LETTER_SPARE = 2;

export interface SuggestLettersInput { gender: Gender; needs: { letter: string; want: number }[]; existing: string[] }

export const LETTERS_SYSTEM = [
  "You suggest baby names for @unique_names, a Facebook page that shares unique, beautiful baby names with their meanings.",
  "Each name is shown on a photo card with its meaning underneath, so both must read well and be true.",
  "This batch fills the gaps in an A to Z series: one baby name per letter of the alphabet. Every name must start with the letter it is asked for.",
  "A single name is exactly one word. Use only letters, with an optional hyphen or apostrophe inside the word. No titles, numbers, emoji or nicknames in brackets.",
  "Only established given names: names listed in mainstream baby-name references and used as first names by real people, from any culture (English, Hebrew, Arabic, Greek, Latin, Irish, Welsh, Hawaiian, Japanese, Yoruba, Sanskrit and so on). Prefer names parents really choose today.",
  "Never invent a name, never respell or shorten a word into a name, and never use a surname, a plant, a place or a fictional name unless it is itself an established given name.",
  "If you know fewer such names for a letter than asked, return fewer for that letter. A short list of real names is right; an invented one is wrong.",
  "For each name give its origin (language or culture) and its commonly accepted meaning in that language, as etymology references give it: one meaning, not a list of alternatives, and never a guess from how the name sounds. If you are not sure of a name's meaning, choose another name.",
  `The meaning is 1 to ${MEANING_MAX_WORDS} plain English words, all lowercase, no commas, no ending period (like "the moon", "little bear" or "peace").`,
  "Every suggestion must be new: never repeat a name from the existing list, in any spelling or capitalization, and never repeat one inside your own list.",
  "Return JSON: {\"names\": [{\"name\": \"...\", \"origin\": \"...\", \"meaning\": \"...\"}]}.",
].join("\n");

const LETTERS_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "One word, capitalized" },
          origin: { type: "STRING", description: "The language or culture the name comes from" },
          meaning: { type: "STRING", description: `1-${MEANING_MAX_WORDS} lowercase English words: the accepted meaning` },
        },
        required: ["name", "origin", "meaning"],
      },
    },
  },
  required: ["names"],
};

export function lettersPrompt(i: SuggestLettersInput, rng?: () => number): string {
  const { items, sampled } = sampleForPrompt(i.existing, PROMPT_NAMES_CAP, rng);
  const ask = i.needs.map((n) => `${n.letter} (${n.want + LETTER_SPARE})`).join(", ");
  const total = i.needs.reduce((t, n) => t + n.want + LETTER_SPARE, 0);
  return [
    `Suggest single-word baby ${i.gender} names that start with these letters (how many in brackets): ${ask}.`,
    `Each name is one word, capitalized, a real ${i.gender} name (or a unisex name given to ${i.gender}s).`,
    items.length
      ? `${sampled ? `Some of the ${i.existing.length} names already on the page (a random sample)` : "Names already on the page (do not repeat any)"}:\n${items.join(", ")}`
      : "The page has no single names of this kind yet.",
    `Return at most ${total} names in total, grouped by letter in the order above.`,
  ].join("\n\n");
}

/** Gemini's names for the missing letters (unfiltered). Never throws. */
export function suggestLetterNames(i: SuggestLettersInput): Promise<GenerateJsonResult<NameSuggestion[]>> {
  return generateJson<NameSuggestion[]>({
    // Low temperature + some thinking: real names and true meanings matter more than variety here.
    system: LETTERS_SYSTEM, prompt: lettersPrompt(i), schema: LETTERS_SCHEMA, temperature: 0.4, thinkingBudget: 2048,
    timeoutMs: SUGGEST_TIMEOUT_MS, parse: arrayOf<NameSuggestion>("names"),
  });
}

/**
 * Fill missing letters, without touching the database: Gemini's names for `needs`, filtered (valid,
 * real-looking single names with a short meaning, new against `allNames` = every name in the
 * database, starting with a requested letter, at most `want` per letter).
 */
export async function suggestForLetters(i: SuggestLettersInput & { allNames: string[] }): Promise<{ ok: true; result: LetterFilterResult } | { ok: false; error: string }> {
  const ai = await suggestLetterNames(i);
  if (!ai.ok) return { ok: false, error: ai.error };
  return { ok: true, result: filterLetterSuggestions(ai.data, i.allNames, i.needs) };
}
