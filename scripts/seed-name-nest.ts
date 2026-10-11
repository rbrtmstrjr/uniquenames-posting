// Name Nest names, step 3: write supabase/seed/name-nest.sql, the one SQL file the owner runs in the NEW project's SQL
// editor after supabase/schema.sql (docs/SETUP-NAME-NEST.md): the pack's settings, the 40 starter themes, and every
// SSA name that has an accepted meaning (scripts/name-meanings.ts) as 'pending' with its origin, US rank and year.
// Run: npx tsx scripts/seed-name-nest.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { nameNestSeed } from "./lib/name-nest-seed";

const OUT = join(process.cwd(), "supabase", "seed", "name-nest.sql");
const s = nameNestSeed();
writeFileSync(OUT, s.sql);
console.log(`${OUT}: settings, ${s.themes} themes, ${s.names} of ${s.total} names.`);
