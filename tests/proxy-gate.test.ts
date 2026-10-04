import { describe, expect, it } from "vitest";
import { gateRedirect, isOwnerEmail, safeNext } from "@/lib/supabase/proxy";
import { config } from "@/proxy";

describe("isOwnerEmail", () => {
  it("matches case-insensitively and needs a configured admin", () => {
    expect(isOwnerEmail("Robert@Example.com", "robert@example.com")).toBe(true);
    expect(isOwnerEmail("other@example.com", "robert@example.com")).toBe(false);
    expect(isOwnerEmail("robert@example.com", "")).toBe(false);
    expect(isOwnerEmail(null, "robert@example.com")).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNext("/posts/abc?x=1")).toBe("/posts/abc?x=1");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
  });
  it("rejects tab/CR/LF tricks that browsers collapse into //host", () => {
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\r/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("/\r\n/evil.com")).toBe("/");
    expect(safeNext("/posts/\tabc")).toBe("/");
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
    expect(safeNext("/posts/abc#card-2")).toBe("/posts/abc#card-2");
  });
});

describe("gateRedirect", () => {
  it("lets the owner through and bounces them off /login", () => {
    expect(gateRedirect("/posts/a", true, true)).toBeNull();
    expect(gateRedirect("/login", true, true)).toEqual({ pathname: "/", search: "" });
  });
  it("sends signed-out visitors to /login with next", () => {
    expect(gateRedirect("/", false, false)).toEqual({ pathname: "/login", search: "" });
    expect(gateRedirect("/posts/a", false, false)).toEqual({ pathname: "/login", search: "?next=%2Fposts%2Fa" });
    expect(gateRedirect("/login", false, false)).toBeNull();
  });
  it("sends a signed-in non-owner to /login?denied=1 instead of looping silently", () => {
    expect(gateRedirect("/", true, false)).toEqual({ pathname: "/login", search: "?denied=1" });
    expect(gateRedirect("/names", true, false)).toEqual({ pathname: "/login", search: "?denied=1&next=%2Fnames" });
    expect(gateRedirect("/login", true, false)).toBeNull();
  });
});

describe("proxy matcher", () => {
  const re = new RegExp("^" + config.matcher[0] + "$");
  it("gates app and api paths", () => {
    for (const p of ["/", "/posts/abc", "/api/xpng", "/foo-ico"]) expect(re.test(p), p).toBe(true);
  });
  it("skips internals and static images", () => {
    for (const p of ["/_next/static/x.js", "/favicon.ico", "/icon.svg", "/x/photo.jpg"]) expect(re.test(p), p).toBe(false);
  });
});
