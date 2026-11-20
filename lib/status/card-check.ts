import type { CardRow } from "@/lib/db/types";

/** The small mark on a card of an Autopilot post: what the photo check did (null while checking or on hand-made posts). */
export function checkChip(card: Pick<CardRow, "check_state" | "check_note">): { text: string; tone: "ok" | "bad" } | null {
  switch (card.check_state) {
    case "passed": return { text: card.check_note?.startsWith("Remade:") ? card.check_note : "Checked", tone: "ok" };
    case "removed": return { text: card.check_note ?? "Removed", tone: "bad" };
    case "failed": return { text: "Not checked", tone: "bad" };
    default: return null;
  }
}
