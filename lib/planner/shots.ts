import { shuffle } from "./random";
import { SUBJECT_AGES, type SubjectAge } from "./age";
import { activePack } from "@/packs";

// A post is ONE photoshoot, planned like a photographer plans a session (2026-10-18 story shots): one set, and the
// camera moves IN. A cover portrait, then face close-ups, detail macros (hands, feet), prop stories (the child with ONE
// prop, focus pulled to the prop or the face), small hands holding a prop, and a few props-only still lifes. Each
// frame has one hero; the set (backdrop, outfit, props, light) never changes. The child is either one child at a
// fixed age, or (Random age) a different child of a different age on every baby card.

/** newborn = newborn; sitter = about 1 year; toddler = 2–3 years; kid = 4–7 years. */
export type Session = "newborn" | "sitter" | "toddler" | "kid";
export type Angle = "eye" | "wide" | "high" | "overhead" | "low" | "closeup" | "macro" | "pov" | "profile";
export type TextSpace = "top" | "bottom";
/**
 * What a frame is about: portrait = the child's face; story = the child with one prop; detail = hands, feet or the
 * outfit up close (no face); hands = small hands holding one prop (no face); still = one prop, nobody in the picture.
 */
export type Frame = "portrait" | "story" | "detail" | "hands" | "still";

export interface ShotSpec {
  kind: "baby" | "props";
  /** Human-readable; stored on the card. Props shots always contain "props-only". "{prop}" = the frame's hero prop. */
  text: string;
  camera: string;
  angle: Angle;
  /** Where the frame stays calm and empty so the name can be stamped there. */
  space: TextSpace;
  /** Story shots: what the frame is about and where its focus sits ("{prop}" = the hero prop). Absent on older shots. */
  frame?: Frame;
  focus?: string;
  /** A focus pull onto the prop: the child is in the frame but out of focus (described without eyes or face). */
  childSoft?: boolean;
}

// The shot lists are the active niche pack's (packs/<id>/cards.ts): index 0 of each session is the album cover; index 0
// of the props-only frames is the "empty set before the session" frame, which always comes first among the props shots.
const CARDS = activePack().cards;
export const SITTER_SHOTS: ShotSpec[] = CARDS.shots.sitter;
export const NEWBORN_SHOTS: ShotSpec[] = CARDS.shots.newborn;
// 2–3 years: on their feet, walking and playing.
export const TODDLER_SHOTS: ShotSpec[] = CARDS.shots.toddler;
// 4–7 years: posed portraits and candid moments of a young child.
export const KID_SHOTS: ShotSpec[] = CARDS.shots.kid;
export const PROPS_SPECS: ShotSpec[] = CARDS.propsShots;

const BY_TEXT = new Map([...SITTER_SHOTS, ...NEWBORN_SHOTS, ...TODDLER_SHOTS, ...KID_SHOTS, ...PROPS_SPECS].map((s) => [s.text, s]));

/** The spec behind a stored shot text (undefined for shots from older posts). */
export const shotSpec = (text: string) => BY_TEXT.get(text);
export const isPropsOnly = (shot: string) => /props-only/.test(shot);

const LIBRARIES: Record<Session, ShotSpec[]> = { newborn: NEWBORN_SHOTS, sitter: SITTER_SHOTS, toddler: TODDLER_SHOTS, kid: KID_SHOTS };
export const sessionShots = (session: Session) => LIBRARIES[session];
/** Props-only still lifes per post: two from 9 cards, else one. */
export const propsCountFor = (n: number) => (n >= 9 ? 2 : 1);
/** True when the frame features a hero prop ("{prop}" in its text or focus). */
export const needsProp = (s: Pick<ShotSpec, "text" | "focus">) => /\{prop\}/.test(s.text + (s.focus ?? ""));

/**
 * The baby frames after the cover, in session order: the camera moves in on the child, onto a prop, into a detail,
 * and back (spreading the angles may then swap frames of the same kind). A post of 12 cards gets 4 portraits
 * (cover included), 3 prop stories, 2 details, 1 hands frame and 2 still lifes.
 */
export const FRAME_PATTERN: Frame[] = ["portrait", "story", "detail", "portrait", "story", "hands", "portrait", "story", "detail", "hands", "portrait", "story"];
export const frameAt = (k: number): Frame => FRAME_PATTERN[(k - 1) % FRAME_PATTERN.length];

/** The frame of a spec (older shots have none: a props-only text is a still, anything else a portrait). */
export const frameOf = (s: Pick<ShotSpec, "kind" | "frame">): Frame => s.frame ?? (s.kind === "props" ? "still" : "portrait");

/** The shot library for a child's age: newborn, ~1 year (sitter), 2–3 (toddler), 4–7 (kid). */
export function sessionFor(age: SubjectAge): Session {
  if (age === "newborn") return "newborn";
  const years = Number(age);
  return years <= 1 ? "sitter" : years <= 3 ? "toddler" : "kid";
}

/**
 * Random age: m ages dealt from shuffled decks of every bucket (newborn, 1 … 7), so each
 * bucket appears once before any repeats and no age dominates a post.
 */
export function dealAges(m: number, rng: () => number): SubjectAge[] {
  const out: SubjectAge[] = [];
  while (out.length < m) out.push(...shuffle([...SUBJECT_AGES], rng));
  return out.slice(0, m);
}

