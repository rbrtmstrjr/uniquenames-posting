import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ShopDb } from "./service";

// The public shop's database client: the anon key, no cookies, no session. It can only call migration 019's shop
// functions (anon has no table access). The service-role key is never used on Vercel.

let client: ReturnType<typeof createClient> | null = null;

export function anonShopDb(): ShopDb {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const c = client;
  return { rpc: (fn, args) => c.rpc(fn, (args ?? {}) as never) };
}
