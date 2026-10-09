import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { HASHTAG_POOL_DEFAULT, legacyPool } from "@/lib/captions/hashtags";

// The live DB = v1 snapshot + 002..008. 009 adds the caption/hashtag columns.
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
];
const m009 = read("supabase", "migrations", "009_captions.sql");
const m010 = read("supabase", "migrations", "010_cta_card.sql");
const m011 = stripSupabase(read("supabase", "migrations", "011_az_series.sql"));
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));
const m013 = stripSupabase(read("supabase", "migrations", "013_letter_posts.sql"));

async function liveDb(hashtags?: string) {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  if (hashtags !== undefined) await db.query(`update settings set hashtags=$1 where id=1`, [hashtags]);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m009);
  return db;
}

describe("009_captions.sql on the live schema (v1 + 002..008)", () => {
  it("runs twice; new settings columns get the defaults + the old tags merged into the pool exactly once", async () => {
    const db = await liveDb("#parenting #uniquenames #fypシ #highlights #follower");
    await db.exec(m009);
    await db.exec(m009);
    expect(await one(db, `select hashtags, hashtags_always, hashtag_pool from settings where id=1`)).toEqual({
      hashtags: "#parenting #uniquenames #fypシ #highlights #follower", hashtags_always: "#uniquenames", hashtag_pool: `${HASHTAG_POOL_DEFAULT} #parenting`,
    });
  });

  it("the SQL merge matches the app's pre-009 legacyPool()", async () => {
    for (const old of ["#parenting #uniquenames #fypシ #highlights #follower", "#BabyNames, #Toddler #toddler #viralvideo #like4like #ok_no #momlife", "", "#a-b", "#momsoftiktok #InstaGood #sleepyhead"]) {
      const db = await liveDb(old);
      await db.exec(m009);
      expect((await one<{ hashtag_pool: string }>(db, `select hashtag_pool from settings where id=1`)).hashtag_pool, old).toBe(legacyPool(old));
    }
  });

  it("a pool the owner edited after 009 is never overwritten by a re-run", async () => {
    const db = await migratedDb();
    await db.query(`update settings set hashtag_pool='#x #y #z', hashtags_always='#a' where id=1`);
    await db.exec(m009);
    expect(await one(db, `select hashtag_pool, hashtags_always from settings where id=1`)).toEqual({ hashtag_pool: "#x #y #z", hashtags_always: "#a" });
  });

  it("posts get caption_style + hashtag_set and reels caption + hashtags, all null on old rows", async () => {
    const db = await liveDb();
    const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T','girl','b','o','p','l','c') returning id`)).id;
    const post = (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id, caption) values ('2026-10-09','girl','single',$1,'Hi #a') returning id`, [theme])).id;
    const reel = (await one<{ id: string }>(db, `insert into reels (title, doll_cast, status) values ('R', '{}', 'script') returning id`)).id;
    await db.exec(m009);
    expect(await one(db, `select caption, caption_style, hashtag_set from posts where id=$1`, [post])).toEqual({ caption: "Hi #a", caption_style: null, hashtag_set: null });
    expect(await one(db, `select caption, hashtags from reels where id=$1`, [reel])).toEqual({ caption: null, hashtags: null });
    await db.query(`update posts set caption_style='spotlight', hashtag_set='#uniquenames #seaside #babynames' where id=$1`, [post]);
    await db.query(`update reels set caption='Sound familiar? What helps you?', hashtags='#uniquenames #sleep #naps' where id=$1`, [reel]);
  });

  it("changes no function (the worker's claims are untouched)", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m009);
    expect(await defs(db)).toEqual(want);
    expect(m009).not.toMatch(/create (or replace )?function/i);
  });

  it("is also safe on a fresh schema.sql project (keeps its pool)", async () => {
    const db = await freshDb();
    await db.exec(m009);
    await db.exec(m009);
    expect(await one(db, `select hashtags_always, hashtag_pool from settings where id=1`)).toEqual({ hashtags_always: "#uniquenames", hashtag_pool: HASHTAG_POOL_DEFAULT });
  });
});

describe("fresh schema.sql matches v1 + 002..009 (+ 010)", () => {
  const TABLES = "('settings','reels','reel_scenes','posts')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
  });

  it("has the same columns (incl. the 009 defaults) and constraints (+ 010)", async () => {
    const migrated = await migratedDb();
    await migrated.exec(m010);
    await migrated.exec(m011);
    await migrated.exec(m012);
    await migrated.exec(m013);
    const want = await shape(migrated);
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["settings.hashtags_always", "settings.hashtag_pool", "posts.caption_style", "posts.hashtag_set", "reels.caption", "reels.hashtags"]));
    expect(await shape(await freshDb())).toEqual(want);
  });
});
