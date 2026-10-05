import "server-only";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { buildCaption } from "@/lib/planner/caption";
import { generateJson, type GeminiSchema } from "./gemini";

export const CAPTION_MAX = 220;
/** Captions are not worth holding up a new post for long: past this, the template is used. */
export const CAPTION_TIMEOUT_MS = 9000;
/** "Rewrite caption" is an explicit request the owner waits for, so it gets a little longer. */
export const REWRITE_TIMEOUT_MS = 15000;
const CAPTION_MIN = 25;

type CaptionTheme = Pick<ThemeRow, "title" | "backdrop" | "outfit" | "props" | "lighting" | "palette">;
type CaptionSettings = Pick<SettingsRow, "caption_template" | "hashtags"> & { caption_ai?: boolean };

export interface CaptionInput { theme: CaptionTheme; gender: Gender; style?: NameStyle }

/** `caption_ai` is undefined until migration 002 runs; treat that as the column default. */
export const captionAiOn = (s: { caption_ai?: boolean | null }) => s.caption_ai ?? TEXT_SETTINGS_DEFAULTS.caption_ai;

export const CAPTION_SYSTEM = [
  "You write the Facebook post caption for @unique_names, a warm, friendly page that shares unique baby names.",
  "Each post is a themed baby photoshoot: a set of photo cards, each showing one baby name and its meaning on the picture.",
  "Write 1 or 2 short, natural sentences (at most 200 characters in total) that introduce today's set of baby boy names or baby girl names and tie in the photoshoot's mood or props.",
  "Sound like a real person who loves baby names talking to parents-to-be: warm, plain everyday words, not salesy or flowery.",
  "Avoid stock openers and cliches such as \"Get ready\", \"Look no further\", \"Introducing\" or \"swoon\"; open with the photoshoot's scene or feeling instead.",
  "You may end with a light question that invites comments, such as which name is their favorite.",
  "Rules: say \"baby boy names\" or \"baby girl names\" (or close wording) so readers know what the post is.",
  "Do not list, quote or invent any names, and never state what a name means.",
  "Do not mention how many names there are.",
  "Use at most one emoji, or none. No hashtags, no @mentions, no links, no quotation marks.",
  "Return JSON: {\"caption\": \"...\"}.",
].join("\n");

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: { caption: { type: "STRING", description: "1-2 sentence Facebook caption, no hashtags" } },
  required: ["caption"],
};

export function captionPrompt({ theme, gender, style }: CaptionInput): string {
  const t = (s: string) => s.replace(/\s+/g, " ").trim();
  return [
    `Today's post: baby ${gender} names${style === "two-word" ? " (first + middle name pairs)" : ""}.`,
    `Photoshoot theme: ${t(theme.title)}`,
    `Backdrop: ${t(theme.backdrop)}`,
    `Outfit: ${t(theme.outfit)}`,
    `Props: ${t(theme.props)}`,
    `Lighting: ${t(theme.lighting)}`,
    `Colors: ${t(theme.palette)}`,
    "Write the caption.",
  ].join("\n");
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;

/** Clean the model's text: no hashtags/mentions/links/quotes, at most one emoji, one paragraph, ≤ CAPTION_MAX. */
export function sanitizeCaption(raw: string): string | null {
  let s = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(^|\s)[#@][\p{L}\p{N}_]+/gu, "$1")
    .replace(/["“”„«»]/g, "")
    .replace(/(^|\s)['‘’]+|['‘’]+(?=\s|$|[.,!?])/g, "$1") // stray single quotes, keep apostrophes in words
    .replace(/\s+/g, " ")
    .trim();
  let seen = 0;
  s = s.replace(EMOJI_RE, (m) => (seen++ === 0 ? m : ""));
  s = s.replace(/\s+([.,!?])/g, "$1").replace(/\s+/g, " ").trim();
  if (s.length > CAPTION_MAX) s = cut(s);
  return s.length >= CAPTION_MIN ? s : null;
}

/** Shorten at the last sentence end that fits, else at a word boundary with an ellipsis. */
function cut(s: string): string {
  const head = s.slice(0, CAPTION_MAX);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end >= CAPTION_MIN) return head.slice(0, end + 1).trim();
  const space = head.slice(0, CAPTION_MAX - 1).lastIndexOf(" ");
  return `${head.slice(0, space > 0 ? space : CAPTION_MAX - 1).replace(/[\s,;:–-]+$/, "")}…`;
}

/** One AI caption line (no hashtags), or null on any failure. Never throws. */
export async function aiCaptionLine(input: CaptionInput, timeoutMs = CAPTION_TIMEOUT_MS): Promise<string | null> {
  const r = await generateJson<{ caption: string }>({
    system: CAPTION_SYSTEM, prompt: captionPrompt(input), schema: SCHEMA, temperature: 1, timeoutMs,
    parse: (x) => (x && typeof (x as { caption?: unknown }).caption === "string" ? (x as { caption: string }) : null),
  });
  if (!r.ok) {
    console.warn("aiCaption: falling back to the template:", r.error);
    return null;
  }
  return sanitizeCaption(r.data.caption);
}

/** The AI line + the owner's hashtags, or the template caption when the line is missing or AI is off. */
export function composeCaption(line: string | null, gender: Gender, s: CaptionSettings): { caption: string; source: "ai" | "template" } {
  if (!line || !captionAiOn(s)) return { caption: buildCaption(gender, s), source: "template" };
  return { caption: withHashtags(line, s.hashtags), source: "ai" };
}

/** The caption line, a blank line, then the owner's hashtags (as the template caption does). */
export function withHashtags(line: string, hashtags: string): string {
  const tags = hashtags.trim();
  return tags ? `${line}\n\n${tags}` : line;
}

/**
 * The caption for a post: Gemini writes it from the theme when `caption_ai` is on,
 * otherwise (or on any AI failure) the settings template. Never throws.
 */
export async function aiCaption(input: CaptionInput & { settings: CaptionSettings; timeoutMs?: number }) {
  if (!captionAiOn(input.settings)) return composeCaption(null, input.gender, input.settings);
  const line = await aiCaptionLine(input, input.timeoutMs);
  return composeCaption(line, input.gender, input.settings);
}
