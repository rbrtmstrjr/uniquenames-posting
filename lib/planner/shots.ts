import { shuffle } from "./random";

// Shots vary; the set (backdrop, outfit, props, light) never does.
export const BABY_SHOTS = [
  "a chubby {baby} around 8 months old sitting upright among the props, looking at the camera",
  "a newborn {baby} sleeping peacefully, curled up and nestled among the props, seen from slightly above",
  "a {baby} around 1 year old sitting and gently playing with one of the props",
  "a {baby} around 6 months old lying on the tummy with the head lifted, soft smile",
  "a close-up portrait of a {baby} around 9 months old with a soft smile, the props softly blurred behind",
  "a side profile of a {baby} around 1 year old sitting calmly with the hands together",
  "a wide shot of a small {baby} sitting in the middle of the set with the props around",
  "a {baby} around 10 months old laughing happily, sitting beside the props",
  "a newborn {baby} swaddled and sleeping on a soft blanket among the props",
  "a {baby} around 9 months old crawling toward the camera between the props",
  "a {baby} around 11 months old looking up curiously, sitting next to the props",
  "a {baby} around 7 months old sitting and reaching for one of the props",
];
export const PROPS_SHOTS = [
  "a props-only still life with no baby in the picture: the outfit laid out neatly among the props",
  "a props-only flat arrangement with no baby in the picture: the props and the folded outfit on the floor",
];

export const isPropsOnly = (shot: string) => /props-only/.test(shot);

export function buildShots(n: number, rng: () => number): string[] {
  const propsCount = n >= 11 ? 2 : 1;
  const babies = shuffle(BABY_SHOTS.slice(1), rng);
  const out = [BABY_SHOTS[0]];
  let b = 0;
  while (out.length < n - propsCount) out.push(babies[b++ % babies.length]);
  const props = shuffle(PROPS_SHOTS, rng).slice(0, propsCount);
  props.forEach((p, i) => {
    const at = Math.min(out.length, 2 + Math.floor(((i + 1) * (n - 2)) / (propsCount + 1)));
    out.splice(at, 0, p);
  });
  return out.slice(0, n);
}
