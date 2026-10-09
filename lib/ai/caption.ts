import "server-only";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { pickPostTags, tagSettings } from "@/lib/captions/hashtags";
import { EMPTY_HISTORY, recentTags, type CaptionHistory } from "@/lib/captions/history";
import { NAME_STYLES, pickStyle, type CaptionName, type CaptionStyle } from "@/lib/captions/styles";
import { askCaption, firstWord, openers, sanitizeText, type AiCaption } from "./caption-core";
import { AZ_SERIES_TAG, partRange, type AzPart } from "@/lib/series/az";
import { isLetter, letterTag } from "@/lib/series/letter";

export type { AiCaption } from "./caption-core";

export const CAPTION_MAX = 240;
/** Captions are not worth holding up a new post for long: past this, the template is used. */
export const CAPTION_TIMEOUT_MS = 9000;
/** "Rewrite caption" is an explicit request the owner waits for, so it gets a little longer. */
export const REWRITE_TIMEOUT_MS = 15000;
const CAPTION_MIN = 25;
/** Names listed for a name style (a post has at most 30 cards; a few are plenty to pick from). */
const NAMES_SHOWN = 13;

type CaptionTheme = Pick<ThemeRow, "title" | "backdrop" | "outfit" | "props" | "lighting" | "palette">;
export type CaptionSettings = Pick<SettingsRow, "caption_template"> & {
  caption_ai?: boolean; hashtags?: string | null; hashtags_always?: string | null; hashtag_pool?: string | null;
};

export interface CaptionInput {
  theme: CaptionTheme; gender: Gender; style?: NameStyle;
  /** The style to write in (rotated per post). */
  captionStyle: CaptionStyle;
  /** The post's names with their real meanings (used by the name styles only). */
  names?: CaptionName[];
  /** The latest captions' words, newest first: the new one must read differently. */
  recent?: string[];
  /** Hashtags used lately: Gemini suggests others. */
  recentTags?: string[];
  /** A part of an A–Z series (011): the caption says which part it is. */
  series?: CaptionSeries;
  /** A post by letter (013): every name starts with this letter, and the caption says so. */
  letter?: string | null;
}
export interface CaptionSeries { part: AzPart }

/** `caption_ai` is undefined until migration 002 runs; treat that as the column default. */
export const captionAiOn = (s: { caption_ai?: boolean | null }) => s.caption_ai ?? TEXT_SETTINGS_DEFAULTS.caption_ai;

export const CAPTION_SYSTEM = [
  "You write the Facebook post caption for @unique_names, a warm, friendly page that shares unique baby names.",
  "Each post is a themed baby photoshoot: a set of photo cards, each showing one baby name and its meaning on the picture.",
  `Write 1 or 2 short, natural sentences (at most ${CAPTION_MAX - 20} characters in total) in the caption style the prompt asks for.`,
  "Sound like a real person who loves baby names talking to parents-to-be: warm, plain everyday words, normal capitalization, not salesy or flowery.",
  "Every caption must read clearly different from the recent captions in the prompt: a different opening word, a different sentence shape and a different question. Never reuse their phrases.",
  "Avoid stock openers and cliches such as \"Get ready\", \"Look no further\", \"Introducing\", \"These lovely\", \"Calling all\" or \"swoon\".",
  "Say \"baby boy names\" or \"baby girl names\" (or close wording) once so readers know what the post is.",
  "Only mention a name when the style asks for one, and then only names from the list in the prompt, spelled exactly. When you say what a name means, use only the meaning given for it: never invent a meaning, an origin or a fact.",
  "Do not mention how many names there are.",
  "The photos are a styled photoshoot set for name ideas, not a real family: never write as if a real baby or family exists (no \"our little one\", \"we loved watching\", \"my baby\"); talk about the set, the mood and the names.",
  "At most one question, and it must be genuine and open. Never engagement bait: no \"comment YES\", \"tag a friend\", \"share if\", \"like if\", \"in the comments\", and never ask anyone to follow, like or share.",
  "Use at most one emoji, or none. No hashtags in the caption, no @mentions, no links, no quotation marks.",
  "Also suggest 1 or 2 hashtags specific to this photoshoot's theme (e.g. #autumnbaby, #oceanbaby), not generic baby-name tags like #babynames or #babyboynames: lowercase letters and digits only, at most 24 characters, right for the post's gender, never #fyp, #foryou, #follow..., #viral or other bait, no other platforms' tags (#tiktok...), and not one of the recent hashtags.",
  "Return JSON: {\"caption\": \"...\", \"tags\": [\"#...\"]}.",
].join("\n");

