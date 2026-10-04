import { describe, expect, it } from "vitest";
import { SEED_NAMES } from "@/supabase/seed/names";
import { SEED_THEMES } from "@/supabase/seed/themes";
import { NAME_RE } from "@/lib/names/bulk-paste";

describe("seed data", () => {
  it("212 valid, unique names in four buckets", () => {
    expect(SEED_NAMES).toHaveLength(212);
    expect(new Set(SEED_NAMES.map((n) => n.name.toLowerCase())).size).toBe(212);
    for (const n of SEED_NAMES) {
      expect(NAME_RE.test(n.name)).toBe(true);
      expect(n.meaning.length).toBeGreaterThan(2);
      expect(n.meaning.length).toBeLessThanOrEqual(80);
      expect(n.style === "single").toBe(n.name.split(" ").length === 1);
    }
  });
  it("60 complete studio themes, 30 per gender", () => {
    expect(SEED_THEMES.filter((t) => t.gender === "boy")).toHaveLength(30);
    expect(SEED_THEMES.filter((t) => t.gender === "girl")).toHaveLength(30);
    expect(new Set(SEED_THEMES.map((t) => t.title)).size).toBe(60);
    for (const t of SEED_THEMES) expect(t.backdrop).toMatch(/seamless .*studio backdrop/);
  });
});
