// The US list for Unique Names (packs/unique-names/us-names.json), built from SSA year files. Pure: scripts/import-us-names.ts
// writes it, tests/ssa-import.test.ts checks it.
import { parseYear } from "./ssa";
import { US_PLACEHOLDERS, usKey } from "@/lib/names/us-key";

export interface UsNamesFile { years: number[]; girl: Record<string, number>; boy: Record<string, number> }

/**
 * Each name's best (lowest) SSA rank over the given years, per gender, top `maxRank` only, keyed by usKey and sorted
 * by rank. SSA placeholder rows (Unknown, Baby, Infant, Boy, Girl, Babyboy, Babygirl) are left out; ranks stay SSA's.
 */
export function buildUsNames(files: { year: number; text: string }[], maxRank = 5000): UsNamesFile {
  const best = { girl: new Map<string, number>(), boy: new Map<string, number>() };
  for (const f of files) {
    const rows = parseYear(f.text);
    for (const g of ["girl", "boy"] as const) {
      for (const r of rows[g]) {
        const k = usKey(r.name);
        if (!k || US_PLACEHOLDERS.has(k)) continue;
        const prev = best[g].get(k);
        if (prev === undefined || r.rank < prev) best[g].set(k, r.rank);
      }
    }
  }
  const sorted = (m: Map<string, number>) =>
    Object.fromEntries([...m].filter(([, r]) => r <= maxRank).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])));
  return { years: files.map((f) => f.year).sort((a, b) => a - b), girl: sorted(best.girl), boy: sorted(best.boy) };
}
