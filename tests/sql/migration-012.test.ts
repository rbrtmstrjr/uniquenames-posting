import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { GUIDE_THEME_IDS, LEGACY_THEME_IDS, REEL_THREADS } from "@/lib/db/types";
import { guidePreviewPrompt } from "@/lib/reels/guide";
import { CRAYON_GUIDE, RED_THREAD_GUIDE } from "@/lib/reels/guide-text";
import { STATIC_THEMES, THEME_LABEL } from "@/lib/reels/themes";

// The live DB = v1 snapshot + 002..011. 012 adds the two guide styles (Crayon, Red Thread) and hides the 8 old themes.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const m007 = stripSupabase(read("supabase", "migrations", "007_reel_themes.sql"));
const earlier = [
  read("supabase", "migrations", "002_v2.sql"),
  read("supabase", "migrations", "003_post_fonts.sql"),
  read("supabase", "migrations", "004_subject_age.sql"),
  stripSupabase(read("supabase", "migrations", "005_reels.sql")),
  stripSupabase(read("supabase", "migrations", "006_reel_voices.sql")),
  m007,
  read("supabase", "migrations", "008_reel_playbook.sql"),
  read("supabase", "migrations", "009_captions.sql"),
  read("supabase", "migrations", "010_cta_card.sql"),
  stripSupabase(read("supabase", "migrations", "011_az_series.sql")),
];
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));
const later = ["013_letter_posts.sql", "014_reel_formats.sql"].map((m) => stripSupabase(read("supabase", "migrations", m)));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m012);
  return db;
}
async function addReel(db: PGlite, theme: string | null) {
  const reel = (await one<{ id: string }>(db, `insert into reels (title, doll_cast, status, theme_id) values ($1, '{}', 'ready', $2) returning id`,
    [`Reel ${crypto.randomUUID()}`, theme])).id;
  await db.query(`insert into reel_scenes (reel_id, position, narration, image_prompt, seed, status) values ($1, 1, 'n', 'p', 1, 'done')`, [reel]);
  return reel;
}
type Row = { id: string; active: boolean; keep_red: boolean; grayscale: boolean; faces: boolean; label: string; emoji: string; style: string; preview_prompt: string | null };
const themes = async (db: PGlite) => (await db.query<Row>(`select * from reel_themes order by sort, id`)).rows;

