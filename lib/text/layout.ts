import layout from "./layout.json";
import { fontById } from "@/lib/fonts/catalog";
import type { TextPosition } from "@/lib/db/types";

/**
 * The card text layout for the Settings live preview. The numbers live in layout.json and
 * the PC worker stamps with the SAME file (worker/render.py: text_style, fit_title,
 * fit_meaning, balanced_lines, layout_text). These functions mirror that Python code
 * step for step; only the text measuring differs (canvas here, FreeType there), so the
 * preview can be a pixel or two off but never lays text out differently.
 */
export const LAYOUT = layout;
export const SIZE_RANGES = layout.sizes;
export type SizeKey = keyof typeof layout.sizes;

/** Width in px of `text` at font size `px` (one font + weight per measure function). */
export type Measure = (text: string, px: number) => number;

/** A px size on a card `width` px wide (sizes are stored for 1080 px). Half rounds up, like the worker's _px. */
export const pxAt = (size: number, width: number) => Math.floor((size * width) / layout.baseWidth + 0.5);

/** Largest whole size in [lo, hi] where fits(size) holds, or null if lo does not fit. */
export function largest(fits: (px: number) => boolean, lo: number, hi: number): number | null {
  lo = Math.trunc(lo); hi = Math.trunc(hi);
  if (hi < lo || !fits(lo)) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** The name never wraps: it shrinks until it fits maxW. */
export function fitTitle(measure: Measure, text: string, px: number, maxW: number): number {
  return largest((s) => measure(text, s) <= maxW, layout.minPx, Math.floor(px + 0.5)) ?? layout.minPx;
}

function combos(n: number, k: number, start = 1): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (let i = start; i < n; i++) for (const rest of combos(n, k - 1, i + 1)) out.push([i, ...rest]);
  return out;
}

/** `words` in n lines whose widest line is as narrow as possible (first best wins, like Python). */
export function balancedLines(measure: Measure, px: number, words: string[], n: number): string[] {
  if (n <= 1) return [words.join(" ")];
  let best: { widest: number; bounds: number[] } | null = null;
  for (const cuts of combos(words.length, n - 1)) {
    const bounds = [0, ...cuts, words.length];
    let widest = 0;
    for (let i = 0; i < n; i++) widest = Math.max(widest, measure(words.slice(bounds[i], bounds[i + 1]).join(" "), px));
    if (!best || widest < best.widest) best = { widest, bounds };
  }
  return Array.from({ length: n }, (_, i) => words.slice(best!.bounds[i], best!.bounds[i + 1]).join(" "));
}

/** One line shrinking to meaningShrinkFirst, then up to meaningMaxLines balanced lines, then smaller. */
export function fitMeaning(measure: Measure, text: string, px: number, maxW: number): { px: number; lines: string[] } {
  const words = text.split(/\s+/).filter(Boolean);
  const start = Math.floor(px + 0.5);
  const floor = Math.max(layout.minPx, Math.floor(px * layout.meaningShrinkFirst + 0.5));
  const most = Math.max(1, Math.min(layout.meaningMaxLines, words.length));
  const fits = (n: number) => (s: number) => balancedLines(measure, s, words, n).every((ln) => measure(ln, s) <= maxW);
  for (let n = 1; n <= most; n++) {
    const s = largest(fits(n), floor, start);
    if (s) return { px: s, lines: balancedLines(measure, s, words, n) };
  }
  const s = largest(fits(most), layout.minPx, floor - 1) ?? layout.minPx;
  return { px: s, lines: balancedLines(measure, s, words, most) };
}

export type Vert = "auto" | "top" | "middle" | "bottom";
export type Horiz = "left" | "center" | "right";
export function spot(position: TextPosition): { vert: Vert; horiz: Horiz } {
  if (position === "auto") return { vert: "auto", horiz: "center" };
  const [vert, horiz] = position.split("-") as [Vert, Horiz];
  return { vert, horiz };
}

/** Widest a line may be: 88% centred, 70% left/right. */
export const maxWidthFor = (horiz: Horiz, width: number) => width * (horiz === "center" ? layout.maxWidthCenter : layout.maxWidthSide);
/** The watermark sits bottom-right unless the text is bottom-right. */
export const markSide = (position: TextPosition): "left" | "right" => (position === "bottom-right" ? "left" : "right");
/** The name as stamped: CAPITALS, except in script fonts. */
export const titleText = (name: string, fontId: string) => (fontById(fontId).caps ? name.toUpperCase() : name);
