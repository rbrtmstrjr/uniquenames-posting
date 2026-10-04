import { describe, expect, it } from "vitest";
import { isOwnerEmail } from "@/lib/supabase/proxy";

describe("isOwnerEmail", () => {
  it("matches case-insensitively and needs a configured admin", () => {
    expect(isOwnerEmail("Robert@Example.com", "robert@example.com")).toBe(true);
    expect(isOwnerEmail("other@example.com", "robert@example.com")).toBe(false);
    expect(isOwnerEmail("robert@example.com", "")).toBe(false);
    expect(isOwnerEmail(null, "robert@example.com")).toBe(false);
  });
});
