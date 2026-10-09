import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002 + 003 + 004 + 005. 006 adds the narrator voices, speed and music.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const m002 = read("supabase", "migrations", "002_v2.sql");
const m003 = read("supabase", "migrations", "003_post_fonts.sql");
const m004 = read("supabase", "migrations", "004_subject_age.sql");
const m005 = stripSupabase(read("supabase", "migrations", "005_reels.sql"));
const m006raw = read("supabase", "migrations", "006_reel_voices.sql");
const m006 = stripSupabase(m006raw);
const m007 = stripSupabase(read("supabase", "migrations", "007_reel_themes.sql"));
const m008 = read("supabase", "migrations", "008_reel_playbook.sql");
const m009 = read("supabase", "migrations", "009_captions.sql");
const m010 = read("supabase", "migrations", "010_cta_card.sql");
const m011 = stripSupabase(read("supabase", "migrations", "011_az_series.sql"));
const m012 = stripSupabase(read("supabase", "migrations", "012_two_styles.sql"));

const GEMINI = [
  ["zephyr", "Bright"], ["puck", "Upbeat"], ["charon", "Informative"], ["kore", "Firm"], ["fenrir", "Excitable"],
  ["leda", "Youthful"], ["orus", "Firm"], ["aoede", "Breezy"], ["callirrhoe", "Easy-going"], ["autonoe", "Bright"],
  ["enceladus", "Breathy"], ["iapetus", "Clear"], ["umbriel", "Easy-going"], ["algieba", "Smooth"], ["despina", "Smooth"],
  ["erinome", "Clear"], ["algenib", "Gravelly"], ["rasalgethi", "Informative"], ["laomedeia", "Upbeat"], ["achernar", "Soft"],
  ["alnilam", "Firm"], ["schedar", "Even"], ["gacrux", "Mature"], ["pulcherrima", "Forward"], ["achird", "Friendly"],
  ["zubenelgenubi", "Casual"], ["vindemiatrix", "Gentle"], ["sadachbia", "Lively"], ["sadaltager", "Knowledgeable"], ["sulafat", "Warm"],
] as const;

async function liveDb() {
  const db = new PGlite();
  await db.exec(v1);
  await db.exec(m002);
  await db.exec(m003);
  await db.exec(m004);
  await db.exec(m005);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m006);
  return db;
}

type Json = Record<string, unknown>;
type Step = { step: string; reel: Json & { id: string; status: string }; scene: (Json & { id: string; position: number }) | null } | null;
type Sample = { voice: Json & { id: string; sample_status: string; claimed_at: string | null; version: number } } | null;
// the 006 worker passes p_music: true
const claimStep = async (db: PGlite, noComfy = false, music = true) =>
  (await one<{ r: Step }>(db, `select claim_next_reel_step($1, $2) r`, [noComfy, music])).r;
const claimSample = async (db: PGlite) => (await one<{ r: Sample }>(db, `select claim_next_voice_sample() r`)).r;
const requeue = async (db: PGlite) => (await one<{ n: number }>(db, `select requeue_stuck_reels() n`)).n;
const release = (db: PGlite, reel: string) => db.query(`update reels set claimed_at=null where id=$1`, [reel]);

async function addReel(db: PGlite, scenes = 2, extra: { created?: string } = {}) {
  const reel = (await one<{ id: string }>(db,
    `insert into reels (title, doll_cast, status, created_at) values ($1, '{}', 'queued', coalesce($2::timestamptz, now())) returning id`,
    [`Reel ${crypto.randomUUID()}`, extra.created ?? null])).id;
  for (let i = 1; i <= scenes; i++) {
    await db.query(`insert into reel_scenes (reel_id, position, narration, image_prompt, seed, status) values ($1,$2::int,'n','p',$2::int,'queued')`, [reel, i]);
  }
  return reel;
}
async function queueCard(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,'boy','b','o','p','l','c') returning id`, [`T ${crypto.randomUUID()}`])).id;
  return (await one<{ id: string }>(db, `insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','P','m','s','p',1) returning id`, [theme])).id;
}
const queueSample = (db: PGlite, id: string, ref: string | null = `voices/${id}/ref.wav`) =>
  db.query(`update reel_voices set sample_status='queued', ref_path=$2 where id=$1`, [id, ref]);

