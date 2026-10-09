import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002 + 003 + 004. 005 adds reels (tables, settings, claim + requeue).
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const m002 = read("supabase", "migrations", "002_v2.sql");
const m003 = read("supabase", "migrations", "003_post_fonts.sql");
const m004 = read("supabase", "migrations", "004_subject_age.sql");
const m005raw = read("supabase", "migrations", "005_reels.sql");
const m005 = stripSupabase(m005raw);
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
  await db.exec(m003);
  await db.exec(m004);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m005);
  return db;
}

type Json = Record<string, unknown>;
type Step = { step: "voice" | "timing" | "image" | "render"; reel: Json & { id: string; status: string }; scene: (Json & { id: string; position: number; status: string; attempts: number }) | null } | null;
const claimStep = async (db: PGlite, noComfy?: boolean) =>
  (await one<{ r: Step }>(db, noComfy === undefined ? `select claim_next_reel_step() r` : `select claim_next_reel_step($1) r`,
    noComfy === undefined ? [] : [noComfy])).r;
const release = (db: PGlite, reel: string) => db.query(`update reels set claimed_at=null where id=$1`, [reel]);

async function addReel(db: PGlite, scenes = 3, extra: { status?: string; created?: string } = {}) {
  const reel = (await one<{ id: string }>(db,
    `insert into reels (title, doll_cast, status, created_at) values ($1, '{"adult":"a","child":"c"}', $2, coalesce($3::timestamptz, now())) returning id`,
    [`Reel ${crypto.randomUUID()}`, extra.status ?? "queued", extra.created ?? null])).id;
  for (let i = 1; i <= scenes; i++) {
    await db.query(`insert into reel_scenes (reel_id, position, beat, narration, image_prompt, seed, status) values ($1,$2::int,'b','n','p',$2::int,'queued')`, [reel, i]);
  }
  return reel;
}
async function queueCard(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,'boy','b','o','p','l','c') returning id`, [`T ${crypto.randomUUID()}`])).id;
  return (await one<{ id: string }>(db, `insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','P','m','s','p',1) returning id`, [theme])).id;
}

describe("005_reels.sql on the live schema (v1 + 002 + 003 + 004)", () => {
  it("runs twice and keeps settings and cards", async () => {
    const db = await liveDb();
    await db.query(`update settings set max_images=12`);
    const card = await queueCard(db);
    await db.exec(m005);
    await db.exec(m005);
    expect(await one(db, `select max_images, reel_max_images, reel_voice_path from settings`)).toEqual({ max_images: 12, reel_max_images: 40, reel_voice_path: null });
    expect(await one(db, `select status from cards where id=$1`, [card])).toEqual({ status: "queued" });
    expect(await one(db, `select count(*)::int n from reels`)).toEqual({ n: 0 });
  });

  it("checks reel_max_images (10..40) and the reel / scene statuses", async () => {
    const db = await migratedDb();
    await expect(db.query(`update settings set reel_max_images=9`)).rejects.toThrow(/check/i);
    await expect(db.query(`update settings set reel_max_images=41`)).rejects.toThrow(/check/i);
    await db.query(`update settings set reel_max_images=10`);
    const reel = await addReel(db, 1);
    await expect(db.query(`update reels set status='done' where id=$1`, [reel])).rejects.toThrow(/check/i);
    await expect(db.query(`update reel_scenes set status='ready' where reel_id=$1`, [reel])).rejects.toThrow(/check/i);
    await expect(db.query(`insert into reel_scenes (reel_id, position, narration, image_prompt, seed) values ($1, 1, 'n', 'p', 1)`, [reel])).rejects.toThrow(/unique|duplicate/i);
  });

  it("new reels default to script / pending, version 1; deleting a reel deletes its scenes", async () => {
    const db = await migratedDb();
    const r = await one<{ id: string; status: string; version: number }>(db, `insert into reels (title, doll_cast) values ('T', '{}') returning id, status, version`);
    expect(r).toMatchObject({ status: "script", version: 1 });
    const s = await one<{ status: string; attempts: number; version: number }>(db,
      `insert into reel_scenes (reel_id, position, narration, image_prompt, seed) values ($1, 1, 'n', 'p', 1) returning status, attempts, version`, [r.id]);
    expect(s).toEqual({ status: "pending", attempts: 0, version: 1 });
    await db.query(`delete from reels where id=$1`, [r.id]);
    expect(await one(db, `select count(*)::int n from reel_scenes`)).toEqual({ n: 0 });
  });
});

