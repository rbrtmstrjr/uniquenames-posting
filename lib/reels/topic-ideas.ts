import { nextFormat, type ReelFormat } from "./formats";
import { REEL_TOPICS, TOPIC_WINDOW, type ReelTopic } from "./topics";

// "Suggest topics" (owner, 2026-10-10: "generate the topic first before the full script"): 5 quick ideas the owner can
// pick from before waiting 1-3 minutes for a script. ~3 come from the vetted bank (not used lately, formats spread out)
// and ~2 are fresh AI ideas; one cheap AI call writes every hook. Pure: shared by the server (lib/ai/reel-ideas) and
// the New reel form (types + limits).

/** Ideas per batch, and its usual mix. */
export const IDEA_COUNT = 5;
export const BANK_IDEAS = 3;
export const FRESH_IDEAS = 2;
/** A fresh idea's topic (it fills the topic box, whose limit is 120). */
export const IDEA_TOPIC_MAX = 90;
/** The hook is the reel's line 1: same limit as the script's (lib/ai/reel-script HOOK_LINE_MAX_WORDS). */
export const IDEA_HOOK_MAX_WORDS = 12;
export const IDEA_WHY_MAX_WORDS = 15;
/** Most already-shown topics "More ideas" sends (the newest are kept). */
export const EXCLUDE_MAX = 60;

export interface TopicIdea {
  /** The topic as it goes in the topic box (≤ 90 characters for a fresh idea; a bank topic as written in the bank). */
  topic: string;
  format: ReelFormat;
  /** The suggested opening spoken line (≤ 12 words). */
  hook: string;
  /** What the mom learns (≤ 15 words). */
  why: string;
  source: "bank" | "fresh";
  /** The bank idea's id (bank ideas only): the script then uses its vetted facts, anchor and safety line. */
  topicId?: string;
  /** Fever, illness, sleep, feeding, development: the script applies the health rules. */
  health: boolean;
}

/** A case-, space- and punctuation-insensitive key for comparing topics. */
export const ideaKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * `n` formats in rotation order (newest first `recent`): the first is nextFormat(recent), each next one is the next
 * format as if the previous ones had just been made, so up to 5 come out all different.
 */
export function formatSpread(recent: (string | null | undefined)[], n: number): ReelFormat[] {
  const out: ReelFormat[] = [];
  let hist = [...recent];
  for (let i = 0; i < n; i++) {
    const f = nextFormat(hist);
    out.push(f);
    hist = [f, ...hist];
  }
  return out;
}

const randomOf = <T,>(xs: T[], rng: () => number): T => {
  const r = rng();
  return xs[Math.min(xs.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * xs.length)))];
};

/**
 * `n` bank ideas for a batch: never one of the last 15 reels' topics (`recentIds`) or one already shown (`exclude`,
 * topic texts or ids) while others are left; one per format in rotation order (formatSpread) where the format has one,
 * the rest from any format. Distinct; deterministic for a given `rng`.
 */
export function pickBankIdeas(recentFormats: (string | null | undefined)[], recentIds: string[], exclude: string[], n: number, rng: () => number = Math.random): ReelTopic[] {
  const recent = new Set(recentIds.slice(0, TOPIC_WINDOW));
  const shown = new Set(exclude.map(ideaKey));
  const isShown = (t: ReelTopic) => shown.has(ideaKey(t.topic)) || shown.has(ideaKey(t.id));
  // best first: fresh and not shown; then used lately but not shown; then shown (every one was shown already)
  const tiers = [
    REEL_TOPICS.filter((t) => !isShown(t) && !recent.has(t.id)),
    REEL_TOPICS.filter((t) => !isShown(t) && recent.has(t.id)),
    REEL_TOPICS.filter((t) => isShown(t)),
  ];
  const picked: ReelTopic[] = [];
  const free = (t: ReelTopic) => !picked.includes(t);
  for (const f of formatSpread(recentFormats, Math.min(n, 5))) {
    const pool = tiers[0].filter((t) => t.format === f && free(t));
    if (pool.length) picked.push(randomOf(pool, rng));
  }
  for (const tier of tiers) {
    while (picked.length < n) {
      const pool = tier.filter(free);
      if (!pool.length) break;
      picked.push(randomOf(pool, rng));
    }
  }
  return picked.slice(0, n);
}

const CHILD: Record<NonNullable<ReelTopic["stage"]>, string> = { newborn: "newborn", baby: "baby", toddler: "toddler", preschooler: "child" };
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** A plain hook for a bank idea when the AI's is missing or breaks a rule (≤ 12 words, talks to "you"). */
export function templateHook(t: ReelTopic): string {
  const child = t.stage ? CHILD[t.stage] : "child";
  if (t.format === "lola_science") {
    const said = t.topic.match(/^Grandma said:\s*([^.]+?)\.?$/i)?.[1];
    const hook = said ? `Your grandma said ${said}. Here's what doctors say.` : "";
    return hook && words(hook) <= IDEA_HOOK_MAX_WORDS ? hook : "You grew up with the old rule. Here's what experts say now.";
  }
  if (t.format === "named_method") {
    const name = t.topic.match(/^(The [^:]+):/)?.[1];
    const hook = name ? `Try ${name} with your ${child} tonight.` : "";
    return hook && words(hook) <= IDEA_HOOK_MAX_WORDS ? hook : `One simple method that helps your ${child}. Here's how.`;
  }
  if (t.format === "say_this") return `What you say to your ${child} matters. Try these words instead.`;
  if (t.format === "scene_lesson") return `Your ${child} needs you in this moment. Here's what to say.`;
  return `Your ${child} does this too? Here's the simple fix that helps.`;
}

/** A plain "why" line for a bank idea when the AI's is missing or breaks a rule (≤ 15 words). */
export const TEMPLATE_WHY: Record<ReelFormat, string> = {
  named_method: "One simple method, step by step, with the exact words to say.",
  say_this: "What to stop saying, and the words to say instead.",
  lola_science: "What doctors say now, and the sweet part of Grandma's way to keep.",
  scene_lesson: "What is really going on, and the exact words that help.",
  problem_fix: "Why it happens, and two simple fixes you can try tonight.",
};
