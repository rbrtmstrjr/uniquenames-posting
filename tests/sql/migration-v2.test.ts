import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// v1 = supabase/schema.sql as it was live before v2 (snapshot), minus the Supabase-only block.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const v1 = stripSupabase(readFileSync(join(process.cwd(), "tests", "sql", "fixtures", "schema-v1.sql"), "utf8"));
const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "002_v2.sql"), "utf8");
// Later migrations that also touch settings/names/themes (005/006/007 add the reel settings).
const later = ["003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql", "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql"]
  .map((m) => stripSupabase(readFileSync(join(process.cwd(), "supabase", "migrations", m), "utf8")));

const POSITIONS = ["auto", "top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];

async function v1Db() {
  const db = new PGlite();
  await db.exec(v1);
  return db;
}
const theme = async (db: PGlite, title: string, status = "available", gender = "boy") =>
  (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette, status) values ($1,$2,'b','o','p','l','c',$3) returning id`, [title, gender, status])).id;
const name = async (db: PGlite, nm: string, status = "available", gender = "boy", style = "two-word") =>
  (await one<{ id: string }>(db, `insert into names (name, meaning, gender, style, status) values ($1,'m',$2,$3,$4) returning id`, [nm, gender, style, status])).id;
const fails = async (db: PGlite, sql: string, params: unknown[] = []) => {
  try { await db.query(sql, params); } catch { return true; }
  return false;
};

describe("002_v2.sql on top of the live v1 schema", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await v1Db();
    // existing data in every v1 status must survive the migration
    for (const s of ["available", "reserved", "used", "skip"]) await name(db, `Old ${s}`, s);
    for (const s of ["available", "used", "archived"]) await theme(db, `Old ${s}`, s);
    await db.query(`update settings set handle='@mine', min_images=10`);
  });

  it("runs twice without error and keeps existing data", async () => {
    await db.exec(migration);
    await db.exec(migration);
    expect((await one<{ n: number }>(db, `select count(*)::int n from names`)).n).toBe(4);
    expect((await one<{ n: number }>(db, `select count(*)::int n from themes`)).n).toBe(3);
    const s = await one<Record<string, unknown>>(db, `select handle, min_images, title_font, meaning_font, mark_font, title_size, meaning_size, mark_size, text_position, caption_ai from settings where id=1`);
    expect(s).toEqual({
      handle: "@mine", min_images: 10, title_font: "poppins", meaning_font: "poppins", mark_font: "poppins",
      title_size: 95, meaning_size: 37, mark_size: 21, text_position: "auto", caption_ai: true,
    });
  });

  it("allows pending names and themes, and still rejects unknown statuses", async () => {
    expect(await fails(db, `insert into names (name, meaning, gender, style, status) values ('P','m','boy','single','pending')`)).toBe(true);
    await db.exec(migration);
    await name(db, "Pending One", "pending");
    await theme(db, "Pending Theme", "pending");
    expect(await fails(db, `insert into names (name, meaning, gender, style, status) values ('Q','m','boy','single','bogus')`)).toBe(true);
    expect(await fails(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette, status) values ('Q','boy','b','o','p','l','c','bogus')`)).toBe(true);
    // the v1 statuses all still pass
    for (const s of ["available", "reserved", "used", "skip"]) await name(db, `New ${s}`, s);
    for (const s of ["available", "used", "archived"]) await theme(db, `New ${s}`, s);
  });

  it("checks the new settings ranges and values", async () => {
    await db.exec(migration);
    const bad = (set: string) => fails(db, `update settings set ${set} where id=1`);
    for (const set of ["title_size=39", "title_size=181", "meaning_size=15", "meaning_size=91", "mark_size=11", "mark_size=49",
      "text_position='center'", "text_position=''", "title_font=''", "meaning_font='  '", "mark_font=''", "title_font=null", "caption_ai=null"]) {
      expect(await bad(set), set).toBe(true);
    }
    for (const set of ["title_size=40", "title_size=180", "meaning_size=16", "meaning_size=90", "mark_size=12", "mark_size=48",
      "title_font='greatvibes'", "meaning_font='lora'", "mark_font='montserrat'", "caption_ai=false"]) {
      expect(await bad(set), set).toBe(false);
    }
    for (const p of POSITIONS) expect(await bad(`text_position='${p}'`), p).toBe(false);
  });
});

