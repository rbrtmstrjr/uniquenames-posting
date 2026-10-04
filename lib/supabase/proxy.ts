import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export function isOwnerEmail(email?: string | null, admin?: string): boolean {
  return !!email && !!admin && email.toLowerCase() === admin.toLowerCase();
}

// Refreshes the session cookie on every request and sends anyone who is not
// the owner to /login (sign-ups are off; the email check is defense in depth).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  const owner = !!user && isOwnerEmail(user.email, process.env.ADMIN_EMAIL);
  const path = request.nextUrl.pathname;
  const carry = (res: NextResponse) => { response.cookies.getAll().forEach((c) => res.cookies.set(c)); return res; };

  if (!owner && path !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    return carry(NextResponse.redirect(url));
  }
  if (owner && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return carry(NextResponse.redirect(url));
  }
  return response;
}
