import "server-only";
import type { Gender } from "@/lib/db/types";
import type { GeminiSchema } from "@/lib/ai/gemini";
import { chunks } from "@/lib/actions/helpers";
import { judgeJson, type JudgeResult, type Usage } from "./claude-judge";

// The parent's-eye check: every name a post would use is judged the way a mom in the US, Canada, the UK or Australia
// choosing her own baby's name would. "good" = a parent would happily choose it (a saved name that is not good gets skipped); "fits" = right for
// THIS post (the letter or the name theme, and not too close to another name in the list).

export type NameTarget = { kind: "letter"; letter: string } | { kind: "theme"; title: string; hint: string | null };
/** `meaning_wrong`: the meaning we have is wrong (not just worded differently); only then is a saved name's meaning replaced. */
/** `appeal`: how much a parent would love to choose it, 1 to 10 from the judge (0 = not judged, or no meaning). */
export interface NameVerdict { name: string; good: boolean; fits: boolean; reason: string; meaning: string; meaning_wrong: boolean; appeal: number }

export const NAMES_JUDGE_SYSTEM = [
  "You are a mom in the US, Canada, the UK or Australia choosing a name for your own baby, and an expert in baby names and their real meanings.",
  "You review names for a Facebook page that shares baby name ideas with parents in the US, Canada, the UK and Australia (many Filipino moms follow it too). Only names a real parent there would happily choose may pass.",
  "good = false when ANY of these is true:",
  "- it is made up, misspelled, or so rare that almost nobody has it",
  "- it is awkward or hard to say for an English-speaking family, or sounds like a joke, a brand, an insult or a word with a bad sense in English or Filipino",
  "- its real meaning is bad, sad, silly or unknown",
  "- it is given mainly to the other gender",
  "fits = false when it does not truly fit this post (the letter or the name theme), or it is too close in sound or spelling to another name in the list (keep the better one).",
  "meaning: for a good name, its standard accepted meaning in 2 to 6 lowercase English words (fix the given meaning if it is wrong); empty otherwise.",
  "meaning_wrong: true only when the meaning we have is wrong, not just worded differently; false otherwise.",
  "reason: why it is not good or does not fit, in a few plain words ('made up', 'hard to say', 'bad meaning', 'mostly a boy name', 'too close to Aria', 'not biblical'); empty when it passes.",
  "appeal: how much a parent would love to choose this name, from 1 to 10 (pretty, meaningful, easy to say, special); 1 for a name that is not good.",
  "Judge every name in the list exactly once.",
].join("\n");

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" }, good: { type: "BOOLEAN" }, fits: { type: "BOOLEAN" },
          reason: { type: "STRING" }, meaning: { type: "STRING" }, meaning_wrong: { type: "BOOLEAN" },
          appeal: { type: "INTEGER", description: "1 to 10: how much a parent would love to choose it" },
        },
        required: ["name", "good", "fits", "reason", "meaning", "meaning_wrong", "appeal"],
      },
    },
  },
  required: ["names"],
};

export const JUDGE_NAMES_AT_ONCE = 60;

export function namesJudgePrompt(i: { gender: Gender; target: NameTarget; names: { name: string; meaning: string }[] }): string {
  const fit = i.target.kind === "letter"
    ? `Every name must start with the letter ${i.target.letter}.`
    : `Every name must truly be a "${i.target.title}" name${i.target.hint ? ` (${i.target.hint})` : ""}.`;
  return [`Baby ${i.gender} names for one post. ${fit}`, "Names (name: the meaning we have):", ...i.names.map((n) => `- ${n.name}: ${n.meaning}`)].join("\n");
}

/** Lowercase letters, spaces, apostrophes, hyphens and commas ("gift of god, gracious"); anything else is dropped. */
const cleanMeaning = (m: string) => m.toLowerCase().replace(/[^\p{L}\s',-]/gu, " ").replace(/\s+,/g, ",").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").slice(0, 80);

function parseVerdicts(raw: unknown): NameVerdict[] | null {
  const list = raw && typeof raw === "object" ? (raw as { names?: unknown }).names : null;
  if (!Array.isArray(list)) return null;
  const valid = list.filter((v): v is NameVerdict => !!v && typeof v === "object"
    && typeof (v as NameVerdict).name === "string" && typeof (v as NameVerdict).good === "boolean" && typeof (v as NameVerdict).fits === "boolean"
    && typeof (v as NameVerdict).reason === "string" && typeof (v as NameVerdict).meaning === "string"
    && Number.isInteger((v as NameVerdict).appeal) && (v as NameVerdict).appeal >= 1 && (v as NameVerdict).appeal <= 10);
  return valid.length ? valid : null;
}

/** Claude's verdicts in the order of `names` (matched by name, any case); a name it skipped fails as "not judged". */
export async function judgeNames(i: { gender: Gender; target: NameTarget; names: { name: string; meaning: string }[] }): Promise<JudgeResult<NameVerdict[]>> {
  const usage: Usage = { input: 0, output: 0 };
  const out: NameVerdict[] = [];
  for (const batch of chunks(i.names, JUDGE_NAMES_AT_ONCE)) {
    const r = await judgeJson<NameVerdict[]>({
      system: NAMES_JUDGE_SYSTEM, schema: SCHEMA, parse: parseVerdicts, timeoutMs: 120_000,
      content: [{ type: "text", text: namesJudgePrompt({ ...i, names: batch }) }],
    });
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    if (!r.ok) return { ...r, usage };
    const byName = new Map(r.data.map((v) => [v.name.trim().toLowerCase(), v]));
    for (const n of batch) {
      const v = byName.get(n.name.trim().toLowerCase());
      if (!v) { out.push({ name: n.name, good: false, fits: false, reason: "not judged", meaning: "", meaning_wrong: false, appeal: 0 }); continue; }
      const meaning = cleanMeaning(v.meaning);
      out.push(v.good && v.fits && !meaning
        ? { name: n.name, good: false, fits: v.fits, reason: "no meaning", meaning: "", meaning_wrong: false, appeal: 0 }
        : { name: n.name, good: v.good, fits: v.fits, reason: v.reason.trim().slice(0, 80), meaning: v.good ? meaning : "", meaning_wrong: v.good && !!meaning && v.meaning_wrong === true, appeal: v.appeal });
    }
  }
  return { ok: true, data: out, usage };
}
