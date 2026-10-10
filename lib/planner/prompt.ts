import type { Gender, ThemeRow } from "@/lib/db/types";
import { hashSeed, seededRandom } from "./random";
import { isPropsOnly, sessionFor, shotSpec, type Session, type TextSpace } from "./shots";
import type { SubjectAge } from "./age";
import { activePack } from "@/packs";

export type ThemePromptFields = Pick<ThemeRow, "backdrop" | "outfit" | "props" | "lighting" | "palette">;

/**
 * The child on a baby card. Without `age` it is the original (pre-age) baby: newborn or
 * 8 months, the same on every card of the post. With `age`, `varied` marks a Random-age
 * card (each card its own child); otherwise it is the one child of a fixed-age post.
 */
export interface Subject { session: Session; look: string; age?: SubjectAge; varied?: boolean }

// The children's looks are the active niche pack's (packs/<id>/cards.ts): one is picked per child and repeated word for
// word; CHILD_LOOKS are the same looks for children of 2 and up (same index = same family look).
const CARDS = activePack().cards;
export const LOOKS = CARDS.looks;
export const CHILD_LOOKS = CARDS.childLooks;
const NEWBORN_SHARE = CARDS.newbornShare;

const looksFor = (age: SubjectAge) => (age === "newborn" || age === "1" ? LOOKS : CHILD_LOOKS);
const lookAt = (age: SubjectAge, r: number) => { const l = looksFor(age); return l[Math.floor(r * l.length)]; };

/**
 * Deterministic per post: the same key always gives the same child. Without an age this is
 * the original newborn-or-8-months baby (posts made before ages existed); with one, the same
 * key keeps the same look at that age.
 */
export function pickSubject(key: string, age?: SubjectAge): Subject {
  const rng = seededRandom(hashSeed(key + "|subject"));
  const session: Session = rng() < NEWBORN_SHARE ? "newborn" : "sitter";
  if (!age) return { session, look: LOOKS[Math.floor(rng() * LOOKS.length)] };
  return { session: sessionFor(age), age, look: lookAt(age, rng()) };
}

/** Random age: one card's own child at the age it was dealt. */
export const randomSubject = (age: SubjectAge, rng: () => number): Subject => ({ session: sessionFor(age), age, look: lookAt(age, rng()), varied: true });

// Z-Image runs without a negative prompt (cfg 1): naming an unwanted object (a camera, a
// stand, a paper roll) can summon it, so prompts only describe what should be there.
// "No text" is the one exception and has proven safe.
export const NO_TEXT = "No text, no letters, no words, no logo, no watermark anywhere.";

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

const years = (age?: SubjectAge) => (!age || age === "newborn" ? 0 : Number(age));

/**
 * Theme outfits are written baby-sized (rompers, onesies, "tiny" bow ties). From 3 years the
 * model is asked for a toddler- or child-sized version of it, so a 6-year-old is not squeezed
 * into a baby romper; younger children wear it as written.
 */
// From 4 years, baby-only garment words become their kid equivalents (ages below 4 keep them).
export const KID_OUTFIT_WORDS: [RegExp, string][] = [
  [/\brompers?\b/gi, "playsuit"],
  [/\bonesies?\b/gi, "outfit"],
  [/\bsleep ?suits?\b/gi, "pajamas"],
  [/\bswaddle\b/gi, "drape"],
  [/\bwrap\b/gi, "drape"],
];

export function outfitFor(outfit: string, age?: SubjectAge): string {
  const y = years(age);
  if (y < 3) return outfit;
  let plain = outfit.replace(/\btiny\s+/gi, "").replace(/^\s*(a|an|the)\s+/i, "").trim();
  if (y >= 4) for (const [from, to] of KID_OUTFIT_WORDS) plain = plain.replace(from, to);
  return `a ${y <= 3 ? "toddler" : "child"}-sized version of the ${plain}`;
}

const SET = (t: ThemePromptFields, outfitLabel: string, propsShot = false, age?: SubjectAge) => [
  propsShot ? `Surface: ${propsSurface(t.backdrop)}.` : `Backdrop: ${t.backdrop}.`,
  `${outfitLabel}: ${propsShot ? t.outfit : outfitFor(t.outfit, age)}.`,
  `Props: ${t.props}.`,
  `Lighting: ${t.lighting}.`,
  `Color palette: ${t.palette}.`,
];

/** "baby" up to 1 year, then "toddler" (2–3) and "child" (4–7): the word for the one who is photographed. */
const noun = (s: Subject) => (s.session === "toddler" ? "toddler" : s.session === "kid" ? "child" : "baby");

