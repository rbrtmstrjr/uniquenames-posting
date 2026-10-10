// The Name Nest seed SQL (supabase/seed/name-nest.sql) from the pack and its seed data. Shared by
// scripts/seed-name-nest.ts (writes it) and tests/name-nest-seed.test.ts (checks the file is up to date).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packById } from "@/packs";
import { settingsSeed } from "@/packs/seed";
import { NAME_NEST_THEMES } from "@/packs/name-nest/seed/themes";
import { seedSql } from "./seed-sql";
import type { NameFacts } from "./meanings";
import type { SsaName } from "./ssa";

export function nameNestSeed(root = process.cwd()) {
  const seed = join(root, "packs", "name-nest", "seed");
  const ssa = JSON.parse(readFileSync(join(seed, "ssa-names.json"), "utf8")) as { year: number; names: SsaName[] };
  const file = join(seed, "name-meanings.json");
  const facts: Record<string, NameFacts> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const names = ssa.names.filter((n) => facts[n.name]).map((n) => ({ ...n, meaning: facts[n.name].meaning, origin: facts[n.name].origin }));
  const settings = Object.fromEntries(Object.entries(settingsSeed(packById("name-nest"))).map(([k, v]) => [k, String(v)]));
  const half = ssa.names.length / 2;
  const sql = seedSql({
    pack: "Name Nest", settings, themes: NAME_NEST_THEMES, names,
    note: `Names: SSA ${ssa.year}, top ${half} girl + top ${half} boy names (public domain); ${names.length} with an AI meaning + origin, ${ssa.names.length - names.length} still without one (left out).`,
  });
  return { sql, themes: NAME_NEST_THEMES.length, names: names.length, total: ssa.names.length };
}
