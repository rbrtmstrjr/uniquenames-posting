import "server-only";
import type { GeminiSchema, GenerateJsonResult } from "./gemini";
import { aiJson } from "./provider";
import { CATEGORY_HINTS, FALLBACK_CATEGORY, MEANING_CATEGORIES, isMeaningCategory, type MeaningCategory } from "@/lib/names/categories";

// Sorts names into the names PDF's meaning groups (migration 018). Each name is sorted ONCE (the result is stored in
// names.meaning_category), in batches of ~100 names per call to the small AI (Gemini, or Claude Haiku with
// AI_PROVIDER=claude). Every answer is checked against the fixed list; a name the AI skips is asked again once, then
// goes to the fallback group.

export const CATEGORY_BATCH = 100;
/** Batches sent at the same time. */
export const CATEGORY_PARALLEL = 3;
export const CATEGORY_TIMEOUT_MS = 45000;

export interface CategorizeItem { id: string; name: string; meaning: string }
type Answer = { n: number; group: MeaningCategory }[];

export const CATEGORY_SYSTEM = [
  "You sort baby names into meaning groups for a printed baby-name book.",
  "For each numbered name, read its meaning and pick the ONE group that best fits what the meaning is about.",
  "Groups (id: what belongs there):",
  ...MEANING_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_HINTS[c]}`),
  "Rules: answer with a group id from the list, exactly as written. Judge by the meaning, not by how the name sounds.",
  "When a meaning has two ideas (a first and a middle name), pick the one that comes first.",
  `Use "${FALLBACK_CATEGORY}" only when no other group fits. Answer for every number, once.`,
].join("\n");

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { n: { type: "INTEGER", description: "The name's number" }, group: { type: "STRING", enum: [...MEANING_CATEGORIES] } },
        required: ["n", "group"],
      },
    },
  },
  required: ["items"],
};

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function categoryPrompt(batch: readonly Pick<CategorizeItem, "name" | "meaning">[]): string {
  return [`Sort these ${batch.length} names:`, ...batch.map((b, i) => `${i + 1}. ${clean(b.name, 40)}: ${clean(b.meaning, 80)}`)].join("\n");
}

/** The AI's answer for a batch of `size` names: valid numbers and groups only (null = not the expected shape). */
export function parseCategories(raw: unknown, size: number): Answer | null {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  const out: Answer = [];
  const seen = new Set<number>();
  for (const it of items) {
    const n = (it as { n?: unknown })?.n;
    const group = (it as { group?: unknown })?.group;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > size || seen.has(n) || !isMeaningCategory(group)) continue;
    seen.add(n);
    out.push({ n, group });
  }
  return out;
}

async function ask(batch: readonly CategorizeItem[]): Promise<GenerateJsonResult<Answer>> {
  return aiJson<Answer>({
    task: "small", system: CATEGORY_SYSTEM, prompt: categoryPrompt(batch), schema: SCHEMA, temperature: 0.2,
    timeoutMs: CATEGORY_TIMEOUT_MS, parse: (raw) => parseCategories(raw, batch.length),
  });
}

/** One batch: the AI's groups; names it skipped are asked once more, then go to the fallback group. */
export async function categorizeBatch(batch: readonly CategorizeItem[]): Promise<GenerateJsonResult<Map<string, MeaningCategory>>> {
  const out = new Map<string, MeaningCategory>();
  const first = await ask(batch);
  if (!first.ok) return first;
  for (const a of first.data) out.set(batch[a.n - 1].id, a.group);
  const missed = batch.filter((b) => !out.has(b.id));
  if (missed.length) {
    const again = await ask(missed);
    if (again.ok) for (const a of again.data) out.set(missed[a.n - 1].id, a.group);
    for (const m of missed) if (!out.has(m.id)) out.set(m.id, FALLBACK_CATEGORY);
  }
  return { ok: true, data: out };
}

/**
 * Sort many names (batches of CATEGORY_BATCH, CATEGORY_PARALLEL at a time). Never throws. On a failed batch the
 * groups found so far come back with the error, so they can still be stored.
 */
export async function categorizeNames(items: readonly CategorizeItem[]): Promise<{ groups: Map<string, MeaningCategory>; error: string | null }> {
  const groups = new Map<string, MeaningCategory>();
  const batches: CategorizeItem[][] = [];
  for (let i = 0; i < items.length; i += CATEGORY_BATCH) batches.push(items.slice(i, i + CATEGORY_BATCH));
  let error: string | null = null;
  for (let i = 0; i < batches.length && !error; i += CATEGORY_PARALLEL) {
    const results = await Promise.all(batches.slice(i, i + CATEGORY_PARALLEL).map(categorizeBatch));
    for (const r of results) {
      if (r.ok) for (const [k, v] of r.data) groups.set(k, v);
      else error ??= r.error;
    }
  }
  return { groups, error };
}
