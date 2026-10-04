// One-time import into a fresh Supabase project: starter names + themes, and
// the 2026-10-04 Boy post made by the n8n flow (9 finished cards from disk).
// Run: npm run import   (reads .env.import; safe to re-run: stops if any post exists)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SEED_NAMES } from "../supabase/seed/names";
import { SEED_THEMES } from "../supabase/seed/themes";
import { BABY_SHOTS, PROPS_SHOTS, buildPrompt, buildCaption, hashSeed } from "../lib/planner";

function loadEnv(file: string): Record<string, string> {
  if (!existsSync(file)) throw new Error(`${file} not found. Copy .env.import.example to .env.import and fill it in.`);
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
}

// The n8n run (execution 3313): card order, names and shots.
const LEGACY = [
  { file: "01-ronan-ellis.jpg", name: "Ronan Ellis", shot: BABY_SHOTS[0] },
  { file: "02-kian-holt.jpg", name: "Kian Holt", shot: BABY_SHOTS[3] },
  { file: "03-ryker-stone.jpg", name: "Ryker Stone", shot: BABY_SHOTS[7] },
  { file: "04-tobias-quinn.jpg", name: "Tobias Quinn", shot: BABY_SHOTS[2] },
  { file: "05-kael-orion.jpg", name: "Kael Orion", shot: BABY_SHOTS[1] },
  { file: "06-theo-alaric.jpg", name: "Theo Alaric", shot: PROPS_SHOTS[0] },
  { file: "07-cyrus-vaughn.jpg", name: "Cyrus Vaughn", shot: BABY_SHOTS[10] },
  { file: "08-nico-ashford.jpg", name: "Nico Ashford", shot: BABY_SHOTS[11] },
  { file: "09-nolan-pierce.jpg", name: "Nolan Pierce", shot: BABY_SHOTS[8] },
];

async function main() {
  const env = loadEnv(join(process.cwd(), ".env.import"));
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const legacyDir = env.LEGACY_DIR || "C:\\Users\\rober\\OneDrive\\Pictures\\Unique Names\\2026-10-04 Boy";

  const { count } = await sb.from("posts").select("id", { count: "exact", head: true });
  if (count) { console.log(`Stopping: ${count} post(s) already exist, the import already ran.`); return; }

  const themes = SEED_THEMES.map((t, i) => ({ ...t, sort_order: i + 1 }));
  const { error: te } = await sb.from("themes").upsert(themes, { onConflict: "title", ignoreDuplicates: true });
  if (te) throw te;
  const { error: ne } = await sb.from("names").insert(SEED_NAMES.map((n) => ({ ...n })));
  if (ne && !String(ne.message).includes("duplicate")) throw ne;
  console.log(`Seeded ${themes.length} themes and ${SEED_NAMES.length} names.`);

  const { data: theme } = await sb.from("themes").select("*").eq("title", "Boho Pampas").single();
  const { data: settings } = await sb.from("settings").select("*").eq("id", 1).single();
  const { data: post, error: pe } = await sb.from("posts").insert({
    post_date: "2026-10-04", gender: "boy", style: "two-word", theme_id: theme.id, caption: buildCaption("boy", settings), status: "generating",
  }).select().single();
  if (pe) throw pe;

  for (const [i, c] of LEGACY.entries()) {
    const { data: nm } = await sb.from("names").select("*").ilike("name", c.name).single();
    const { data: card, error: ce } = await sb.from("cards").insert({
      post_id: post.id, theme_id: theme.id, kind: "post", position: i + 1, order_index: i + 1, name_id: nm.id, name: nm.name,
      meaning: nm.meaning, shot: c.shot, prompt: buildPrompt(theme, c.shot, "boy"), seed: hashSeed(`2026-10-04|${nm.name}`) * 4096 + i,
      status: "queued", claimed_at: new Date().toISOString(),
    }).select().single();
    if (ce) throw ce;
    const path = `cards/${card.id}/v1.jpg`;
    const bytes = readFileSync(join(legacyDir, c.file));
    const { error: ue } = await sb.storage.from("cards").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (ue) throw ue;
    await sb.from("names").update({ status: "reserved", post_id: post.id, position: i + 1 }).eq("id", nm.id);
    const { error: de } = await sb.from("cards").update({
      status: "done", card_path: path, claimed_at: null, started_at: new Date(Date.now() - 33000).toISOString(), finished_at: new Date().toISOString(),
    }).eq("id", card.id);
    if (de) throw de;
    console.log(`  ${c.file} uploaded`);
  }
  await sb.from("themes").update({ status: "used", used_on: "2026-10-04" }).eq("id", theme.id);
  console.log("Imported the 2026-10-04 Boy post (9 cards). Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
