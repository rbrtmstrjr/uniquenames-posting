import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..019. 020 adds claim_next_job: the PC worker's whole poll (requeue stuck claims, then
// a card, a reel step, a voice sample or a theme preview) in ONE request instead of up to six, because every request is
// a line in the Supabase project's logs (the Free plan's 1 GB log quota). It must hand out exactly what the old
// one-by-one sequence (worker 2.7.2, jobs.Runner.tick) handed out, in the same order, with the same side effects.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql", "019_shop.sql",
];
const earlier = ALL.map((m) => stripSupabase(read("supabase", "migrations", m)));
const m020raw = read("supabase", "migrations", "020_one_claim.sql");
const m020 = stripSupabase(m020raw);
const SIG = "public.claim_next_job(boolean, boolean, boolean)";

async function liveDb(upTo = ALL.length) {
  const db = new PGlite();
  for (const sql of [v1, ...earlier.slice(0, upTo)]) await db.exec(sql);
  return db;
}

type Json = Record<string, unknown>;
type Job = { kind: "card" | "reel_step" | "voice_sample" | "theme_preview"; job: Json } | null;
const claim = async (db: PGlite, comfy = true, o: { music?: boolean; requeue?: boolean } = {}) =>
  (await one<{ r: Job }>(db, `select claim_next_job($1, $2, $3) r`, [comfy, o.music ?? true, o.requeue ?? true])).r;
const kinds = async (db: PGlite, n: number, comfy = true) => {
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const j = await claim(db, comfy);
    out.push(j ? (j.kind === "reel_step" ? `reel_step:${(j.job as { step: string }).step}` : j.kind) : null);
    if (j) await complete(db, j);
  }
  return out;
};

