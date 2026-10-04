// One-time import into a fresh Supabase project: starter names + themes, and
// the 2026-10-04 Boy post made by the n8n flow (9 finished cards from disk).
// Run: npm run import   (reads .env.import; safe to re-run: resumes after failure)
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
  { file: "08-nico-ashford.jpg", name: "Nico Ashford", shot: BABY_SHOTS[10] },
  { file: "09-nolan-pierce.jpg", name: "Nolan Pierce", shot: BABY_SHOTS[8] },
];

async function main() {
  const env = loadEnv(join(process.cwd(), ".env.import"));
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const legacyDir = env.LEGACY_DIR || "C:\\Users\\rober\\OneDrive\\Pictures\\Unique Names\\2026-10-04 Boy";

  // Check if the legacy post already exists and is complete
  const { data: existingPost, error: epErr } = await sb.from("posts").select("id").eq("post_date", "2026-10-04").eq("gender", "boy").eq("style", "two-word");
  if (epErr) throw new Error(`Error checking for existing post: ${epErr.message}`);

  if (existingPost && existingPost.length > 0) {
    const postId = existingPost[0].id;
    const { data: cards, error: cardsErr } = await sb.from("cards").select("id, status").eq("post_id", postId);
    if (cardsErr) throw new Error(`Error checking post cards: ${cardsErr.message}`);

    if (cards && cards.length === 9 && cards.every((c) => c.status === "done")) {
      console.log("Already imported: 2026-10-04 Boy post with 9 complete cards exists.");
      return;
    }

    // Post exists but is incomplete; delete it and retry
    console.log("Incomplete post found; cleaning up...");
    const { data: cardPaths, error: pathsErr } = await sb.from("cards").select("card_path").eq("post_id", postId).not("card_path", "is", null);
    if (pathsErr) throw new Error(`Error retrieving card paths: ${pathsErr.message}`);

    if (cardPaths && cardPaths.length > 0) {
      const paths = cardPaths.map((c) => c.card_path).filter(Boolean) as string[];
      if (paths.length > 0) {
        const { error: rmErr } = await sb.storage.from("cards").remove(paths);
        if (rmErr) throw new Error(`Error removing card storage: ${rmErr.message}`);
      }
    }

    const { error: delErr } = await sb.rpc("delete_post", { p_post: postId });
    if (delErr) throw new Error(`Error deleting incomplete post: ${delErr.message}`);
    console.log("Deleted incomplete post; restarting import...");
  }

  // Upsert themes (safe to repeat)
  const themes = SEED_THEMES.map((t, i) => ({ ...t, sort_order: i + 1 }));
  const { error: te } = await sb.from("themes").upsert(themes, { onConflict: "title", ignoreDuplicates: true });
  if (te) throw new Error(`Error upserting themes: ${te.message}`);

  // For names: select existing (case-insensitive), insert only missing
  const { data: existingNames, error: enErr } = await sb.from("names").select("name");
  if (enErr) throw new Error(`Error selecting existing names: ${enErr.message}`);
  const existingLower = new Set((existingNames || []).map((n) => n.name.toLowerCase()));
  const namesToInsert = SEED_NAMES.filter((n) => !existingLower.has(n.name.toLowerCase()));

  if (namesToInsert.length > 0) {
    const { error: ni } = await sb.from("names").insert(namesToInsert);
    if (ni && !String(ni.message).includes("duplicate")) throw new Error(`Error inserting names: ${ni.message}`);
  }
  console.log(`Seeded ${themes.length} themes and ${namesToInsert.length} new names (${SEED_NAMES.length - namesToInsert.length} already existed).`);

  // Get theme and settings
  const { data: theme, error: thErr } = await sb.from("themes").select("*").eq("title", "Boho Pampas").single();
  if (thErr) throw new Error(`Error fetching Boho Pampas theme: ${thErr.message}`);

  const { data: settings, error: stErr } = await sb.from("settings").select("*").eq("id", 1).single();
  if (stErr) throw new Error(`Error fetching settings: ${stErr.message}`);

  // Create post
  const { data: post, error: pe } = await sb.from("posts").insert({
    post_date: "2026-10-04", gender: "boy", style: "two-word", theme_id: theme.id, caption: buildCaption("boy", settings), status: "generating",
  }).select().single();
  if (pe) throw new Error(`Error creating post: ${pe.message}`);

  // Mark theme as used immediately after post insert
  const { error: tuErr } = await sb.from("themes").update({ status: "used", used_on: "2026-10-04" }).eq("id", theme.id);
  if (tuErr) throw new Error(`Error marking theme as used: ${tuErr.message}`);

  // Process legacy cards
  for (const [i, c] of LEGACY.entries()) {
    try {
      const { data: nm, error: nmErr } = await sb.from("names").select("*").ilike("name", c.name).single();
      if (nmErr) throw new Error(`Error finding name "${c.name}": ${nmErr.message}`);

      const { data: card, error: ce } = await sb.from("cards").insert({
        post_id: post.id, theme_id: theme.id, kind: "post", position: i + 1, order_index: i + 1, name_id: nm.id, name: nm.name,
        meaning: nm.meaning, shot: c.shot, prompt: buildPrompt(theme, c.shot, "boy"), seed: hashSeed(`2026-10-04|${nm.name}`) * 4096 + i,
        status: "queued", claimed_at: new Date().toISOString(),
      }).select().single();
      if (ce) throw new Error(`Error creating card: ${ce.message}`);

      const path = `cards/${card.id}/v1.jpg`;
      const bytes = readFileSync(join(legacyDir, c.file));
      const { error: ue } = await sb.storage.from("cards").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
      if (ue) throw new Error(`Error uploading file: ${ue.message}`);

      const { error: nuErr } = await sb.from("names").update({ status: "reserved", post_id: post.id, position: i + 1 }).eq("id", nm.id);
      if (nuErr) throw new Error(`Error reserving name: ${nuErr.message}`);

      const { error: de } = await sb.from("cards").update({
        status: "done", card_path: path, claimed_at: null, started_at: new Date(Date.now() - 33000).toISOString(), finished_at: new Date().toISOString(),
      }).eq("id", card.id);
      if (de) throw new Error(`Error marking card done: ${de.message}`);

      console.log(`  ${c.file} uploaded`);
    } catch (err) {
      throw new Error(`Failed at card ${c.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("Imported the 2026-10-04 Boy post (9 cards). Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
