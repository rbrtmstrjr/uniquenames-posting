import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isOwnerEmail } from "./proxy";

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

export const getOwner = cache(async () => {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user && isOwnerEmail(user.email, process.env.ADMIN_EMAIL) ? user : null;
});
