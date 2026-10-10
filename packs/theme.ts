import type { ColorTokens, PackBrand } from "./types";

const TOKEN_RE = /^[a-z][a-z0-9-]*$/;
const VALUE_RE = /^[#(),.%\w\s-]+$/;

const vars = (tokens: ColorTokens) =>
  Object.entries(tokens)
    .filter(([k, v]) => TOKEN_RE.test(k) && VALUE_RE.test(v))
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");

/**
 * The pack's colour tokens as CSS for the root layout: `html:root` / `html.dark` outrank app/globals.css's `:root` /
 * `.dark` (which keep the Unique Names values as fallbacks). Only plain token names and colour values pass.
 */
export const brandCss = (colors: PackBrand["colors"]) => `html:root{${vars(colors.light)}}html.dark{${vars(colors.dark)}}`;
