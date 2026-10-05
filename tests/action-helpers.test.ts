import { describe, expect, it } from "vitest";
import { dedupeNames, nameKey, normalizeName, restampMode, styleOf, validateCreatePost } from "@/lib/actions/helpers";

const U = "123e4567-e89b-12d3-a456-426614174000";

describe("restampMode", () => {
  it("restamps only with a current clean photo", () => {
    expect(restampMode({ status: "done", photo_path: "a" })).toBe("restamp");
    expect(restampMode({ status: "failed", photo_path: "a" })).toBe("restamp");
    expect(restampMode({ status: "restamp", photo_path: "a" })).toBe("restamp");
    expect(restampMode({ status: "queued", photo_path: "a" })).toBe("regenerate");
    expect(restampMode({ status: "done", photo_path: null })).toBe("regenerate");
  });
});

describe("name helpers", () => {
  it("normalizes, keys and styles", () => {
    expect(normalizeName("  Arlo   Zenith ")).toBe("Arlo Zenith");
    expect(nameKey("  ARLO   zenith")).toBe("arlo zenith");
    expect(styleOf("Arlo  Zenith")).toBe("two-word");
    expect(styleOf(" Arlo ")).toBe("single");
  });
  it("only raises a lowercase first letter per word — never lowercases anything", () => {
    expect(normalizeName("arlo   zenith")).toBe("Arlo Zenith");
    expect(normalizeName("AJ")).toBe("AJ");
    expect(normalizeName("TJ Rowan")).toBe("TJ Rowan");
    expect(normalizeName("JJ")).toBe("JJ");
    expect(normalizeName("ARLO ZENITH")).toBe("ARLO ZENITH");
    expect(normalizeName("Mary-JANE")).toBe("Mary-JANE");
    expect(normalizeName("mary-jane")).toBe("Mary-Jane");
    expect(normalizeName("McKenzie")).toBe("McKenzie");
    expect(normalizeName("McKenzie deAndre")).toBe("McKenzie DeAndre");
    expect(normalizeName("D'Angelo")).toBe("D'Angelo");
    expect(normalizeName("d’angelo")).toBe("D'angelo");
    expect(normalizeName("Zoë")).toBe("Zoë");
    expect(normalizeName("élodie")).toBe("Élodie");
    // first + middle names, not surnames: short words are names too
    expect(normalizeName("ava le")).toBe("Ava Le");
    expect(normalizeName("arlo van")).toBe("Arlo Van");
    expect(normalizeName("Ava Le")).toBe("Ava Le");
    expect(nameKey(" arlo  ZENITH ")).toBe(nameKey("Arlo Zenith"));
  });
  it("dedupes against existing and within the batch", () => {
    const have = new Set(["arlo"]);
    const { fresh, skipped } = dedupeNames([{ name: "ARLO" }, { name: "Kai  Rowan" }, { name: "kai rowan" }], have);
    expect(fresh.map((r) => r.name)).toEqual(["Kai  Rowan"]);
    expect(skipped).toEqual(["ARLO", "kai rowan"]);
  });
});

describe("validateCreatePost", () => {
  const ok = { gender: "boy", style: "single", count: null, requestId: U };
  it("accepts valid input", () => {
    expect(validateCreatePost(ok)).toBeNull();
    expect(validateCreatePost({ ...ok, count: 10, themeId: U })).toBeNull();
  });
  it("rejects bad input", () => {
    expect(validateCreatePost({ ...ok, requestId: "x" })).toBeTruthy();
    expect(validateCreatePost({ ...ok, themeId: "x" })).toBeTruthy();
    expect(validateCreatePost({ ...ok, gender: "other" })).toBeTruthy();
    expect(validateCreatePost({ ...ok, style: "three" })).toBeTruthy();
    expect(validateCreatePost({ ...ok, count: 9.5 })).toBeTruthy();
  });
});

describe("curly apostrophes (iPhone smart punctuation)", () => {
  it("normalizeName straightens them so storage and dedup use the plain form", () => {
    expect(normalizeName("D’Angelo")).toBe("D'Angelo");
    expect(normalizeName("D‘Angelo")).toBe("D'Angelo");
    expect(normalizeName("DʼAngelo")).toBe("D'Angelo");
    expect(normalizeName("“Luna”  Rose")).toBe("Luna Rose");
    expect(nameKey("D’Angelo")).toBe(nameKey("d'angelo"));
  });
});
