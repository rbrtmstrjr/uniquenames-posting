import type { ReelMotion } from "@/lib/db/types";

// Per-line feeling and camera move for a reel. Pure and deterministic. The 007 framings (REEL_SHOTS) stay readable for
// lines written before 008; new lines use the shot sizes of lib/reels/shots.

/** The feelings a line can carry (the script picks exactly one per line). */
export const REEL_EMOTIONS = [
  "laughing", "playful", "surprised", "curious", "determined", "proud",
  "relieved", "tender", "cuddly", "teary", "worried", "exhausted",
] as const;
export type ReelEmotion = (typeof REEL_EMOTIONS)[number];

/** The 007 framings (lines written before 008 carry one in reel_scenes.shot). */
export const REEL_SHOTS = ["wide", "medium", "over-the-shoulder", "low-angle", "hands-detail", "eye-level"] as const;
export type ReelShot = (typeof REEL_SHOTS)[number];

export const isEmotion = (x: unknown): x is ReelEmotion => typeof x === "string" && (REEL_EMOTIONS as readonly string[]).includes(x);
export const isShot = (x: unknown): x is ReelShot => typeof x === "string" && (REEL_SHOTS as readonly string[]).includes(x);

/** "Over the shoulder" / "LOW_ANGLE" / "hands detail" → the shot id, or null. */
export function shotOf(x: unknown): ReelShot | null {
  if (typeof x !== "string") return null;
  const s = x.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return isShot(s) ? s : null;
}
export function emotionOf(x: unknown): ReelEmotion | null {
  if (typeof x !== "string") return null;
  const s = x.trim().toLowerCase();
  return isEmotion(s) ? s : null;
}

/**
 * The camera move for every line (playbook v2): push_in / pull_out alternating (a gentle eased zoom; never a pan or
 * tilt), a 'hold' on every 5th line and on the payoff (last) line; after a hold the direction flips from the move
 * before it; never the same move twice in a row. Line 1 pushes in. Depends only on the number of lines.
 */
export function assignMotion(scenes: readonly unknown[]): ReelMotion[] {
  const n = scenes.length;
  const out: ReelMotion[] = [];
  let lastMove: ReelMotion = "pull_out";
  for (let i = 0; i < n; i++) {
    const payoff = n >= 2 && i === n - 1;
    const fifth = (i + 1) % 5 === 0 && i !== n - 2 && i !== n - 1;
    if (payoff || fifth) { out.push("hold"); continue; }
    lastMove = lastMove === "push_in" ? "pull_out" : "push_in";
    out.push(lastMove);
  }
  return out;
}
