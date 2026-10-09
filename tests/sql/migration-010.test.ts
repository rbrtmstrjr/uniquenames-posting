import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { CTA_MESSAGES_DEFAULT } from "@/lib/cta/messages";

// The live DB = v1 snapshot + 002..009. 010 adds the closing "follow" card.
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
  read("supabase", "migrations", "008_reel_playbook.sql"),
  read("supabase", "migrations", "009_captions.sql"),
];
const m010 = read("supabase", "migrations", "010_cta_card.sql");
const m011 = stripSupabase(read("supabase", "migrations", "011_az_series.sql"));
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));
const m013 = stripSupabase(read("supabase", "migrations", "013_letter_posts.sql"));
const m014 = stripSupabase(read("supabase", "migrations", "014_reel_formats.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m010);
  return db;
}

async function seedPost(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T','boy','b','o','p','l','c') returning id`)).id;
  const post = (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id, caption, status) values ('2026-10-09','boy','single',$1,'c','generating') returning id`, [theme])).id;
  const card = (await one<{ id: string }>(db, `insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed, order_index)
    values ($1,$2,'post',1,'Arlo','peak','s','p',1,1) returning id`, [post, theme])).id;
  return { theme, post, card };
}
const insertCta = (db: PGlite, post: string | null, theme: string, text = "Follow for more / baby name ideas.") =>
  db.query(`insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed, order_index)
    values ($1,$2,'cta',2,$3,'','closing card: s','p',2,2) returning id`, [post, theme, text]);
const postStatus = async (db: PGlite, id: string) => (await one<{ status: string }>(db, `select status from posts where id=$1`, [id])).status;

describe("010_cta_card.sql on the live schema (v1 + 002..009)", () => {
  it("before 010 a closing card is refused by the kind check (the app then skips it)", async () => {
    const db = await liveDb();
    const { post, theme } = await seedPost(db);
    await expect(insertCta(db, post, theme)).rejects.toThrow(/cards_kind_check/);
  });

  it("runs twice; settings get closing card on + the default messages (same as the app's list)", async () => {
    const db = await liveDb();
    await db.exec(m010);
    await db.exec(m010);
    expect(await one(db, `select cta_enabled, cta_messages from settings where id=1`)).toEqual({ cta_enabled: true, cta_messages: CTA_MESSAGES_DEFAULT });
  });

  it("an owner's messages survive a re-run", async () => {
    const db = await migratedDb();
    await db.query(`update settings set cta_enabled=false, cta_messages='Mine / only' where id=1`);
    await db.exec(m010);
    expect(await one(db, `select cta_enabled, cta_messages from settings where id=1`)).toEqual({ cta_enabled: false, cta_messages: "Mine / only" });
  });

  it("a closing card belongs to a post, and a post has at most one", async () => {
    const db = await migratedDb();
    const { post, theme } = await seedPost(db);
    await insertCta(db, post, theme);
    await expect(insertCta(db, post, theme, "again")).rejects.toThrow(/cards_one_cta/);
    await expect(insertCta(db, null, theme)).rejects.toThrow(/check/);
    // other kinds are untouched: still any number of name cards and previews
    await db.query(`insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed) values ($1,$2,'post',3,'B','m','s','p',3)`, [post, theme]);
    await db.query(`insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','S','m','s','p',4)`, [theme]);
    await expect(db.query(`insert into cards (post_id, theme_id, kind, name, meaning, shot, prompt, seed) values ($1,$2,'other','x','m','s','p',5)`, [post, theme])).rejects.toThrow(/cards_kind_check/);
  });

  it("claim_next_card hands the closing card out (after the name cards) with its kind; the post is ready only once it is done", async () => {
    const db = await migratedDb();
    const { post, theme, card } = await seedPost(db);
    const cta = (await insertCta(db, post, theme)).rows[0] as { id: string };
    const claim = async () => (await one<{ j: { job: string; card: { id: string; kind: string; name: string; meaning: string } } | null }>(db, `select claim_next_card() j`)).j;
    expect((await claim())!.card.id).toBe(card);
    await db.query(`update cards set status='done', claimed_at=null, card_path='x' where id=$1`, [card]);
    expect(await postStatus(db, post)).toBe("generating");
    const j = (await claim())!;
    expect(j).toMatchObject({ job: "generate", card: { id: cta.id, kind: "cta", name: "Follow for more / baby name ideas.", meaning: "" } });
    await db.query(`update cards set status='done', claimed_at=null, card_path='y' where id=$1`, [cta.id]);
    expect(await postStatus(db, post)).toBe("ready");
    // deleting the closing card frees no name and keeps the post ready
    await db.query(`select delete_card($1)`, [cta.id]);
    expect(await postStatus(db, post)).toBe("ready");
  });

  it("changes no function", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m010);
    expect(await defs(db)).toEqual(want);
    expect(m010).not.toMatch(/create (or replace )?function/i);
  });

  it("is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m010);
    await db.exec(m010);
    const { post, theme } = await seedPost(db);
    await insertCta(db, post, theme);
    expect(await one(db, `select cta_enabled, cta_messages from settings where id=1`)).toEqual({ cta_enabled: true, cta_messages: CTA_MESSAGES_DEFAULT });
  });
});

describe("fresh schema.sql matches v1 + 002..010 (+ 011)", () => {
  const TABLES = "('settings','cards','posts','reels','reel_scenes','themes','names')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
  });

  it("has the same columns (incl. the 010 defaults), constraints and indexes (+ 011)", async () => {
    const migrated = await migratedDb();
    await migrated.exec(m011);
    await migrated.exec(m012);
    await migrated.exec(m013);
    await migrated.exec(m014);
    const want = await shape(migrated);
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["settings.cta_enabled", "settings.cta_messages"]));
    expect((want.indexes as { indexname: string }[]).map((i) => i.indexname)).toContain("cards_one_cta");
    expect(await shape(await freshDb())).toEqual(want);
  });
});
