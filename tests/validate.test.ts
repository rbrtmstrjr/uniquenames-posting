import { describe, expect, it } from "vitest";
import { validateName, validateSettings, validateTextSettings, validateTheme } from "@/lib/actions/validate";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";

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
    const s = { caption_template: "x {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, ...TEXT_SETTINGS_DEFAULTS };
    expect(validateSettings(s)).toBeNull();
    expect(validateSettings({ ...s, min_images: 14 })).toMatch(/min/i);
    expect(validateSettings({ ...s, handle: "" })).toMatch(/handle/i);
    expect(validateSettings({ ...s, title_size: 500 })).toMatch(/Name size/);
    expect(validateSettings({ ...s, reel_max_images: 10 })).toBeNull();
    expect(validateSettings({ ...s, reel_max_images: 40 })).toBeNull();
    expect(validateSettings({ ...s, reel_max_images: 9 })).toBe("Images per reel must be 10 to 40.");
    expect(validateSettings({ ...s, reel_max_images: 41 })).toMatch(/Images per reel/);
    expect(validateSettings({ ...s, reel_max_images: 12.5 })).toMatch(/Images per reel/);
  });
  it("card text settings", () => {
    const t = { ...TEXT_SETTINGS_DEFAULTS, title_font: "playfair", meaning_font: "lora", mark_font: "greatvibes", text_position: "bottom-right" as const };
    expect(validateTextSettings(t)).toBeNull();
    expect(validateTextSettings({ ...t, title_font: "comic-sans" })).toMatch(/font/);
    expect(validateTextSettings({ ...t, mark_font: "" })).toMatch(/font/);
    expect(validateTextSettings({ ...t, title_size: 39 })).toBe("Name size must be 40 to 180 px.");
    expect(validateTextSettings({ ...t, title_size: 180 })).toBeNull();
    expect(validateTextSettings({ ...t, meaning_size: 91 })).toBe("Meaning size must be 16 to 90 px.");
    expect(validateTextSettings({ ...t, mark_size: 12.5 })).toBe("Watermark size must be 12 to 48 px.");
    expect(validateTextSettings({ ...t, mark_size: Number.NaN })).toMatch(/Watermark/);
    expect(validateTextSettings({ ...t, text_position: "upside-down" as never })).toMatch(/position/);
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
