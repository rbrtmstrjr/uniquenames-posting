import { describe, expect, it } from "vitest";
import { isOwnerEmail, safeNext } from "@/lib/supabase/proxy";
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