describe("006_reel_voices.sql on the live schema (v1 + 002..005)", () => {
  it("runs twice, keeps settings and reels, and seeds the 31 voices once", async () => {
    const db = await liveDb();
    await db.query(`update settings set reel_max_images=12`);
    const reel = await addReel(db, 1);
    await db.exec(m006);
    await db.query(`update reel_voices set label='Mine', sample_status='ready' where id='kore'`);
    await db.exec(m006);
    expect(await one(db, `select reel_max_images, reel_voice_id, reel_speed::text speed, reel_music, reel_music_volume from settings`))
      .toEqual({ reel_max_images: 12, reel_voice_id: "gacrux", speed: "1.12", reel_music: true, reel_music_volume: 18 });
    expect(await one(db, `select status, voice_id, music_path from reels where id=$1`, [reel])).toEqual({ status: "queued", voice_id: null, music_path: null });
    expect(await one(db, `select count(*)::int n from reel_voices`)).toEqual({ n: 31 });
    expect(await one(db, `select label, sample_status from reel_voices where id='kore'`)).toEqual({ label: "Mine", sample_status: "ready" });
  });

  it("seeds the 30 Gemini voices (capitalised label, spike tone, no gender) and the built-in voice", async () => {
    const db = await migratedDb();
    const rows = (await db.query<{ id: string; label: string; tone: string; gender: string | null; sample_status: string; version: number; ref_path: string | null }>(
      `select id, label, tone, gender, sample_status, version, ref_path from reel_voices order by id`)).rows;
    const want = [...GEMINI.map(([id, tone]) => ({ id, label: id[0].toUpperCase() + id.slice(1), tone })),
      { id: "builtin", label: "Built-in", tone: "Default" }].sort((a, b) => a.id.localeCompare(b.id));
    expect(rows.map(({ id, label, tone }) => ({ id, label, tone }))).toEqual(want);
    for (const r of rows) expect(r).toMatchObject({ gender: null, sample_status: "missing", version: 1, ref_path: null });
  });

  it("checks speed (1.00..1.25), volume (5..40), sample status, gender and the voice references", async () => {
    const db = await migratedDb();
    for (const bad of ["reel_speed=0.99", "reel_speed=1.26", "reel_music_volume=4", "reel_music_volume=41", "reel_voice_id='nobody'", "reel_voice_id=null"]) {
      await expect(db.query(`update settings set ${bad}`), bad).rejects.toThrow();
    }
    await db.query(`update settings set reel_speed=1.00, reel_music_volume=5, reel_music=false, reel_voice_id='builtin'`);
    await db.query(`update settings set reel_speed=1.25, reel_music_volume=40, reel_voice_id='kore'`);
    await expect(db.query(`update reel_voices set sample_status='done' where id='kore'`)).rejects.toThrow(/check/i);
    await expect(db.query(`update reel_voices set gender='other' where id='kore'`)).rejects.toThrow(/check/i);
    await db.query(`update reel_voices set gender='female' where id='kore'`);
    const reel = await addReel(db, 0);
    await expect(db.query(`update reels set voice_id='nobody' where id=$1`, [reel])).rejects.toThrow(/foreign key/i);
    await db.query(`update reels set voice_id='puck' where id=$1`, [reel]);
    await db.query(`delete from reel_voices where id='puck'`);
    expect(await one(db, `select voice_id from reels where id=$1`, [reel])).toEqual({ voice_id: null });
  });

  it("006 is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m006);
    expect(await one(db, `select count(*)::int n from reel_voices`)).toEqual({ n: 31 });
    await addReel(db, 1);
    expect((await claimStep(db))?.step).toBe("voice");
  });

  it("has exactly one signature per function after running 006 twice (005's and the first draft's are dropped)", async () => {
    const db = await liveDb();
    await db.exec(`create function public.reel_next_step(p_reel public.reels, p_no_comfy boolean) returns jsonb language sql as $$ select null::jsonb $$`);
    await db.exec(m006);
    await db.exec(m006);
    const sigs = (await db.query<{ proname: string; s: string }>(`select p.proname, pg_get_function_identity_arguments(p.oid) s from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname='public'
      and p.proname in ('claim_next_reel_step','claim_next_voice_sample','requeue_stuck_reels','reel_next_step') order by 1`)).rows;
    expect(sigs).toEqual([
      { proname: "claim_next_reel_step", s: "p_no_comfy boolean, p_music boolean" },
      { proname: "claim_next_voice_sample", s: "" },
      { proname: "reel_next_step", s: "p_reel reels, p_no_comfy boolean, p_music boolean" },
      { proname: "requeue_stuck_reels", s: "" },
    ]);
  });
});

