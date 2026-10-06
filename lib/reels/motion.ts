import type { ReelMotion } from "@/lib/db/types";

// Per-line feeling, framing and camera move for a reel (spec 2026-10-06, decisions 3-5). Pure and deterministic.
// No AI motion this round: every line gets one of the 7 camera moves; a key line gets the 'punch' emphasis.

/** The feelings a line can carry (the script picks exactly one per line). */
export const REEL_EMOTIONS = [
  "laughing", "playful", "surprised", "curious", "determined", "proud",
  "relieved", "tender", "cuddly", "teary", "worried", "exhausted",
] as const;
export type ReelEmotion = (typeof REEL_EMOTIONS)[number];

/** The framings a line can use; never the same one on two lines in a row. */
export const REEL_SHOTS = ["wide", "medium", "over-the-shoulder", "low-angle", "hands-detail", "eye-level"] as const;
export type ReelShot = (typeof REEL_SHOTS)[number];

/** At most this many key lines per reel. */
export const KEY_MAX = 3;
/** Hook lines are among the first 3. */
export const HOOK_MAX = 3;

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
 * Every line's shot with no shot repeated on consecutive lines: a missing / unknown shot, or one equal to the line
 * before, becomes the first shot in REEL_SHOTS order (starting after the line's index, so fills vary) that differs
 * from both neighbours.
 */
export function fixShots(shots: readonly unknown[]): ReelShot[] {
  const out: ReelShot[] = [];
  for (let i = 0; i < shots.length; i++) {
    const want = shotOf(shots[i]);
    const prev = out[i - 1];
    if (want && want !== prev) { out.push(want); continue; }
    const next = shotOf(shots[i + 1]);
    const n = REEL_SHOTS.length;
    let pick: ReelShot = REEL_SHOTS[0];
    for (let k = 0; k < n; k++) {
      const c = REEL_SHOTS[(i + k) % n];
      if (c !== prev && c !== next) { pick = c; break; }
    }
    out.push(pick);
  }
  return out;
}

/** What assignMotion needs from a line. */
export interface MotionScene { beat?: string | null; emotion?: string | null; key?: boolean | null }

/** A hook line: the first line always; lines 2-3 when the script marks them as the hook beat. */
export const isHookLine = (scene: MotionScene, index: number) => index === 0 || (index < HOOK_MAX && scene.beat === "hook");

/** Which lines are key: the first KEY_MAX lines marked key (the rest are ignored). */
export function capKeys<T extends MotionScene>(scenes: readonly T[]): boolean[] {
  let n = 0;
  return scenes.map((s) => (s.key === true && n < KEY_MAX ? (n++, true) : false));
}

/** Camera moves matched to a feeling, best first. */
const BY_EMOTION: Record<ReelEmotion, ReelMotion[]> = {
  teary: ["push_in", "tilt_down"],
  cuddly: ["push_in", "pull_out"],
  tender: ["push_in", "pan_right"],
  relieved: ["pull_out", "tilt_up"],
  proud: ["pull_out", "tilt_up"],
  curious: ["pan_right", "pan_left"],
  surprised: ["pan_left", "push_in"],
  playful: ["pan_left", "pan_right"],
  laughing: ["pan_right", "pull_out"],
  determined: ["tilt_up", "push_in"],
  worried: ["tilt_down", "pan_left"],
  exhausted: ["tilt_down", "pull_out"],
};
/** The calm moves ('punch' is kept for emphasis). */
const CYCLE: ReelMotion[] = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down"];

/**
 * The camera move for every line. Hook lines and key lines (at most 3) get the emphasis: 'punch', or 'push_in' when
 * the line before already punched. Every other line gets the move matched to its feeling (teary/cuddly/tender →
 * push_in, relieved/proud → pull_out, curious/playful/laughing/surprised → pans, determined → tilt_up,
 * worried/exhausted → tilt_down), or the next one when that equals the line before; never the same move twice in
 * a row. Deterministic.
 */
export function assignMotion(scenes: readonly MotionScene[]): ReelMotion[] {
  const keys = capKeys(scenes);
  const out: ReelMotion[] = [];
  scenes.forEach((s, i) => {
    const prev = out[i - 1];
    if (isHookLine(s, i) || keys[i]) { out.push(prev === "punch" ? "push_in" : "punch"); return; }
    const e = emotionOf(s.emotion);
    const pref = e ? BY_EMOTION[e] : [];
    const start = e ? CYCLE.indexOf(pref[0]) : i % CYCLE.length;
    const rotated = CYCLE.map((_, k) => CYCLE[(start + k) % CYCLE.length]);
    out.push([...pref, ...rotated].find((m) => m !== prev)!);
  });
  return out;
}
