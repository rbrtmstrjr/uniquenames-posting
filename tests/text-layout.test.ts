import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import layoutJson from "@/lib/text/layout.json";
import catalogJson from "@/lib/fonts/catalog.json";
import { TEXT_POSITIONS, TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { FONT_IDS, cssFamily, fontById, fontWeight, googleFontsHref, isFontId } from "@/lib/fonts/catalog";
import { balancedLines, fitMeaning, fitTitle, markSide, maxWidthFor, pxAt, spot, titleText, type Measure } from "@/lib/text/layout";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// A monospace stand-in for text measuring: every character is 0.6 em wide.
const mono: Measure = (text, px) => text.length * px * 0.6;

describe("one source of truth shared with the PC worker", () => {
  it("the worker reads the same layout.json and catalog.json", () => {
    expect(read("worker/render.py")).toMatch(/os\.path\.join\(HERE, "\.\.", "lib", "text", "layout\.json"\)/);
    expect(read("worker/fonts.py")).toMatch(/os\.path\.join\(HERE, "\.\.", "lib", "fonts", "catalog\.json"\)/);
  });

  it("DB defaults, positions and the migration's size ranges match layout.json", () => {
    expect(TEXT_POSITIONS).toEqual(layoutJson.positions);
    expect([TEXT_SETTINGS_DEFAULTS.title_size, TEXT_SETTINGS_DEFAULTS.meaning_size, TEXT_SETTINGS_DEFAULTS.mark_size])
      .toEqual([layoutJson.sizes.title.default, layoutJson.sizes.meaning.default, layoutJson.sizes.mark.default]);
    expect(TEXT_SETTINGS_DEFAULTS.title_font).toBe(catalogJson.fallback);
    const sql = read("supabase/migrations/002_v2.sql");
    for (const [col, key] of [["title_size", "title"], ["meaning_size", "meaning"], ["mark_size", "mark"]] as const) {
      const r = layoutJson.sizes[key];
      expect(sql).toContain(`check (${col} between ${r.min} and ${r.max})`);
      expect(sql).toContain(`${col} int not null default ${r.default}`);
    }
    for (const p of TEXT_POSITIONS) expect(sql).toContain(`'${p}'`);
  });

  it("the font list is the verified one", () => {
    expect(FONT_IDS).toEqual(["poppins", "montserrat", "playfair", "fraunces", "dmserif", "quicksand", "nunito", "lora",
      "cormorant", "josefin", "comfortaa", "greatvibes", "dancing", "pacifico", "parisienne"]);
  });
});

describe("font catalog", () => {
  it("unknown ids fall back to Poppins", () => {
    expect(fontById("comic").id).toBe("poppins");
    expect(fontById(undefined).id).toBe("poppins");
    expect(isFontId("lora")).toBe(true);
    expect(isFontId("comic")).toBe(false);
  });

  it("single-weight fonts are never asked for 600 (no faux bold)", () => {
    expect(fontWeight(fontById("greatvibes"), 600)).toBe(400);
    expect(fontWeight(fontById("montserrat"), 600)).toBe(600);
    expect(fontWeight(fontById("poppins"), 600)).toBe(600);
  });

  it("one Google Fonts URL with every family and only the weights each has", () => {
    const href = googleFontsHref();
    expect(href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
    expect(href).toContain("family=Playfair+Display:wght@400;600");
    expect(href).toContain("family=Great+Vibes&");
    expect(href).toContain("family=Poppins:wght@400;600");
    expect(href.match(/family=/g)).toHaveLength(FONT_IDS.length);
    expect(href).toMatch(/display=swap$/);
    expect(cssFamily(fontById("pacifico"))).toBe('"Pacifico", cursive');
  });
});

describe("layout mirror of worker/render.py", () => {
  it("sizes scale with the width, half up", () => {
    expect([pxAt(95, 540), pxAt(37, 540), pxAt(21, 540)]).toEqual([48, 19, 11]);
    expect(pxAt(95, 1080)).toBe(95);
  });

  it("spots, widths and the watermark side", () => {
    expect(spot("auto")).toEqual({ vert: "auto", horiz: "center" });
    expect(spot("bottom-left")).toEqual({ vert: "bottom", horiz: "left" });
    expect(maxWidthFor("center", 1000)).toBeCloseTo(880);
    expect(maxWidthFor("right", 1000)).toBeCloseTo(700);
    expect(TEXT_POSITIONS.filter((p) => markSide(p) === "left")).toEqual(["bottom-right"]);
  });

  it("script fonts keep Title Case", () => {
    expect(titleText("Arlo Zenith", "lora")).toBe("ARLO ZENITH");
    expect(titleText("Arlo Zenith", "greatvibes")).toBe("Arlo Zenith");
  });

  it("the name shrinks to fit and never wraps", () => {
    expect(fitTitle(mono, "ARLO", 95, 756)).toBe(95);
    const px = fitTitle(mono, "ANASTASIA-EVANGELINE MAXIMILIANA ROSALIE", 180, 756);
    expect(mono("ANASTASIA-EVANGELINE MAXIMILIANA ROSALIE", px)).toBeLessThanOrEqual(756);
    expect(mono("ANASTASIA-EVANGELINE MAXIMILIANA ROSALIE", px + 1)).toBeGreaterThan(756);
  });

  it("the meaning shrinks a little, then wraps onto balanced lines", () => {
    expect(fitMeaning(mono, "peak strength", 37, 756)).toEqual({ px: 37, lines: ["peak strength"] });
    const long = "a gift of grace and light who brings joy, warmth and peace to every home she";
    const r = fitMeaning(mono, long, 90, 756);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.join(" ")).toBe(long);
    for (const ln of r.lines) expect(mono(ln, r.px)).toBeLessThanOrEqual(756);
    expect(balancedLines(mono, 10, ["aa", "bb", "cc", "dd"], 2)).toEqual(["aa bb", "cc dd"]);
  });

  // The real cross-check: the worker's own Python functions, given the same monospace
  // measure, must pick the same sizes and line breaks. Skipped where Python + Pillow are missing.
  const py = spawnSync("python", ["-c", "import PIL"]);
  it.skipIf(py.status !== 0)("matches the Python worker on the same inputs", () => {
    const cases = [
      ["peak strength", 37, 756], ["a gift of grace and light who brings joy, warmth and peace to every home she", 90, 756],
      ["light of the morning sun over quiet water", 60, 950], ["x", 16, 300],
    ] as const;
    const script = `
import json, sys
sys.path.insert(0, "worker")
import render
class F:
    def __init__(s, px): s.size = px
    def getbbox(s, t): return (0, 0, len(t) * s.size * 0.6, s.size)
render.fonts.load_safe = lambda fid, w, px, log=None: F(px)
out = []
for text, px, mw in json.loads(sys.argv[1]):
    f, lines = render.fit_meaning("poppins", text, px, mw)
    out.append({"px": f.size, "lines": lines, "title": render.fit_title("poppins", text.upper(), px * 2, mw).size})
print(json.dumps(out))`;
    const r = spawnSync("python", ["-c", script, JSON.stringify(cases)], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const got = JSON.parse(r.stdout) as { px: number; lines: string[]; title: number }[];
    cases.forEach(([text, px, mw], i) => {
      expect(got[i]).toEqual({ ...fitMeaning(mono, text, px, mw), title: fitTitle(mono, text.toUpperCase(), px * 2, mw) });
    });
  });
});
