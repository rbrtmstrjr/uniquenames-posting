import "server-only";
import type { GeminiSchema } from "./gemini";
import { plainWordsProblem } from "./plain-words";
import { aiJson } from "./provider";

/**
 * What post and reel captions share: cleaning the model's text, the engagement-bait and
 * repeated-opener checks, and one Gemini call with a single corrective retry.
 */

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;

/** Clean the model's text: no hashtags/mentions/links/quotes, at most one emoji, one paragraph, ≤ max (null when < min). */
export function sanitizeText(raw: string, max: number, min: number): string | null {
  let s = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?<![\p{L}\p{N}_])(?:[#@][\p{L}\p{N}_]+)+/gu, "") // hashtags/mentions, even glued ("names!#cute#baby")
    .replace(/[*_`~]+/g, "") // markdown emphasis/code/strike
    .replace(/["“”„«»]/g, "")
    .replace(/(^|\s)['‘’]+|['‘’]+(?=\s|$|[.,!?])/g, "$1") // stray single quotes, keep apostrophes in words
    .replace(/\s+/g, " ")
    .trim();
  let seen = 0;
  s = s.replace(EMOJI_RE, (m) => (seen++ === 0 ? m : ""));
  s = s.replace(/\s+([.,!?])/g, "$1").replace(/\s+/g, " ").trim();
  if (s.length > max) s = cut(s, max, min);
  return s.length >= min ? s : null;
}

/** Shorten at the last sentence end that fits, else at a word boundary with an ellipsis. */
function cut(s: string, max: number, min: number): string {
  // One extra character so a sentence ending exactly at the cap (its space at index max) counts.
  let end = -1;
  for (const m of s.slice(0, max + 1).matchAll(/[.!?](?=\s)/g)) if (m.index < max) end = m.index;
  const head = s.slice(0, max);
  if (end >= min) return head.slice(0, end + 1).trim();
  const space = head.slice(0, max - 1).lastIndexOf(" ");
  return `${head.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:–-]+$/, "")}…`;
}

/** Engagement bait Meta demotes ("comment YES", "tag a friend", "share if", "follow for more", …). */
const BAIT_RE = new RegExp([
  String.raw`\bcomment\s+(?:yes|below|if|amen|done)\b`, String.raw`\btype\s+(?:yes|amen)\b`, String.raw`\b(?:in|to)\s+the\s+comments\b`,
  String.raw`\btag\s+(?:a|your|someone|that|every|the)\b`, String.raw`\bshare\s+(?:if|this|with)\b`, String.raw`\blike\s+if\b`,
  String.raw`\bfollow\s+(?:us|me|for|along|the\s+page)\b`, String.raw`\bsmash\b`, String.raw`\bdrop\s+an?\s+(?:comment|heart|emoji|like)\b`,
  String.raw`\bhit\s+(?:like|follow|share)\b`, String.raw`\blink\s+in\s+bio\b`,
].join("|"), "i");
export const hasBait = (s: string) => BAIT_RE.test(s);

/** The first word, lower-cased ("Tiny" from "Tiny boots, big dreams."). */
export const firstWord = (s: string) => s.match(/[\p{L}\p{N}']+/u)?.[0]?.toLowerCase() ?? "";

/** The opening words of earlier captions (for the prompt and the repeat check). */
export const openers = (texts: string[]) => [...new Set(texts.map(firstWord).filter(Boolean))];

export interface AiCaption { line: string; tags: string[] }

export const CAPTION_SCHEMA = (maxTags: number): GeminiSchema => ({
  type: "OBJECT",
  properties: {
    caption: { type: "STRING", description: "The Facebook caption, no hashtags" },
    tags: { type: "ARRAY", items: { type: "STRING" }, maxItems: maxTags, description: "Hashtags, lowercase, best first" },
  },
  required: ["caption", "tags"],
});

const parse = (x: unknown) => {
  const o = x as { caption?: unknown; tags?: unknown } | null;
  if (!o || typeof o.caption !== "string") return null;
  return { caption: o.caption, tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [] };
};

/** A second try (bait, a repeated opener, a missing name) is only made with at least this much time left. */
export const RETRY_MIN_MS = 3000;

/**
 * Ask Gemini for {caption, tags}, clean the caption, and check it: bait, a Filipino / Tagalog word and expert jargon
 * are never accepted; any
 * other `problem` (a repeated opener, …) earns a corrective retry (`attempts` in all, default 2)
 * while time allows, after which the usable caption with the lowest `penalty` is kept (ties: the
 * later one; no penalty = the last usable one). Null on any failure. Never throws.
 */
export async function askCaption(o: {
  system: string; prompt: string; maxTags: number; max: number; min: number; timeoutMs: number; label: string;
  problem: (line: string) => string | null;
  attempts?: number; penalty?: (line: string) => number;
}): Promise<AiCaption | null> {
  const deadline = Date.now() + o.timeoutMs;
  let usable: AiCaption | null = null;
  let usablePenalty = Infinity;
  let note = "";
  for (let attempt = 0; attempt < (o.attempts ?? 2); attempt++) {
    const left = deadline - Date.now();
    if (left <= 0 || (attempt > 0 && left < RETRY_MIN_MS)) break;
    const r = await aiJson({
      task: "small", system: o.system, prompt: o.prompt + note, schema: CAPTION_SCHEMA(o.maxTags), temperature: 1, timeoutMs: left, parse,
    });
    if (!r?.ok) {
      console.warn(`${o.label}: no AI caption:`, r?.error ?? "no answer");
      break;
    }
    const line = sanitizeText(r.data.caption, o.max, o.min);
    if (!line) { note = "\n\nYour last caption was empty or unusable. Write a new one."; continue; }
    if (hasBait(line)) { note = `\n\nYour last caption ("${line}") used engagement bait. Write a new one with a genuine question and no call to comment, tag, share, like or follow.`; continue; }
    // simple global English: a Filipino / Tagalog word or expert jargon is never accepted (like bait)
    const plain = plainWordsProblem(line);
    if (plain) { note = `\n\nYour last caption ("${line}") ${plain}. Write a new one.`; continue; }
    const result = { line, tags: Array.isArray(r.data.tags) ? r.data.tags : [] };
    const problem = o.problem(line);
    if (!problem) return result;
    const penalty = o.penalty?.(line) ?? 0;
    if (penalty <= usablePenalty) { usable = result; usablePenalty = penalty; }
    note = `\n\nYour last caption ("${line}") ${problem}. Write a clearly different one.`;
  }
  return usable;
}
