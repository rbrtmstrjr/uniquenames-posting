import { FALLBACK_FONT, isFontId } from "./catalog";

/**
 * Fonts are chosen per post (Today, and the post page's Re-stamp dialog). posts.title_font etc.
 * (migration 003) hold them; null = the fonts in settings, which are the "last used" fonts.
 */
export const FONT_KEYS = ["title_font", "meaning_font", "mark_font"] as const;
export type FontKey = (typeof FONT_KEYS)[number];
export type PostFonts = Record<FontKey, string>;
export const FONT_LABELS: Record<FontKey, string> = { title_font: "Name", meaning_font: "Meaning", mark_font: "Watermark" };

type FontSource = Partial<Record<FontKey, string | null>> | null | undefined;

/** Per key, the first catalog font found in `sources` (e.g. the post, then settings), else Poppins. */
export function fontsOf(...sources: FontSource[]): PostFonts {
  const pick = (k: FontKey) => sources.map((s) => s?.[k]).find(isFontId) ?? FALLBACK_FONT;
  return { title_font: pick("title_font"), meaning_font: pick("meaning_font"), mark_font: pick("mark_font") };
}

/** All three must be catalog font ids (the PC can only draw those). */
export function validateFonts(f: unknown): string | null {
  if (!f || typeof f !== "object") return "Pick the fonts from the list.";
  for (const k of FONT_KEYS) {
    const v = (f as Record<string, unknown>)[k];
    if (!isFontId(v)) return `${FONT_LABELS[k]} font: "${String(v ?? "")}" is not in the font list. Pick one from the list.`;
  }
  return null;
}

export const sameFonts = (a: PostFonts, b: PostFonts) => FONT_KEYS.every((k) => a[k] === b[k]);

/** True when the row has the 003 font columns (null counts; a missing key means 003 has not run). */
export const hasFontColumns = (row: object) => FONT_KEYS.every((k) => k in row);

/**
 * What the Re-stamp dialog sends: the picked fonts, except when the database has no font
 * columns yet (003 not run) and the owner kept the prefilled fonts, which are then the
 * settings fonts the PC uses anyway: sending nothing keeps Re-stamp working before 003.
 */
export function restampFonts(post: object, prefill: PostFonts, picked: PostFonts): PostFonts | undefined {
  return hasFontColumns(post) || !sameFonts(prefill, picked) ? picked : undefined;
}