// ------------------------------------------------------------------ world builders
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
async function theme(db: PGlite) {
  return (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,'boy','b','o','p','l','c') returning id`, [`T ${uid()}`])).id;
}
async function card(db: PGlite, o: { status?: string; claimedAgo?: string | null; attempts?: number; queuedAgo?: string } = {}) {
  const id = uid();
  await db.query(`insert into cards (id, theme_id, kind, name, meaning, shot, prompt, seed, status, claimed_at, attempts, queued_at)
    values ($1, $2, 'preview', 'P', 'm', 's', 'p', 1, $3, now() - $4::interval, $5, now() - $6::interval)`,
  [id, await theme(db), o.status ?? "queued", o.claimedAgo ?? null, o.attempts ?? 0, o.queuedAgo ?? "0 seconds"]);
  return id;
}
async function reel(db: PGlite, o: { scenes?: string[]; voice?: string | null; words?: boolean; music?: string | null; status?: string; claimedAgo?: string | null; createdAgo?: string } = {}) {
  const id = uid();
  await db.query(`insert into reels (id, title, doll_cast, status, voice_path, words, music_path, claimed_at, created_at)
    values ($1::uuid, 'Reel ' || $1::text, '{}', $2, $3, case when $4 then '[]'::jsonb end, $5, now() - $6::interval, now() - $7::interval)`,
  [id, o.status ?? "queued", o.voice ?? null, o.words ?? false, o.music ?? null, o.claimedAgo ?? null, o.createdAgo ?? "0 seconds"]);
  for (const [i, s] of (o.scenes ?? ["queued"]).entries()) {
    const [status, attempts] = s.split(":");
    await db.query(`insert into reel_scenes (id, reel_id, position, narration, image_prompt, seed, status, attempts) values ($1,$2,$3::int,'n','p',$3::bigint,$4,$5)`,
      [uid(), id, i + 1, status, Number(attempts ?? 0)]);
  }
  return id;
}
const queueSample = (db: PGlite, id: string, ref: string | null = `voices/${id}/ref.wav`) =>
  db.query(`update reel_voices set sample_status='queued', ref_path=$2 where id=$1`, [id, ref]);
const queuePreview = (db: PGlite, id: string) => db.query(`update reel_themes set preview_status='queued' where id=$1`, [id]);

/** What the worker does with a claimed job, reduced to its database result (applied the same way in both runs). */
async function complete(db: PGlite, j: NonNullable<Job>) {
  const job = j.job as Json & { card?: Json; reel?: Json; scene?: Json | null; step?: string; voice?: Json; theme?: Json };
  if (j.kind === "card") {
    await db.query(`update cards set status='done', claimed_at=null, finished_at=now() where id=$1`, [job.card!.id]);
  } else if (j.kind === "reel_step") {
    const set: Record<string, string> = {
      voice: "voice_path='v'", timing: "words='[]'", music: "music_path='m.flac'", image: "status='imaging'",
      render: "preview_path='p.mp4', status='ready'",
    };
    if (job.step === "image") await db.query(`update reel_scenes set status='done', claimed_at=null where id=$1`, [job.scene!.id]);
    await db.query(`update reels set ${set[job.step!]}, claimed_at=null where id=$1`, [job.reel!.id]);
  } else if (j.kind === "voice_sample") {
    await db.query(`update reel_voices set sample_status='ready', claimed_at=null where id=$1`, [job.voice!.id]);
  } else {
    await db.query(`update reel_themes set preview_status='ready', claimed_at=null where id=$1`, [job.theme!.id]);
  }
}

/** The 2.7.2 worker's poll, one function at a time (jobs.Runner.tick / _reel_tick / _sample_tick / _preview_tick). */
async function oldPoll(db: PGlite, comfy: boolean, music: boolean, requeue: boolean): Promise<Job> {
  const rpc = async (sql: string, params: unknown[] = []) => (await one<{ r: Json | null }>(db, `select ${sql} r`, params)).r;
  if (requeue) await db.query(`select requeue_stuck_cards()`);
  const c = await rpc(`claim_next_card($1)`, [!comfy]);
  if (c) return { kind: "card", job: c };
  if (requeue) await db.query(`select requeue_stuck_reels()`);
  const step = await rpc(`claim_next_reel_step($1, $2)`, [!comfy, music]);
  if (step) return { kind: "reel_step", job: step };
  if (!comfy) return null;
  const sample = await rpc(`claim_next_voice_sample()`);
  if (sample && sample.voice) return { kind: "voice_sample", job: sample };
  const preview = await rpc(`claim_next_theme_preview()`);
  if (preview && preview.theme) return { kind: "theme_preview", job: preview };
  return null;
}

const snapshot = async (db: PGlite) => ({
  cards: (await db.query(`select * from cards order by id`)).rows,
  reels: (await db.query(`select * from reels order by id`)).rows,
  scenes: (await db.query(`select * from reel_scenes order by id`)).rows,
  voices: (await db.query(`select * from reel_voices order by id`)).rows,
  themes: (await db.query(`select * from reel_themes order by id`)).rows,
});

// ------------------------------------------------------------------ the migration
describe("020_one_claim.sql on the live schema (v1 + 002..019)", () => {
  it("runs twice, has one signature and leaves every other function as it was", async () => {
    const db = await liveDb();
    const defs = async () => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname <> 'claim_next_job' order by 1, 2`)).rows;
    const before = await defs();
    await db.exec(m020);
    await db.exec(m020);
    expect(await defs()).toEqual(before);
    const sigs = await db.query<{ s: string }>(`select p.oid::regprocedure::text s from pg_proc p where p.proname = 'claim_next_job'`);
    expect(sigs.rows).toEqual([{ s: "claim_next_job(boolean,boolean,boolean)" }]);
    expect(await claim(db)).toBeNull();
  });

  it("stops with a clear message on a database without 006 / 007 (the worker then keeps its old calls)", async () => {
    const db = await liveDb(ALL.indexOf("005_reels.sql") + 1);
    await expect(db.exec(m020)).rejects.toThrow(/020_one_claim\.sql needs 006_reel_voices\.sql and 007_reel_themes\.sql first/);
    expect((await db.query(`select 1 from pg_proc where proname = 'claim_next_job'`)).rows).toEqual([]);
  });

  it("fresh schema.sql has the same claim_next_job", async () => {
    const def = async (db: PGlite) => (await one<{ d: string }>(db, `select pg_get_functiondef('${SIG}'::regprocedure) d`)).d.replace(/\r\n/g, "\n");
    const migrated = await liveDb();
    await migrated.exec(m020);
    expect(await def(await freshDb())).toBe(await def(migrated));
  });

  it("is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m020);
    await card(db);
    expect(await claim(db)).toMatchObject({ kind: "card", job: { job: "generate" } });
  });
});

