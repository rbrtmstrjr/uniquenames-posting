import type { ReelFormat } from "./formats";
import { activePack } from "@/packs";

// The topic bank is the active niche pack's (packs/<id>/topics.ts): picked when the owner leaves the topic blank.
// Each idea carries the format it suits and a health flag (fever, illness, sleep, feeding, development: the script then
// needs soft wording and a safety line).

export interface ReelTopic {
  id: string;
  topic: string;
  format: ReelFormat;
  health: boolean;
  stage?: "newborn" | "baby" | "toddler" | "preschooler";
  /** Health topics: the only medical claims the script may make (3-5 plain sentences from a checked source). */
  facts?: string[];
  /** Health topics: the safety line (when to call the doctor). */
  safety?: string;
  /** A plain-language anchor the reel may restate: "<plain claim> — <who says it>" (never a technique or study name). */
  anchor?: string;
}

export const REEL_TOPICS: ReelTopic[] = activePack().reels.topics;

/** How many recent reels' topics are skipped. */
export const TOPIC_WINDOW = 15;

/**
 * A topic for a reel of `format`: one not used by the last 15 reels (`recentIds`), preferring the rotated format; then
 * any topic not used lately; then any topic (every one was used lately). Deterministic for a given `rng`.
 */
export function pickTopic(format: ReelFormat, recentIds: string[], rng: () => number = Math.random): ReelTopic {
  const recent = new Set(recentIds.slice(0, TOPIC_WINDOW));
  const fresh = REEL_TOPICS.filter((t) => !recent.has(t.id));
  const pool = fresh.filter((t) => t.format === format);
  const from = pool.length ? pool : fresh.length ? fresh : REEL_TOPICS;
  const r = rng();
  const i = Math.min(from.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * from.length)));
  return from[i];
}

export const topicById = (id: string | null | undefined) => REEL_TOPICS.find((t) => t.id === id) ?? null;

/** A typed topic about fever, illness, sleep safety, choking, allergies or medicine: the script gets the health rules. */
const HEALTH_WORDS = /\b(?:fever|feverish|cough\w*|vomit\w*|throw(?:s|ing)? up|rash\w*|diarrh\w*|sick|illness|sleep safety|safe sleep|sids|chok\w*|allerg\w*|medicine\w*|medication\w*|dose|teething pain|dehydrat\w*)\b/i;
export const isHealthTopic = (topic: string | null | undefined) => HEALTH_WORDS.test(topic ?? "");
