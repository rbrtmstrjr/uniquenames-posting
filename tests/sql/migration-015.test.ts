import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..014. 015 (Name Nest, spec 2026-10-10-niche-packs-name-nest-design) adds a name's
// origin, its US rank and the SSA year of that rank (all null for Unique Names) and the card layout setting
// ('classic' = today's cards; 'name-nest' = the Name Nest stamp). Harmless for Unique Names: nothing changes.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const earlier = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m015 = stripSupabase(read("supabase", "migrations", "015_name_nest.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m015);
  return db;
}
const addName = async (db: PGlite, name: string) =>
  (await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1, 'm', 'girl', 'single') returning id`, [name])).id;

describe("015_name_nest.sql on the live schema (v1 + 002..014)", () => {
  it("runs twice; existing names keep null origin / rank / year; the card layout stays classic", async () => {
    const db = await liveDb();
    const old = await addName(db, "Wren");
    const before = await one(db, `select * from settings`);
    await db.exec(m015);
    await db.exec(m015);
    expect(await one(db, `select origin, us_rank, us_year from names where id=$1`, [old])).toEqual({ origin: null, us_rank: null, us_year: null });
    const after = await one<Record<string, unknown>>(db, `select * from settings`);
    expect(after.card_layout).toBe("classic");
    const { card_layout: _l, ...rest } = after;
    expect(rest).toEqual(before);
  });

  it("a name takes an origin (1-40 characters), a US rank (1-100000) and a year (1880-2100)", async () => {
    const db = await migratedDb();
    const id = await addName(db, "Olivia");
    await db.query(`update names set origin='Latin', us_rank=1, us_year=2024 where id=$1`, [id]);
    expect(await one(db, `select origin, us_rank, us_year from names where id=$1`, [id])).toEqual({ origin: "Latin", us_rank: 1, us_year: 2024 });
    await expect(db.query(`update names set origin='' where id=$1`, [id])).rejects.toThrow(/names_origin_len/);
    await expect(db.query(`update names set origin=$2 where id=$1`, [id, "x".repeat(41)])).rejects.toThrow(/names_origin_len/);
    await expect(db.query(`update names set us_rank=0 where id=$1`, [id])).rejects.toThrow(/names_us_rank_check/);
    await expect(db.query(`update names set us_year=1879 where id=$1`, [id])).rejects.toThrow(/names_us_year_check/);
  });

  it("the card layout is classic or name-nest", async () => {
    const db = await migratedDb();
    await db.query(`update settings set card_layout='name-nest'`);
    await db.query(`update settings set card_layout='classic'`);
    await expect(db.query(`update settings set card_layout='fancy'`)).rejects.toThrow(/settings_card_layout_check/);
  });
});

describe("fresh schema.sql matches v1 + 002..015 (+ 018) (names, settings)", () => {
  const TABLES = "('names','settings')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
  });

  it("has the same columns and constraints", async () => {
    const migrated = await migratedDb();
    await migrated.exec(stripSupabase(read("supabase", "migrations", "018_names_pdf.sql")));
    const want = await shape(migrated);
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["names.origin", "names.us_rank", "names.us_year", "settings.card_layout"]));
    expect(await shape(await freshDb())).toEqual(want);
  });

  it("is also safe to run on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m015);
    expect(await one(db, `select card_layout from settings`)).toEqual({ card_layout: "classic" });
  });
});