describe("claim_next_reel_step with music", () => {
  it("claims voice -> timing -> music -> image -> render; music runs as 'voicing'", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    expect(await claimStep(db)).toMatchObject({ step: "voice" });
    await db.query(`update reels set voice_path='v', claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db)).toMatchObject({ step: "timing" });
    await db.query(`update reels set words='[]', claimed_at=null where id=$1`, [reel]);
    const music = await claimStep(db);
    expect(music).toMatchObject({ step: "music", scene: null, reel: { id: reel, status: "voicing", music_path: null } });
    expect(music!.reel.claimed_at).not.toBeNull();
    expect(await claimStep(db)).toBeNull(); // claimed
    await db.query(`update reels set music_path='${reel}/music-v1.flac', claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db)).toMatchObject({ step: "image", reel: { status: "imaging" }, scene: { position: 1 } });
    await db.query(`update reel_scenes set status='done', claimed_at=null where reel_id=$1`, [reel]);
    await release(db, reel);
    expect(await claimStep(db)).toMatchObject({ step: "render" });
  });

  it("a failed music step ('' sentinel) is not retried: images and render go on, voice only", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]', music_path='' where id=$1`, [reel]);
    expect(await claimStep(db)).toMatchObject({ step: "image" });
    await db.query(`update reel_scenes set status='done', claimed_at=null where reel_id=$1`, [reel]);
    await release(db, reel);
    expect(await claimStep(db)).toMatchObject({ step: "render" });
  });

  it("a worker without music (p_music false or omitted, e.g. the 005 worker) never gets or waits for a music step", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    const old = await one<{ r: Step }>(db, `select claim_next_reel_step(false) r`);
    expect(old.r).toMatchObject({ step: "image" });
    await db.query(`update reel_scenes set status='done', claimed_at=null where reel_id=$1`, [reel]);
    await release(db, reel);
    expect(await claimStep(db, true, false)).toMatchObject({ step: "render" }); // no waiting for music
    await release(db, reel);
    expect((await one<{ r: Step }>(db, `select claim_next_reel_step() r`)).r).toMatchObject({ step: "render" });
    expect(await one(db, `select music_path from reels where id=$1`, [reel])).toEqual({ music_path: null });
  });

  it("music off: no music step", async () => {
    const db = await migratedDb();
    await db.query(`update settings set reel_music=false`);
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    expect(await claimStep(db)).toMatchObject({ step: "image" });
  });

  it("with ComfyUI closed the music step waits (no render without the bed); timing still runs", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v' where id=$1`, [reel]);
    expect(await claimStep(db, true)).toMatchObject({ step: "timing" });
    await db.query(`update reels set words='[]', claimed_at=null where id=$1`, [reel]);
    await db.query(`update reel_scenes set status='done' where reel_id=$1`, [reel]); // e.g. music switched on after the images
    expect(await claimStep(db, true)).toBeNull();
    expect(await claimStep(db, false)).toMatchObject({ step: "music" });
    await db.query(`update reels set music_path='m.flac', claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db, true)).toMatchObject({ step: "render" });
  });

  it("no music step for an already rendered reel or a reel not yet timed", async () => {
    const db = await migratedDb();
    const rendered = await addReel(db, 1, { created: "2026-10-01" });
    await db.query(`update reels set voice_path='v', words='[]', preview_path='p.mp4' where id=$1`, [rendered]);
    await db.query(`update reel_scenes set status='done' where reel_id=$1`, [rendered]);
    expect(await claimStep(db)).toBeNull();
  });

  it("cards still go first", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    const card = await queueCard(db);
    expect(await claimStep(db)).toBeNull();
    await db.query(`update cards set status='done' where id=$1`, [card]);
    expect(await claimStep(db)).toMatchObject({ step: "music" });
  });
});

describe("claim_next_voice_sample", () => {
  it("claims the oldest queued voice with a ref clip (or the built-in voice): making + claimed_at", async () => {
    const db = await migratedDb();
    expect(await claimSample(db)).toBeNull(); // nothing queued
    await queueSample(db, "kore", null); // queued but no ref clip yet: not claimable
    expect(await claimSample(db)).toBeNull();
    await queueSample(db, "puck");
    await queueSample(db, "builtin", null);
    // oldest = queued first (updated_at); the touch trigger would re-stamp a manual time
    await db.exec(`alter table reel_voices disable trigger touch;
      update reel_voices set updated_at = now() - interval '1 hour' where id='puck';
      alter table reel_voices enable trigger touch;`);
    const a = await claimSample(db);
    expect(a).toMatchObject({ voice: { id: "puck", sample_status: "making", label: "Puck", ref_path: "voices/puck/ref.wav", version: 1 } });
    expect(a!.voice.claimed_at).not.toBeNull();
    expect(await claimSample(db)).toMatchObject({ voice: { id: "builtin", sample_status: "making" } });
    expect(await claimSample(db)).toBeNull();
    expect(await one(db, `select sample_status from reel_voices where id='kore'`)).toEqual({ sample_status: "queued" });
  });

  it("order: cards > reel steps (incl. music) > samples", async () => {
    const db = await migratedDb();
    await queueSample(db, "gacrux");
    const card = await queueCard(db);
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    expect(await claimSample(db)).toBeNull(); // a card is waiting
    await db.query(`update cards set status='done' where id=$1`, [card]);
    expect(await claimSample(db)).toBeNull(); // the reel's music step can run
    expect(await claimStep(db)).toMatchObject({ step: "music" });
    expect(await claimSample(db)).toBeNull(); // the reel step is being worked on
    await db.query(`update reels set music_path='m', claimed_at=null where id=$1`, [reel]);
    expect(await claimSample(db)).toBeNull(); // the image can run
    await db.query(`update reel_scenes set status='done' where reel_id=$1`, [reel]);
    expect(await claimSample(db)).toBeNull(); // the render can run
    await db.query(`update reels set preview_path='p', status='ready' where id=$1`, [reel]);
    expect(await claimSample(db)).toMatchObject({ voice: { id: "gacrux" } });
  });

  it("a reel that cannot move on (all scenes pending, image failed 3 times) does not block samples", async () => {
    const db = await migratedDb();
    await queueSample(db, "gacrux");
    const pending = await addReel(db, 1);
    const broken = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]', music_path=''`);
    await db.query(`update reel_scenes set status='pending' where reel_id=$1`, [pending]);
    await db.query(`update reel_scenes set status='failed', attempts=3 where reel_id=$1`, [broken]);
    expect(await claimStep(db)).toBeNull();
    expect(await claimSample(db)).toMatchObject({ voice: { id: "gacrux" } });
  });

  it("a stale card or reel claim does not block samples", async () => {
    const db = await migratedDb();
    await queueSample(db, "gacrux");
    const card = await queueCard(db);
    await db.query(`update cards set status='generating', claimed_at=now() - interval '6 minutes' where id=$1`, [card]);
    const reel = await addReel(db, 1);
    await db.query(`update reels set status='imaging', claimed_at=now() - interval '11 minutes' where id=$1`, [reel]);
    expect(await claimSample(db)).toMatchObject({ voice: { id: "gacrux" } });
  });

  it("requeue_stuck_reels puts sample claims older than 10 minutes back in the queue, keeps fresh ones", async () => {
    const db = await migratedDb();
    await queueSample(db, "gacrux");
    await queueSample(db, "kore");
    await claimSample(db);
    await claimSample(db);
    expect(await requeue(db)).toBe(0);
    await db.query(`update reel_voices set claimed_at=now() - interval '11 minutes' where id='gacrux'`);
    expect(await requeue(db)).toBe(1);
    expect(await one(db, `select sample_status, claimed_at from reel_voices where id='gacrux'`)).toEqual({ sample_status: "queued", claimed_at: null });
    expect(await one(db, `select sample_status from reel_voices where id='kore'`)).toEqual({ sample_status: "making" });
    expect(await claimSample(db)).toMatchObject({ voice: { id: "gacrux" } });
  });
});