describe("020 Supabase-only block", () => {
  it("applies twice and grants claim_next_job to the service role only (same as schema.sql)", async () => {
    const db = await liveDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(m020raw);
    await db.exec(m020raw);
    const can = async (role: string) => (await one<{ ok: boolean }>(db, `select has_function_privilege($1, '${SIG}', 'execute') ok`, [role])).ok;
    expect(await can("service_role")).toBe(true);
    expect(await can("authenticated")).toBe(false);
    expect(await can("anon")).toBe(false);
    const schema = read("supabase", "schema.sql");
    for (const sql of [m020raw, schema]) {
      expect(sql).toMatch(/revoke execute on function public\.claim_next_job\(boolean, boolean, boolean\) from public, anon, authenticated;/);
      expect(sql).toMatch(/grant execute on function public\.claim_next_job\(boolean, boolean, boolean\) to service_role;/);
    }
  });
});

// ------------------------------------------------------------------ the order
describe("claim_next_job: the same order as the old one-by-one calls", () => {
  it("answers null when there is nothing to do", async () => {
    const db = await freshDb();
    expect(await claim(db)).toBeNull();
    expect(await claim(db, false)).toBeNull();
  });

  it("wraps each kind's own answer: {kind, job}", async () => {
    const db = await freshDb();
    const c = await card(db);
    const got = await claim(db);
    expect(got).toMatchObject({ kind: "card", job: { job: "generate", card: { id: c, status: "generating", attempts: 1 }, fonts: null } });
    expect(Object.keys(got!).sort()).toEqual(["job", "kind"]);
  });

  it("cards first (restamps before new photos), then reel steps, voice samples, theme previews", async () => {
    const db = await freshDb();
    await queuePreview(db, "clay");
    await queueSample(db, "gacrux");
    await reel(db, { scenes: ["queued"] });
    await card(db, { queuedAgo: "2 minutes" });
    await card(db, { status: "restamp" });
    expect(await kinds(db, 9)).toEqual([
      "card", "card", "reel_step:voice", "reel_step:timing", "reel_step:music", "reel_step:image", "reel_step:render",
      "voice_sample", "theme_preview",
    ]);
    expect(await claim(db)).toBeNull();
  });

  it("restamp first, then the oldest queued card", async () => {
    const db = await freshDb();
    const old = await card(db, { queuedAgo: "3 minutes" });
    const young = await card(db, { queuedAgo: "1 minute" });
    const restamp = await card(db, { status: "restamp" });
    const ids: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const j = (await claim(db))!;
      ids.push((j.job.card as Json).id);
      await complete(db, j);
    }
    expect(ids).toEqual([restamp, old, young]);
  });

  it("with ComfyUI closed: restamps only, then the reel steps that don't need it; no voice samples or previews", async () => {
    const db = await freshDb();
    await queuePreview(db, "clay");
    await queueSample(db, "gacrux");
    const queued = await card(db);
    await card(db, { status: "restamp" });
    expect(await claim(db, false)).toMatchObject({ kind: "card", job: { job: "restamp" } });
    expect(await claim(db, false)).toBeNull();     // the queued card waits (and holds back every reel step)
    expect(await one(db, `select status, claimed_at from cards where id=$1`, [queued])).toEqual({ status: "queued", claimed_at: null });
    await db.query(`update cards set status='done'`);
    const r = await reel(db, { voice: "v", scenes: ["done"] });
    expect(await claim(db, false)).toMatchObject({ kind: "reel_step", job: { step: "timing" } });
    await db.query(`update reels set words='[]', claimed_at=null where id=$1`, [r]);
    expect(await claim(db, false)).toBeNull();     // the music bed waits for ComfyUI (no render without it)
    expect(await claim(db, false, { music: false })).toMatchObject({ kind: "reel_step", job: { step: "render" } });
    await db.query(`update reels set preview_path='p', status='ready', claimed_at=null where id=$1`, [r]);
    expect(await claim(db, false)).toBeNull();     // samples and previews need ComfyUI
    expect(await claim(db, true)).toMatchObject({ kind: "voice_sample", job: { voice: { id: "gacrux" } } });
  });

  it("p_music: true gets the music step after timing; false (an older worker) goes straight to the images", async () => {
    const db = await freshDb();
    const r = await reel(db, { voice: "v", words: true });
    expect(await claim(db, true, { music: false })).toMatchObject({ kind: "reel_step", job: { step: "image" } });
    await db.query(`update reels set claimed_at=null where id=$1`, [r]);
    await db.query(`update reel_scenes set status='queued', claimed_at=null where reel_id=$1`, [r]);
    expect(await claim(db, true, { music: true })).toMatchObject({ kind: "reel_step", job: { step: "music", scene: null } });
  });

  it("p_requeue releases stuck claims first (cards after 5 minutes, reels / samples / previews after 10)", async () => {
    const db = await freshDb();
    const stuck = await card(db, { status: "generating", claimedAgo: "6 minutes", attempts: 1 });
    expect(await claim(db, true, { requeue: false })).toBeNull();
    expect(await one(db, `select status from cards where id=$1`, [stuck])).toEqual({ status: "generating" });
    expect(await claim(db, true, { requeue: true })).toMatchObject({ kind: "card", job: { card: { id: stuck, attempts: 2 } } });
    await db.query(`update cards set status='done', claimed_at=null`);

    const r = await reel(db, { voice: "v", words: true, music: "m", status: "imaging", claimedAgo: "11 minutes", scenes: ["generating:1"] });
    await db.query(`update reel_scenes set claimed_at = now() - interval '11 minutes' where reel_id=$1`, [r]);
    await db.query(`update reel_voices set sample_status='making', ref_path='x', claimed_at = now() - interval '11 minutes' where id='kore'`);
    await db.query(`update reel_themes set preview_status='making', claimed_at = now() - interval '11 minutes' where id='clay'`);
    expect(await claim(db, true, { requeue: false })).toBeNull();
    expect(await kinds(db, 4)).toEqual(["reel_step:image", "reel_step:render", "voice_sample", "theme_preview"]);
  });

  it("a card found on a requeue poll skips the reel requeue, exactly like the old worker", async () => {
    const db = await freshDb();
    await card(db);
    await db.query(`update reel_voices set sample_status='making', ref_path='x', claimed_at = now() - interval '11 minutes' where id='kore'`);
    expect(await claim(db)).toMatchObject({ kind: "card" });
    expect(await one(db, `select sample_status from reel_voices where id='kore'`)).toEqual({ sample_status: "making" });
  });

  it("nothing for reels while a card is being made; a stale card claim does not block", async () => {
    const db = await freshDb();
    await reel(db);
    const c = await card(db, { status: "generating", claimedAgo: "1 minute", attempts: 1 });
    expect(await claim(db, true, { requeue: false })).toBeNull();
    await db.query(`update cards set claimed_at = now() - interval '6 minutes' where id=$1`, [c]);
    expect(await claim(db, true, { requeue: false })).toMatchObject({ kind: "reel_step", job: { step: "voice" } });
  });
});

