import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerStatusRow } from "@/lib/db/types";
import { canGenerate, workerHealth } from "@/lib/status/worker-health";

/**
 * Server half of the Generate lock (the client lock is the main one; this stops a stale
 * tab or a double-tap from queuing photos the PC cannot make). One small select of the
 * single worker_status row. A read error does not block: the lock is a convenience, not
 * a safety guarantee, and the card would simply wait in line.
 */
export async function generateLockReason(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.from("worker_status").select("last_seen, comfyui_ok").eq("id", 1).maybeSingle();
  if (error) return null;
  const lock = canGenerate(workerHealth((data ?? null) as WorkerStatusRow | null, Date.now()));
  return lock.ok ? null : lock.reason;
}
