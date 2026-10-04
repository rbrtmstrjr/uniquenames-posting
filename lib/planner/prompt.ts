import type { Gender, ThemeRow } from "@/lib/db/types";
import { isPropsOnly } from "./shots";

export type ThemePromptFields = Pick<ThemeRow, "backdrop" | "outfit" | "props" | "lighting" | "palette">;

const NO_TEXT = "No text, no letters, no words, no logo, no watermark anywhere.";
const COMPOSITION_TAIL = "props are short and low, nothing rises above the middle of the frame. The top 40 percent is only smooth empty backdrop.";

export function buildPrompt(theme: ThemePromptFields, shot: string, gender: Gender): string {
  const baby = gender === "girl" ? "baby girl" : "baby boy";
  const shotLine = "Shot: " + shot.replace(/\{baby\}/g, baby) + ".";
  if (isPropsOnly(shot)) {
    // "baby photoshoot" alone makes the model add a baby, so describe an empty set.
    return [
      "Professional studio still life photograph of an empty newborn photoshoot set, photorealistic, styled flat lay.",
      shotLine,
      "There is no baby, no child, no person and no hands anywhere in the picture. The outfit is empty, folded or laid flat.",
      `Backdrop: ${theme.backdrop}.`,
      `Outfit (empty, no one wearing it): ${theme.outfit}.`,
      `Props: ${theme.props}.`,
      `Lighting: ${theme.lighting}.`,
      `Color palette: ${theme.palette}.`,
      "Camera: 85mm lens, shallow depth of field, sharp focus on the props, high detail.",
      `Composition: square frame. Every prop sits in the lower 60 percent of the frame; ${COMPOSITION_TAIL}`,
      NO_TEXT,
    ].join("\n");
  }
  return [
    "Professional studio baby photoshoot photograph, photorealistic, fine art baby photography.",
    shotLine,
    `Backdrop: ${theme.backdrop}.`,
    `Outfit: ${theme.outfit}.`,
    `Props: ${theme.props}.`,
    `Lighting: ${theme.lighting}.`,
    `Color palette: ${theme.palette}.`,
    "Camera: 85mm lens, shallow depth of field, sharp focus on the subject, high detail, natural skin.",
    `Composition: square frame. Everything (baby and every prop) sits in the lower 60 percent of the frame; ${COMPOSITION_TAIL}`,
    NO_TEXT,
  ].join("\n");
}
