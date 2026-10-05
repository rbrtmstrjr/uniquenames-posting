import type { CardRow } from "@/lib/db/types";
import { normalizeName } from "@/lib/actions/helpers";
import { formatElapsed } from "./eta";
import type { WorkerHealth } from "./worker-health";

type Text = Pick<CardRow, "name" | "meaning">;

/**
 * Same normalizing the server applies, on BOTH sides, so a legacy row stored before
 * normalizeName (e.g. "arlo  zenith") never looks edited when the owner did not touch it.
 */
export function textChanged(card: Text, name: string, meaning: string): boolean {
  return normalizeName(name) !== normalizeName(card.name) || meaning.trim().toLowerCase() !== card.meaning.trim().toLowerCase();
}

export type NewPicture = { kind: "regenerate" } | { kind: "edit-regenerate"; name: string; meaning: string };

/** What the dialog's "New picture" sends: the edited text goes with it, so the edit is never lost. */
export function newPictureAction(card: Text, name: string, meaning: string): NewPicture {
  return textChanged(card, name, meaning) ? { kind: "edit-regenerate", name, meaning } : { kind: "regenerate" };
}

export type StatusTone = "ok" | "bad" | "warn" | "accent";
export interface DialogStatus { label: string; tone: StatusTone; pulse: boolean }

/** The dialog header's live state, from the realtime card row. */
export function dialogStatus(card: Pick<CardRow, "status" | "started_at">, health: WorkerHealth, queuePos: number, now: number): DialogStatus {
  if (card.status === "done") return { label: "Ready", tone: "ok", pulse: false };
  if (card.status === "failed") return { label: "Failed", tone: "bad", pulse: false };
  if (health === "offline" || health === "unknown") return { label: "Waiting for your PC", tone: "warn", pulse: true };
  if (card.status === "restamp") return { label: "Updating text…", tone: "accent", pulse: true };
  if (card.status === "generating") {
    const sec = card.started_at ? (now - Date.parse(card.started_at)) / 1000 : 0;
    return { label: `Making… ${formatElapsed(sec)}`, tone: "accent", pulse: true };
  }
  if (health === "comfy-off") return { label: "Waiting for ComfyUI", tone: "warn", pulse: true };
  return { label: queuePos > 0 ? `In line #${queuePos}` : "In line", tone: "accent", pulse: true };
}
