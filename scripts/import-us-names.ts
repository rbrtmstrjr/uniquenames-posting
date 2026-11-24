// US names list for Unique Names: every name in the official US Social Security (SSA) national baby-name data
// (public domain) with its best (lowest) rank over the last 3 years, per gender, top 5,000 only, as
// packs/unique-names/us-names.json: { "years": [y-2, y-1, y], "girl": { key: rank }, "boy": { key: rank } }.
// Keys are lowercase, no accents (usKey), sorted by rank. Source: https://www.ssa.gov/oact/babynames/names.zip
// Run: npx tsx scripts/import-us-names.ts [--zip <path-to-names.zip>]    (refresh yearly, when SSA publishes)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SSA_URL, parseYear, recentYears } from "./lib/ssa";

const OUT = join(process.cwd(), "packs", "unique-names", "us-names.json");
const MAX_RANK = 5000;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const usKey = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

async function bytes(): Promise<Uint8Array> {
  const local = arg("--zip");
  if (local) return readFileSync(local);
  // Node's fetch gets through ssa.gov's bot filter (curl and PowerShell are refused with 403).
  const res = await fetch(SSA_URL, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) name-nest-seed", accept: "*/*" } });
  if (!res.ok) throw new Error(`SSA download failed: HTTP ${res.status}. Download names.zip in a browser and pass --zip <path>.`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const files = await recentYears(await bytes(), 3);
  const best = { girl: new Map<string, number>(), boy: new Map<string, number>() };
  for (const f of files) {
    const rows = parseYear(f.text);
    for (const g of ["girl", "boy"] as const) {
      for (const r of rows[g]) {
        const k = usKey(r.name);
        const prev = best[g].get(k);
        if (prev === undefined || r.rank < prev) best[g].set(k, r.rank);
      }
    }
  }
  const sorted = (m: Map<string, number>) =>
    Object.fromEntries([...m].filter(([, r]) => r <= MAX_RANK).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])));
  const out = { years: files.map((f) => f.year).sort((a, b) => a - b), girl: sorted(best.girl), boy: sorted(best.boy) };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`SSA ${out.years.join(", ")}: ${Object.keys(out.girl).length} girl + ${Object.keys(out.boy).length} boy names -> ${OUT}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