// ------------------------------------------------------------------ parity with the old calls
// Random worlds (seeded), each polled 24 times with the same random ComfyUI / music / requeue flags: once with the old
// one-by-one calls, once with claim_next_job, from the same starting point inside ONE transaction (so now() and every
// id are identical). The answers and every row they touched must be equal.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

async function randomWorld(db: PGlite, r: () => number) {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  await db.query(`update settings set reel_music=$1`, [r() < 0.7]);
  for (let i = Math.floor(r() * 4); i > 0; i--) {
    const kind = pick(["queued", "restamp", "fresh", "stale", "staleRestamp", "done", "failed"] as const);
    await card(db, {
      status: { queued: "queued", restamp: "restamp", fresh: "generating", stale: "generating", staleRestamp: "restamp", done: "done", failed: "failed" }[kind],
      claimedAgo: kind === "fresh" ? "1 minute" : kind === "stale" || kind === "staleRestamp" ? "6 minutes" : null,
      attempts: kind === "stale" ? pick([1, 2, 3]) : 0, queuedAgo: `${Math.floor(r() * 600)} seconds`,
    });
  }
  for (let i = Math.floor(r() * 4); i > 0; i--) {
    const stage = Math.floor(r() * 5); // 0 no voice, 1 voice, 2 timed, 3 music made / failed, 4 rendered
    const scenes = Array.from({ length: Math.floor(r() * 4) }, () => pick(["queued", "pending", "done", "skipped", "failed:1", "failed:3", "generating:1"]));
    const id = await reel(db, {
      scenes, voice: stage >= 1 ? "v" : null, words: stage >= 2, music: stage >= 3 ? pick(["m.flac", ""]) : null,
      status: pick(["queued", "voicing", "imaging", "rendering", "ready", "needs_attention", "script"]),
      claimedAgo: pick([null, null, null, "1 minute", "11 minutes"]), createdAgo: `${Math.floor(r() * 9999)} seconds`,
    });
    if (stage === 4) await db.query(`update reels set preview_path='p.mp4' where id=$1`, [id]);
  }
  await db.query(`update reel_scenes set claimed_at = now() - $1::interval where status='generating'`, [pick(["1 minute", "11 minutes"])]);
  const voices = (await db.query<{ id: string }>(`select id from reel_voices order by id`)).rows.map((v) => v.id);
  for (let i = Math.floor(r() * 4); i > 0; i--) {
    const v = pick(voices);
    const how = pick(["queued", "noRef", "making", "staleMaking"] as const);
    if (how === "noRef") await queueSample(db, v, null);
    else if (how === "queued") await queueSample(db, v);
    else await db.query(`update reel_voices set sample_status='making', ref_path='x', claimed_at = now() - $2::interval where id=$1`,
      [v, how === "making" ? "1 minute" : "11 minutes"]);
  }
  const themes = (await db.query<{ id: string }>(`select id from reel_themes order by id`)).rows.map((t) => t.id);
  for (let i = Math.floor(r() * 4); i > 0; i--) {
    const t = pick(themes);
    const how = pick(["queued", "making", "staleMaking"] as const);
    if (how === "queued") await queuePreview(db, t);
    else await db.query(`update reel_themes set preview_status='making', claimed_at = now() - $2::interval where id=$1`,
      [t, how === "making" ? "1 minute" : "11 minutes"]);
  }
}

