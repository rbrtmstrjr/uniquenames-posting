import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { KNIT_STYLE } from "@/lib/reels/prompt";
import { REEL_MOTIONS, LEGACY_THEME_IDS } from "@/lib/db/types";

// The live DB = v1 snapshot + 002..006. 007 adds the reel themes (with previews) and per-line emotion + motion.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const m002 = read("supabase", "migrations", "002_v2.sql");
const m003 = read("supabase", "migrations", "003_post_fonts.sql");
const m004 = read("supabase", "migrations", "004_subject_age.sql");
const m005 = stripSupabase(read("supabase", "migrations", "005_reels.sql"));
const m006 = stripSupabase(read("supabase", "migrations", "006_reel_voices.sql"));
const m007raw = read("supabase", "migrations", "007_reel_themes.sql");
const m007 = stripSupabase(m007raw);
const m008 = read("supabase", "migrations", "008_reel_playbook.sql");
const m009 = read("supabase", "migrations", "009_captions.sql");
const m010 = read("supabase", "migrations", "010_cta_card.sql");
const m011 = stripSupabase(read("supabase", "migrations", "011_az_series.sql"));
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));
const m013 = stripSupabase(read("supabase", "migrations", "013_letter_posts.sql"));

// The final style blocks from the PC spike, verbatim.
const spike = read("docs", "reference", "reel-themes-motion-spike.md").replace(/\r\n/g, "\n");
const SPIKE_STYLES = Object.fromEntries([...spike.matchAll(/### `([a-z0-9]+)`\s*\n\s*```text\n([\s\S]*?)\n```/g)].map((m) => [m[1], m[2]]));

const THEMES = [
  { id: "knitted", label: "Knitted Doll", emoji: "🧶", faces: false, grayscale: false, sort: 1 },
  { id: "animated3d", label: "3D Animated", emoji: "🎬", faces: true, grayscale: false, sort: 2 },
  { id: "watercolor", label: "Storybook Watercolor", emoji: "🎨", faces: true, grayscale: false, sort: 3 },
  { id: "clay", label: "Clay Stop-motion", emoji: "🏺", faces: true, grayscale: false, sort: 4 },
  { id: "papercraft", label: "Paper Craft", emoji: "✂️", faces: false, grayscale: false, sort: 5 },
  { id: "anime", label: "Soft Anime", emoji: "🌸", faces: true, grayscale: false, sort: 6 },
  { id: "sketch", label: "Pencil Sketch (B&W)", emoji: "✏️", faces: true, grayscale: true, sort: 7 },
  { id: "cinematic", label: "Cinematic Real", emoji: "📷", faces: true, grayscale: false, sort: 8 },
];

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, m002, m003, m004, m005, m006]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m007);
  return db;
}

type Json = Record<string, unknown>;
type Preview = { theme: Json & { id: string; preview_status: string; claimed_at: string | null; version: number } } | null;
type Step = { step: string } | null;
const claimPreview = async (db: PGlite) => (await one<{ r: Preview }>(db, `select claim_next_theme_preview() r`)).r;
const claimSample = async (db: PGlite) => (await one<{ r: Json | null }>(db, `select claim_next_voice_sample() r`)).r;
const claimStep = async (db: PGlite) => (await one<{ r: Step }>(db, `select claim_next_reel_step(false, true) r`)).r;
const requeue = async (db: PGlite) => (await one<{ n: number }>(db, `select requeue_stuck_reels() n`)).n;
const queuePreview = (db: PGlite, id: string) => db.query(`update reel_themes set preview_status='queued' where id=$1`, [id]);

async function addReel(db: PGlite, scenes = 1) {
  const reel = (await one<{ id: string }>(db,
    `insert into reels (title, doll_cast, status) values ($1, '{}', 'queued') returning id`, [`Reel ${crypto.randomUUID()}`])).id;
  for (let i = 1; i <= scenes; i++) {
    await db.query(`insert into reel_scenes (reel_id, position, narration, image_prompt, seed, status) values ($1,$2::int,'n','p',$2::int,'queued')`, [reel, i]);
  }
  return reel;
}
async function queueCard(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,'boy','b','o','p','l','c') returning id`, [`T ${crypto.randomUUID()}`])).id;
  return (await one<{ id: string }>(db, `insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','P','m','s','p',1) returning id`, [theme])).id;
}

