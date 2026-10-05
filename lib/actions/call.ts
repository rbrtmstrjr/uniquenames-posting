import type { ActionResult } from "./result";

export const OFFLINE_ERROR = "Could not reach the server. Check your connection and try again.";

// Client-side wrapper for a server action: a thrown call (offline, timeout, server crash)
// becomes an ordinary failed result, so optimistic UI can always roll back and toast.
export async function callAction<T extends object>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const r = await fn();
    return r ?? { ok: false, error: "Something went wrong." };
  } catch {
    return { ok: false, error: OFFLINE_ERROR };
  }
}

// Optimistic update helper: apply the change now, run the action, roll back on failure.
// The rollback gets the failed result (see `doneIds` for bulk actions that stopped part-way).
// Returns the action result so callers can toast success/failure.
export async function optimistic<T extends object>(apply: () => void, rollback: (r: { ok: false; error: string }) => void, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  apply();
  const r = await callAction(fn);
  if (!r.ok) rollback(r);
  return r;
}

/** Ids a failed bulk action had already changed before it stopped (empty if none/unknown). */
export function doneIds(r: { ok: false; error: string }): Set<string> {
  const done = (r as { done?: unknown }).done;
  return new Set(Array.isArray(done) ? done.filter((d): d is string => typeof d === "string") : []);
}
