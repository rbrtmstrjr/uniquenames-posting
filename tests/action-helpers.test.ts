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
  it("gives every name consistent capitals, keeping deliberate mixed case", () => {
    expect(normalizeName("arlo   zenith")).toBe("Arlo Zenith");
    expect(normalizeName("ARLO ZENITH")).toBe("Arlo Zenith");
    expect(normalizeName("mary-jane")).toBe("Mary-Jane");
    expect(normalizeName("McKenzie deAndre")).toBe("McKenzie DeAndre");
    expect(normalizeName("d’angelo")).toBe("D'angelo");
    expect(normalizeName("O'Brien")).toBe("O'Brien");
    expect(normalizeName("élodie")).toBe("Élodie");
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
