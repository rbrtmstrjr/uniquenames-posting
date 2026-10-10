// Meanings + origins for the SSA names (scripts/name-meanings.ts): asked of Claude in batches, then validated here. A
// name only gets a meaning that passes every check; the rest stay without one (never invented silently) and are
// left out of the seed until a later run fills them. Every seeded name is 'pending': the owner approves it on the
// Names page before it is used. Pure (tested in tests/ssa-import.test.ts).
import type { GeminiSchema } from "@/lib/ai/gemini";
import type { Gender } from "@/lib/db/types";

export interface NameFacts { meaning: string; origin: string }
export interface Asked { name: string; gender: Gender }

export const MEANINGS_SYSTEM = [
  "You give the standard, commonly accepted meaning and origin of popular American baby names, as baby-name and etymology references give them.",
  "For each name: \"meaning\" is 2 to 6 plain English words, all lowercase, no commas, no ending period, read as a natural phrase (like \"olive tree\", \"gift of god\", \"little warrior\"): one meaning, never \"x or y\", never two synonyms side by side. When the accepted meaning is one word, phrase it in 2 or more words that keep it true (\"peace\" becomes \"peace and calm\" only if both are the name's sense; \"hunter\" becomes \"the hunter\").",
  "\"origin\" is the language or culture the name comes from, 1 to 3 words with capitals (like \"Latin\", \"Hebrew\", \"Old English\", \"Irish\", \"Spanish\", \"Arabic\", \"Greek\"). For a modern American coinage or a surname turned first name, say so plainly (\"American\", \"English surname\").",
  "Use the name's sense for the gender given. Never invent: if a name has no clear accepted meaning, return an empty meaning for it.",
  "Return every name asked, spelled exactly as asked, in the same order. Return JSON: {\"names\": [{\"name\": \"...\", \"meaning\": \"...\", \"origin\": \"...\"}]}.",
].join("\n");

export const MEANINGS_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, meaning: { type: "STRING" }, origin: { type: "STRING" } },
        required: ["name", "meaning", "origin"],
      },
    },
  },
  required: ["names"],
};

export const meaningsPrompt = (batch: Asked[]) =>
  ["Names (gender in brackets):", ...batch.map((n) => `- ${n.name} (${n.gender})`)].join("\n");

const squash = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Why a meaning can't go on a card, or null. */
export function meaningProblem(m: string): string | null {
  if (!m) return "empty";
  if (m.length > 80) return "longer than 80 characters";
  if (!/^[a-z][a-z' -]*[a-z]$/.test(m)) return "not plain lowercase words";
  const words = m.split(" ").length;
  if (words < 2 || words > 6) return "not 2 to 6 words";
  if (/\bor\b/.test(m)) return "two meanings";
  return null;
}

/** Why an origin can't be shown, or null. */
export function originProblem(o: string): string | null {
  if (!o) return "empty";
  if (o.length > 40) return "longer than 40 characters";
  if (!/^[A-Z][A-Za-z' -]*$/.test(o) || o.split(" ").length > 3) return "not 1 to 3 capitalized words";
  return null;
}

/** The answers that pass, keyed by the asked name (an answer for a name not asked, or misspelled, is dropped). */
export function acceptMeanings(raw: unknown, asked: Asked[]): { ok: Record<string, NameFacts>; rejected: { name: string; why: string }[] } {
  const want = new Map(asked.map((a) => [a.name.toLowerCase(), a.name]));
  const ok: Record<string, NameFacts> = {};
  const rejected: { name: string; why: string }[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as { names?: unknown }).names) ? (raw as { names: unknown[] }).names : [];
  for (const r of list) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = want.get(squash(o.name).toLowerCase());
    if (!name || ok[name]) continue;
    const meaning = squash(o.meaning).replace(/\.$/, "");
    const origin = squash(o.origin);
    const why = meaningProblem(meaning) ?? originProblem(origin);
    if (why) rejected.push({ name, why });
    else ok[name] = { meaning, origin };
  }
  return { ok, rejected };
}