describe("007_reel_themes.sql on the live schema (v1 + 002..006)", () => {
  it("runs twice, keeps settings, reels and scenes, and seeds the 8 themes once", async () => {
    const db = await liveDb();
    await db.query(`update settings set reel_voice_id='kore', reel_max_images=12`);
    const reel = await addReel(db, 2);
    await db.exec(m007);
    await db.exec(m007);
    expect(await one(db, `select reel_voice_id, reel_max_images, reel_theme_id from settings`))
      .toEqual({ reel_voice_id: "kore", reel_max_images: 12, reel_theme_id: "knitted" });
    // reels made before 007 were Knitted Doll: backfilled (idempotent)
    expect(await one(db, `select status, theme_id from reels where id=$1`, [reel])).toEqual({ status: "queued", theme_id: "knitted" });
    expect((await db.query(`select emotion, action, shot, key_moment, motion from reel_scenes where reel_id=$1 order by position`, [reel])).rows)
      .toEqual([1, 2].map(() => ({ emotion: null, action: null, shot: null, key_moment: false, motion: null })));
    expect(await one(db, `select count(*)::int n from reel_themes`)).toEqual({ n: 8 });
  });

  it("seeds the 8 themes in order with the spike's style blocks verbatim (knitted = KNIT_STYLE)", async () => {
    const db = await migratedDb();
    const rows = (await db.query<Json & { id: string; style: string; blurb: string }>(
      `select id, label, emoji, blurb, style, faces, grayscale, sort, preview_path, preview_status, error, version, claimed_at from reel_themes order by sort`)).rows;
    expect(rows.map(({ id, label, emoji, faces, grayscale, sort }) => ({ id, label, emoji, faces, grayscale, sort }))).toEqual(THEMES);
    expect(rows.map((r) => r.id)).toEqual([...LEGACY_THEME_IDS]);
    expect(Object.keys(SPIKE_STYLES).sort()).toEqual(THEMES.map((t) => t.id).sort());
    for (const r of rows) {
      expect(r.style, r.id).toBe(SPIKE_STYLES[r.id]);
      expect(r.blurb.length, r.id).toBeGreaterThan(10);
      expect(r).toMatchObject({ preview_path: null, preview_status: "missing", error: null, version: 1, claimed_at: null });
      // positive-only wording, never "camera"
      expect(r.style, r.id).not.toMatch(/camera|avoid|\bno [a-z]|\bnot a\b/i);
    }
    expect(rows[0].style).toBe(KNIT_STYLE);
  });

  it("re-running refreshes the seed wording but never touches preview_*; an unchanged re-run leaves rows alone", async () => {
    const db = await migratedDb();
    await db.query(`update reel_themes set label='X', emoji='?', blurb='b', style='s', faces=true, grayscale=true, sort=99,
      preview_path='themes/knitted/preview-v3.jpg', preview_status='failed', error='boom', version=3, claimed_at=now() where id='knitted'`);
    await db.query(`update reel_themes set preview_path='themes/clay/preview-v1.jpg', preview_status='ready' where id='clay'`);
    const before = await one<{ updated_at: string }>(db, `select updated_at::text from reel_themes where id='anime'`);
    await db.exec(m007);
    expect(await one(db, `select label, emoji, faces, grayscale, sort, style = $1 same, preview_path, preview_status, error, version,
      claimed_at is not null claimed from reel_themes where id='knitted'`, [KNIT_STYLE])).toEqual({
      label: "Knitted Doll", emoji: "🧶", faces: false, grayscale: false, sort: 1, same: true,
      preview_path: "themes/knitted/preview-v3.jpg", preview_status: "failed", error: "boom", version: 3, claimed: true,
    });
    expect(await one(db, `select preview_path, preview_status from reel_themes where id='clay'`))
      .toEqual({ preview_path: "themes/clay/preview-v1.jpg", preview_status: "ready" });
    expect(await one(db, `select updated_at::text from reel_themes where id='anime'`)).toEqual(before);
  });

  it("checks preview status, the theme references and the motion presets; key_moment defaults to false", async () => {
    const db = await migratedDb();
    await expect(db.query(`update reel_themes set preview_status='done' where id='clay'`)).rejects.toThrow(/check/i);
    for (const bad of ["reel_theme_id='nope'", "reel_theme_id=null"]) {
      await expect(db.query(`update settings set ${bad}`), bad).rejects.toThrow();
    }
    await db.query(`update settings set reel_theme_id='anime'`);
    const reel = await addReel(db, 1);
    await expect(db.query(`update reels set theme_id='nope' where id=$1`, [reel])).rejects.toThrow(/foreign key/i);
    await db.query(`update reels set theme_id='cinematic' where id=$1`, [reel]);
    await db.query(`delete from reel_themes where id='cinematic'`);
    expect(await one(db, `select theme_id from reels where id=$1`, [reel])).toEqual({ theme_id: null });

    // 007's presets (008 adds 'hold')
    const M007 = REEL_MOTIONS.filter((m) => m !== "hold");
    expect(M007).toEqual(["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "punch"]);
    await expect(db.query(`update reel_scenes set motion='hold' where reel_id=$1`, [reel])).rejects.toThrow(/check/i);
    for (const m of M007) await db.query(`update reel_scenes set motion=$1 where reel_id=$2`, [m, reel]);
    await db.query(`update reel_scenes set motion=null where reel_id=$1`, [reel]);
    for (const bad of ["ai", "zoom", ""]) {
      await expect(db.query(`update reel_scenes set motion=$1 where reel_id=$2`, [bad, reel]), bad).rejects.toThrow(/check/i);
    }
    await expect(db.query(`update reel_scenes set key_moment=null where reel_id=$1`, [reel])).rejects.toThrow();
    await db.query(`update reel_scenes set emotion='laughing', action='arms up', shot='wide', key_moment=true, motion='punch' where reel_id=$1`, [reel]);
    expect(await one(db, `select emotion, action, shot, key_moment, motion from reel_scenes where reel_id=$1`, [reel]))
      .toEqual({ emotion: "laughing", action: "arms up", shot: "wide", key_moment: true, motion: "punch" });
  });

  it("adds no AI-motion parts (no clip step, no p_clips, no clip_path)", async () => {
    const db = await migratedDb();
    expect(m007raw).not.toMatch(/p_clips|clip_path|'clip'/);
    expect(await one(db, `select count(*)::int n from information_schema.columns where table_name='reel_scenes' and column_name='clip_path'`)).toEqual({ n: 0 });
  });

  it("leaves claim_next_reel_step and reel_next_step exactly as 006 made them", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ('claim_next_reel_step','reel_next_step','claim_next_voice_sample') order by 1`)).rows;
    const live = await liveDb();
    const want = await defs(live);
    await live.exec(m007);
    expect(await defs(live)).toEqual(want);
  });

  it("007 is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m007);
    // the 8 of 007 + the 2 guide styles of 012 (schema.sql has both)
    expect(await one(db, `select count(*)::int n from reel_themes`)).toEqual({ n: 10 });
    await addReel(db, 1);
    expect((await claimStep(db))?.step).toBe("voice");
  });

  it("has exactly one signature per function after running 007 twice", async () => {
    const db = await liveDb();
    await db.exec(m007);
    await db.exec(m007);
    const sigs = (await db.query(`select p.proname, pg_get_function_identity_arguments(p.oid) s from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname='public'
      and p.proname in ('claim_next_reel_step','claim_next_voice_sample','claim_next_theme_preview','requeue_stuck_reels','reel_next_step') order by 1`)).rows;
    expect(sigs).toEqual([
      { proname: "claim_next_reel_step", s: "p_no_comfy boolean, p_music boolean" },
      { proname: "claim_next_theme_preview", s: "" },
      { proname: "claim_next_voice_sample", s: "" },
      { proname: "reel_next_step", s: "p_reel reels, p_no_comfy boolean, p_music boolean" },
      { proname: "requeue_stuck_reels", s: "" },
    ]);
  });
});

describe("claim_next_theme_preview", () => {
  it("claims the oldest queued theme: making + claimed_at, returns {theme}", async () => {
    const db = await migratedDb();
    expect(await claimPreview(db)).toBeNull(); // nothing queued
    await queuePreview(db, "anime");
    await queuePreview(db, "clay");
    await db.exec(`alter table reel_themes disable trigger touch;
      update reel_themes set updated_at = now() - interval '1 hour' where id='clay';
      alter table reel_themes enable trigger touch;`);
    const a = await claimPreview(db);
    expect(a).toMatchObject({ theme: { id: "clay", preview_status: "making", label: "Clay Stop-motion", version: 1, error: null } });
    expect(a!.theme.claimed_at).not.toBeNull();
    expect(typeof a!.theme.style).toBe("string");
    expect(await claimPreview(db)).toMatchObject({ theme: { id: "anime", preview_status: "making" } });
    expect(await claimPreview(db)).toBeNull();
  });

  it("order: cards > reel steps > voice samples > theme previews", async () => {
    const db = await migratedDb();
    await queuePreview(db, "sketch");
    await db.query(`update reel_voices set sample_status='queued', ref_path='voices/kore/ref.wav' where id='kore'`);
    const card = await queueCard(db);
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]', music_path='' where id=$1`, [reel]);
    expect(await claimPreview(db)).toBeNull(); // a card is waiting
    await db.query(`update cards set status='done' where id=$1`, [card]);
    expect(await claimPreview(db)).toBeNull(); // the reel's image can run
    expect(await claimStep(db)).toMatchObject({ step: "image" });
    expect(await claimPreview(db)).toBeNull(); // the reel step is being worked on
    await db.query(`update reel_scenes set status='done', claimed_at=null where reel_id=$1`, [reel]);
    await db.query(`update reels set claimed_at=null where id=$1`, [reel]);
    expect(await claimPreview(db)).toBeNull(); // the render can run
    await db.query(`update reels set preview_path='p', status='ready' where id=$1`, [reel]);
    expect(await claimPreview(db)).toBeNull(); // a voice sample is queued: samples first
    expect(await claimSample(db)).toMatchObject({ voice: { id: "kore" } });
    expect(await claimPreview(db)).toBeNull(); // the sample is being made
    await db.query(`update reel_voices set sample_status='ready', claimed_at=null where id='kore'`);
    expect(await claimPreview(db)).toMatchObject({ theme: { id: "sketch", grayscale: true } });
  });

  it("stale claims and samples that can't run (no reference clip yet) do not block previews", async () => {
    const db = await migratedDb();
    await queuePreview(db, "watercolor");
    await db.query(`update reel_voices set sample_status='queued' where id='puck'`); // no ref clip: not claimable
    await db.query(`update reel_voices set sample_status='making', ref_path='r', claimed_at=now() - interval '11 minutes' where id='kore'`);
    const card = await queueCard(db);
    await db.query(`update cards set status='generating', claimed_at=now() - interval '6 minutes' where id=$1`, [card]);
    const reel = await addReel(db, 1);
    await db.query(`update reels set status='imaging', claimed_at=now() - interval '11 minutes' where id=$1`, [reel]);
    expect(await claimPreview(db)).toMatchObject({ theme: { id: "watercolor" } });
  });

  it("a reel that cannot move on does not block previews", async () => {
    const db = await migratedDb();
    await queuePreview(db, "anime");
    const broken = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]', music_path='' where id=$1`, [broken]);
    await db.query(`update reel_scenes set status='failed', attempts=3 where reel_id=$1`, [broken]);
    expect(await claimStep(db)).toBeNull();
    expect(await claimPreview(db)).toMatchObject({ theme: { id: "anime" } });
  });

  it("requeue_stuck_reels puts preview claims older than 10 minutes back in the queue, keeps fresh ones", async () => {
    const db = await migratedDb();
    await queuePreview(db, "clay");
    await queuePreview(db, "anime");
    await claimPreview(db);
    await claimPreview(db);
    expect(await requeue(db)).toBe(0);
    await db.query(`update reel_themes set claimed_at=now() - interval '11 minutes' where id='clay'`);
    expect(await requeue(db)).toBe(1);
    expect(await one(db, `select preview_status, claimed_at from reel_themes where id='clay'`)).toEqual({ preview_status: "queued", claimed_at: null });
    expect(await one(db, `select preview_status from reel_themes where id='anime'`)).toEqual({ preview_status: "making" });
    expect(await claimPreview(db)).toMatchObject({ theme: { id: "clay" } });
  });
});

