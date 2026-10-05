import catalog from "./catalog.json";
import layout from "@/lib/text/layout.json";

/**
 * The card font catalog. The list lives in catalog.json, which the PC worker reads too
 * (worker/fonts.py downloads the same Google Fonts files and stamps with them), so the
 * Settings page can only offer fonts the worker can draw.
 */
export interface FontEntry {
  id: string; label: string; family: string; dir: string;
  /** One variable font file with a wght axis, or one static file per weight. */
  var?: string; files?: Record<string, string>;
  /** Names are stamped in CAPITALS; script fonts keep the name's own Title Case. */
  caps: boolean;
}

export const FONTS: readonly FontEntry[] = catalog.fonts as FontEntry[];
export const FONT_IDS = FONTS.map((f) => f.id);
export const FALLBACK_FONT = catalog.fallback;

export const isFontId = (id: unknown): id is string => typeof id === "string" && FONT_IDS.includes(id);
/** Unknown ids fall back to Poppins, like the worker. */
export const fontById = (id: string | null | undefined): FontEntry =>
  FONTS.find((f) => f.id === id) ?? FONTS.find((f) => f.id === FALLBACK_FONT)!;

/** The weights a font really has (a static single-weight font is drawn at 400 only, never faux bold). */
export const fontWeights = (f: FontEntry): number[] => (f.var ? [layout.bodyWeight, layout.titleWeight] : Object.keys(f.files ?? {}).map(Number).sort((a, b) => a - b));
/** The closest weight the font has, like worker/fonts.py `_pick_file`. */
export function fontWeight(f: FontEntry, want: number): number {
  return fontWeights(f).reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best));
}

/** CSS font-family for a catalog font, with a generic fallback. */
export const cssFamily = (f: FontEntry) => `"${f.family}", ${f.caps ? "sans-serif" : "cursive"}`;

/** One Google Fonts CSS2 URL for the whole catalog (loaded on the Settings page only). */
export function googleFontsHref(fonts: readonly FontEntry[] = FONTS): string {
  const families = fonts.map((f) => {
    const fam = f.family.replace(/ /g, "+");
    const ws = fontWeights(f);
    return ws.length > 1 || ws[0] !== 400 ? `family=${fam}:wght@${ws.join(";")}` : `family=${fam}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}