describe("fresh schema.sql matches v1 + 002 (+ the later migrations)", () => {
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ('settings','names','themes') order by table_name, column_name`)).rows,
    checks: (await db.query<{ t: string; conname: string; def: string }>(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where contype='c' and conrelid::regclass::text in ('settings','names','themes') order by 1, 2`)).rows,
  });

  it("has the same columns, defaults and check constraints", async () => {
    const migrated = await v1Db();
    await migrated.exec(migration);
    for (const m of later) await migrated.exec(m);
    const fresh = await freshDb();
    const want = await shape(migrated);
    expect(want.checks.map((c) => c.conname)).toEqual(expect.arrayContaining(["names_status_check", "themes_status_check", "settings_text_position_check", "settings_title_font_check"]));
    expect(await shape(fresh)).toEqual(want);
  });

  it("002 is also safe to run on a fresh schema.sql project", async () => {
    const fresh = await freshDb();
    await fresh.exec(migration);
    await name(fresh, "Pending Two", "pending");
    expect((await one<{ text_position: string }>(fresh, `select text_position from settings`)).text_position).toBe("auto");
  });
});

describe("pending is never planned", () => {
  let db: PGlite;
  let themeId: string;
  const plan = (ids: string[], theme_id: string) => ({
    request_id: crypto.randomUUID(), post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id, caption: "c",
    cards: ids.map((id, i) => ({ position: i + 1, name_id: id, name: `N${i}`, meaning: "m", shot: "s", prompt: "p", seed: i })),
  });
  const createPost = async (p: unknown) => (await one<{ r: { status: string; reason?: string; post_id?: string } }>(db, `select create_post($1::jsonb) r`, [JSON.stringify(p)])).r;
  beforeEach(async () => {
    db = await freshDb();
    themeId = await theme(db, "Ready");
  });

  it("create_post rejects a pending name", async () => {
    const ok = await name(db, "Ok One");
    const pend = await name(db, "Pend One", "pending");
    expect(await createPost(plan([ok, pend], themeId))).toEqual({ status: "conflict", reason: "names" });
    expect((await one<{ status: string }>(db, `select status from names where id=$1`, [pend])).status).toBe("pending");
  });

  it("create_post rejects a pending theme", async () => {
    const pendTheme = await theme(db, "Suggested", "pending");
    const ok = await name(db, "Ok Two");
    expect(await createPost(plan([ok], pendTheme))).toEqual({ status: "conflict", reason: "theme" });
    expect((await one<{ status: string }>(db, `select status from themes where id=$1`, [pendTheme])).status).toBe("pending");
  });

  it("add_card rejects a pending name", async () => {
    const r = await createPost(plan([await name(db, "Ok Three")], themeId));
    const pend = await name(db, "Pend Two", "pending");
    const add = await one<{ r: { status: string } }>(db, `select add_card($1, $2::jsonb) r`,
      [r.post_id, JSON.stringify({ name_id: pend, name: "Pend Two", meaning: "m", shot: "s", prompt: "p", seed: 1 })]);
    expect(add.r.status).toBe("conflict");
  });

  it("the planner's selects (status = 'available') skip pending rows", async () => {
    await name(db, "Pend Three", "pending");
    await name(db, "Ok Four");
    await theme(db, "Suggested Two", "pending");
    expect((await one<{ n: number }>(db, `select count(*)::int n from names where status='available'`)).n).toBe(1);
    expect((await db.query(`select title from themes where status='available'`)).rows).toEqual([{ title: "Ready" }]);
  });
});
