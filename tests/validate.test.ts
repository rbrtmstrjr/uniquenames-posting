import { describe, expect, it } from "vitest";
import { validateName, validateSettings, validateTheme } from "@/lib/actions/validate";

describe("validate", () => {
  it("names", () => {
    expect(validateName("Arlo Zenith", "peak strength")).toBeNull();
    expect(validateName("Arlo2", "x")).toMatch(/letters/);
    expect(validateName("Arlo", "")).toMatch(/meaning/i);
    expect(validateName("A".repeat(41), "x")).toMatch(/40/);
  });
  it("themes", () => {
    const t = { title: "Boho", gender: "boy" as const, backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c" };
    expect(validateTheme(t)).toBeNull();
    expect(validateTheme({ ...t, props: " " })).toMatch(/props/);
  });
  it("settings", () => {
    const s = { caption_template: "x {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, caption_ai: true };
    expect(validateSettings(s)).toBeNull();
    expect(validateSettings({ ...s, min_images: 14 })).toMatch(/min/i);
    expect(validateSettings({ ...s, handle: "" })).toMatch(/handle/i);
  });
});

describe("validateName with curly apostrophes", () => {
  it("accepts names typed with iPhone smart punctuation", () => {
    expect(validateName("D’Angelo", "messenger")).toBeNull();
    expect(validateName("O‘Brien", "noble")).toBeNull();
    expect(validateName("Keʼala", "path")).toBeNull();
    expect(validateName("“Luna”", "moon")).toBeNull();
  });
});
