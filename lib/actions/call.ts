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
// Returns the action result so callers can toast success/failure.
export async function optimistic<T extends object>(apply: () => void, rollback: () => void, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  apply();
  const r = await callAction(fn);
  if (!r.ok) rollback();
  return r;
}
