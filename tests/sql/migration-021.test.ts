import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// 021 adds the Facebook columns to posts (Post now / Schedule). fb_state is the guard against posting the same album
// twice: the app takes it with ONE conditional update before it talks to Facebook.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql", "019_shop.sql",
  "020_one_claim.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m021 = stripSupabase(read("supabase", "migrations", "021_facebook_posting.sql"));
const COLS = ["fb_post_id", "fb_permalink", "fb_state", "fb_scheduled_for", "fb_attempt_at", "fb_error"];

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...ALL]) await db.exec(sql);
  return db;
}

const columns = async (db: PGlite) => (await db.query<{ column_name: string }>(
  `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'posts'`)).rows.map((r) => r.column_name);

async function aPost(db: PGlite) {
  await db.exec(`insert into public.themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T', 'boy', 'b', 'o', 'p', 'l', 'c')`);
  const t = await one<{ id: string }>(db, `select id from public.themes limit 1`);
  return (await one<{ id: string }>(db, `insert into public.posts (post_date, gender, style, theme_id) values ('2026-11-04', 'boy', 'single', $1) returning id`, [t.id])).id;
}

// The app's lock, as PostgREST runs it: set 'publishing' only when the post has no Facebook post yet.
const lock = async (db: PGlite, id: string, alsoUnsure = false) => (await db.query(
  `update public.posts set fb_state = 'publishing', fb_attempt_at = now(), fb_error = null
   where id = $1 and (fb_state is null or fb_state = 'failed'${alsoUnsure ? " or fb_state = 'unsure'" : ""}) returning id`, [id])).rows.length;

describe("migration 021: Facebook posting columns", () => {
  it("adds the six columns to the live database and is safe to run twice", async () => {
    const db = await liveDb();
    for (const c of COLS) expect(await columns(db)).not.toContain(c);
    await db.exec(m021);
    await db.exec(m021);
    for (const c of COLS) expect(await columns(db)).toContain(c);
  });

  it("schema.sql (a fresh project) has the same columns and rules", async () => {
    const db = await freshDb();
    for (const c of COLS) expect(await columns(db)).toContain(c);
    const id = await aPost(db);
    await expect(db.query(`update public.posts set fb_state = 'posted' where id = $1`, [id])).rejects.toThrow(/posts_fb_state_check/);
    await expect(db.query(`update public.posts set fb_error = repeat('x', 501) where id = $1`, [id])).rejects.toThrow(/posts_fb_error_len/);
  });

  it("only one sender can take a post: the lock works once, again after a failure, and after unsure only on purpose", async () => {
    const db = await liveDb();
    await db.exec(m021);
    const id = await aPost(db);
    expect(await lock(db, id)).toBe(1);
    expect(await lock(db, id)).toBe(0); // a second tap or a twin request while sending
    await db.query(`update public.posts set fb_state = 'failed' where id = $1`, [id]);
    expect(await lock(db, id)).toBe(1); // Facebook said no: safe to try again
    await db.query(`update public.posts set fb_state = 'unsure' where id = $1`, [id]);
    expect(await lock(db, id)).toBe(0); // no answer: never retried by itself
    expect(await lock(db, id, true)).toBe(1); // "Retry anyway"
    await db.query(`update public.posts set fb_state = 'published', fb_post_id = '1_2' where id = $1`, [id]);
    expect(await lock(db, id, true)).toBe(0); // on the Page: never again
  });
});