describe("012_two_styles.sql on the live schema (v1 + 002..011)", () => {
  it("runs twice: Crayon + Red Thread added and offered, the 8 old themes kept but hidden, old reels untouched", async () => {
    const db = await liveDb();
    const old = await addReel(db, "sketch");
    await db.exec(m012);
    await db.exec(m012);
    const rows = await themes(db);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([...GUIDE_THEME_IDS]);
    expect(rows.filter((r) => !r.active).map((r) => r.id).sort()).toEqual([...LEGACY_THEME_IDS].sort());
    expect(await one(db, `select theme_id from reels where id=$1`, [old])).toEqual({ theme_id: "sketch" });
    expect(await one(db, `select grayscale from reel_themes where id='sketch'`)).toEqual({ grayscale: true });
    expect(await one(db, `select feeling, thread from reel_scenes where reel_id=$1`, [old])).toEqual({ feeling: null, thread: null });
  });

  it("seeds both styles from the guides: style paragraph, preview prompt (the guide's example), Red Thread keeps red", async () => {
    const db = await migratedDb();
    for (const id of GUIDE_THEME_IDS) {
      const r = await one<Row>(db, `select * from reel_themes where id=$1`, [id]);
      expect(r).toMatchObject({ label: THEME_LABEL[id].label, emoji: THEME_LABEL[id].emoji, faces: true, grayscale: false, keep_red: id === "redthread", active: true });
      expect(r.style).toBe(STATIC_THEMES[id].style);
      expect(r.preview_prompt).toBe(guidePreviewPrompt(id));
      expect(r).toMatchObject({ preview_status: "missing", preview_path: null, version: 1 });
    }
    expect(STATIC_THEMES.crayon.style).toBe(CRAYON_GUIDE.style);
    expect(STATIC_THEMES.redthread.style).toBe(RED_THREAD_GUIDE.style);
    for (const id of LEGACY_THEME_IDS) {
      expect(await one(db, `select keep_red, preview_prompt from reel_themes where id=$1`, [id])).toEqual({ keep_red: false, preview_prompt: null });
    }
  });

  it("the Settings default moves to Crayon from an old theme; a guide style already chosen stays; new rows default to Crayon", async () => {
    const db = await liveDb();
    await db.query(`update settings set reel_theme_id='sketch'`);
    await db.exec(m012);
    expect(await one(db, `select reel_theme_id from settings`)).toEqual({ reel_theme_id: "crayon" });
    await db.query(`update settings set reel_theme_id='redthread'`);
    await db.exec(m012);
    expect(await one(db, `select reel_theme_id from settings`)).toEqual({ reel_theme_id: "redthread" });
    expect(await one(db, `select column_default from information_schema.columns where table_name='settings' and column_name='reel_theme_id'`))
      .toEqual({ column_default: "'crayon'::text" });
  });

  it("re-running keeps previews; a preview still in line for an old theme leaves the line; re-running 007 never re-activates", async () => {
    const db = await liveDb();
    await db.query(`update reel_themes set preview_status='queued' where id in ('clay', 'anime')`);
    await db.query(`update reel_themes set preview_path='themes/anime/preview-v1.jpg' where id='anime'`);
    await db.exec(m012);
    expect((await db.query(`select id, preview_status from reel_themes where id in ('clay', 'anime') order by id`)).rows)
      .toEqual([{ id: "anime", preview_status: "ready" }, { id: "clay", preview_status: "missing" }]);
    await db.query(`update reel_themes set preview_path='themes/crayon/preview-v2.jpg', preview_status='ready', version=2 where id='crayon'`);
    await db.query(`update reel_themes set label='X', active=false where id='redthread'`);
    await db.exec(m012);
    expect(await one(db, `select preview_path, preview_status, version from reel_themes where id='crayon'`))
      .toEqual({ preview_path: "themes/crayon/preview-v2.jpg", preview_status: "ready", version: 2 });
    expect(await one(db, `select label, active from reel_themes where id='redthread'`)).toEqual({ label: "Red Thread", active: true });
    await db.exec(m007);
    expect((await themes(db)).filter((r) => r.active).map((r) => r.id)).toEqual([...GUIDE_THEME_IDS]);
    expect(await one(db, `select reel_theme_id from settings`)).toEqual({ reel_theme_id: "crayon" });
  });

  it("a line's thread is one of the 5 states (or null)", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, "redthread");
    for (const t of REEL_THREADS) await db.query(`update reel_scenes set thread=$1, feeling='a love that just began' where reel_id=$2`, [t, reel]);
    await db.query(`update reel_scenes set thread=null where reel_id=$1`, [reel]);
    await expect(db.query(`update reel_scenes set thread='frayed' where reel_id=$1`, [reel])).rejects.toThrow(/reel_scenes_thread_check/);
  });
});

describe("fresh schema.sql matches v1 + 002..012 (+ 013, 014)", () => {
  const TABLES = "('settings','reel_themes','reel_scenes','reels')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    themes: (await db.query(`select id, label, emoji, blurb, style, faces, grayscale, keep_red, active, sort, preview_prompt, preview_status
      from reel_themes order by id`)).rows,
    settings: (await db.query(`select reel_theme_id from settings`)).rows,
  });

  it("has the same columns, constraints, theme rows and default theme", async () => {
    const migrated = await migratedDb();
    for (const m of later) await migrated.exec(m);
    const want = await shape(migrated);
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["reel_themes.active", "reel_themes.keep_red", "reel_themes.preview_prompt", "reel_scenes.feeling", "reel_scenes.thread"]));
    expect(await shape(await freshDb())).toEqual(want);
  });
});
