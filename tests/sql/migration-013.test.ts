import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..012. 013 adds posts.letter (a post by letter: every name starts with it).
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const earlier = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m013 = stripSupabase(read("supabase", "migrations", "013_letter_posts.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m013);
  return db;
}
async function addPost(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,'boy','b','o','p','l','c') returning id`,
    [`T ${crypto.randomUUID()}`])).id;
  return (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id, caption) values ('2026-10-09','boy','single',$1,'c') returning id`, [theme])).id;
}

describe("013_letter_posts.sql on the live schema (v1 + 002..012)", () => {
  it("runs twice; existing posts keep a null letter", async () => {
    const db = await liveDb();
    const old = await addPost(db);
    await db.exec(m013);
    await db.exec(m013);
    expect(await one(db, `select letter from posts where id=$1`, [old])).toEqual({ letter: null });
  });

  it("stores one capital letter A–Z, nothing else", async () => {
    const db = await migratedDb();
    const p = await addPost(db);
    await db.query(`update posts set letter='K' where id=$1`, [p]);
    expect(await one(db, `select letter from posts where id=$1`, [p])).toEqual({ letter: "K" });
    for (const bad of ["k", "AB", "", "1", "É"]) {
      await expect(db.query(`update posts set letter=$2 where id=$1`, [p, bad])).rejects.toThrow(/posts_letter_check/);
    }
  });
});

describe("fresh schema.sql matches v1 + 002..013 (posts)", () => {
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='posts' order by column_name`)).rows,
    constraints: (await db.query(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.posts'::regclass order by 1`)).rows,
    indexes: (await db.query(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='posts' order by 1`)).rows,
  });

  it("has the same posts columns, constraints and indexes", async () => {
    const want = await shape(await migratedDb());
    expect((want.columns as { column_name: string }[]).map((c) => c.column_name)).toContain("letter");
    expect(await shape(await freshDb())).toEqual(want);
  });
});
