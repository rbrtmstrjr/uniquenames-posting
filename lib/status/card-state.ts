import type { CardRow } from "@/lib/db/types";
import type { WorkerHealth } from "./worker-health";

export type CardVisual = "queued" | "generating" | "regenerating" | "restamp" | "done" | "failed" | "waiting";

export function cardVisual(card: Pick<CardRow, "status" | "card_path">, health: WorkerHealth): CardVisual {
  if (card.status === "done") return "done";
  if (card.status === "failed") return "failed";
  // Any unfinished card waits while the PC is offline. A re-stamp does not need
  // ComfyUI, so "comfy-off" does not block it.
  if (health === "offline" || health === "unknown") return "waiting";
  if (card.status === "restamp") return "restamp";
  if (card.card_path) return "regenerating";
  return card.status === "generating" ? "generating" : "queued";
}

type QueueItem = Pick<CardRow, "id" | "status" | "queued_at" | "claimed_at">;

export function queuePosition(card: QueueItem, all: QueueItem[]): number {
  const line = all
    .filter((c) => (c.status === "queued" || c.status === "restamp") && !c.claimed_at)
    .sort((a, b) => (a.status === "restamp" ? 0 : 1) - (b.status === "restamp" ? 0 : 1) || Date.parse(a.queued_at) - Date.parse(b.queued_at));
  const i = line.findIndex((c) => c.id === card.id);
  return i < 0 ? 0 : i + 1;
}
