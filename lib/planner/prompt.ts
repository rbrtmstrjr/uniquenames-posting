import type { Gender, ThemeRow } from "@/lib/db/types";
import { hashSeed, seededRandom } from "./random";
import { isPropsOnly, shotSpec, type Session, type TextSpace } from "./shots";

export type ThemePromptFields = Pick<ThemeRow, "backdrop" | "outfit" | "props" | "lighting" | "palette">;

/** The one baby of a post: same session type and same look on every card. */
export interface Subject { session: Session; look: string }

// Looks written for the page's audience; one is picked per post and repeated word for word.
export const LOOKS = [
  "soft wispy dark hair, warm light-tan skin and big brown eyes",
  "short fine black hair, fair skin and round chubby cheeks",
  "a little tuft of dark brown hair, warm medium skin and dark eyes",
  "soft light brown hair, fair rosy skin and bright eyes",
  "thick soft black hair, warm tan skin and long eyelashes",
  "very fine short hair, light skin and big curious eyes",
];
const NEWBORN_SHARE = 0.35;

/** Deterministic per post: the same key always gives the same baby. */
export function pickSubject(key: string): Subject {
  const rng = seededRandom(hashSeed(key + "|subject"));
  const session: Session = rng() < NEWBORN_SHARE ? "newborn" : "sitter";
  return { session, look: LOOKS[Math.floor(rng() * LOOKS.length)] };
}

// Z-Image runs without a negative prompt (cfg 1): naming an unwanted object (a camera, a
// stand, a paper roll) can summon it, so prompts only describe what should be there.
// "No text" is the one exception and has proven safe.
const NO_TEXT = "No text, no letters, no words, no logo, no watermark anywhere.";

const space = (where: TextSpace) => where === "top"
  ? "keep the upper third of the frame calm and empty: smooth, softly lit backdrop only"
  : "keep the lower third of the frame calm and empty: smooth blanket or floor only";

/**
 * Props-only frames: "studio", "seamless" and "backdrop" make the model pull back and show the
 * studio itself, so the same color is described as a plain surface.
 * "smooth seamless pastel mint studio backdrop" -> "a smooth pastel mint surface".
 */
export function propsSurface(backdrop: string): string {
  const color = backdrop
    .replace(/\bwith\b.*$/i, "")
    .replace(/\b(smooth|seamless|studio|backdrop|paper)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return `a smooth ${color || "plain"} surface`;
}

const SET = (t: ThemePromptFields, outfitLabel: string, propsShot = false) => [
  propsShot ? `Surface: ${propsSurface(t.backdrop)}.` : `Backdrop: ${t.backdrop}.`,
  `${outfitLabel}: ${t.outfit}.`,
  `Props: ${t.props}.`,
  `Lighting: ${t.lighting}.`,
  `Color palette: ${t.palette}.`,
];

function subjectLine(gender: Gender, s: Subject): string {
  const who = gender === "girl" ? "girl" : "boy";
  const age = s.session === "newborn" ? `a newborn baby ${who}, about 10 days old` : `an 8-month-old baby ${who}`;
  return `Subject (the same baby in every photo of this session): ${age}, with ${s.look}.`;
}

export function buildPrompt(theme: ThemePromptFields, shot: string, gender: Gender, subject?: Subject): string {
  const spec = shotSpec(shot);
  const babyWord = gender === "girl" ? "baby girl" : "baby boy";
  const shotLine = "Shot: " + shot.replace(/\{baby\}/g, babyWord) + ".";
  const camera = spec?.camera ?? "85mm lens, shallow depth of field";
  const where = spec?.space ?? "top";

  if (isPropsOnly(shot)) {
    // "baby photoshoot" alone makes the model add a baby, so describe the set with nobody in it.
    return [
      "Professional still life photograph of an empty, styled photo set with nobody in it, photorealistic, fine art.",
      shotLine,
      "There is no baby, no child, no person and no hands anywhere in the picture. The outfit is empty, folded or laid flat.",
      ...SET(theme, "Outfit (empty, no one wearing it)", true),
      `Photography: ${camera}, sharp focus on the props, high detail.`,
      `Composition: square frame, close crop, the smooth colored surface fills the whole frame; ${space(where)}.`,
      NO_TEXT,
    ].join("\n");
  }
  return [
    "Professional studio baby photoshoot photograph, photorealistic, fine art baby photography; one frame from a full session with the same baby.",
    subject ? subjectLine(gender, subject) : `Subject: a ${babyWord}.`,
    shotLine,
    ...SET(theme, "Outfit"),
    `Photography: ${camera}, high detail, natural skin.`,
    `Composition: square frame, the backdrop fills the whole frame; ${space(where)}.`,
    NO_TEXT,
  ].join("\n");
}
