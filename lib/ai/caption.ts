import "server-only";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { pickPostTags, tagSettings } from "@/lib/captions/hashtags";
import { EMPTY_HISTORY, recentTags, type CaptionHistory } from "@/lib/captions/history";
import { NAME_STYLES, pickStyle, type CaptionName, type CaptionStyle } from "@/lib/captions/styles";
import { askCaption, firstWord, openers, sanitizeText, type AiCaption } from "./caption-core";
import { AZ_SERIES_TAG, partRange, type AzPart } from "@/lib/series/az";
import { isLetter, letterTag } from "@/lib/series/letter";
import { activePack } from "@/packs";

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

export const CAPTION_SYSTEM = activePack().captions.postSystem(CAPTION_MAX);

/** How each style is written (the active pack's wording; the names in the prompt are the post's own, with their real meanings). */
export const STYLE_GUIDE: Record<CaptionStyle, (g: Gender) => string> = activePack().captions.styleGuide;

const t = (s: string) => s.replace(/\s+/g, " ").trim();

/** " (origin: Latin; #3 in the US)" when a name has an origin or a US rank (Name Nest); "" otherwise (Unique Names). */
function nameFacts(n: CaptionName): string {
  const facts = [
    n.origin && t(n.origin) ? `origin: ${t(n.origin)}` : "",
    typeof n.usRank === "number" && n.usRank > 0 ? `#${n.usRank} in the US` : "",
  ].filter(Boolean);
  return facts.length ? ` (${facts.join("; ")})` : "";
}

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
    lines.push("", "Names in this post with their real meanings (use only these, spelled exactly):", ...names.map((n) => `- ${t(n.name)}: ${t(n.meaning)}${nameFacts(n)}`));
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
  const own = activePack().captions.postProblem?.(line);
  if (own) return own;
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
