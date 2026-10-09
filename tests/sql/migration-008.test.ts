import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { REEL_MOTIONS, REEL_SHOT_SIZES, REEL_SUBJECTS } from "@/lib/db/types";

// The live DB = v1 snapshot + 002..007. 008 adds the hook card and the per-line shot list / punch / time jump.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const earlier = [
  read("supabase", "migrations", "002_v2.sql"),
  read("supabase", "migrations", "003_post_fonts.sql"),
  read("supabase", "migrations", "004_subject_age.sql"),
  stripSupabase(read("supabase", "migrations", "005_reels.sql")),
  stripSupabase(read("supabase", "migrations", "006_reel_voices.sql")),
  stripSupabase(read("supabase", "migrations", "007_reel_themes.sql")),
];
const m008 = read("supabase", "migrations", "008_reel_playbook.sql");
const m009 = read("supabase", "migrations", "009_captions.sql");
const m010 = read("supabase", "migrations", "010_cta_card.sql");
const m011 = stripSupabase(read("supabase", "migrations", "011_az_series.sql"));
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m008);
  return db;
}
async function addReel(db: PGlite, scenes = 1) {
  const reel = (await one<{ id: string }>(db,
    `insert into reels (title, doll_cast, status) values ($1, '{}', 'script') returning id`, [`Reel ${crypto.randomUUID()}`])).id;
  for (let i = 1; i <= scenes; i++) {
    await db.query(`insert into reel_scenes (reel_id, position, narration, image_prompt, seed, motion) values ($1,$2::int,'n','p',$2::int,'pan_left')`, [reel, i]);
  }
  return reel;
}

describe("008_reel_playbook.sql on the live schema (v1 + 002..007)", () => {
  it("runs twice and keeps every reel and line (old moves included); the new fields start empty / false", async () => {
    const db = await liveDb();
    const reel = await addReel(db, 2);
    await db.exec(m008);
    await db.exec(m008);
    expect(await one(db, `select title like 'Reel %' ok, hook_text from reels where id=$1`, [reel])).toEqual({ ok: true, hook_text: null });
    expect((await db.query(`select motion, shot_size, subject, punch, time_jump from reel_scenes where reel_id=$1 order by position`, [reel])).rows)
      .toEqual([1, 2].map(() => ({ motion: "pan_left", shot_size: null, subject: null, punch: null, time_jump: false })));
  });

  it("checks shot size, subject and motion (hold added, the old moves still valid); time_jump is not null", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    const set = (sql: string, v: unknown) => db.query(`update reel_scenes set ${sql}=$1 where reel_id=$2`, [v, reel]);
    for (const s of REEL_SHOT_SIZES) await set("shot_size", s);
    for (const s of REEL_SUBJECTS) await set("subject", s);
    for (const m of REEL_MOTIONS) await set("motion", m);
    expect(REEL_MOTIONS).toContain("hold");
    for (const [col, bad] of [["shot_size", "close-up"], ["shot_size", ""], ["subject", "dad"], ["motion", "zoom"]] as const) {
      await expect(set(col, bad), `${col}=${bad}`).rejects.toThrow(/check/i);
    }
    await expect(set("time_jump", null)).rejects.toThrow();
    await db.query(`update reel_scenes set shot_size='detail', subject='object', punch='last time', time_jump=true, motion='hold' where reel_id=$1`, [reel]);
    await db.query(`update reels set hook_text='And you won''t know it''s the last' where id=$1`, [reel]);
    expect(await one(db, `select shot_size, subject, punch, time_jump, motion from reel_scenes where reel_id=$1`, [reel]))
      .toEqual({ shot_size: "detail", subject: "object", punch: "last time", time_jump: true, motion: "hold" });
    expect(await one(db, `select hook_text from reels where id=$1`, [reel])).toEqual({ hook_text: "And you won't know it's the last" });
    for (const col of ["shot_size", "subject", "punch"]) await set(col, null);
  });

  it("changes no function (the worker's claims are untouched)", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m008);
    expect(await defs(db)).toEqual(want);
    expect(m008).not.toMatch(/create (or replace )?function/i);
  });

  it("is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m008);
    await db.exec(m008);
    const reel = await addReel(db, 1);
    await db.query(`update reel_scenes set motion='hold', shot_size='pov', subject='baby' where reel_id=$1`, [reel]);
  });
});

describe("fresh schema.sql matches v1 + 002..008 (+ 009)", () => {
  const TABLES = "('settings','reels','reel_scenes','reel_voices','reel_themes','cards','posts')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
  });

  it("has the same columns and constraints (incl. the new checks)", async () => {
    const migrated = await migratedDb();
    await migrated.exec(m009);
    await migrated.exec(m010);
    await migrated.exec(m011);
    await migrated.exec(m012);
    const want = await shape(migrated);
    const names = (want.constraints as { conname: string }[]).map((c) => c.conname);
    expect(names).toEqual(expect.arrayContaining(["reel_scenes_shot_size_check", "reel_scenes_subject_check", "reel_scenes_motion_check"]));
    expect(await shape(await freshDb())).toEqual(want);
  });
});
