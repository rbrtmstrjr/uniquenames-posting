import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export function isOwnerEmail(email?: string | null, admin?: string): boolean {
  return !!email && !!admin && email.toLowerCase() === admin.toLowerCase();
}

export type Account = { id: string; email: string | null };

/**
 * The signed-in account from the session cookie, or null. auth.getClaims() verifies the access token's signature and
 * expiry (and refreshes an expiring session, like getUser did). This project signs tokens with an asymmetric key (ES256),
 * so the check runs here against the public key from /auth/v1/.well-known/jwks.json (fetched once, cached 10 minutes)
 * instead of sending every page view to Supabase Auth with getUser() (each request is a line in the project's logs).
 * A project still on the legacy symmetric JWT secret makes getClaims ask Auth, exactly as getUser did.
 * Trade-off: a session revoked elsewhere is honoured until its access token expires (1 hour at most); signing out in
 * this browser clears its cookies at once.
 */
export async function verifiedAccount(sb: SupabaseClient): Promise<Account | null> {
  try {
    const { data, error } = await sb.auth.getClaims();
    const c = data?.claims;
    if (error || !c?.sub) return null;
    return { id: c.sub, email: typeof c.email === "string" ? c.email : null };
  } catch {
    return null; // Auth unreachable while refreshing: treated as signed out, as getUser was
  }
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

// The public names PDF shop (docs/SHOP.md): pages and endpoints anyone may open without signing in. They never use
// the owner's session: they call migration 019's narrow functions with the anon key. Exact paths only; anything odd
// (dot segments, doubled slashes, encoded characters) stays behind the owner gate.
const PUBLIC_EXACT = new Set(["/shop", "/shop/thanks", "/api/shop/checkout", "/api/shop/status", "/api/paymongo/webhook"]);
export function isPublicPath(path: string): boolean {
  if (/[%\\]|\/\/|(^|\/)\.{1,2}(\/|$)/.test(path)) return false;
  if (PUBLIC_EXACT.has(path)) return true;
  return /^\/shop\/download\/[0-9a-f]{96}$/.test(path);
}

// Refreshes the session cookie on every request and sends anyone who is not
// the owner to /login (sign-ups are off; the email check is defense in depth).
// The public shop paths skip all of it (no Supabase call, no redirect).
export async function updateSession(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next({ request });
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
  const account = await verifiedAccount(sb);
  const owner = !!account && isOwnerEmail(account.email, process.env.ADMIN_EMAIL);
  const target = gateRedirect(request.nextUrl.pathname, !!account, owner);
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