// Back-compat names used by theme previews and the one-time import.
export const BABY_SHOTS = SITTER_SHOTS.map((s) => s.text);
export const PROPS_SHOTS = PROPS_SPECS.map((s) => s.text);

type Framed = { kind: ShotSpec["kind"]; angle: Angle };

const clashes = (list: Framed[], i: number) =>
  (i > 0 && list[i].angle === list[i - 1].angle) || (i + 1 < list.length && list[i].angle === list[i + 1].angle);

/**
 * Swap frames of the same kind (baby with baby, props with props, so the props
 * slots and the cover stay put) until no two neighbours share a camera angle.
 */
function spreadAngles<T extends Framed>(list: T[], locked: Set<number>): T[] {
  const out = list.slice();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      if (!clashes(out, i) || locked.has(i)) continue;
      for (let j = 0; j < out.length; j++) {
        if (j === i || locked.has(j) || out[j].kind !== out[i].kind) continue;
        [out[i], out[j]] = [out[j], out[i]];
        if (!clashes(out, i) && !clashes(out, j)) { changed = true; break; }
        [out[i], out[j]] = [out[j], out[i]];
      }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * Gallery positions for p still lifes in a post of n cards: seeded per post (so the rhythm changes from post to
 * post), never the cover or the card after it, never two side by side, never the last card.
 */
export function propsSlots(n: number, p: number, rng: () => number): number[] {
  const slots: number[] = [];
  for (const i of shuffle(Array.from({ length: Math.max(0, n - 3) }, (_, k) => k + 2), rng)) {
    if (slots.length < p && slots.every((s) => Math.abs(s - i) > 1)) slots.push(i);
  }
  return slots.sort((a, b) => a - b);
}

const propsCount = (n: number) => Math.min(propsCountFor(n), PROPS_SPECS.length, Math.max(0, n - 3));

/**
 * Lay the gallery out: the baby frames in session order (cover first), with the still lifes at seeded positions,
 * then swap frames within their kind so neighbours never share an angle. The cover stays put.
 */
function arrange<T extends Framed>(babies: T[], n: number, toProps: (s: ShotSpec) => T, rng: () => number): T[] {
  const p = propsCount(n);
  const out = babies.slice();
  const propsList = shuffle(PROPS_SPECS, rng).slice(0, p).map(toProps);
  // Ascending inserts at final positions: each earlier insert is already in place.
  propsSlots(n, p, rng).forEach((slot, i) => out.splice(Math.min(slot, out.length), 0, propsList[i]));
  return spreadAngles(out, new Set([0])).slice(0, n);
}

/** Per-frame queues of a library's shots (cover excluded), each shuffled; an empty frame falls back to portraits. */
function frameQueues(lib: ShotSpec[], rng: () => number) {
  const queues = new Map<Frame, ShotSpec[]>();
  for (const s of shuffle(lib.slice(1), rng)) queues.set(frameOf(s), [...(queues.get(frameOf(s)) ?? []), s]);
  const used = new Map<Frame, number>();
  return (frame: Frame): ShotSpec => {
    const want = queues.get(frame)?.length ? frame : "portrait";
    const q = queues.get(want) ?? lib.slice(1);
    const k = used.get(want) ?? 0;
    used.set(want, k + 1);
    return q[k % q.length];
  };
}

/**
 * The shot list for a post of n cards with one child: the session's cover first, then baby frames in
 * FRAME_PATTERN order (portrait, story, detail, …), with 1–2 props-only still lifes at seeded positions.
 */
export function buildShotSpecs(n: number, session: Session, rng: () => number): ShotSpec[] {
  const lib = sessionShots(session);
  const next = frameQueues(lib, rng);
  const babies: ShotSpec[] = [lib[0]];
  for (let k = 1; babies.length < n - propsCount(n); k++) babies.push(next(frameAt(k)));
  return arrange(babies, n, (s) => s, rng);
}

/** One frame of a Random-age post: the shot and, for baby frames, that card's child's age. */
export interface AgedShot { kind: ShotSpec["kind"]; angle: Angle; spec: ShotSpec; age?: SubjectAge }

/**
 * Random age: baby frame k shows a child of ages[k] (one per baby frame, in order), with a
 * shot from that age's library; the first baby frame is that library's cover. Swapping
 * frames to spread the angles moves the age along with its shot.
 */
export function buildMixedShotSpecs(n: number, ages: SubjectAge[], rng: () => number): AgedShot[] {
  const queues = new Map<Session, (frame: Frame) => ShotSpec>();
  const next = (session: Session, k: number): ShotSpec => {
    const lib = sessionShots(session);
    if (k === 0) return lib[0];
    if (!queues.has(session)) queues.set(session, frameQueues(lib, rng));
    return queues.get(session)!(frameAt(k));
  };
  const babies: AgedShot[] = [];
  for (let k = 0; babies.length < n - propsCount(n); k++) {
    const age = ages[k % ages.length];
    const spec = next(sessionFor(age), k);
    babies.push({ kind: "baby", angle: spec.angle, spec, age });
  }
  const toProps = (spec: ShotSpec): AgedShot => ({ kind: "props", angle: spec.angle, spec });
  return arrange(babies, n, toProps, rng);
}

export function buildShots(n: number, rng: () => number, session: Session = "sitter"): string[] {
  return buildShotSpecs(n, session, rng).map((s) => s.text);
}
