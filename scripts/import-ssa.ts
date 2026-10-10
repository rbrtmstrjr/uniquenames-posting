// Name Nest names, step 1: the top 500 girl + top 500 boy names of the latest year in the official US Social Security
// (SSA) national baby-name data (public domain), with their US rank and year, as packs/name-nest/seed/ssa-names.json.
// Run: npx tsx scripts/import-ssa.ts            (downloads https://www.ssa.gov/oact/babynames/names.zip)
//      npx tsx scripts/import-ssa.ts --zip <path-to-names.zip> [--top 500]
// Next: scripts/name-meanings.ts (meanings + origins), then scripts/seed-name-nest.ts (the SQL for the new project).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SSA_URL, latestYear, parseYear, pickTop } from "./lib/ssa";

const OUT = join(process.cwd(), "packs", "name-nest", "seed", "ssa-names.json");
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
  const top = Number(arg("--top") ?? 500);
  const { year, text } = await latestYear(await bytes());
  const names = pickTop(parseYear(text), year, top);
  const out = { source: SSA_URL, license: "US government work (public domain)", year, top, names };
  // One name per line: small diffs when a new year comes out.
  const head = JSON.stringify({ ...out, names: undefined }).slice(0, -1);
  writeFileSync(OUT, `${head},"names": [\n${names.map((n) => JSON.stringify(n)).join(",\n")}\n]}\n`);
  const g = names.filter((n) => n.gender === "girl").length;
  console.log(`SSA ${year}: ${g} girl + ${names.length - g} boy names -> ${OUT}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