// schema.sql also holds 007 (new columns, requeue_stuck_reels) and 008 (columns): compare with them applied too.
describe("fresh schema.sql matches v1 + 002..006 (+ 007, 008)", () => {
  const TABLES = "('settings','reels','reel_scenes','reel_voices','cards','posts')";
  const FUNCS = "('create_post','claim_next_card','requeue_stuck_cards','claim_next_reel_step','requeue_stuck_reels','reel_next_step','claim_next_voice_sample')";
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
    voices: (await db.query(`select id, label, tone, gender, sample_status, version from reel_voices order by id`)).rows,
  });

  it("has the same columns, constraints, indexes, triggers, function bodies and voice rows", async () => {
    const migrated = await migratedDb();
    await migrated.exec(m007);
    await migrated.exec(m008);
    await migrated.exec(m009);
    await migrated.exec(m010);
    await migrated.exec(m011);
    await migrated.exec(m012);
    const want = await shape(migrated);
    expect(want.functions).toHaveLength(7);
    expect(want.voices).toHaveLength(31);
    expect(want.triggers.filter((t) => (t as { t: string }).t === "reel_voices")).toHaveLength(1);
    expect(await shape(await freshDb())).toEqual(want);
  });
});

describe("006 Supabase-only block", () => {
  const security = (sql: string) => sql.match(/-- @supabase-only begin([\s\S]*?)-- -+ storage/)![1];

  it("applies twice: owner RLS on reel_voices, functions for the service role only", async () => {
    const db = await migratedDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(security(m006raw));
    await db.exec(security(m006raw));
    const can = async (role: string, fn: string) =>
      (await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, fn])).ok;
    for (const fn of ["public.claim_next_reel_step(boolean, boolean)", "public.requeue_stuck_reels()", "public.claim_next_voice_sample()",
      "public.reel_next_step(public.reels, boolean, boolean)"]) {
      expect(await can("service_role", fn), fn).toBe(true);
      expect(await can("authenticated", fn), fn).toBe(false);
      expect(await can("anon", fn), fn).toBe(false);
    }
    expect(await one(db, `select has_table_privilege('authenticated','public.reel_voices','update') a,
      has_table_privilege('service_role','public.reel_voices','update') s, has_table_privilege('anon','public.reel_voices','select') x`))
      .toEqual({ a: true, s: true, x: false });
    expect(await one(db, `select relrowsecurity from pg_class where relname='reel_voices'`)).toEqual({ relrowsecurity: true });
    expect((await db.query(`select policyname from pg_policies where tablename='reel_voices'`)).rows).toEqual([{ policyname: "owner_all" }]);
  });

  it("lets the owner upload reference clips, adds realtime (same as schema.sql)", () => {
    const schema = read("supabase", "schema.sql");
    for (const sql of [m006raw, schema]) {
      expect(sql).toMatch(/create policy reels_voice_refs_insert on storage\.objects for insert to authenticated\s+with check \(bucket_id = 'reels' and name ~ '\^voices\/\[a-z\]\+\/ref\\\.wav\$'\);/);
      expect(sql).toMatch(/alter table public\.reel_voices replica identity full;/);
      expect(sql).toMatch(/grant execute on function public\.claim_next_voice_sample\(\) to service_role;/);
      expect(sql).toMatch(/grant execute on function public\.reel_next_step\(public\.reels, boolean, boolean\) to service_role;/);
      expect(sql).toMatch(/grant execute on function public\.claim_next_reel_step\(boolean, boolean\) to service_role;/);
      expect(sql).not.toMatch(/function public\.claim_next_reel_step\(boolean\) to/);
    }
    expect(m006raw).toMatch(/alter publication supabase_realtime add table public\.reel_voices/);
    expect(schema).toMatch(/array\[[^\]]*'reel_voices'[^\]]*\][\s\S]*supabase_realtime/);
  });
});
