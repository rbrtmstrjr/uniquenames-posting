import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NAME_THEMES, nameThemeLabel, nameThemeTag, nameThemesProblem, parseNameTheme, parseNameThemes,
} from "@/lib/autopilot/name-themes";
import { postLabel } from "@/lib/series/letter";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { captionPrompt, captionProblem, composePostCaption, templateLine } = await import("@/lib/ai/caption");
const { postHistory } = await import("@/lib/captions/history");

beforeEach(() => generateJson.mockReset());

describe("name themes", () => {
  it("reads 'Title' and 'Title (hint)' lines, dropping blanks, duplicates and too-long titles", () => {
    expect(parseNameTheme("  Heavenly   (stars, sky, light) ")).toEqual({ title: "Heavenly", hint: "stars, sky, light" });
    expect(parseNameTheme("Biblical")).toEqual({ title: "Biblical", hint: null });
    expect(parseNameTheme("   ")).toBeNull();
    expect(parseNameTheme("x".repeat(61))).toBeNull();
    expect(parseNameThemes("Biblical\n\nbiblical\nSoft and cool").map((t) => t.title)).toEqual(["Biblical", "Soft and cool"]);
    expect(parseNameThemes(null).map((t) => t.title)).toHaveLength(DEFAULT_NAME_THEMES.length);
  });
  it("says why a list can't be saved", () => {
    expect(nameThemesProblem("")).toMatch(/at least one/);
    expect(nameThemesProblem(Array.from({ length: 31 }, (_, i) => `Theme ${i}`).join("\n"))).toMatch(/30/);
    expect(nameThemesProblem(`Biblical\n${"y".repeat(70)}`)).toMatch(/too long/);
    expect(nameThemesProblem(DEFAULT_NAME_THEMES.join("\n"))).toBeNull();
  });
  it("makes the hashtag and the label", () => {
    expect(nameThemeTag("Biblical")).toBe("#biblicalnames");
    expect(nameThemeTag("Nature-inspired")).toBe("#natureinspirednames");
    expect(nameThemeTag("Strong names")).toBe("#strongnames");
    expect(nameThemeLabel({ name_theme: "Biblical" })).toBe("Biblical names");
    expect(nameThemeLabel({ name_theme: "Strong names" })).toBe("Strong names");
    expect(nameThemeLabel({ name_theme: null })).toBeNull();
    expect(postLabel({ name_theme: "Soft and cool" })).toBe("Soft and cool names");
    expect(postLabel({ letter: "S" })).toBe("Letter S");
  });
});

describe("captions for a name-theme post", () => {
  const theme = { title: "Garden", backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c" };
  const nameTheme = { title: "Biblical", hint: null };
  it("tells the AI the theme and checks the caption says it", () => {
    const p = captionPrompt({ theme, gender: "girl", captionStyle: "story", nameTheme });
    expect(p).toContain("Every name in this post is one of our biblical names");
    expect(captionProblem("Sweet names for your little one.", { captionStyle: "story", nameTheme })).toMatch(/Biblical/);
    expect(captionProblem("Biblical baby girl names with gentle meanings.", { captionStyle: "story", nameTheme })).toBeNull();
  });
  it("the template names it and the theme tag takes the first theme-tag slot", () => {
    expect(templateLine("boy", "Lovely names.", undefined, null, null, "Biblical")).toBe("Biblical names for your baby boy. Lovely names.");
    const settings = { caption_template: "Lovely names.", hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", caption_ai: true };
    const c = composePostCaption({ ai: { line: "Biblical names for your girl.", tags: ["#faith"] }, aiOn: true, captionStyle: "story", gender: "girl",
      settings, history: postHistory([]), nameTheme: "Biblical" });
    expect(c.hashtag_set.split(" ").slice(0, 2)).toEqual(["#uniquenames", "#biblicalnames"]);
  });
});
