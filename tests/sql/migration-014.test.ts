import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { REEL_FORMATS } from "@/lib/reels/formats";

// The live DB = v1 snapshot + 002..013. 014 adds the reel format / topic id, the per-line on-screen label, the labels
// switch, and moves the default narration speed 1.12 -> 1.05.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const earlier = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m014 = stripSupabase(read("supabase", "migrations", "014_reel_formats.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m014);
  return db;
}
async function addReel(db: PGlite) {
  const reel = (await one<{ id: string }>(db, `insert into reels (title, doll_cast, status) values ($1, '{}', 'ready') returning id`,
    [`Reel ${crypto.randomUUID()}`])).id;
  await db.query(`insert into reel_scenes (reel_id, position, narration, image_prompt, seed, status) values ($1, 1, 'n', 'p', 1, 'done')`, [reel]);
  return reel;
}

describe("014_reel_formats.sql on the live schema (v1 + 002..013)", () => {
  it("runs twice; old reels and lines keep null format / topic / label; the labels switch is on", async () => {
    const db = await liveDb();
    const old = await addReel(db);
    await db.exec(m014);
    await db.exec(m014);
    expect(await one(db, `select format, topic_id from reels where id=$1`, [old])).toEqual({ format: null, topic_id: null });
    expect(await one(db, `select on_screen from reel_scenes where reel_id=$1`, [old])).toEqual({ on_screen: null });
    expect(await one(db, `select reel_labels from settings`)).toEqual({ reel_labels: true });
  });

  it("a reel's format is one of the 5 (or null); any topic id", async () => {
    const db = await migratedDb();
    const r = await addReel(db);
    for (const f of REEL_FORMATS) await db.query(`update reels set format=$2, topic_id='five-word-rule' where id=$1`, [r, f]);
    await db.query(`update reels set format=null where id=$1`, [r]);
    await expect(db.query(`update reels set format='pov' where id=$1`, [r])).rejects.toThrow(/reels_format_check/);
  });

  it("a line's label is at most 80 characters", async () => {
    const db = await migratedDb();
    const r = await addReel(db);
    await db.query(`update reel_scenes set on_screen=$2 where reel_id=$1`, [r, "x".repeat(80)]);
    await db.query(`update reel_scenes set on_screen=null where reel_id=$1`, [r]);
    await expect(db.query(`update reel_scenes set on_screen=$2 where reel_id=$1`, [r, "x".repeat(81)])).rejects.toThrow(/reel_scenes_on_screen_len/);
  });

  it("the old default speed 1.12 becomes 1.05; a speed the owner chose stays; new rows default to 1.05", async () => {
    const db = await liveDb();
    expect(await one(db, `select reel_speed::text s from settings`)).toEqual({ s: "1.12" });
    await db.exec(m014);
    expect(await one(db, `select reel_speed::text s from settings`)).toEqual({ s: "1.05" });
    const kept = await liveDb();
    await kept.query(`update settings set reel_speed=1.20`);
    await kept.exec(m014);
    expect(await one(kept, `select reel_speed::text s from settings`)).toEqual({ s: "1.20" });
    expect(await one(kept, `select column_default from information_schema.columns where table_name='settings' and column_name='reel_speed'`))
      .toEqual({ column_default: "1.05" });
  });
});

describe("fresh schema.sql matches v1 + 002..014 (reels, reel_scenes, settings)", () => {
  const TABLES = "('settings','reel_scenes','reels')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    settings: (await db.query(`select reel_speed::text s, reel_labels from settings`)).rows,
  });

  it("has the same columns, constraints and settings row", async () => {
    const want = await shape(await migratedDb());
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["reels.format", "reels.topic_id", "reel_scenes.on_screen", "settings.reel_labels"]));
    expect(await shape(await freshDb())).toEqual(want);
  });
});
