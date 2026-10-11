import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..017. 018 (the sellable names PDF) adds names.meaning_category (the meaning group a
// name is listed under) and the exports log (one row per PDF made for a buyer, owner only).
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql",
];
const earlier = ALL.map((m) => stripSupabase(read("supabase", "migrations", m)));
const m018raw = read("supabase", "migrations", "018_names_pdf.sql");
const m018 = stripSupabase(m018raw);

async function liveDb(skip015 = false) {
  const db = new PGlite();
  for (const [i, sql] of [v1, ...earlier].entries()) if (!(skip015 && ALL[i - 1] === "015_name_nest.sql")) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m018);
  return db;
}
const addName = async (db: PGlite, name: string) =>
  (await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1, 'a kind meaning', 'girl', 'single') returning id`, [name])).id;
const exportRow = (o: Record<string, unknown> = {}) => ({
  buyer: "Jane Doe <jane@example.com>", gender: "girl", name_count: 312, password: "Kp7m-Xr4d-Tq9w", file_name: "unique-names-girl-2026-10.pdf",
  pack: "unique-names", ...o,
});
const insertExport = (db: PGlite, o: Record<string, unknown> = {}) => {
  const r = exportRow(o);
  return db.query(`insert into exports (buyer, gender, name_count, password, file_name, pack) values ($1,$2,$3,$4,$5,$6) returning id, created_at`,
    [r.buyer, r.gender, r.name_count, r.password, r.file_name, r.pack]);
};

describe("018_names_pdf.sql on the live schema (v1 + 002..017)", () => {
  it("runs twice; existing names keep a null category", async () => {
    const db = await liveDb();
    const id = await addName(db, "Wren");
    await db.exec(m018);
    await db.exec(m018);
    expect(await one(db, `select meaning_category from names where id=$1`, [id])).toEqual({ meaning_category: null });
  });

  it("also runs without 015 (Unique Names may not have it)", async () => {
    const db = await liveDb(true);
    await db.exec(m018);
    const id = await addName(db, "Wren");
    await db.query(`update names set meaning_category='nature' where id=$1`, [id]);
    expect(await one(db, `select meaning_category from names where id=$1`, [id])).toEqual({ meaning_category: "nature" });
  });

  it("a category is one of the twelve groups (or null)", async () => {
    const db = await migratedDb();
    const id = await addName(db, "Wren");
    for (const ok of ["nature", "light", "water", "strength", "faith", "love", "wisdom", "royal", "peace", "gems", "earth", "more", null]) {
      await db.query(`update names set meaning_category=$2 where id=$1`, [id, ok]);
    }
    for (const bad of ["Nature", "flowers", "", "theme"]) {
      await expect(db.query(`update names set meaning_category=$2 where id=$1`, [id, bad])).rejects.toThrow(/names_meaning_category_check/);
    }
  });

  it("logs exports: defaults, and checks every field", async () => {
    const db = await migratedDb();
    const r = (await insertExport(db)).rows[0] as { id: string; created_at: unknown };
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.created_at).toBeTruthy();
    expect(await one(db, `select buyer, gender, name_count, password, file_name, pack from exports`)).toEqual(exportRow());
    await insertExport(db, { gender: "both" });
    for (const [bad, check] of [
      [{ gender: "girls" }, "exports_gender_check"], [{ buyer: "" }, "exports_buyer_len"], [{ buyer: "x".repeat(121) }, "exports_buyer_len"],
      [{ password: "short" }, "exports_password_len"], [{ name_count: -1 }, "exports_name_count_check"], [{ file_name: "" }, "exports_file_name_len"],
      [{ pack: "" }, "exports_pack_len"],
    ] as const) {
      await expect(insertExport(db, bad)).rejects.toThrow(new RegExp(check));
    }
  });

  it("exports are owner only: RLS on, the app (authenticated) may read and write, anon gets nothing", async () => {
    const db = await liveDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(m018raw);
    await db.exec(m018raw);
    expect(await one(db, `select relrowsecurity from pg_class where oid='public.exports'::regclass`)).toEqual({ relrowsecurity: true });
    expect((await db.query(`select policyname, roles::text, cmd from pg_policies where tablename='exports'`)).rows)
      .toEqual([{ policyname: "owner_all", roles: "{authenticated}", cmd: "ALL" }]);
    const can = async (role: string, priv: string) =>
      (await one<{ ok: boolean }>(db, `select has_table_privilege($1, 'public.exports', $2) ok`, [role, priv])).ok;
    for (const priv of ["select", "insert", "update", "delete"]) {
      expect(await can("authenticated", priv)).toBe(true);
      expect(await can("anon", priv)).toBe(false);
    }
  });

  it("changes no existing function", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m018);
    expect(await defs(db)).toEqual(want);
  });
});

describe("fresh schema.sql matches v1 + 002..018 (names, exports)", () => {
  const TABLES = "('names','exports')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
  });

  it("has the same columns, constraints and indexes", async () => {
    const want = await shape(await migratedDb());
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["names.meaning_category", "exports.password", "exports.buyer", "exports.pack"]));
    expect(await shape(await freshDb())).toEqual(want);
  });

  it("is also safe to run on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m018);
    await insertExport(db);
    expect(await one(db, `select count(*)::int n from exports`)).toEqual({ n: 1 });
  });

  it("schema.sql turns on RLS and the owner policy for exports", () => {
    const schema = read("supabase", "schema.sql");
    expect(schema).toMatch(/alter table public\.exports enable row level security;/);
    expect(schema).toMatch(/foreach t in array array\[[^\]]*'exports'[^\]]*\] loop\s+execute format\('drop policy if exists owner_all/);
  });
});
