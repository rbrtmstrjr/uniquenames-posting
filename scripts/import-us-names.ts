// US names list for Unique Names: every name in the official US Social Security (SSA) national baby-name data
// (public domain) with its best (lowest) rank over the last 3 years, per gender, top 5,000 only, as
// packs/unique-names/us-names.json: { "years": [y-2, y-1, y], "girl": { key: rank }, "boy": { key: rank } }.
// Keys are lowercase, letters only, no accents (usKey), sorted by rank; SSA placeholders (Unknown, Baby...) are left
// out (scripts/lib/us-names.ts). Source: https://www.ssa.gov/oact/babynames/names.zip
// Run: npx tsx scripts/import-us-names.ts [--zip <path-to-names.zip>]    (refresh yearly, when SSA publishes)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SSA_URL, recentYears } from "./lib/ssa";
import { buildUsNames } from "./lib/us-names";

const OUT = join(process.cwd(), "packs", "unique-names", "us-names.json");
const MAX_RANK = 5000;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

async function bytes(): Promise<Uint8Array> {
  const local = arg("--zip");
  if (local) return readFileSync(local);
  // Node's fetch gets through ssa.gov's bot filter (curl and PowerShell are refused with 403).
  const res = await fetch(SSA_URL, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) name-nest-seed", accept: "*/*" } });
  if (!res.ok) throw new Error(`SSA download failed: HTTP ${res.status}. Download names.zip in a browser and pass --zip <path>.`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const out = buildUsNames(await recentYears(await bytes(), 3), MAX_RANK);
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`SSA ${out.years.join(", ")}: ${Object.keys(out.girl).length} girl + ${Object.keys(out.boy).length} boy names -> ${OUT}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
