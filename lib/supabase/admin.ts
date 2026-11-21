import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client, for the Autopilot tick route only (there is no owner session there; the route checks
 * AUTOPILOT_SECRET first). Never used in pages or actions, never sent to a browser. Null until the key is set.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
