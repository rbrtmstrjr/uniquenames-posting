import "server-only";
import { askCaption, firstWord, openers, sanitizeText, type AiCaption } from "./caption-core";

/** A reel caption: 1–3 short sentences (the hashtags go after it, from pickReelTags). */
export const REEL_CAPTION_MAX = 300;
const REEL_CAPTION_MIN = 30;
/** Written in the background after the script, so it may take a little longer than a post caption. */
export const REEL_CAPTION_TIMEOUT_MS = 20000;
/** The script text Gemini reads (the whole narration of a 40-line reel is about this long). */
const SCRIPT_CHARS = 2400;

export interface ReelCaptionInput {
  title: string; topic?: string | null; stage?: string | null; hook?: string | null;
  /** The narration, line by line. */
  lines: string[];
  /** The latest reel captions, newest first: the new one must read differently. */
  recent?: string[];
  /** Hashtags used on recent reels: Gemini suggests others. */
  recentTags?: string[];
}

export const REEL_CAPTION_SYSTEM = [
  "You write the Facebook post caption for a narrated parenting reel on a page for moms of babies and toddlers (mostly Filipino moms).",
  `Write 1 to 3 short sentences (at most ${REEL_CAPTION_MAX - 20} characters in total): echo the reel's hook in fresh words, give one concrete, useful takeaway from the script, and end with one genuine open question moms would want to answer from their own life.`,
  "Plain, warm English with normal capitalization, like a mom friend talking. Not salesy, no cliches, no lecturing.",
  "Exactly one question, at the very end. Never engagement bait: no \"comment YES\", \"tag a friend\" or \"tag a mom\", \"share if\", \"like if\", \"drop a heart\", \"in the comments\"; never \"follow us\", \"follow for more\" or any other call to follow, like or share.",
  "It must read clearly different from the recent captions in the prompt: a different opening word, a different sentence shape and a different question. Never reuse their phrases.",
  "At most one emoji, or none. No hashtags in the caption, no @mentions, no links, no quotation marks.",
  "Also suggest 3 to 5 hashtags about this reel's specific topic, best first (for example #toddlertantrums, #gentleparenting, #momtips): lowercase letters and digits only, at most 24 characters each, never #fyp, #foryou, #follow..., #viral or other bait, no other platforms' tags (#momsoftiktok, #instagood...), and different from the recent hashtags.",
  "Return JSON: {\"caption\": \"...\", \"tags\": [\"#...\"]}.",
].join("\n");

const t = (s: string) => s.replace(/\s+/g, " ").trim();

export function reelCaptionPrompt(input: ReelCaptionInput): string {
  let script = input.lines.map(t).filter(Boolean).join(" ");
  if (script.length > SCRIPT_CHARS) script = `${script.slice(0, SCRIPT_CHARS).replace(/\s+\S*$/, "")} …`;
  const lines = [`Reel title: ${t(input.title)}`];
  if (input.topic?.trim()) lines.push(`Topic: ${t(input.topic)}`);
  if (input.stage?.trim()) lines.push(`Child's stage: ${t(input.stage)}`);
  if (input.hook?.trim()) lines.push(`Hook card on screen: ${t(input.hook)}`);
  lines.push(`Script (the narration): ${script}`);
  const recent = (input.recent ?? []).filter(Boolean);
  if (recent.length) {
    lines.push("", "Recent reel captions, newest first. Yours must read clearly different (opening word, sentence shape, question):",
      ...recent.map((c, i) => `${i + 1}. ${t(c)}`), `Do not start with any of these words: ${openers(recent).join(", ")}.`);
  }
  if (input.recentTags?.length) lines.push("", `Hashtags used on recent reels (suggest different ones): ${input.recentTags.join(" ")}`);
  lines.push("", "Write the caption and suggest the topic hashtags.");
  return lines.join("\n");
}

export const sanitizeReelCaption = (raw: string) => sanitizeText(raw, REEL_CAPTION_MAX, REEL_CAPTION_MIN);

/** Why a reel caption is not right yet: it opens like a recent one, or does not end on its one question. */
export function reelCaptionProblem(line: string, recent: string[] = []): string | null {
  const w = firstWord(line);
  if (w && openers(recent).includes(w)) return `starts with "${w}" like a recent caption`;
  const end = line.replace(/[\s\p{Extended_Pictographic}️‍]+$/u, "");
  if (!end.endsWith("?")) return "does not end with one genuine question";
  if ((line.match(/\?/g) ?? []).length > 1) return "asks more than one question";
  return null;
}

/** The reel's caption + Gemini's topic hashtags (best first), or null on any failure. Never throws. */
export function writeReelCaption(input: ReelCaptionInput, timeoutMs = REEL_CAPTION_TIMEOUT_MS): Promise<AiCaption | null> {
  return askCaption({
    system: REEL_CAPTION_SYSTEM, prompt: reelCaptionPrompt(input), maxTags: 5, max: REEL_CAPTION_MAX, min: REEL_CAPTION_MIN, timeoutMs,
    label: "reelCaption", problem: (line) => reelCaptionProblem(line, input.recent),
  });
}
