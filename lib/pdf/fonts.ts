import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";

// The names PDF's fonts: free OFL fonts committed in lib/pdf/fonts (each with its licence, OFL-<Family>.txt), the same
// families the cards use (lib/fonts/catalog.json), from github.com/google/fonts (ofl/<family>/):
//   Poppins-Regular / Poppins-SemiBold, PlayfairDisplay-VF (= PlayfairDisplay[wght].ttf, renamed only),
//   DMSerifDisplay-Regular, GreatVibes-Regular: as published.
//   Nunito-Regular / Nunito-Bold: static instances (wght 400 / 700) of Nunito[wght].ttf made with fontTools
//   varLib.instancer (the variable file's default is the thin 200 weight; Nunito has no Reserved Font Name).
// next.config.ts traces this folder into the /names/export function so it ships with the Vercel deployment.

export const PDF_FONT_DIR = join(process.cwd(), "lib", "pdf", "fonts");

/** The full path of a committed font file; throws when it is missing (a wrong pack setting must fail loudly). */
export function pdfFontPath(file: string): string {
  if (!/^[\w.-]+\.ttf$/.test(file)) throw new Error(`Not a font file name: ${file}`);
  const p = join(PDF_FONT_DIR, file);
  if (!existsSync(p)) throw new Error(`Font file missing: lib/pdf/fonts/${file}`);
  return p;
}
