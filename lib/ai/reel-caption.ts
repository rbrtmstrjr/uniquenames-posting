import "server-only";
import { askCaption, firstWord, openers, sanitizeText, type AiCaption } from "./caption-core";
import { FORMAT_SPECS, isReelFormat } from "@/lib/reels/formats";

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
  /** 014: the reel's format (lib/reels/formats) and its key phrase (the first exact words in quotes). */
  format?: string | null;
  keyPhrase?: string | null;
}

export const REEL_CAPTION_SYSTEM = [
  "You write the Facebook post caption for a narrated parenting reel on a page for moms of babies and young kids (0-7) around the world (most are in the Philippines, others in the US, Africa, Australia and beyond).",
  `Write 1 to 3 short sentences (at most ${REEL_CAPTION_MAX - 20} characters in total): echo the reel's hook in fresh words, give one concrete, useful takeaway from the script, and end with one genuine open question moms would want to answer from their own life.`,
  "When the prompt gives a key phrase, repeat it word for word (without quotation marks, e.g. after a colon) or name the method's name, so the post is worth saving; if the phrase uses I, me, my, we, us or our, name the method's name or the takeaway instead. The question is honest and about this topic, never bait.",
  "Simple, warm English anyone understands, with normal capitalization and no region-specific slang, in everyday words a busy mom gets at a glance. Not salesy, no cliches, no lecturing, no jargon (never name a technique, therapy, study or brain part such as affect labeling, PCIT, serve and return, co-regulation, amygdala or cortisol).",
  "Never a Filipino or Tagalog word or Taglish (no anak, lola, naman, talaga, kasi, lang, mga, OFW): say Grandma, not lola.",
  "This is a brand page, not a person: speak to the mom in the second person (\"you\", \"your little one\"). Never claim personal experience or feelings (no \"I really felt that\", no \"it helped us\"): never use the words I, me, my, we, us or our.",
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
  if (isReelFormat(input.format)) lines.push(`Format: ${FORMAT_SPECS[input.format].label}`);
  if (input.keyPhrase?.trim()) lines.push(`Key phrase (the exact words the reel teaches): ${t(input.keyPhrase)}`);
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

/** First-person words (I, me, my, we, us, our, with contractions like I'm / we're) as whole words: "us" in "useful" is fine. */
const FIRST_PERSON_RE = /(?<![\p{L}\p{N}_'’])(?:i|me|my|we|us|our)(?![\p{L}\p{N}_])/iu;
export const hasFirstPerson = (s: string) => FIRST_PERSON_RE.test(s);

const FIRST_PERSON = "speaks in the first person (I, me, my, we, us, our): a brand page has no experience of its own, so speak to the mom as you / your little one";

/** Every rule a reel caption breaks: first-person experience, a recent opener, not exactly one question (at the end). */
export function reelCaptionProblems(line: string, recent: string[] = []): string[] {
  const out: string[] = [];
  if (hasFirstPerson(line)) out.push(FIRST_PERSON);
  const w = firstWord(line);
  if (w && openers(recent).includes(w)) out.push(`starts with "${w}" like a recent caption`);
  const n = (line.match(/\?/g) ?? []).length;
  if (n > 1) out.push("asks more than one question (ask exactly one)");
  else if (n === 0 || !line.replace(/[\s\p{Extended_Pictographic}️‍]+$/u, "").endsWith("?")) out.push("does not end with one genuine question");
  return out;
}

/** Why a reel caption is not right yet (every broken rule), or null. */
export function reelCaptionProblem(line: string, recent: string[] = []): string | null {
  const p = reelCaptionProblems(line, recent);
  return p.length ? p.join("; it ") : null;
}

/** Fewest broken rules wins; on a tie the one without first-person words. */
export const reelCaptionPenalty = (line: string, recent: string[] = []) =>
  reelCaptionProblems(line, recent).length * 2 + (hasFirstPerson(line) ? 1 : 0);

/** A reel caption gets up to 2 corrective retries (3 attempts) within its deadline. */
export const REEL_CAPTION_ATTEMPTS = 3;

/** The reel's caption + Gemini's topic hashtags (best first), or null on any failure. Never throws. */
export function writeReelCaption(input: ReelCaptionInput, timeoutMs = REEL_CAPTION_TIMEOUT_MS): Promise<AiCaption | null> {
  return askCaption({
    system: REEL_CAPTION_SYSTEM, prompt: reelCaptionPrompt(input), maxTags: 5, max: REEL_CAPTION_MAX, min: REEL_CAPTION_MIN, timeoutMs,
    label: "reelCaption", problem: (line) => reelCaptionProblem(line, input.recent),
    attempts: REEL_CAPTION_ATTEMPTS, penalty: (line) => reelCaptionPenalty(line, input.recent),
  });
}
