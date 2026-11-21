import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardRow } from "@/lib/db/types";
import { nextSeed } from "@/lib/actions/helpers";

/** The fields that put a card back in line (the worker claims it again). */
export const REQUEUE = { status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0 } as const;

/**
 * An owner edit that gives an Autopilot card (check_state set, migration 022) a new image sends it back to its photo
 * check: a card that passed keeps "passed" no more. Cards of hand-made posts (check_state null, or no column before 022)
 * get nothing.
 */
export const recheck = (card: Pick<CardRow, "check_state">) =>
  (card.check_state != null ? { check_state: "pending" as const, check_note: null } : {});

/**
 * Autopilot's remake: the same shot with a new seed (ComfyUI is deterministic), back in line, guarded by the card's
 * version so a card that changed meanwhile is left alone. `extra` lands in the same update (the check fields).
 */
export async function remakeCard(sb: SupabaseClient, card: Pick<CardRow, "id" | "version" | "seed">, extra: Record<string, unknown> = {}): Promise<boolean> {
  const version = card.version + 1;
  const { data, error } = await sb.from("cards")
    .update({ ...REQUEUE, ...extra, version, seed: nextSeed(card.id, version, card.seed), queued_at: new Date().toISOString() })
    .eq("id", card.id).eq("version", card.version).neq("status", "generating").select("id");
  return !error && !!data?.length;
}
