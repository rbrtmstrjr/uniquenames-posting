import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// 022 adds Autopilot: the run and its planned posts, the card checks, name themes and the claim flag.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql", "019_shop.sql",
  "020_one_claim.sql", "021_facebook_posting.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m022 = stripSupabase(read("supabase", "migrations", "022_autopilot.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...ALL]) await db.exec(sql);
  return db;
}
const cols = async (db: PGlite, table: string) => (await db.query<{ column_name: string }>(
  `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name);

describe("migration 022: Autopilot", () => {
  it("adds the columns and tables to the live database and is safe to run twice", async () => {
    const db = await liveDb();
    await db.exec(m022);
    await db.exec(m022);
    expect(await cols(db, "posts")).toContain("name_theme");
    expect(await cols(db, "names")).toContain("autopilot_note");
    expect(await cols(db, "cards")).toEqual(expect.arrayContaining(["check_state", "check_note", "remakes"]));
    expect(await cols(db, "settings")).toContain("autopilot_name_themes");
    expect(await cols(db, "autopilot_runs")).toEqual(expect.arrayContaining(
      ["id", "status", "days", "first_day", "message", "events", "input_tokens", "output_tokens", "tick_until", "finished_at"]));
    expect(await cols(db, "autopilot_items")).toEqual(expect.arrayContaining(
      ["run_id", "day", "slot", "gender", "scheduled_for", "letter", "name_theme", "name_count", "post_id", "state", "lookalike_done", "attempts", "note"]));
    await db.exec(`insert into public.settings (id) values (1) on conflict do nothing`);
    const s = await one<{ autopilot_name_themes: string }>(db, `select autopilot_name_themes from public.settings where id = 1`);
    expect(s.autopilot_name_themes.split("\n")).toEqual([
      "Unique and modern", "Biblical", "Soft and cool", "Short and sweet", "Classic and timeless",
      "Nature-inspired", "Royal and elegant", "Strong and brave", "Heavenly (stars, sky, light)",
    ]);
  });

  it("schema.sql has the same rules: one active run, one label per planned post, known check states", async () => {
    const db = await freshDb();
    for (const t of ["posts", "names", "cards", "settings", "autopilot_runs", "autopilot_items"]) expect((await cols(db, t)).length).toBeGreaterThan(0);
    const run = await one<{ id: string }>(db, `insert into public.autopilot_runs (days, first_day) values (7, '2026-11-21') returning id`);
    await expect(db.query(`insert into public.autopilot_runs (days, first_day) values (1, '2026-11-21')`)).rejects.toThrow(/autopilot_runs_one_active/);
    const item = `insert into public.autopilot_items (run_id, day, slot, gender, scheduled_for, letter, name_theme, name_count) values ($1, '2026-11-21', 'morning', 'boy', now(), $2, $3, 12)`;
    await expect(db.query(item, [run.id, null, null])).rejects.toThrow(/autopilot_items_label/);
    await expect(db.query(item, [run.id, "S", "Biblical"])).rejects.toThrow(/autopilot_items_label/);
    await db.query(item, [run.id, "S", null]);
    await expect(db.query(`insert into public.autopilot_runs (days, first_day) values (8, '2026-11-21')`)).rejects.toThrow();
    await db.query(`update public.autopilot_runs set status = 'done' where id = $1`, [run.id]);
    await db.query(`insert into public.autopilot_runs (days, first_day) values (1, '2026-11-28')`); // a finished run frees the slot
    const checks = await db.query<{ conname: string }>(`select conname from pg_constraint where conname in ('cards_check_state_check', 'posts_name_theme_len', 'names_autopilot_note_len')`);
    expect(checks.rows.map((r) => r.conname).sort()).toEqual(["cards_check_state_check", "names_autopilot_note_len", "posts_name_theme_len"]);
  });

  it("claim_next_job says when a run is active, even with nothing to hand out", async () => {
    const db = await freshDb();
    const claim = async () => (await one<{ j: unknown }>(db, `select public.claim_next_job(false, false, false) as j`)).j;
    expect(await claim()).toBeNull();
    await db.exec(`insert into public.autopilot_runs (days, first_day) values (7, '2026-11-21')`);
    expect(await claim()).toEqual({ kind: "none", autopilot: true });
    await db.exec(`update public.autopilot_runs set status = 'waiting'`);
    expect(await claim()).toEqual({ kind: "none", autopilot: true });
    await db.exec(`update public.autopilot_runs set status = 'paused'`);
    expect(await claim()).toBeNull();
  });
});
