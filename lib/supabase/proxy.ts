import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export function isOwnerEmail(email?: string | null, admin?: string): boolean {
  return !!email && !!admin && email.toLowerCase() === admin.toLowerCase();
}

// Only same-site relative paths. Browsers strip tab/CR/LF and treat "\" as "/",
// so "/\t/evil.com" would become "//evil.com": reject control chars and
// backslashes outright. URL parsing collapses dot segments ("/.//evil.com" -> "//evil.com"),
// so also reject any "//" or dot segment (".", "..", or %2e forms) in the path part, then
// parse, require our origin, and re-check that the result is not protocol-relative.
export function safeNext(next?: string): string {
  if (!next || !next.startsWith("/") || /[\u0000-\u001F\u007F\\]/.test(next)) return "/";
  const path = next.split(/[?#]/, 1)[0];
  if (path.includes("//") || /(^|\/)\.{1,2}(\/|$)/.test(path.replace(/%2e/gi, "."))) return "/";
  let u: URL;
  try { u = new URL(next, "http://x"); } catch { return "/"; }
  if (u.origin !== "http://x") return "/";
  const out = u.pathname + u.search + u.hash;
  return out.startsWith("//") || out.startsWith("/\\") ? "/" : out;
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
  const target = gateRedirect(request.nextUrl.pathname, !!user, owner);
  if (!target) return response;
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  const res = NextResponse.redirect(url);
  response.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

// Where the gate sends a request, or null to let it through. A signed-in account
// that is not the owner goes to /login?denied=1 so the page can explain why
// (and sign it out) instead of silently looping back to the login form.
export function gateRedirect(path: string, signedIn: boolean, owner: boolean): { pathname: string; search: string } | null {
  if (owner) return path === "/login" ? { pathname: "/", search: "" } : null;
  if (path === "/login") return null;
  const params = new URLSearchParams();
  if (signedIn) params.set("denied", "1");
  if (path !== "/") params.set("next", path);
  const qs = params.toString();
  return { pathname: "/login", search: qs ? `?${qs}` : "" };
}
