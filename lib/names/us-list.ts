import "server-only";
import data from "@/packs/unique-names/us-names.json";
import { activePack } from "@/packs";
import type { Gender, NameStyle } from "@/lib/db/types";
import { US_MIN_RANK, US_NOTE, usKey } from "./us-key";

/** The US list (official SSA data, best rank over the last 3 years; spec 2026-11-24): "unique but known" names. */
export { US_MIN_RANK, US_NOTE, usKey };
export const US_MAX_RANK = 2000;
export const US_WIDE_MAX_RANK = 5000;
export const US_LETTER_MIN = 25;
/** Autopilot skips a letter for the day when either gender has fewer names than this in its US range (owner, 2026-11-24). */
export const US_LETTER_POOL_MIN = 16;

export interface UsNamesData { years: number[]; girl: Record<string, number>; boy: Record<string, number> }

export function makeUsList(d: UsNamesData) {
  const inRange = new Map<string, number>(); // "girl|v" → names ranked 101..2000
  for (const g of ["girl", "boy"] as const) {
    for (const [k, r] of Object.entries(d[g])) {
      if (r >= US_MIN_RANK && r <= US_MAX_RANK) inRange.set(`${g}|${k[0]}`, (inRange.get(`${g}|${k[0]}`) ?? 0) + 1);
    }
  }
  const rank = (name: string, gender: Gender): number | null => d[gender][usKey(name)] ?? null;
  const maxRankFor = (letter: string, gender: Gender): number =>
    (inRange.get(`${gender}|${usKey(letter).charAt(0)}`) ?? 0) < US_LETTER_MIN ? US_WIDE_MAX_RANK : US_MAX_RANK;
  const isUsName = (name: string, gender: Gender, letter?: string | null): boolean => {
    const r = rank(name, gender);
    return r !== null && r >= US_MIN_RANK && r <= maxRankFor(letter ?? usKey(name).charAt(0), gender);
  };
  const isUsTwoWord = (name: string, gender: Gender): boolean => {
    const w = name.trim().split(/\s+/);
    if (w.length !== 2) return false;
    const a = rank(w[0], gender), b = rank(w[1], gender);
    // The second word has no top-100 floor (spec: only the first name must not be in the top 100).
    return a !== null && b !== null && a >= US_MIN_RANK && a <= US_WIDE_MAX_RANK && b <= US_WIDE_MAX_RANK;
  };
  /** How many names start with `letter` and rank 101 up to that letter's range for this gender. */
  const usPool = (letter: string, gender: Gender): number => {
    const l = usKey(letter).charAt(0), max = maxRankFor(l, gender);
    let n = 0;
    for (const [k, r] of Object.entries(d[gender])) if (k[0] === l && r >= US_MIN_RANK && r <= max) n++;
    return n;
  };
  /**
   * The names the AI picks from (brief 2026-11-25): with a letter, those starting with it ranked 101 up to its range;
   * without, every name ranked 101 to 2,000. Less the library's names (`exclude`, by usKey), a random sample of at
   * most `limit` (150 with a letter, 300 without), display-cased ("zora" → "Zora").
   */
  const usCandidates = (gender: Gender, o: { letter?: string | null; exclude: Iterable<string>; limit?: number; rng?: () => number }): string[] => {
    const l = o.letter ? usKey(o.letter).charAt(0) : "";
    const max = l ? maxRankFor(l, gender) : US_MAX_RANK;
    const skip = new Set<string>();
    for (const n of o.exclude) skip.add(usKey(n));
    const pool = Object.entries(d[gender]).filter(([k, r]) => (!l || k[0] === l) && r >= US_MIN_RANK && r <= max && !skip.has(k)).map(([k]) => k);
    const n = Math.min(Math.max(0, o.limit ?? (l ? 150 : 300)), pool.length);
    const rng = o.rng ?? Math.random;
    for (let i = 0; i < n; i++) { // a partial Fisher-Yates shuffle: the first n are a uniform sample
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n).map((k) => k.charAt(0).toUpperCase() + k.slice(1));
  };
  return { rank, maxRankFor, isUsName, isUsTwoWord, usPool, usCandidates, latestYear: Math.max(...d.years) };
}

export const US_LIST = makeUsList(data as UsNamesData);

/** The real list's names for the AI to pick from (see makeUsList's usCandidates). */
export const usCandidates = US_LIST.usCandidates;

/** True on a pack that aims its names at the US, Canada, the UK and Australia (Unique Names). */
export const usGateOn = () => activePack().suggest.usNames === true;

/** Can Autopilot plan a post for this letter? Always with the gate off; else both genders need 16 US names for it. */
export const usLetterOk = (letter: string): boolean =>
  !usGateOn() || (["girl", "boy"] as const).every((g) => US_LIST.usPool(letter, g) >= US_LETTER_POOL_MIN);

/** Keep only US names (when the pack asks for it); `dropped` counts the rest. */
export function keepUsNames<T extends { name: string }>(list: T[], gender: Gender, o: { style: NameStyle; letter?: string | null }): { kept: T[]; dropped: number } {
  if (!usGateOn()) return { kept: list, dropped: 0 };
  const ok = (n: T) => (o.style === "two-word" ? US_LIST.isUsTwoWord(n.name, gender) : US_LIST.isUsName(n.name, gender, o.letter));
  const kept = list.filter(ok);
  return { kept, dropped: list.length - kept.length };
}
