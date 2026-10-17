import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isOwnerEmail, verifiedAccount, type Account } from "./proxy";

export async function createClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* server component: proxy refreshes */ }
      },
    },
  });
}

/** The owner's account (verified token claims, see verifiedAccount), or null: pages, server actions, the test-mode shop. */
export const getOwner = cache(async (): Promise<Account | null> => {
  const sb = await createClient();
  const account = await verifiedAccount(sb);
  return account && isOwnerEmail(account.email, process.env.ADMIN_EMAIL) ? account : null;
});