// schema.sql also holds 008 and 009 (columns only): compare with them applied too.
describe("fresh schema.sql matches v1 + 002..007 (+ 008)", () => {
  const TABLES = "('settings','reels','reel_scenes','reel_voices','reel_themes','cards','posts')";
  const FUNCS = "('create_post','claim_next_card','requeue_stuck_cards','claim_next_reel_step','requeue_stuck_reels','reel_next_step','claim_next_voice_sample','claim_next_theme_preview')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
    triggers: (await db.query(`select event_object_table t, trigger_name, event_manipulation e from information_schema.triggers
      where event_object_table in ${TABLES} order by 1, 2, 3`)).rows,
    functions: (await db.query<{ proname: string; def: string }>(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ${FUNCS} order by 1`)).rows
      .map((r) => ({ ...r, def: r.def.replace(/\r\n/g, "\n") })),
    themes: (await db.query(`select id, label, emoji, blurb, style, faces, grayscale, sort, preview_path, preview_status, error, version from reel_themes order by id`)).rows,
  });

  it("has the same columns, constraints, indexes, triggers, function bodies and theme rows", async () => {
    const migrated = await migratedDb();
    await migrated.exec(m008);
    await migrated.exec(m009);
    await migrated.exec(m010);
    await migrated.exec(m011);
    await migrated.exec(m012);
    await migrated.exec(m013);
    const want = await shape(migrated);
    expect(want.functions).toHaveLength(8);
    expect(want.themes).toHaveLength(10);
    expect(want.triggers.filter((t) => (t as { t: string }).t === "reel_themes")).toHaveLength(1);
    expect(await shape(await freshDb())).toEqual(want);
  });
});

describe("007 Supabase-only block", () => {
  const security = (sql: string) => sql.match(/-- @supabase-only begin([\s\S]*?)-- -+ realtime/)![1];

  it("applies twice: owner RLS on reel_themes, the preview claim for the service role only", async () => {
    const db = await migratedDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(security(m007raw));
    await db.exec(security(m007raw));
    const can = async (role: string, fn: string) =>
      (await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, fn])).ok;
    for (const fn of ["public.claim_next_theme_preview()", "public.requeue_stuck_reels()"]) {
      expect(await can("service_role", fn), fn).toBe(true);
      expect(await can("authenticated", fn), fn).toBe(false);
      expect(await can("anon", fn), fn).toBe(false);
    }
    expect(await one(db, `select has_table_privilege('authenticated','public.reel_themes','update') a,
      has_table_privilege('service_role','public.reel_themes','update') s, has_table_privilege('anon','public.reel_themes','select') x`))
      .toEqual({ a: true, s: true, x: false });
    expect(await one(db, `select relrowsecurity from pg_class where relname='reel_themes'`)).toEqual({ relrowsecurity: true });
    expect((await db.query(`select policyname from pg_policies where tablename='reel_themes'`)).rows).toEqual([{ policyname: "owner_all" }]);
  });

  it("adds realtime and the grants (same as schema.sql)", () => {
    const schema = read("supabase", "schema.sql");
    for (const sql of [m007raw, schema]) {
      expect(sql).toMatch(/alter table public\.reel_themes replica identity full;/);
      expect(sql).toMatch(/revoke execute on function public\.claim_next_theme_preview\(\) from public, anon, authenticated;/);
      expect(sql).toMatch(/grant execute on function public\.claim_next_theme_preview\(\) to service_role;/);
    }
    expect(m007raw).toMatch(/alter publication supabase_realtime add table public\.reel_themes/);
    expect(schema).toMatch(/array\[[^\]]*'reel_themes'\][\s\S]*supabase_realtime/);
    expect(schema).toMatch(/foreach t in array array\[[^\]]*'reel_themes'[^\]]*\] loop\s+execute format\('drop policy if exists owner_all/);
  });
});
