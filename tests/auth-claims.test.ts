import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The owner gate (proxy) and getOwner (pages, server actions) verify the session with auth.getClaims(): with the
// project's asymmetric signing key (ES256) the token is checked locally against the cached public key, so a page view no
// longer sends a request to Supabase Auth (each one was a line in the project's logs). getUser() always asked Auth.
const auth = { getClaims: vi.fn(), getUser: vi.fn(), getSession: vi.fn() };
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth })) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { updateSession, verifiedAccount } = await import("@/lib/supabase/proxy");
const { getOwner } = await import("@/lib/supabase/server");

const OWNER = "owner@example.com";
const claims = (c: Record<string, unknown>) => auth.getClaims.mockResolvedValue({ data: { claims: c, header: {}, signature: new Uint8Array() }, error: null });
const where = (res: Response) => res.headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_EMAIL", OWNER);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});

describe("proxy gate", () => {
  it("lets the owner through with getClaims and never calls getUser", async () => {
    claims({ sub: "u1", email: "Owner@Example.com", role: "authenticated" });
    const res = await updateSession(new NextRequest("https://app.test/posts/a"));
    expect(where(res)).toBeNull();
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("sends a signed-in account that is not the owner to /login?denied=1", async () => {
    claims({ sub: "u2", email: "someone@example.com", role: "authenticated" });
    expect(where(await updateSession(new NextRequest("https://app.test/names")))).toBe("https://app.test/login?denied=1&next=%2Fnames");
  });

  it("no session, a bad signature or an expired token: /login", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(where(await updateSession(new NextRequest("https://app.test/")))).toBe("https://app.test/login");
    auth.getClaims.mockResolvedValue({ data: null, error: new Error("Invalid JWT signature") });
    expect(where(await updateSession(new NextRequest("https://app.test/posts/a")))).toBe("https://app.test/login?next=%2Fposts%2Fa");
    auth.getClaims.mockRejectedValue(new Error("fetch failed"));
    expect(where(await updateSession(new NextRequest("https://app.test/")))).toBe("https://app.test/login");
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("claims without an email (an anonymous sign-in) are never the owner", async () => {
    claims({ sub: "anon-1", role: "authenticated", is_anonymous: true });
    expect(where(await updateSession(new NextRequest("https://app.test/")))).toBe("https://app.test/login?denied=1");
  });

  it("the public shop paths never touch auth", async () => {
    await updateSession(new NextRequest("https://app.test/shop"));
    expect(auth.getClaims).not.toHaveBeenCalled();
  });
});

describe("getOwner", () => {
  it("is the owner's id and email from the verified claims", async () => {
    claims({ sub: "u1", email: OWNER, role: "authenticated" });
    expect(await getOwner()).toEqual({ id: "u1", email: OWNER });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("is null for anyone else, without a session, or when ADMIN_EMAIL is not set", async () => {
    claims({ sub: "u2", email: "someone@example.com" });
    expect(await getOwner()).toBeNull();
    auth.getClaims.mockResolvedValue({ data: null, error: new Error("JWT expired") });
    expect(await getOwner()).toBeNull();
    claims({ sub: "u1", email: OWNER });
    vi.stubEnv("ADMIN_EMAIL", "");
    expect(await getOwner()).toBeNull();
  });
});

describe("verifiedAccount", () => {
  it("needs a subject; a non-string email is no email", async () => {
    const sb = { auth } as never;
    claims({ email: OWNER });
    expect(await verifiedAccount(sb)).toBeNull();
    claims({ sub: "u1", email: 42 });
    expect(await verifiedAccount(sb)).toEqual({ id: "u1", email: null });
  });
});
