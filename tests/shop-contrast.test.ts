import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACK_IDS, packById } from "@/packs";

// /shop's text stays readable over the moving photo wall: every text colour against the background it really sits
// on (WCAG 2.x contrast), for every pack, light and dark. Cards are the pack's cream (dark: surface) at 96% opacity
// (app/globals.css .shop-card), so the worst case lets 4% of pure black (light) or pure white (dark) through.
// Tokens: the pack's brand colours over app/globals.css (warn-text and bad live only there).

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const m = h.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)) as RGB;
};
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** `a` at opacity t over `b`. */
const over = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v * t + b[i] * (1 - t)) as RGB;

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const block = (sel: RegExp) => {
  const body = css.match(sel)?.[1] ?? "";
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
};
const BASE = { light: block(/^:root\s*\{([^}]*)\}/m), dark: block(/^\.dark\s*\{([^}]*)\}/m) };

/** The card opacity in app/globals.css (.shop-card), read from the file so the test follows a change. */
const CARD_ALPHA = Number(css.match(/\.shop-card\s*\{[^}]*color-mix\(in srgb, var\(--card\) (\d+)%/)?.[1] ?? NaN) / 100;

interface Pair { where: string; fg: string; bg: (t: (k: string) => RGB, card: RGB) => RGB; min: number }
const NORMAL = 4.5;
const UI = 3; // focus rings, the error icon: non-text (WCAG 1.4.11)
const PAIRS: Pair[] = [
  { where: "headings, header, inside lines, FAQ questions (ink on card)", fg: "ink", bg: (_, c) => c, min: NORMAL },
  { where: "subtitle, 'from' price, caption, FAQ answers, personal use (muted on card)", fg: "muted", bg: (_, c) => c, min: NORMAL },
  { where: "eyebrow, help link (accent on card)", fg: "accent", bg: (_, c) => c, min: NORMAL },
  { where: "test-mode banner (warn-text on card)", fg: "warn-text", bg: (_, c) => c, min: NORMAL },
  { where: "trust badges (ink on accent-soft)", fg: "ink", bg: (t) => t("accent-soft"), min: NORMAL },
  { where: "inside numbers, edition badge (accent on accent-soft)", fg: "accent", bg: (t) => t("accent-soft"), min: NORMAL },
  { where: "order buttons, phone order bar (accent-ink on accent)", fg: "accent-ink", bg: (t) => t("accent"), min: NORMAL },
  { where: "edition tiles + inputs: names, prices, typed text (ink on surface)", fg: "ink", bg: (t) => t("surface"), min: NORMAL },
  { where: "edition blurbs, hints, placeholders (muted on surface)", fg: "muted", bg: (t) => t("surface"), min: NORMAL },
  { where: "form error text (ink on bad/10 over card)", fg: "ink", bg: (t, c) => over(t("bad"), c, 0.1), min: NORMAL },
  { where: "form error icon (bad on bad/10 over card)", fg: "bad", bg: (t, c) => over(t("bad"), c, 0.1), min: UI },
  { where: "focus outline (accent on card)", fg: "accent", bg: (_, c) => c, min: UI },
];

describe("shop contrast over the photo wall", () => {
  it("reads the card opacity from globals.css (>= 92%)", () => {
    expect(CARD_ALPHA).toBeGreaterThanOrEqual(0.92);
  });

  for (const id of PACK_IDS) {
    for (const mode of ["light", "dark"] as const) {
      it(`${id} ${mode}: every text >= 4.5:1 and every UI mark >= 3:1 on its worst-case background`, () => {
        const tokens: Record<string, string> = { ...BASE[mode], ...packById(id).brand.colors[mode] };
        const t = (k: string) => {
          expect(tokens[k], `token --${k}`).toMatch(/^#[0-9a-fA-F]{6}$/);
          return hex(tokens[k]);
        };
        const cardColor = t(mode === "light" ? "bg" : "surface");
        const leak: RGB = mode === "light" ? [0, 0, 0] : [255, 255, 255];
        // both extremes of what can shine through the 4%: the worst one, and the plain card
        const cards = [over(cardColor, leak, CARD_ALPHA), cardColor];
        for (const p of PAIRS) {
          for (const card of cards) {
            const ratio = contrast(t(p.fg), p.bg(t, card));
            expect(ratio, `${id} ${mode}: ${p.where} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(p.min);
          }
        }
      });
    }
  }
});
