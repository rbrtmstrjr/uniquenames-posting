import "server-only";
import data from "@/packs/unique-names/us-names.json";
import { activePack } from "@/packs";
import type { Gender, NameStyle } from "@/lib/db/types";

/** The US list (official SSA data, best rank over the last 3 years; spec 2026-11-24): "unique but known" names. */
export const US_MIN_RANK = 101;
export const US_MAX_RANK = 2000;
export const US_WIDE_MAX_RANK = 5000;
export const US_LETTER_MIN = 25;
export const US_NOTE = "Not a US name";

export interface UsNamesData { years: number[]; girl: Record<string, number>; boy: Record<string, number> }

/** "Zoë " → "zoe": lowercase, no accents, trimmed. */
export const usKey = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

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
    return a !== null && b !== null && a >= US_MIN_RANK && a <= US_WIDE_MAX_RANK && b <= US_WIDE_MAX_RANK;
  };
  return { rank, maxRankFor, isUsName, isUsTwoWord, latestYear: Math.max(...d.years) };
}

export const US_LIST = makeUsList(data as UsNamesData);

/** True on a pack that aims its names at the US, Canada, the UK and Australia (Unique Names). */
export const usGateOn = () => activePack().suggest.usNames === true;

/** Keep only US names (when the pack asks for it); `dropped` counts the rest. */
export function keepUsNames<T extends { name: string }>(list: T[], gender: Gender, o: { style: NameStyle; letter?: string | null }): { kept: T[]; dropped: number } {
  if (!usGateOn()) return { kept: list, dropped: 0 };
  const ok = (n: T) => (o.style === "two-word" ? US_LIST.isUsTwoWord(n.name, gender) : US_LIST.isUsName(n.name, gender, o.letter));
  const kept = list.filter(ok);
  return { kept, dropped: list.length - kept.length };
}
