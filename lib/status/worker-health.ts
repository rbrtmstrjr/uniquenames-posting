import type { WorkerStatusRow } from "@/lib/db/types";

export type WorkerHealth = "ready" | "comfy-off" | "offline" | "unknown";
export const OFFLINE_AFTER_MS = 45_000;

export function workerHealth(w: WorkerStatusRow | null, now: number): WorkerHealth {
  if (!w || !w.last_seen) return "unknown";
  if (now - Date.parse(w.last_seen) > OFFLINE_AFTER_MS) return "offline";
  return w.comfyui_ok ? "ready" : "comfy-off";
}

/**
 * worker_status.message while the shared PC (worker 2.7.1, several pages) works for another page: the same words as
 * worker/jobs.py BUSY_ELSEWHERE. The PC is still ready (a new job waits its turn), so this is shown, not a lock.
 */
export const BUSY_ELSEWHERE = "PC busy with your other page";

/** True while the PC is up but working for the other page (an older worker never says so). */
export const busyElsewhere = (w: WorkerStatusRow | null, now: number): boolean =>
  workerHealth(w, now) === "ready" && w?.message === BUSY_ELSEWHERE;

/** Why Generate / New picture / Add a card / Make preview are locked (shown as visible text, not only a tooltip). */
export const GENERATE_LOCK = {
  offline: "Your PC is offline — turn it on to generate",
  comfy: "Open ComfyUI Desktop to generate",
} as const;

export type GenerateLock = { ok: true } | { ok: false; reason: string };

/** New photos need the PC on AND ComfyUI open. Re-stamps only need Pillow (see cardVisual). */
export function canGenerate(health: WorkerHealth): GenerateLock {
  if (health === "ready") return { ok: true };
  return { ok: false, reason: health === "comfy-off" ? GENERATE_LOCK.comfy : GENERATE_LOCK.offline };
}

export function lastSeenText(w: WorkerStatusRow | null, now: number): string {
  if (!w?.last_seen) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(w.last_seen)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
