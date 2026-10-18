import { shuffle } from "./random";

// A theme's props as single heroes: every story frame features ONE prop sharp and in focus, the others at most as
// soft blurred shapes behind (2026-10-18 story shots). Themes store props as one comma-separated line.

/** "wooden toy train on a short track, small vintage suitcase, and a round station clock" -> three props, no articles. */
export function splitProps(props: string): string[] {
  return props
    .split(/[,;]/)
    .map((p) => p.replace(/\s+/g, " ").trim().replace(/^and\s+/i, "").replace(/^(a|an|the)\s+/i, "").replace(/\.$/, "").trim())
    .filter(Boolean);
}

/** "the small vintage suitcase": reads right in any frame sentence, singular or plural. */
export const theProp = (prop: string) => `the ${prop}`;

/**
 * Hero props for `count` frames: a shuffled pass over the props, then another, so every prop gets its frames before
 * one repeats and two frames in a row never share a hero (when the theme has two props or more).
 */
export function dealProps(props: string[], count: number, rng: () => number): string[] {
  if (!props.length) return Array.from({ length: count }, () => "");
  const out: string[] = [];
  while (out.length < count) {
    const deck = shuffle(props, rng);
    // A new pass never starts with the hero the last pass ended on.
    if (out.length && deck.length > 1 && deck[0] === out[out.length - 1]) [deck[0], deck[1]] = [deck[1], deck[0]];
    out.push(...deck);
  }
  return out.slice(0, count);
}
