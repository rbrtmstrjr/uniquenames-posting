import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002. 003 adds the per-post fonts.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const m002 = read("supabase", "migrations", "002_v2.sql");
const m003 = read("supabase", "migrations", "003_post_fonts.sql");
const m004 = read("supabase", "migrations", "004_subject_age.sql");
const m005 = stripSupabase(read("supabase", "migrations", "005_reels.sql"));
const m006 = stripSupabase(read("supabase", "migrations", "006_reel_voices.sql"));
const m007 = stripSupabase(read("supabase", "migrations", "007_reel_themes.sql"));
const m008 = read("supabase", "migrations", "008_reel_playbook.sql");
const m009 = read("supabase", "migrations", "009_captions.sql");
const m010 = read("supabase", "migrations", "010_cta_card.sql");
const m011 = stripSupabase(read("supabase", "migrations", "011_az_series.sql"));
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));
const m013 = stripSupabase(read("supabase", "migrations", "013_letter_posts.sql"));
const m014 = stripSupabase(read("supabase", "migrations", "014_reel_formats.sql"));

async function liveDb() {
  const db = new PGlite();
  await db.exec(v1);
  await db.exec(m002);
  return db;
}

type Claim = { job: string; card: { id: string }; post_date: string; gender_label: string | null; style_label: string | null; fonts?: Record<string, string | null> | null } | null;

async function seed(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T','boy','b','o','p','l','c') returning id`)).id;
  const names: string[] = [];
  for (let i = 0; i < 4; i++) names.push((await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1,'m','boy','two-word') returning id`, [`Name ${i}`])).id);
  return { theme, names };
}
const plan = (theme: string, ids: string[], extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(), post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: theme, caption: "c",
  cards: ids.map((id, i) => ({ position: i + 1, name_id: id, name: `N${i}`, meaning: "m", shot: "s", prompt: "p", seed: i })),
  ...extra,
});
const createPost = async (db: PGlite, p: unknown) => (await one<{ r: { status: string; post_id?: string } }>(db, `select create_post($1::jsonb) r`, [JSON.stringify(p)])).r;
const claim = async (db: PGlite) => (await one<{ r: Claim }>(db, `select claim_next_card(false) r`)).r;
const FONTS = { title_font: "quicksand", meaning_font: "comfortaa", mark_font: "poppins" };

describe("003_post_fonts.sql on the live schema (v1 + 002)", () => {
  it("runs twice and keeps existing posts (their fonts are null)", async () => {
    const db = await liveDb();
    const { theme, names } = await seed(db);
    const before = await createPost(db, plan(theme, names.slice(0, 2), FONTS)); // old create_post ignores the fonts
    expect(before.status).toBe("ok");
    await db.exec(m003);
    await db.exec(m003);
    expect(await one(db, `select title_font, meaning_font, mark_font from posts where id=$1`, [before.post_id])).toEqual({ title_font: null, meaning_font: null, mark_font: null });
    // a post made before 003 claims with fonts: null (the PC uses the settings fonts)
    const c = await claim(db);
    expect(c?.fonts).toBeNull();
    expect(c).toMatchObject({ job: "generate", gender_label: "Boy", style_label: "Two-word", post_date: "2026-10-05" });
  });

  it("before 003 the claim has no fonts key at all", async () => {
    const db = await liveDb();
    const { theme, names } = await seed(db);
    await createPost(db, plan(theme, names.slice(0, 1), FONTS));
    const c = await claim(db);
    expect(c && "fonts" in c).toBe(false);
  });

  it("create_post stores the fonts and claim_next_card returns them, for generate and restamp", async () => {
    const db = await liveDb();
    await db.exec(m003);
    const { theme, names } = await seed(db);
    const r = await createPost(db, plan(theme, names.slice(0, 1), FONTS));
    expect(await one(db, `select title_font, meaning_font, mark_font from posts where id=$1`, [r.post_id])).toEqual(FONTS);
    const c = await claim(db);
    expect(c?.fonts).toEqual(FONTS);
    await db.query(`update cards set status='restamp', claimed_at=null where id=$1`, [c!.card.id]);
    const again = await claim(db);
    expect(again).toMatchObject({ job: "restamp", fonts: FONTS });
  });

  it("missing or empty fonts are stored as null; one font set returns the others as null", async () => {
    const db = await liveDb();
    await db.exec(m003);
    const { theme, names } = await seed(db);
    const r = await createPost(db, plan(theme, names.slice(0, 1), { title_font: "lora", meaning_font: "  ", mark_font: "" }));
    expect(await one(db, `select title_font, meaning_font, mark_font from posts where id=$1`, [r.post_id])).toEqual({ title_font: "lora", meaning_font: null, mark_font: null });
    expect((await claim(db))?.fonts).toEqual({ title_font: "lora", meaning_font: null, mark_font: null });
  });

  it("preview cards (no post) claim with fonts: null", async () => {
    const db = await liveDb();
    await db.exec(m003);
    const { theme } = await seed(db);
    await db.query(`insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','P','m','s','p',1)`, [theme]);
    const c = await claim(db);
    expect(c).toMatchObject({ job: "generate", fonts: null, gender_label: null, style_label: null, post_date: null });
  });
});

describe("fresh schema.sql matches v1 + 002..009", () => {
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ('posts','settings') order by table_name, column_name`)).rows,
    // Line endings differ by checkout (schema.sql may be CRLF on Windows); the code must not.
    functions: (await db.query<{ proname: string; def: string }>(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ('create_post','claim_next_card') order by 1`)).rows.map((r) => ({ ...r, def: r.def.replace(/\r\n/g, "\n") })),
  });

  it("has the same posts columns and create_post / claim_next_card bodies", async () => {
    const migrated = await liveDb();
    await migrated.exec(m003);
    await migrated.exec(m004);
    await migrated.exec(m005);
    await migrated.exec(m006);
    await migrated.exec(m007);
    await migrated.exec(m008);
    await migrated.exec(m009);
    await migrated.exec(m010);
    await migrated.exec(m011);
    await migrated.exec(m012);
    await migrated.exec(m013);
    await migrated.exec(m014);
    const want = await shape(migrated);
    expect(want.functions).toHaveLength(2);
    expect(await shape(await freshDb())).toEqual(want);
  });

  it("003 is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m003);
    const { theme, names } = await seed(db);
    const r = await createPost(db, plan(theme, names.slice(0, 1), FONTS));
    expect(await one(db, `select title_font from posts where id=$1`, [r.post_id])).toEqual({ title_font: "quicksand" });
  });
});
