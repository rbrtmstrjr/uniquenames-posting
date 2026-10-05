import { shuffle } from "./random";

// A post is ONE photoshoot: one baby, one set, many camera angles, plus a few
// props-only frames, ordered like a real session gallery. The set (backdrop,
// outfit, props, light) never changes; the camera does.

export type Session = "newborn" | "sitter";
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

// Lens + aperture per frame give the photoshoot its depth: a portrait lens wide open melts
// the set into creamy blur behind the baby. (Never the word for the device itself: the model draws it.)
const PORTRAIT = "85mm portrait lens, f/1.8, creamy blurred background";
const CLOSE = "85mm portrait lens, f/1.8, close-up, very shallow depth of field";
const MACRO = "100mm macro lens, f/2.8, extreme close-up, background melted into blur";
const WIDE = "35mm lens, f/2.0, soft background falloff";
const OVERHEAD = "50mm lens, f/2.8, soft focus falloff at the edges";
// Props-only frames: same optics without the word "portrait", which could pull a person into an empty set.
const PROPS_LENS = "85mm lens, f/1.8";

const baby = (text: string, camera: string, angle: Angle, space: TextSpace = "top"): ShotSpec => ({ kind: "baby", text, camera, angle, space });
const props = (text: string, camera: string, angle: Angle, space: TextSpace = "top"): ShotSpec => ({ kind: "props", text, camera, angle, space });

// Index 0 of each session is the album cover.
export const SITTER_SHOTS: ShotSpec[] = [
  baby("eye-level medium shot of the baby sitting up in the middle of the set, looking straight ahead at the viewer with a sweet expression", `eye level, medium shot, ${PORTRAIT}`, "eye"),
  baby("wide establishing shot of the whole set with the baby sitting small in the scene among the props", `eye level, wide shot, ${WIDE}`, "wide"),
  baby("high-angle shot looking down at the baby sitting on the blanket and gazing up at the viewer with wide eyes", `high-angle viewpoint from above at 45 degrees looking down, ${PORTRAIT}`, "high", "bottom"),
  baby("low-angle shot from floor level of the baby crawling toward the viewer between the props", `floor-level viewpoint, low angle, ${PORTRAIT}`, "low"),
  baby("tight close-up portrait of the baby's face with a soft smile, the props melting into soft blur behind", CLOSE, "closeup"),
  baby("detail close-up of the baby's tiny hands holding one of the small props", MACRO, "macro"),
  baby("over-the-shoulder view from behind the baby, who sits looking at the props in front of them; the back of the head and the outfit are visible", `viewpoint just behind the baby at the baby's eye level, point of view, ${PORTRAIT}`, "pov"),
  baby("three-quarter side view of the baby reaching out to touch one of the props", `eye level, three-quarter angle, ${PORTRAIT}`, "profile"),
  baby("candid moment of the baby laughing with eyes squeezed shut, sitting beside the props", `slightly above eye level, candid, ${PORTRAIT}`, "eye"),
  baby("tummy-time shot of the baby lying on the tummy with the head lifted, smiling at the viewer", `floor-level viewpoint, ${PORTRAIT}`, "low"),
  baby("detail close-up of the baby's bare feet and toes resting on the blanket next to a small prop", MACRO, "macro"),
];

export const NEWBORN_SHOTS: ShotSpec[] = [
  baby("eye-level shot of the newborn sleeping peacefully, curled up in the main prop in the center of the set", `eye level, medium shot, ${PORTRAIT}`, "eye"),
  baby("wide establishing shot of the whole set with the sleeping newborn small in the scene", `eye level, wide shot, ${WIDE}`, "wide"),
  baby("top-down bird's-eye shot of the newborn sleeping curled on a soft blanket with the small props arranged around", `top-down viewpoint looking straight down, ${OVERHEAD}`, "overhead", "bottom"),
  baby("high-angle shot of the swaddled newborn sleeping on the blanket", `high-angle viewpoint from above at 45 degrees looking down, ${PORTRAIT}`, "high", "bottom"),
  baby("close-up of the newborn's sleeping face and tiny nose, cheek resting on folded hands", CLOSE, "closeup"),
  baby("macro detail of the newborn's tiny feet and toes peeking out of the blanket", MACRO, "macro"),
  baby("macro detail of the newborn's tiny hand curled around one of the small props", MACRO, "macro"),
  baby("side profile of the newborn sleeping on the tummy with the chin resting on the hands", `eye level, side profile, ${PORTRAIT}`, "profile"),
  baby("low-angle shot from blanket level, the sleeping newborn in soft focus in front with the props rising behind", `blanket-level viewpoint, low angle, ${PORTRAIT}`, "low"),
  baby("eye-level shot of the newborn sleeping on the side, wrapped, with a small plush prop tucked beside", `eye level, ${PORTRAIT}`, "eye"),
];

