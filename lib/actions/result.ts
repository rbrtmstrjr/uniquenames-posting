import { getOwner } from "@/lib/supabase/server";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A bulk action that stopped part-way: `done` lists the ids it had already changed. */
export type BulkFailure = { ok: false; error: string; done: string[] };
export type BulkResult = ActionResult<{ count: number }> | BulkFailure;
export const bulkFail = (error: string, done: string[]): BulkFailure => ({ ok: false, error, done });

export async function requireOwner() {
  const user = await getOwner();
  if (!user) throw new Error("Not signed in.");
  return user;
}