/** How each style is written (the names in the prompt are the post's own, with their real meanings). */
export const STYLE_GUIDE: Record<CaptionStyle, (g: Gender) => string> = {
  story: (g) => `Story moment. Open inside the photoshoot with one small, concrete moment or detail (a prop, the outfit, the light), then tie it to these baby ${g} names. You may end with a short open question. Do not name any names.`,
  spotlight: (g) => `Name spotlight. Feature 1 or 2 names from the list with their given meanings, woven into a warm sentence about these baby ${g} names. You may end with a short open question.`,
  question: (g) => `Gentle question. Open with a soft, genuine question to parents-to-be about choosing a name (the question is the first sentence), then one short line tying in the photoshoot and these baby ${g} names. No second question. Do not name any names.`,
  choice: (g) => `A or B. Pick two names from the list and ask, naturally, which one readers would choose (for example "Name or Name for ...?"), with a short line about the photoshoot and these baby ${g} names. You may add the meaning of one or both.`,
  fact: (g) => `Fun name fact. Share one small fact that follows directly from a given meaning (what the meaning brings to mind, or an origin only if the meaning states it), naming that name, then tie in these baby ${g} names. No outside facts. You may end with a short open question.`,
  compliment: (g) => `Warm compliment. Open with a kind, specific line to moms and moms-to-be (for example the love and care that goes into choosing a name), then these baby ${g} names and the photoshoot's mood. A question is optional. Do not name any names.`,
};

const t = (s: string) => s.replace(/\s+/g, " ").trim();

export function captionPrompt(input: CaptionInput): string {
  const { theme, gender, style, captionStyle } = input;
  const lines = [
    `Today's post: baby ${gender} names${style === "two-word" ? " (first + middle name pairs)" : ""}.`,
    `Caption style: ${STYLE_GUIDE[captionStyle](gender)}`,
    `Photoshoot theme: ${t(theme.title)}`,
    `Backdrop: ${t(theme.backdrop)}`,
    `Outfit: ${t(theme.outfit)}`,
    `Props: ${t(theme.props)}`,
    `Lighting: ${t(theme.lighting)}`,
    `Colors: ${t(theme.palette)}`,
  ];
  const names = (input.names ?? []).filter((n) => n.name.trim() && n.meaning.trim()).slice(0, NAMES_SHOWN);
  if (NAME_STYLES.includes(captionStyle) && names.length) {
    lines.push("", "Names in this post with their real meanings (use only these, spelled exactly):", ...names.map((n) => `- ${t(n.name)}: ${t(n.meaning)}`));
  }
  if (input.series) {
    const { part } = input.series;
    lines.push("", `This post is Part ${part} of 2 of an A to Z series of single-word baby ${gender} names: one name for each letter from ${partRange(part)}.`,
      `Say naturally that it is Part ${part} of the A to Z series, for example "Part ${part} of our A to Z baby ${gender} names, ${partRange(part)}".`);
  }
  if (isLetter(input.letter)) {
    const l = input.letter;
    lines.push("", `Every name in this post starts with the letter ${l}: baby ${gender} names starting with ${l}.`,
      `Say naturally that these are baby ${gender} names starting with the letter ${l}, for example "baby ${gender} names that start with ${l}".`);
  }
  const recent = (input.recent ?? []).filter(Boolean);
  if (recent.length) {
    lines.push("", "Recent captions on the page, newest first. Yours must read clearly different (opening word, sentence shape, question):",
      ...recent.map((c, i) => `${i + 1}. ${t(c)}`), `Do not start with any of these words: ${openers(recent).join(", ")}.`);
  }
  if (input.recentTags?.length) lines.push("", `Hashtags used recently (suggest different ones): ${input.recentTags.join(" ")}`);
  lines.push("", "Write the caption and suggest the theme hashtags.");
  return lines.join("\n");
}

/** Clean the model's text: no hashtags/mentions/links/quotes, at most one emoji, one paragraph, ≤ CAPTION_MAX. */
export const sanitizeCaption = (raw: string) => sanitizeText(raw, CAPTION_MAX, CAPTION_MIN);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The name's first word as a whole word ("Aurelia" in "Aurelia means golden"). */
const nameRe = (name: string) => new RegExp(`(?<![\\p{L}])${escapeRe(t(name).split(" ")[0])}(?![\\p{L}])`, "iu");

/** "Part 1" / "Part one" (any case). */
const PART_RE: Record<AzPart, RegExp> = { 1: /\bpart\s+(?:1|one)\b/i, 2: /\bpart\s+(?:2|two)\b/i };
const partRe = (part: AzPart) => PART_RE[part];
/** The letter named as such: "letter K", "start with K", "starting with an A", "K names" (the capital itself, so "a" never counts). */
const letterRe = (l: string) => new RegExp([
  String.raw`[Ll]etter\s+["'“‘]?${l}(?!\p{L})`,
  String.raw`\b(?:[Ss]tart|[Bb]egin)\w*\s+with\s+(?:an?\s+|the\s+letter\s+)?["'“‘]?${l}(?!\p{L})`,
  String.raw`(?<!\p{L})${l}[-\s]names\b`,
].join("|"), "u");