// Index 0 is the "empty set before the session" frame; it always comes first among the props shots.
export const PROPS_SPECS: ShotSpec[] = [
  props("props-only shot of the empty styled set before the session: every prop in place on the smooth colored surface, close crop so the colored surface fills every edge of the frame", "eye level, close crop, 50mm lens, f/2.0, soft background falloff", "wide"),
  props("props-only flat lay photographed from directly above like a product flat lay: the outfit laid flat with the small props arranged around it on the smooth colored surface, which fills every edge of the frame", `top-down view looking straight down, close crop, ${OVERHEAD}`, "overhead"),
  props("props-only macro close-up of the single most charming prop from the props list, filling the frame, the colored background melting into soft blur", `eye level, ${MACRO}`, "macro"),
  props("props-only low-angle still life from floor level, the props in the foreground and the smooth colored background softly blurred behind, close crop", `floor-level viewpoint, low angle, close crop, ${PROPS_LENS}, creamy blurred background`, "low"),
  props("props-only detail of the folded outfit resting on the blanket next to one small prop", `slightly above, ${PROPS_LENS}, close-up, very shallow depth of field`, "closeup"),
];

const BY_TEXT = new Map([...SITTER_SHOTS, ...NEWBORN_SHOTS, ...PROPS_SPECS].map((s) => [s.text, s]));

/** The spec behind a stored shot text (undefined for shots from older posts). */
export const shotSpec = (text: string) => BY_TEXT.get(text);
export const isPropsOnly = (shot: string) => /props-only/.test(shot);

export const sessionShots = (session: Session) => (session === "newborn" ? NEWBORN_SHOTS : SITTER_SHOTS);
export const propsCountFor = (n: number) => (n >= 11 ? 4 : 3);

// Back-compat names used by theme previews and the one-time import.
export const BABY_SHOTS = SITTER_SHOTS.map((s) => s.text);
export const PROPS_SHOTS = PROPS_SPECS.map((s) => s.text);

const clashes = (list: ShotSpec[], i: number) =>
  (i > 0 && list[i].angle === list[i - 1].angle) || (i + 1 < list.length && list[i].angle === list[i + 1].angle);

/**
 * Swap frames of the same kind (baby with baby, props with props, so the props
 * slots and the cover stay put) until no two neighbours share a camera angle.
 */
function spreadAngles(list: ShotSpec[], locked: Set<number>): ShotSpec[] {
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

/**
 * The shot list for a post of n cards: the session's cover first, then the other
 * baby shots, with 3 (n <= 10) or 4 (n >= 11) props-only shots spread evenly
 * through the gallery. The empty-set frame is always the first props shot.
 */
export function buildShotSpecs(n: number, session: Session, rng: () => number): ShotSpec[] {
  const lib = sessionShots(session);
  const p = Math.min(propsCountFor(n), PROPS_SPECS.length, Math.max(0, n - 1));
  const others = shuffle(lib.slice(1), rng);
  const babies: ShotSpec[] = [lib[0]];
  for (let k = 0; babies.length < n - p; k++) babies.push(others[k % others.length]);
  const out = babies.slice();
  const propsList = [PROPS_SPECS[0], ...shuffle(PROPS_SPECS.slice(1), rng).slice(0, p - 1)];
  // Ascending inserts at final positions: each earlier insert is already in place.
  propsSlots(n, p).forEach((slot, i) => out.splice(Math.min(slot, out.length), 0, propsList[i]));
  // The cover and the empty-set frame stay where they are; everything else may swap within its kind.
  return spreadAngles(out, new Set([0, out.indexOf(PROPS_SPECS[0])])).slice(0, n);
}

export function buildShots(n: number, rng: () => number, session: Session = "sitter"): string[] {
  return buildShotSpecs(n, session, rng).map((s) => s.text);
}
