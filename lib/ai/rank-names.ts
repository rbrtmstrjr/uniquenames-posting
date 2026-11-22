import "server-only";
import type { Gender, SettingsRow } from "@/lib/db/types";
import type { GeminiSchema } from "./gemini";
import { aiJson } from "./provider";
import { has023 } from "@/lib/cover/card";
import { activePack } from "@/packs";

// The 3 best names first (spec 2026-11-21). When a Today post (single names or initials) is made, ONE call to the app's
// AI (Gemini, or Claude Haiku with AI_PROVIDER=claude, the same AI as the captions) picks the 3 names a parent would
// most love. It runs alongside the caption with its own ~8 s limit, and its answer is checked in code (the post's own
// names, each once); on a failure, a late answer or any other answer the post keeps today's order. Never throws, never
// blocks or fails a post. Autopilot's names come ranked by its own name check (appeal), so it never calls this.

export const RANK_TIMEOUT_MS = 8000;
/** How many names lead the post (the 3 a phone shows after the front card). */
export const RANK_TOP = 3;

export const RANK_SYSTEM = [
  "You are a mom choosing a name for your own baby, and you know what other parents love.",
  "From the list of baby names for one Facebook post, pick the names parents would most love to choose: pretty, meaningful, easy to say and special.",
  "Answer with names from the list only, written exactly as in the list, best first, each name once.",
].join("\n");

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: { best: { type: "ARRAY", items: { type: "STRING" }, description: "The best names from the list, best first" } },
  required: ["best"],
};

type Named = { name: string; meaning: string };
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => squash(s).toLowerCase();

export function rankPrompt(i: { gender: Gender; names: readonly Named[] }): string {
  const want = Math.min(RANK_TOP, i.names.length);
  return [`Baby ${i.gender} names for one post (name: meaning):`, ...i.names.map((n) => `- ${squash(n.name)}: ${squash(n.meaning)}`), `Pick the ${want} best.`].join("\n");
}

/**
 * The AI's answer as indexes into `names`, best first, at most RANK_TOP. Null for anything else: not a list of
 * strings, a name that is not the post's, a name twice, or fewer than RANK_TOP (all of them on a shorter post).
 */
export function parseRanking(raw: unknown, names: readonly { name: string }[]): number[] | null {
  const list = raw && typeof raw === "object" ? (raw as { best?: unknown }).best : null;
  if (!Array.isArray(list)) return null;
  const index = new Map(names.map((n, i) => [key(n.name), i]));
  const out: number[] = [];
  for (const v of list) {
    if (typeof v !== "string") return null;
    const i = index.get(key(v));
    if (i === undefined || out.includes(i)) return null;
    out.push(i);
  }
  const want = Math.min(RANK_TOP, names.length);
  return out.length >= want ? out.slice(0, want) : null;
}

/** The full order of a post's cards: the top indexes first, then every other card in its current order. */
export function bestFirstOrder(top: readonly number[], count: number): number[] {
  return [...top, ...Array.from({ length: count }, (_, i) => i).filter((i) => !top.includes(i))];
}

/** Today's ranking comes with the front card: once migration 023 has run (switch on or off), on a pack with front-card wording. */
export const bestFirstOn = (s: Partial<SettingsRow> | null | undefined) => has023(s) && !!activePack().cards.cover;

/** One ranking call: the post's best names as indexes, best first; null = keep today's order. */
export async function rankNames(i: { gender: Gender; names: readonly Named[] }, timeoutMs = RANK_TIMEOUT_MS): Promise<number[] | null> {
  if (i.names.length < 2) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    const call = aiJson<unknown>({ task: "small", system: RANK_SYSTEM, prompt: rankPrompt(i), schema: SCHEMA, temperature: 0.3, timeoutMs })
      .then((r) => (r.ok ? parseRanking(r.data, i.names) : null))
      .catch(() => null);
    return await Promise.race([call, late]);
  } finally {
    clearTimeout(timer);
  }
}
