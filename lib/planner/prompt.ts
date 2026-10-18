import type { Gender, ThemeRow } from "@/lib/db/types";
import { hashSeed, seededRandom } from "./random";
import { frameOf, isPropsOnly, sessionFor, shotSpec, type Session, type ShotSpec, type TextSpace } from "./shots";
import { splitProps, theProp } from "./props";
import type { SubjectAge } from "./age";
import { activePack } from "@/packs";
import { NO_TEXT } from "./no-text";

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

// Z-Image runs without a negative prompt (cfg 1): prompts only describe what should be there; NO_TEXT (lib/planner/no-text)
// is the one exception.
export { NO_TEXT };

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

/** "a 2-year-old toddler boy": the child's age and gender in words. */
function ageWords(gender: Gender, s: Subject): string {
  const who = gender === "girl" ? "girl" : "boy";
  if (!s.age) return s.session === "newborn" ? `a newborn baby ${who}, about 10 days old` : `an 8-month-old baby ${who}`;
  const y = years(s.age);
  return s.age === "newborn" ? `a newborn baby ${who}, about 10 days old`
    : y === 1 ? `a 1-year-old baby ${who}`
    : y === 2 ? `a 2-year-old toddler ${who}`
    : y === 3 ? `a 3-year-old ${who} (a little preschooler)`
    : y <= 5 ? `a ${y}-year-old ${who} (a preschool-age child)`
    : `a ${y}-year-old ${who} (a slim school-age child, longer legs, gap-toothed smile)`;
}

function subjectLine(gender: Gender, s: Subject): string {
  const desc = ageWords(gender, s);
  if (!s.age) return `Subject (the same baby in every photo of this session): ${desc}, with ${s.look}.`;
  return s.varied ? `Subject: ${desc}, with ${s.look}.` : `Subject (the same ${noun(s)} in every photo of this session): ${desc}, with ${s.look}.`;
}

function header(s?: Subject): string {
  const kind = s?.session === "toddler" ? "toddler" : s?.session === "kid" ? "children's" : "baby";
  const art = s?.session === "toddler" ? "child" : s?.session === "kid" ? "child portrait" : "baby";
  const session = s?.varied ? "one frame from a full session" : `one frame from a full session with the same ${s ? noun(s) : "baby"}`;
  return `Professional studio ${kind} photoshoot photograph, photorealistic, fine art ${art} photography; ${session}.`;
}

/**
 * A card's photo prompt. Story shots (2026-10-18) get the story prompt; a shot from before them (an older card's
 * stored text, or any unknown text) keeps the original prompt word for word. `hero` = the frame's one featured prop
 * (one of the theme's props; the first one when not given).
 */
export function buildPrompt(theme: ThemePromptFields, shot: string, gender: Gender, subject?: Subject, hero?: string): string {
  const spec = shotSpec(shot);
  if (spec?.frame) return storyPrompt(theme, spec, gender, subject, hero);
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

// ---------------------------------------------------------------- story shots (2026-10-18)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "deep forest green" from "smooth seamless deep forest green studio backdrop with a soft darker vignette". */
export function backdropColor(backdrop: string): string {
  return backdrop.replace(/\bwith\b.*$/i, "").replace(/\b(smooth|seamless|studio|backdrop|paper)\b/gi, "").replace(/\s+/g, " ").trim() || "plain";
}

/** "warm light-tan skin" from a look ("soft dark hair, warm light-tan skin and big brown eyes"). */
export function skinOf(look: string): string | null {
  return /(?:^|,\s*|and\s+)([a-z][a-z -]*?\bskin)\b/i.exec(look)?.[1]?.trim() ?? null;
}

/** A look up to the skin ("soft dark hair, warm light-tan skin"): no eyes or cheeks, for a child kept out of focus. */
export const softLook = (look: string) => /^(.*?\bskin)\b/i.exec(look)?.[1] ?? look;

/**
 * The story prompt, in the order Z-Image weighs it (most first): the frame and its one hero; where the focus sits and
 * the lens; who is in the frame (the child's whole look only when the face is in it: a look with eyes and cheeks pulls
 * a hands or feet macro back into a face); the set, with the hero sharp and the other props only as soft shapes; the
 * top third left clean for the stamped name; NO_TEXT last. Positive-only like every card (cfg 1).
 */
function storyPrompt(theme: ThemePromptFields, spec: ShotSpec, gender: Gender, subject: Subject | undefined, hero?: string): string {
  const frame = frameOf(spec);
  const props = splitProps(theme.props);
  const prop = hero?.trim() || props[0] || "";
  const babyWord = gender === "girl" ? "baby girl" : "baby boy";
  const fill = (s: string) => s.replace(/\{prop\}/g, prop ? theProp(prop) : "the main prop").replace(/\{baby\}/g, babyWord);
  const others = props.filter((p) => p !== prop);
  const behind = others.length ? `, with ${others.map(theProp).join(" and ")} as soft blurred shapes far behind` : "";
  const skin = subject ? skinOf(subject.look) : null;
  const who = frame === "still"
    ? "There is no baby, no child, no person and no hands anywhere in the picture."
    : frame === "detail" || frame === "hands"
      ? `Only ${frame === "hands" ? "the small hands and sleeves" : "this small detail"} in the frame, the face outside it${skin ? `; ${skin}` : ""}.`
      : spec.childSoft
        ? `Out of focus behind it: ${subject ? `${ageWords(gender, subject)} with ${softLook(subject.look)}` : `a ${babyWord}`}.`
        : subject ? subjectLine(gender, subject) : `Subject: a ${babyWord}.`;
  // Hands and detail frames name only the garment: a hat, crown or headband in the line pulls a head back into the frame.
  const outfit = frame === "still"
    ? (/outfit/.test(spec.text) ? [`Outfit (empty, no one wearing it): ${theme.outfit}.`] : [])
    : frame === "detail" || frame === "hands"
      ? [`Sleeves and fabric: ${outfitFor(theme.outfit, subject?.age).replace(/\s+with\b.*$/i, "")}.`]
      : [`Outfit: ${outfitFor(theme.outfit, subject?.age)}.`];
  const background = frame === "still"
    ? `Background: ${theme.backdrop} sweeping down into the floor in one color, softly out of focus${behind}.`
    : `Background: ${theme.backdrop}, softly out of focus${frame === "detail" || frame === "hands" ? "" : behind}.`;
  const color = backdropColor(theme.backdrop);
  return [
    // The placement rides in the first sentence: later in the prompt Z-Image still put the head into the name's band.
    `${cap(fill(spec.text))}, in the bottom half of the frame. The upper half of the frame is empty, softly blurred ${color} backdrop.`,
    `${cap(fill(spec.focus ?? "sharp focus on the subject, the background dissolving into creamy bokeh"))}.`,
    `Photography: ${spec.camera}.`,
    who,
    ...outfit,
    background,
    `Lighting: ${theme.lighting}.`,
    `Color palette: ${theme.palette}.`,
    `Composition: square frame; the top third of the frame is clean, softly blurred ${color} backdrop with nothing in it.`,
    frame === "still" ? "Fine art still life photograph of a styled photo set, photorealistic, high detail." : storyStyle(subject),
    NO_TEXT,
  ].join("\n");
}

function storyStyle(s?: Subject): string {
  const kind = s?.session === "toddler" ? "toddler" : s?.session === "kid" ? "children's" : "baby";
  return `Professional studio ${kind} photoshoot photograph, photorealistic, fine art, natural skin texture, high detail.`;
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
