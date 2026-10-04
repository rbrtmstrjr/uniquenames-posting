import { getOwner } from "@/lib/supabase/server";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function requireOwner() {
  const user = await getOwner();
  if (!user) throw new Error("Not signed in.");
  return user;
}
