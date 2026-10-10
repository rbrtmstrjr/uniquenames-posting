import { shuffle } from "./random";
import { SUBJECT_AGES, type SubjectAge } from "./age";
import { activePack } from "@/packs";

// A post is ONE photoshoot: one set, many camera angles, plus a few props-only
// frames, ordered like a real session gallery. The set (backdrop, outfit, props,
// light) never changes; the camera does. The child is either one child at a fixed
// age, or (Random age) a different child of a different age on every baby card.

/** newborn = newborn; sitter = about 1 year; toddler = 2–3 years; kid = 4–7 years. */
export type Session = "newborn" | "sitter" | "toddler" | "kid";
export type Angle = "eye" | "wide" | "high" | "overhead" | "low" | "closeup" | "macro" | "pov" | "profile";
export type TextSpace = "top" | "bottom";

export interface ShotSpec {
  kind: "baby" | "props";
  /** Human-readable; stored on the card. Props shots always contain "props-only". */
  text: string;
  camera: string;
  angle: Angle;
  /** Where the frame stays calm and empty so the name can be stamped there. */
  space: TextSpace;
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
export const propsCountFor = (n: number) => (n >= 11 ? 4 : 3);

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

/** Final-gallery positions for p props shots in a post of n cards (never 0, never adjacent for n >= 9). */
export function propsSlots(n: number, p: number): number[] {
  return Array.from({ length: p }, (_, i) => Math.round(1 + ((i + 1) * (n - 1)) / (p + 1)));
}

const propsCount = (n: number) => Math.min(propsCountFor(n), PROPS_SPECS.length, Math.max(0, n - 1));

/**
 * Lay the gallery out: the baby frames in order (cover first), with the props-only frames
 * spread evenly through it (the empty-set frame always first among them), then swap frames
 * within their kind so neighbours never share an angle. The cover and the empty set stay put.
 */
function arrange<T extends Framed>(babies: T[], n: number, toProps: (s: ShotSpec) => T, isEmptySet: (t: T) => boolean, rng: () => number): T[] {
  const p = propsCount(n);
  const out = babies.slice();
  const propsList = [PROPS_SPECS[0], ...shuffle(PROPS_SPECS.slice(1), rng).slice(0, p - 1)].map(toProps);
  // Ascending inserts at final positions: each earlier insert is already in place.
  propsSlots(n, p).forEach((slot, i) => out.splice(Math.min(slot, out.length), 0, propsList[i]));
  return spreadAngles(out, new Set([0, out.findIndex(isEmptySet)])).slice(0, n);
}

/**
 * The shot list for a post of n cards with one child: the session's cover first, then the
 * other baby shots, with 3 (n <= 10) or 4 (n >= 11) props-only shots spread evenly through
 * the gallery. The empty-set frame is always the first props shot.
 */
export function buildShotSpecs(n: number, session: Session, rng: () => number): ShotSpec[] {
  const lib = sessionShots(session);
  const others = shuffle(lib.slice(1), rng);
  const babies: ShotSpec[] = [lib[0]];
  for (let k = 0; babies.length < n - propsCount(n); k++) babies.push(others[k % others.length]);
  return arrange(babies, n, (s) => s, (s) => s === PROPS_SPECS[0], rng);
}

/** One frame of a Random-age post: the shot and, for baby frames, that card's child's age. */
export interface AgedShot { kind: ShotSpec["kind"]; angle: Angle; spec: ShotSpec; age?: SubjectAge }

/**
 * Random age: baby frame k shows a child of ages[k] (one per baby frame, in order), with a
 * shot from that age's library; the first baby frame is that library's cover. Swapping
 * frames to spread the angles moves the age along with its shot.
 */
export function buildMixedShotSpecs(n: number, ages: SubjectAge[], rng: () => number): AgedShot[] {
  const queues = new Map<Session, ShotSpec[]>();
  const used = new Map<Session, number>();
  const next = (session: Session, cover: boolean): ShotSpec => {
    const lib = sessionShots(session);
    if (cover) return lib[0];
    if (!queues.has(session)) queues.set(session, shuffle(lib.slice(1), rng));
    const k = used.get(session) ?? 0;
    used.set(session, k + 1);
    const q = queues.get(session)!;
    return q[k % q.length];
  };
  const babies: AgedShot[] = [];
  for (let k = 0; babies.length < n - propsCount(n); k++) {
    const age = ages[k % ages.length];
    const spec = next(sessionFor(age), k === 0);
    babies.push({ kind: "baby", angle: spec.angle, spec, age });
  }
  const toProps = (spec: ShotSpec): AgedShot => ({ kind: "props", angle: spec.angle, spec });
  return arrange(babies, n, toProps, (s) => s.spec === PROPS_SPECS[0], rng);
}

export function buildShots(n: number, rng: () => number, session: Session = "sitter"): string[] {
  return buildShotSpecs(n, session, rng).map((s) => s.text);
}
