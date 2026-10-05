import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// One browser client per tab (Realtime shares its socket).
export function createClient(): SupabaseClient {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}

/**
 * Put the signed-in token on the Realtime socket before joining a channel. A channel joined
 * before the session has loaded joins as anon, and RLS (owner only) then turns every change
 * into an empty "Error 401: Unauthorized" event — the PC looked offline 45 s after each page
 * load because the worker_status heartbeats never got through. Never throws.
 */
export async function realtimeAuthReady(sb: SupabaseClient): Promise<void> {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) await sb.realtime.setAuth(data.session.access_token);
  } catch { /* join anyway; the refetch-on-subscribe path still loads fresh rows */ }
}