describe("claim_next_job parity with the old sequence (random worlds)", () => {
  it("hands out the same jobs in the same order with the same side effects", async () => {
    const db = await freshDb();
    let jobs = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      await db.exec("begin");
      await randomWorld(db, r);
      const polls = Array.from({ length: 24 }, () => ({ comfy: r() < 0.75, music: r() < 0.85, requeue: r() < 0.5 }));
      await db.exec("savepoint world");
      const run = async (poll: (p: (typeof polls)[number]) => Promise<Job>) => {
        const out: Job[] = [];
        for (const p of polls) {
          const j = await poll(p);
          out.push(j);
          if (j) await complete(db, j);
        }
        return { out, rows: await snapshot(db) };
      };
      const before = await run((p) => oldPoll(db, p.comfy, p.music, p.requeue));
      await db.exec("rollback to savepoint world");
      const after = await run((p) => claim(db, p.comfy, { music: p.music, requeue: p.requeue }));
      await db.exec("rollback");
      expect(after.out, `seed ${seed}`).toEqual(before.out);
      expect(after.rows, `seed ${seed}`).toEqual(before.rows);
      for (const j of before.out) if (j) { jobs++; seen.add(j.kind === "reel_step" ? `reel_step:${(j.job as { step: string }).step}` : j.kind); }
    }
    // the worlds really exercised every kind of job
    expect(jobs).toBeGreaterThan(150);
    expect([...seen].sort()).toEqual(["card", "reel_step:image", "reel_step:music", "reel_step:render", "reel_step:timing",
      "reel_step:voice", "theme_preview", "voice_sample"]);
  }, 120_000);
});