/**
 * Why a caption is not right yet: it opens like a recent one, a name style names too few names, a series
 * part does not say its part, or a post by letter does not say its letter.
 */
export function captionProblem(line: string, input: Pick<CaptionInput, "captionStyle" | "names" | "recent" | "series" | "letter">): string | null {
  const w = firstWord(line);
  if (w && openers(input.recent ?? []).includes(w)) return `starts with "${w}" like a recent caption`;
  if (input.series && !partRe(input.series.part).test(line)) return `does not say it is Part ${input.series.part} of the A to Z series`;
  if (isLetter(input.letter) && !letterRe(input.letter).test(line)) return `does not say the names start with the letter ${input.letter}`;
  const need = input.captionStyle === "choice" ? 2 : NAME_STYLES.includes(input.captionStyle) ? 1 : 0;
  if (need && (input.names ?? []).filter((n) => n.name.trim() && nameRe(n.name).test(line)).length < need) {
    return need === 2 ? "does not name two names from the list" : "does not name a name from the list";
  }
  return null;
}

/** One AI caption line (no hashtags) + Gemini's theme hashtags, or null on any failure. Never throws. */
export function aiCaptionLine(input: CaptionInput, timeoutMs = CAPTION_TIMEOUT_MS): Promise<AiCaption | null> {
  return askCaption({
    system: CAPTION_SYSTEM, prompt: captionPrompt(input), maxTags: 3, max: CAPTION_MAX, min: CAPTION_MIN, timeoutMs, label: "aiCaption",
    problem: (line) => captionProblem(line, input),
  });
}

/** The caption line, a blank line, then the hashtags. */
export function withHashtags(line: string, hashtags: string): string {
  const tags = hashtags.trim();
  return tags ? `${line}\n\n${tags}` : line;
}

export const templateLine = (gender: Gender, template: string, series?: CaptionSeries, letter?: string | null) => {
  const line = template.replace(/\{gender\}/g, gender).trim();
  if (series) return `A to Z baby ${gender} names, Part ${series.part} (${partRange(series.part)}). ${line}`.trim();
  return isLetter(letter) ? `Baby ${gender} names starting with ${letter}. ${line}`.trim() : line;
};

export interface PostCaption { caption: string; caption_style: string; hashtag_set: string; source: "ai" | "template" }

/**
 * The finished caption: the AI line + always-tags, theme tags and a rotated pool tag; or, when the
 * line is missing or AI is off, the template + always-tags and 2 rotated pool tags. Either way the
 * hashtag set differs from the last 10 posts in `history`.
 */
export function composePostCaption(o: {
  ai: AiCaption | null; aiOn: boolean; captionStyle: CaptionStyle; gender: Gender; settings: CaptionSettings; history: CaptionHistory;
  /** A part of an A–Z series: the series tag takes the first theme-tag slot, and the template names the part. */
  series?: CaptionSeries;
  /** A post by letter: its letter tag takes the first theme-tag slot, and the template names the letter. */
  letter?: string | null;
}): PostCaption {
  const { always, pool } = tagSettings(o.settings);
  const ai = o.aiOn ? o.ai : null;
  const themeTags = [...(o.series ? [AZ_SERIES_TAG] : isLetter(o.letter) ? [letterTag(o.letter)] : []), ...(ai ? ai.tags : [])];
  const tags = pickPostTags({ always, themeTags, pool, gender: o.gender, history: o.history.sets, poolCount: ai ? 1 : 2 });
  const set = tags.join(" ");
  return ai
    ? { caption: withHashtags(ai.line, set), caption_style: o.captionStyle, hashtag_set: set, source: "ai" }
    : { caption: withHashtags(templateLine(o.gender, o.settings.caption_template, o.series, o.letter), set), caption_style: "template", hashtag_set: set, source: "template" };
}

/**
 * The caption for a post: a style the last post did not use, written by Gemini from the theme
 * (and, for name styles, the post's names) against the recent captions when `caption_ai` is on;
 * otherwise (or on any AI failure) the settings template. Never throws.
 */
export async function aiCaption(input: Omit<CaptionInput, "captionStyle" | "recent" | "recentTags"> & {
  settings: CaptionSettings; history?: CaptionHistory; timeoutMs?: number; rand?: () => number; avoid?: string[];
}): Promise<PostCaption> {
  const history = input.history ?? EMPTY_HISTORY;
  const captionStyle = pickStyle(history.styles, input.names ?? [], input.rand, input.avoid);
  const aiOn = captionAiOn(input.settings);
  const ai = aiOn
    ? await aiCaptionLine({ ...input, captionStyle, recent: history.texts, recentTags: recentTags(history) }, input.timeoutMs)
    : null;
  return composePostCaption({ ai, aiOn, captionStyle, gender: input.gender, settings: input.settings, history });
}
