// Name Nest names, step 2: a plain, true meaning (2-6 words) and an origin for every SSA name, asked of Claude in
// validated batches (scripts/lib/meanings.ts) and saved to packs/name-nest/seed/name-meanings.json. Resumable: names
// that already have an accepted answer are skipped; a rejected answer is retried on the next run. Nothing is
// invented here: a name without an accepted meaning is left out of the seed, and every seeded name is 'pending'
// until the owner approves it on the Names page.
// Run (needs ANTHROPIC_API_KEY in .env.local or the environment; ~1-2 US cents with Haiku for 1,000 names):
//   npx tsx --conditions=react-server scripts/name-meanings.ts [--model haiku|sonnet] [--limit 1000] [--batch 50]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeJson, CLAUDE_HAIKU, CLAUDE_SONNET } from "@/lib/ai/claude";
import { MEANINGS_SCHEMA, MEANINGS_SYSTEM, acceptMeanings, meaningsPrompt, type NameFacts } from "./lib/meanings";
import type { SsaName } from "./lib/ssa";

const SEED = join(process.cwd(), "packs", "name-nest", "seed");
const OUT = join(SEED, "name-meanings.json");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

/** Only the AI keys from a git-ignored .env.local (never printed). */
function loadKey() {
  const f = join(process.cwd(), ".env.local");
  if (process.env.ANTHROPIC_API_KEY || !existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^(ANTHROPIC_API_KEY)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

/** One name per line, sorted: small diffs between runs. */
function save(done: Record<string, NameFacts>) {
  const rows = Object.entries(done).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  writeFileSync(OUT, `{\n${rows.join(",\n")}\n}\n`);
}

async function main() {
  loadKey();
  const model = arg("--model") === "sonnet" ? CLAUDE_SONNET : CLAUDE_HAIKU;
  const limit = Number(arg("--limit") ?? 100000);
  const size = Number(arg("--batch") ?? 50);
  const { names } = JSON.parse(readFileSync(join(SEED, "ssa-names.json"), "utf8")) as { names: SsaName[] };
  const done: Record<string, NameFacts> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const todo = names.filter((n) => !done[n.name]).slice(0, limit);
  console.log(`${Object.keys(done).length} names already have a meaning; asking for ${todo.length} (${model}).`);
  let rejected = 0;
  for (let i = 0; i < todo.length; i += size) {
    const batch = todo.slice(i, i + size).map((n) => ({ name: n.name, gender: n.gender }));
    const r = await claudeJson<unknown>({ system: MEANINGS_SYSTEM, prompt: meaningsPrompt(batch), schema: MEANINGS_SCHEMA, model, effort: "medium", timeoutMs: 180_000 });
    if (!r.ok) { console.log(`batch ${i / size + 1}: ${r.error}`); continue; }
    const { ok, rejected: bad } = acceptMeanings(r.data, batch);
    Object.assign(done, ok);
    rejected += batch.length - Object.keys(ok).length;
    for (const b of bad) console.log(`  rejected ${b.name}: ${b.why}`);
    save(done);
    console.log(`batch ${i / size + 1}: ${Object.keys(ok).length}/${batch.length} accepted`);
  }
  console.log(`Done: ${Object.keys(done).length} of ${names.length} names have a meaning (${rejected} not accepted this run).`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