describe("claim_next_reel_step", () => {
  it("returns null while a card is queued, generating (fresh) or restamp; a stale claimed card does not block", async () => {
    const db = await migratedDb();
    await addReel(db);
    const card = await queueCard(db);
    expect(await claimStep(db)).toBeNull();
    await db.query(`update cards set status='generating', claimed_at=now() where id=$1`, [card]);
    expect(await claimStep(db)).toBeNull();
    await db.query(`update cards set status='restamp', claimed_at=null where id=$1`, [card]);
    expect(await claimStep(db)).toBeNull();
    await db.query(`update cards set status='generating', claimed_at=now() - interval '6 minutes' where id=$1`, [card]);
    expect((await claimStep(db))?.step).toBe("voice");
  });

  it("with ComfyUI closed (p_no_comfy) hands out only timing and render", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 2);
    expect(await claimStep(db, true)).toBeNull(); // voice needs ComfyUI
    await db.query(`update reels set voice_path='v.wav' where id=$1`, [reel]);
    expect(await claimStep(db, true)).toMatchObject({ step: "timing" });
    await db.query(`update reels set words='[]', claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db, true)).toBeNull(); // images need ComfyUI
    expect(await one(db, `select count(*)::int n from reel_scenes where reel_id=$1 and status='queued' and attempts=0`, [reel])).toEqual({ n: 2 });
    await db.query(`update reel_scenes set status='done' where reel_id=$1`, [reel]);
    await release(db, reel);
    expect(await claimStep(db, true)).toMatchObject({ step: "render" });
    await db.query(`update reels set preview_path=null, claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db, false)).toMatchObject({ step: "render" });
  });

  it("has exactly one signature after running 005 twice (the zero-argument draft is dropped)", async () => {
    const db = await liveDb();
    await db.exec(`create function public.claim_next_reel_step() returns jsonb language sql as $$ select null::jsonb $$`);
    await db.exec(m005);
    await db.exec(m005);
    const sigs = (await db.query<{ s: string }>(`select pg_get_function_identity_arguments(p.oid) s from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='claim_next_reel_step'`)).rows;
    expect(sigs).toEqual([{ s: "p_no_comfy boolean" }]);
  });

  it("done / failed cards do not block", async () => {
    const db = await migratedDb();
    await addReel(db);
    const card = await queueCard(db);
    await db.query(`update cards set status='done' where id=$1`, [card]);
    expect((await claimStep(db))?.step).toBe("voice");
  });

  it("claims voice -> timing -> image (by position) -> render, setting the reel status and claim", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 2);
    // shuffle insertion so position (not id/created order) decides
    await db.query(`update reel_scenes set position = position + 10 where reel_id=$1`, [reel]);
    await db.query(`update reel_scenes set position = 3 where reel_id=$1 and position = 12`, [reel]);
    await db.query(`update reel_scenes set position = 4 where reel_id=$1 and position = 11`, [reel]);

    const voice = await claimStep(db);
    expect(voice).toMatchObject({ step: "voice", scene: null, reel: { id: reel, status: "voicing" } });
    expect(voice!.reel.claimed_at).not.toBeNull();
    expect(voice!.reel.started_at).not.toBeNull();
    expect(voice!.reel).toHaveProperty("doll_cast", { adult: "a", child: "c" });
    expect(await claimStep(db)).toBeNull(); // the reel is claimed: never the same step twice

    await db.query(`update reels set voice_path='reels/x/voice.wav', claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db)).toMatchObject({ step: "timing", scene: null, reel: { status: "voicing" } });

    await db.query(`update reels set words='[]', claimed_at=null where id=$1`, [reel]);
    const img1 = await claimStep(db);
    expect(img1).toMatchObject({ step: "image", reel: { status: "imaging" }, scene: { position: 3, status: "generating", attempts: 1 } });
    expect(img1!.scene!.claimed_at).not.toBeNull();
    expect(await one(db, `select status, attempts from reel_scenes where id=$1`, [img1!.scene!.id])).toEqual({ status: "generating", attempts: 1 });

    await db.query(`update reel_scenes set status='done', claimed_at=null where id=$1`, [img1!.scene!.id]);
    await release(db, reel);
    expect(await claimStep(db)).toMatchObject({ step: "image", scene: { position: 4 } });

    await db.query(`update reel_scenes set status='skipped', claimed_at=null where reel_id=$1 and position=4`, [reel]);
    await release(db, reel);
    expect(await claimStep(db)).toMatchObject({ step: "render", scene: null, reel: { status: "rendering" } });

    await db.query(`update reels set preview_path='reels/x/preview.mp4', claimed_at=null where id=$1`, [reel]);
    expect(await claimStep(db)).toBeNull(); // nothing left (the worker marks it ready)
  });

  it("a failed scene is retried until its 3rd attempt; then it is not claimable", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 2);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const s = await claimStep(db);
      expect(s).toMatchObject({ step: "image", scene: { position: 1, attempts: attempt } });
      await db.query(`update reel_scenes set status='failed', error='boom', claimed_at=null where id=$1`, [s!.scene!.id]);
      await release(db, reel);
    }
    // position 1 failed 3 times: not claimable any more (the worker sets the reel needs_attention on that
    // 3rd failure; here the reel is still queued, so the next scene is still worked on)
    const next = await claimStep(db);
    expect(next).toMatchObject({ step: "image", scene: { position: 2, attempts: 1 } });
    await db.query(`update reel_scenes set status='done', claimed_at=null where id=$1`, [next!.scene!.id]);
    await release(db, reel);
    expect(await claimStep(db)).toBeNull(); // never renders around a broken image
  });

  it("a scene still pending (script not approved) or a reel not in a working status is skipped", async () => {
    const db = await migratedDb();
    const script = await addReel(db, 1, { status: "script", created: "2026-10-01" });
    await db.query(`update reel_scenes set status='pending' where reel_id=$1`, [script]);
    await addReel(db, 1, { status: "ready", created: "2026-10-02" });
    await addReel(db, 1, { status: "needs_attention", created: "2026-10-03" });
    await addReel(db, 1, { status: "failed", created: "2026-10-03" });
    expect(await claimStep(db)).toBeNull();
    const queued = await addReel(db, 1, { created: "2026-10-04" });
    expect(await claimStep(db)).toMatchObject({ step: "voice", reel: { id: queued } });
  });

  it("claims the oldest reel first and moves on to the next when the oldest has nothing to do", async () => {
    const db = await migratedDb();
    const old = await addReel(db, 1, { created: "2026-10-01" });
    const young = await addReel(db, 1, { created: "2026-10-02" });
    expect((await claimStep(db))?.reel.id).toBe(old);
    expect((await claimStep(db))?.reel.id).toBe(young);
    expect(await claimStep(db)).toBeNull();
    // old: its only scene failed 3 times -> stuck for the owner; young still gets work
    await db.query(`update reels set voice_path='v', words='[]', claimed_at=null`);
    await db.query(`update reel_scenes set status='failed', attempts=3 where reel_id=$1`, [old]);
    expect(await claimStep(db)).toMatchObject({ step: "image", reel: { id: young } });
  });

  it("an all-pending reel in a working status yields no step", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 2);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    await db.query(`update reel_scenes set status='pending' where reel_id=$1`, [reel]);
    expect(await claimStep(db)).toBeNull();
  });

  it("render needs at least one done scene: all skipped or no scenes is not claimable", async () => {
    const db = await migratedDb();
    const skipped = await addReel(db, 2, { created: "2026-10-01" });
    const empty = await addReel(db, 0, { created: "2026-10-02" });
    await db.query(`update reels set voice_path='v', words='[]' where id in ($1, $2)`, [skipped, empty]);
    await db.query(`update reel_scenes set status='skipped' where reel_id=$1`, [skipped]);
    expect(await claimStep(db)).toBeNull();
    await db.query(`update reel_scenes set status='done' where reel_id=$1 and position=1`, [skipped]);
    expect(await claimStep(db)).toMatchObject({ step: "render", reel: { id: skipped } });
  });
});

describe("requeue_stuck_reels", () => {
  it("fails an unclaimed timed reel whose images were all skipped (or that has no scenes)", async () => {
    const db = await migratedDb();
    const skipped = await addReel(db, 2);
    const empty = await addReel(db, 0);
    const notTimed = await addReel(db, 0); // before timing: left alone
    await db.query(`update reels set voice_path='v', words='[]' where id in ($1, $2)`, [skipped, empty]);
    await db.query(`update reel_scenes set status='skipped' where reel_id=$1`, [skipped]);
    expect((await one<{ n: number }>(db, `select requeue_stuck_reels() n`)).n).toBe(2);
    for (const id of [skipped, empty]) {
      expect(await one(db, `select status, error from reels where id=$1`, [id])).toEqual({ status: "failed", error: "Every image was skipped." });
    }
    expect(await one(db, `select status, error from reels where id=$1`, [notTimed])).toEqual({ status: "queued", error: null });
  });

  it("flags an unclaimed working reel with a scene failed 3 times as needs_attention", async () => {
    const db = await migratedDb();
    const bad = await addReel(db, 2);
    const fine = await addReel(db, 2);
    await db.query(`update reels set voice_path='v', words='[]', status='imaging'`);
    await db.query(`update reel_scenes set status='failed', attempts=3, error='boom' where reel_id=$1 and position=1`, [bad]);
    await db.query(`update reel_scenes set status='failed', attempts=2 where reel_id=$1 and position=1`, [fine]);
    expect((await one<{ n: number }>(db, `select requeue_stuck_reels() n`)).n).toBe(1);
    expect(await one(db, `select status, error from reels where id=$1`, [bad])).toEqual({ status: "needs_attention", error: "An image failed 3 times." });
    expect(await one(db, `select status, error from reels where id=$1`, [fine])).toEqual({ status: "imaging", error: null });
    // a claimed reel is left to its worker
    await db.query(`update reels set status='imaging', claimed_at=now() where id=$1`, [bad]);
    expect((await one<{ n: number }>(db, `select requeue_stuck_reels() n`)).n).toBe(0);
  });

  it("releases reel and scene claims older than 10 minutes, keeps fresh ones", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 2);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    const s = await claimStep(db);
    expect(await one(db, `select requeue_stuck_reels() n`)).toEqual({ n: 0 });
    await db.query(`update reels set claimed_at=now() - interval '11 minutes' where id=$1`, [reel]);
    await db.query(`update reel_scenes set claimed_at=now() - interval '11 minutes' where id=$1`, [s!.scene!.id]);
    expect((await one<{ n: number }>(db, `select requeue_stuck_reels() n`)).n).toBeGreaterThanOrEqual(1);
    expect(await one(db, `select claimed_at, status from reels where id=$1`, [reel])).toEqual({ claimed_at: null, status: "imaging" });
    expect(await one(db, `select claimed_at, status, attempts from reel_scenes where id=$1`, [s!.scene!.id])).toEqual({ claimed_at: null, status: "queued", attempts: 1 });
    expect(await claimStep(db)).toMatchObject({ step: "image", scene: { id: s!.scene!.id, attempts: 2 } });
  });

  it("a scene stuck on its 3rd attempt fails and the reel needs attention", async () => {
    const db = await migratedDb();
    const reel = await addReel(db, 1);
    await db.query(`update reels set voice_path='v', words='[]' where id=$1`, [reel]);
    await db.query(`update reel_scenes set status='generating', attempts=3, claimed_at=now() - interval '11 minutes' where reel_id=$1`, [reel]);
    await db.query(`update reels set status='imaging', claimed_at=now() - interval '11 minutes' where id=$1`, [reel]);
    await db.query(`select requeue_stuck_reels()`);
    const sc = await one<{ status: string; error: string }>(db, `select status, error from reel_scenes where reel_id=$1`, [reel]);
    expect(sc.status).toBe("failed");
    expect(sc.error).toMatch(/3 tries/);
    const r = await one<{ status: string; error: string; claimed_at: string | null }>(db, `select status, error, claimed_at from reels where id=$1`, [reel]);
    expect(r).toMatchObject({ status: "needs_attention", claimed_at: null });
    expect(r.error).toMatch(/3 tries/);
    expect(await claimStep(db)).toBeNull();
  });
});

// schema.sql also holds 006, 007 and 008 (they change claim_next_reel_step / requeue_stuck_reels / columns): compare with them applied too.
describe("fresh schema.sql matches v1 + 002..005 (+ 006, 007, 008)", () => {
  const TABLES = "('settings','reels','reel_scenes','cards','posts')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
    triggers: (await db.query(`select event_object_table t, trigger_name, event_manipulation e from information_schema.triggers
      where event_object_table in ${TABLES} order by 1, 2, 3`)).rows,
    // Line endings differ by checkout (schema.sql may be CRLF on Windows); the code must not.
    functions: (await db.query<{ proname: string; def: string }>(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ('create_post','claim_next_card','requeue_stuck_cards','claim_next_reel_step','requeue_stuck_reels') order by 1`)).rows
      .map((r) => ({ ...r, def: r.def.replace(/\r\n/g, "\n") })),
  });

  it("has the same columns, constraints, indexes, triggers and function bodies", async () => {
    const migrated = await migratedDb();
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
    expect(want.functions).toHaveLength(5);
    expect(want.triggers.filter((t) => (t as { t: string }).t.startsWith("reel"))).toHaveLength(2);
    expect(await shape(await freshDb())).toEqual(want);
  });

  it("005 is also safe on a fresh schema.sql project (followed by 006, which drops 005's one-argument claim again)", async () => {
    const db = await freshDb();
    await db.exec(m005);
    await db.exec(m006);
    await addReel(db, 1);
    expect((await claimStep(db))?.step).toBe("voice");
  });
});