function subjectLine(gender: Gender, s: Subject): string {
  const who = gender === "girl" ? "girl" : "boy";
  if (!s.age) {
    const age = s.session === "newborn" ? `a newborn baby ${who}, about 10 days old` : `an 8-month-old baby ${who}`;
    return `Subject (the same baby in every photo of this session): ${age}, with ${s.look}.`;
  }
  const y = years(s.age);
  const desc = s.age === "newborn" ? `a newborn baby ${who}, about 10 days old`
    : y === 1 ? `a 1-year-old baby ${who}`
    : y === 2 ? `a 2-year-old toddler ${who}`
    : y === 3 ? `a 3-year-old ${who} (a little preschooler)`
    : y <= 5 ? `a ${y}-year-old ${who} (a preschool-age child)`
    : `a ${y}-year-old ${who} (a slim school-age child, longer legs, gap-toothed smile)`;
  return s.varied ? `Subject: ${desc}, with ${s.look}.` : `Subject (the same ${noun(s)} in every photo of this session): ${desc}, with ${s.look}.`;
}

function header(s?: Subject): string {
  const kind = s?.session === "toddler" ? "toddler" : s?.session === "kid" ? "children's" : "baby";
  const art = s?.session === "toddler" ? "child" : s?.session === "kid" ? "child portrait" : "baby";
  const session = s?.varied ? "one frame from a full session" : `one frame from a full session with the same ${s ? noun(s) : "baby"}`;
  return `Professional studio ${kind} photoshoot photograph, photorealistic, fine art ${art} photography; ${session}.`;
}

export function buildPrompt(theme: ThemePromptFields, shot: string, gender: Gender, subject?: Subject): string {
  const spec = shotSpec(shot);
  const babyWord = gender === "girl" ? "baby girl" : "baby boy";
  const shotLine = "Shot: " + shot.replace(/\{baby\}/g, babyWord) + ".";
  const camera = spec?.camera ?? "85mm lens, f/1.8, shallow depth of field";
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
    header(subject),
    subject ? subjectLine(gender, subject) : `Subject: a ${babyWord}.`,
    shotLine,
    ...SET(theme, "Outfit", false, subject?.age),
    `Photography: ${camera}, high detail, natural skin.`,
    `Composition: square frame, the backdrop fills the whole frame; ${space(where)}.`,
    NO_TEXT,
  ].join("\n");
}

// ---------------------------------------------------------------- closing card (migration 010)
/** Every closing card's stored shot starts with this (no shot library entry: shotSpec() is undefined for it). */
export const CTA_SHOT_PREFIX = "closing card";
export const isCtaShot = (shot: string) => shot.startsWith(`${CTA_SHOT_PREFIX}:`);

// The child (or the sleeping newborn) and the props low in the frame, so the upper half stays
// open backdrop for the follow message the worker stamps there (the pack's wording per session).
const CTA_MOMENT: Record<Session, string> = CARDS.ctaMoment;
const CTA_OPTICS = "eye level, wide shot, 35mm lens, f/2.0, soft background falloff";

/** The stored shot of a closing card for a child of this session. */
export const ctaShot = (session: Session = "sitter") => `${CTA_SHOT_PREFIX}: wide eye-level shot of ${CTA_MOMENT[session]}`;

/**
 * The closing card's photo: the post's set and child, people and props in the lower half, the
 * upper half calm open backdrop. Positive-only like every card (cfg 1); NO_TEXT is the one
 * exception, so the photo is text-free and the message is stamped by code.
 */
export function buildCtaPrompt(theme: ThemePromptFields, gender: Gender, subject?: Subject): string {
  const babyWord = gender === "girl" ? "baby girl" : "baby boy";
  const who = subject ? noun(subject) : "baby";
  return [
    header(subject),
    subject ? subjectLine(gender, subject) : `Subject: a ${babyWord}.`,
    `Shot: the closing frame of the session, ${ctaShot(subject?.session).slice(CTA_SHOT_PREFIX.length + 2)}.`,
    ...SET(theme, "Outfit", false, subject?.age),
    `Photography: ${CTA_OPTICS}, high detail, natural skin.`,
    `Composition: square frame, the backdrop fills the whole frame; the ${who} and the props sit in the lower half of the frame, and the upper half of the frame is calm, open backdrop: smooth, softly lit and empty, with generous space above the ${who}'s head.`,
    NO_TEXT,
  ].join("\n");
}
