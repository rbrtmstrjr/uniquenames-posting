import type { ReelRow, ReelSceneRow, ReelSceneStatus, ReelStatus } from "@/lib/db/types";

// Pure helpers for the Reels pages (no React): the status badge + overall percent, the step strip,
// per-image labels, and the review page's word counts. Shared by the list, review and progress views.

/** Same limit as the server (lib/ai/reel-script LINE_MAX_WORDS, which is server-only). */
export const LINE_MAX_WORDS = 14;
export const TITLE_MAX = 80;
/** Chatterbox speaks about 3.8 words a second (the spike measured ~4). */
export const WORDS_PER_SECOND = 3.8;
/** Tries the PC makes per image before the reel needs attention. */
export const IMAGE_TRIES = 3;

export type Tone = "ok" | "warn" | "bad" | "muted" | "accent";
type SceneLike = Pick<ReelSceneRow, "status">;
type ReelLike = Pick<ReelRow, "status" | "voice_path" | "words">;

/** The PC is working on (or waiting to work on) the reel. */
export const WORKING: ReelStatus[] = ["queued", "voicing", "imaging", "rendering"];
export const isWorking = (s: ReelStatus) => WORKING.includes(s);

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** "1:35" for 95 seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Spoken length of a script, from its word count (the voice is sped up by `speed`). */
export const estimateSeconds = (words: number, speed = 1) => words / (WORDS_PER_SECOND * (speed > 0 ? speed : 1));

/** The script length the prompt aims for: 330–420 words at 1×, more when the voice is sped up (lib/ai/reel-script). */
export const wordTarget = (speed = 1) => {
  const x = speed > 0 ? speed : 1;
  return { lo: Math.round(330 * x), hi: Math.round(420 * x) };
};

export function imageCounts(scenes: SceneLike[]) {
  const n = (st: ReelSceneStatus) => scenes.filter((s) => s.status === st).length;
  const done = n("done"), skipped = n("skipped"), failed = n("failed");
  return { total: scenes.length, done, skipped, failed, finished: done + skipped };
}

/**
 * Overall percent: voice 10, caption timing 5, images 70 (by finished share), video 15.
 * A requeued reel (after a redo) keeps the credit for the steps it already has.
 */
function percent(reel: ReelLike, scenes: SceneLike[]): number {
  if (reel.status === "ready") return 100;
  if (reel.status === "script") return 0;
  const { total, finished } = imageCounts(scenes);
  const pct = (reel.voice_path ? 10 : 0) + (reel.words ? 5 : 0) + (total ? (70 * finished) / total : 0);
  return Math.min(99, Math.round(pct));
}

/** The reel's one-line status for badges and the progress header. */
export function reelProgress(reel: ReelLike, scenes: SceneLike[]): { label: string; pct: number; tone: Tone } {
  const pct = percent(reel, scenes);
  const { total, finished } = imageCounts(scenes);
  switch (reel.status) {
    case "script": return { label: "Script ready", pct, tone: "accent" };
    case "queued": return { label: "Waiting for your PC", pct, tone: "muted" };
    // The music bed (migration 006) is made under 'voicing', after the timing.
    case "voicing": return { label: reel.words ? "Music…" : reel.voice_path ? "Timing captions…" : "Voice…", pct, tone: "accent" };
    case "imaging": return { label: `Images ${finished}/${total}`, pct, tone: "accent" };
    case "rendering": return { label: "Making video…", pct, tone: "accent" };
    case "ready": return { label: "Ready", pct, tone: "ok" };
    case "needs_attention": return { label: "Needs attention", pct, tone: "warn" };
    case "failed": return { label: "Failed", pct, tone: "bad" };
  }
}

export type StepState = "done" | "active" | "waiting" | "failed" | "attention";
export interface Step { key: "voice" | "timing" | "images" | "video"; label: string; state: StepState }

/** Voice · Captions timing · Images n/m · Video, each with its state (for the step strip). */
export function reelSteps(reel: ReelLike, scenes: SceneLike[]): Step[] {
  const { total, finished, failed } = imageCounts(scenes);
  const st = reel.status;
  const hasVoice = !!reel.voice_path, hasWords = !!reel.words;
  const imagesDone = total > 0 && finished === total;
  const voice: StepState = hasVoice ? "done" : st === "voicing" ? "active" : st === "failed" ? "failed" : "waiting";
  const timing: StepState = hasWords ? "done" : !hasVoice ? "waiting"
    : st === "failed" ? "failed" : st === "voicing" || st === "imaging" ? "active" : "waiting";
  const images: StepState = imagesDone ? "done"
    : st === "needs_attention" ? "attention"
    : st === "failed" && hasWords ? "failed"
    : st === "imaging" ? (failed ? "attention" : "active") : "waiting";
  const video: StepState = st === "ready" ? "done" : st === "rendering" ? "active" : st === "failed" && imagesDone && hasWords ? "failed" : "waiting";
  return [
    { key: "voice", label: "Voice", state: voice },
    { key: "timing", label: "Captions timing", state: timing },
    { key: "images", label: `Images ${finished}/${total}`, state: images },
    { key: "video", label: "Video", state: video },
  ];
}

/** Per-image tile label. */
export const SCENE_LABEL: Record<ReelSceneStatus, string> = {
  pending: "Waiting", queued: "In line", generating: "Making…", done: "Done", failed: "Failed", skipped: "Skipped",
};

/** "Retry image" (redo) works on a finished, failed or skipped image once the script is approved. */
export const canRedoScene = (reelStatus: ReelStatus, s: Pick<ReelSceneRow, "status">) =>
  reelStatus !== "script" && (s.status === "done" || s.status === "failed" || s.status === "skipped");

/** "Skip image": a failed image of a reel that needs attention, or one that failed 3 times while the PC works. */
export const canSkipScene = (reelStatus: ReelStatus, s: Pick<ReelSceneRow, "status" | "attempts">) =>
  s.status === "failed" && (reelStatus === "needs_attention" || (isWorking(reelStatus) && s.attempts >= IMAGE_TRIES));

/** "Make video again": every image done or skipped, at least one done, the reel ready or stopped. */
export const canRerender = (reelStatus: ReelStatus, scenes: SceneLike[]) =>
  (reelStatus === "ready" || reelStatus === "failed") && scenes.length > 0
  && scenes.every((s) => s.status === "done" || s.status === "skipped") && scenes.some((s) => s.status === "done");