describe("005 Supabase-only block", () => {
  // The security part runs in PGlite with stand-in roles (storage / realtime only exist on Supabase).
  const security = (sql: string) => sql.match(/-- @supabase-only begin([\s\S]*?)-- -+ storage/)![1];

  it("applies twice and grants the claim functions to the service role only", async () => {
    const db = await migratedDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(security(m005raw));
    await db.exec(security(m005raw));
    const can = async (role: string, fn: string) =>
      (await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, fn])).ok;
    for (const fn of ["public.claim_next_reel_step(boolean)", "public.requeue_stuck_reels()"]) {
      expect(await can("service_role", fn), fn).toBe(true);
      expect(await can("authenticated", fn), fn).toBe(false);
      expect(await can("anon", fn), fn).toBe(false);
    }
    const t = await one(db, `select has_table_privilege('authenticated','public.reels','update') a, has_table_privilege('service_role','public.reel_scenes','update') s,
      has_table_privilege('anon','public.reels','select') x`);
    expect(t).toEqual({ a: true, s: true, x: false });
    const rls = await db.query(`select relname, relrowsecurity from pg_class where relname in ('reels','reel_scenes') order by 1`);
    expect(rls.rows).toEqual([{ relname: "reel_scenes", relrowsecurity: true }, { relname: "reels", relrowsecurity: true }]);
    const pol = await db.query(`select tablename, policyname from pg_policies where tablename in ('reels','reel_scenes') order by 1`);
    expect(pol.rows).toEqual([{ tablename: "reel_scenes", policyname: "owner_all" }, { tablename: "reels", policyname: "owner_all" }]);
  });

  it("creates the private reels bucket, its policies and realtime for both tables (same as schema.sql)", () => {
    const schema = read("supabase", "schema.sql");
    for (const sql of [m005raw, schema]) {
      expect(sql).toMatch(/insert into storage\.buckets \(id, name, public\) values \('reels', 'reels', false\) on conflict \(id\) do nothing;/);
      expect(sql).toMatch(/create policy reels_read on storage\.objects for select to authenticated using \(bucket_id = 'reels'\);/);
      expect(sql).toMatch(/create policy reels_delete on storage\.objects for delete to authenticated using \(bucket_id = 'reels'\);/);
      expect(sql).toMatch(/alter table public\.reels replica identity full;/);
      expect(sql).toMatch(/alter table public\.reel_scenes replica identity full;/);
      expect(sql).toMatch(/grant execute on function public\.requeue_stuck_reels\(\) to service_role;/);
    }
    // schema.sql has 006's two-argument claim (p_no_comfy, p_music)
    expect(m005raw).toMatch(/grant execute on function public\.claim_next_reel_step\(boolean\) to service_role;/);
    expect(schema).toMatch(/grant execute on function public\.claim_next_reel_step\(boolean, boolean\) to service_role;/);
    expect(m005raw).toMatch(/array\['reels', 'reel_scenes'\][\s\S]*supabase_realtime/);
    expect(schema).toMatch(/array\[[^\]]*'reels', 'reel_scenes'[^\]]*\][\s\S]*supabase_realtime/);
  });
});
