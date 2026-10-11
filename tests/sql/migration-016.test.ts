import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..015. 016 adds swap_card_name: the card dialog's "My names" tab puts an available name
// from the Names page on a card in one transaction (reserve the new name, release the old one, queue the card).
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const earlier = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m016raw = read("supabase", "migrations", "016_swap_card_name.sql");
const m016 = stripSupabase(m016raw);

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}

type R = { status: string; mode?: string; reason?: string };
const addName = async (db: PGlite, name: string, gender = "boy", style = "single") =>
  (await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1, 'a meaning', $2, $3) returning id`, [name, gender, style])).id;

/** A boy single post with 2 finished cards (Arlo, Bram) and 3 more names: Cyrus (fits), Dawn (girl), Eli Mae (two-word). */
async function world(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T','boy','b','o','p','l','c') returning id`)).id;
  const arlo = await addName(db, "Arlo");
  const bram = await addName(db, "Bram");
  const cyrus = await addName(db, "Cyrus");
  const dawn = await addName(db, "Dawn", "girl");
  const twoWord = await addName(db, "Eli Mae", "boy", "two-word");
  const cards = [arlo, bram].map((id, i) => ({ position: i + 1, name_id: id, name: i ? "Bram" : "Arlo", meaning: "a meaning", shot: "s", prompt: "p", seed: 10 + i }));
  const r = (await one<{ r: { post_id: string } }>(db, `select create_post($1::jsonb) r`, [JSON.stringify({
    request_id: crypto.randomUUID(), post_date: "2026-10-11", gender: "boy", style: "single", theme_id: theme, caption: "c", cards,
  })])).r;
  await db.query(`update cards set status='done', photo_path='photos/'||id||'/v1.jpg', card_path='cards/'||id||'/v1.jpg' where post_id=$1`, [r.post_id]);
  const card = (await one<{ id: string }>(db, `select id from cards where post_id=$1 and position=1`, [r.post_id])).id;
  return { post: r.post_id, card, arlo, bram, cyrus, dawn, twoWord };
}
const swap = async (db: PGlite, card: string, name: string, o: { version?: number; meaning?: string; mode?: string; seed?: number } = {}) =>
  (await one<{ r: R }>(db, `select swap_card_name($1, $2, $3, $4, $5, $6) r`, [card, name, o.version ?? 1, o.meaning ?? "the new meaning", o.mode ?? "restamp", o.seed ?? 999])).r;
const cardRow = (db: PGlite, id: string) => one<Record<string, unknown>>(db, `select name, meaning, name_id, status, version, seed, photo_path, attempts from cards where id=$1`, [id]);
const nameRow = (db: PGlite, id: string) => one<Record<string, unknown>>(db, `select status, post_id, position, meaning from names where id=$1`, [id]);

describe("016_swap_card_name.sql on the live schema (v1 + 002..015)", () => {
  it("runs twice and swaps", async () => {
    const db = await liveDb();
    await db.exec(m016);
    await db.exec(m016);
    const w = await world(db);
    expect(await swap(db, w.card, w.cyrus)).toEqual({ status: "ok", mode: "restamp" });
  });

  it("also runs without 015 (Unique Names may not have it)", async () => {
    const db = new PGlite();
    for (const sql of [v1, ...earlier.slice(0, -1)]) await db.exec(sql);
    await db.exec(m016);
    const w = await world(db);
    expect(await swap(db, w.card, w.cyrus)).toEqual({ status: "ok", mode: "restamp" });
  });

  it("fresh schema.sql has the same swap_card_name", async () => {
    const def = async (db: PGlite) => (await one<{ d: string }>(db, `select pg_get_functiondef('public.swap_card_name'::regproc) d`)).d.replace(/\r\n/g, "\n");
    const migrated = await liveDb();
    await migrated.exec(m016);
    expect(await def(await freshDb())).toBe(await def(migrated));
  });

  it("grants execute to the app (authenticated), never to anon", async () => {
    const db = await liveDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(m016raw);
    await db.exec(m016raw);
    const can = async (role: string) => (await one<{ ok: boolean }>(db,
      `select has_function_privilege($1, 'public.swap_card_name(uuid, uuid, int, text, text, bigint)', 'execute') ok`, [role])).ok;
    expect(await can("authenticated")).toBe(true);
    expect(await can("anon")).toBe(false);
  });
});

describe("swap_card_name (fresh schema.sql)", () => {
  it("restamp: the card takes the name and keeps its photo; the new name is the post's, the old one available again", async () => {
    const db = await freshDb();
    const w = await world(db);
    expect(await one(db, `select status from posts where id=$1`, [w.post])).toEqual({ status: "ready" });
    expect(await swap(db, w.card, w.cyrus, { meaning: "  sun  " })).toEqual({ status: "ok", mode: "restamp" });
    expect(await cardRow(db, w.card)).toMatchObject({ name: "Cyrus", meaning: "sun", name_id: w.cyrus, status: "restamp", version: 2, seed: 10, attempts: 0 });
    expect((await cardRow(db, w.card)).photo_path).toMatch(/^photos\//);
    // A ready post stays ready (text-only restamp) and its names are 'used' (refresh_post through the card trigger).
    expect(await one(db, `select status from posts where id=$1`, [w.post])).toEqual({ status: "ready" });
    expect(await nameRow(db, w.cyrus)).toEqual({ status: "used", post_id: w.post, position: 1, meaning: "sun" });
    expect(await nameRow(db, w.arlo)).toEqual({ status: "available", post_id: null, position: null, meaning: "a meaning" });
    expect(await nameRow(db, w.bram)).toMatchObject({ status: "used", post_id: w.post });
  });

  it("regenerate: queued with the new seed; the post makes it again and the name is reserved", async () => {
    const db = await freshDb();
    const w = await world(db);
    await db.query(`update cards set attempts=2 where id=$1`, [w.card]);
    expect(await swap(db, w.card, w.cyrus, { mode: "regenerate", seed: 4242 })).toEqual({ status: "ok", mode: "regenerate" });
    expect(await cardRow(db, w.card)).toMatchObject({ name: "Cyrus", status: "queued", version: 2, seed: 4242, attempts: 0 });
    expect(await one(db, `select status from posts where id=$1`, [w.post])).toEqual({ status: "generating" });
    expect(await nameRow(db, w.cyrus)).toMatchObject({ status: "reserved", post_id: w.post, position: 1 });
    await db.query(`update cards set status='done' where id=$1`, [w.card]);
    expect(await nameRow(db, w.cyrus)).toMatchObject({ status: "used" });
  });

  it("an empty meaning keeps the name's own meaning", async () => {
    const db = await freshDb();
    const w = await world(db);
    await swap(db, w.card, w.cyrus, { meaning: " " });
    expect(await cardRow(db, w.card)).toMatchObject({ meaning: "a meaning" });
  });

  it("a posted post: the new name is used straight away (refresh_post leaves posted posts alone)", async () => {
    const db = await freshDb();
    const w = await world(db);
    await db.query(`update posts set status='posted' where id=$1`, [w.post]);
    await swap(db, w.card, w.cyrus);
    expect(await nameRow(db, w.cyrus)).toMatchObject({ status: "used", post_id: w.post });
    expect(await one(db, `select status from posts where id=$1`, [w.post])).toEqual({ status: "posted" });
  });

  it("taken: a name no longer available, of the other gender or style answers taken and changes nothing", async () => {
    const db = await freshDb();
    const w = await world(db);
    await db.query(`update names set status='skip' where id=$1`, [w.cyrus]);
    for (const id of [w.cyrus, w.dawn, w.twoWord, w.bram]) expect(await swap(db, w.card, id)).toEqual({ status: "taken" });
    expect(await cardRow(db, w.card)).toMatchObject({ name: "Arlo", name_id: w.arlo, status: "done", version: 1 });
    expect(await nameRow(db, w.arlo)).toMatchObject({ status: "used", post_id: w.post });
  });

  it("stale: another version or a card being made", async () => {
    const db = await freshDb();
    const w = await world(db);
    expect(await swap(db, w.card, w.cyrus, { version: 7 })).toEqual({ status: "stale" });
    await db.query(`update cards set status='generating' where id=$1`, [w.card]);
    expect(await swap(db, w.card, w.cyrus)).toEqual({ status: "stale" });
    expect(await nameRow(db, w.cyrus)).toMatchObject({ status: "available", post_id: null });
  });

  it("idempotent: the same swap again answers ok and changes nothing more", async () => {
    const db = await freshDb();
    const w = await world(db);
    await swap(db, w.card, w.cyrus);
    expect(await swap(db, w.card, w.cyrus)).toEqual({ status: "ok", mode: "restamp" });
    expect(await cardRow(db, w.card)).toMatchObject({ version: 2 });
  });

  it("the old name stays put when another card still uses it; a card without a name row just takes the new one", async () => {
    const db = await freshDb();
    const w = await world(db);
    const other = (await one<{ id: string }>(db, `select id from cards where post_id=$1 and position=2`, [w.post])).id;
    await db.query(`update cards set name_id=$2 where id=$1`, [other, w.arlo]);
    await swap(db, w.card, w.cyrus);
    expect(await nameRow(db, w.arlo)).toMatchObject({ status: "used", post_id: w.post });
    await db.query(`update cards set name_id=null where id=$1`, [other]);
    const felix = await addName(db, "Felix");
    expect(await swap(db, other, felix)).toEqual({ status: "ok", mode: "restamp" });
    expect(await nameRow(db, felix)).toMatchObject({ status: "used", post_id: w.post, position: 2 });
  });

  it("only post name cards: a closing card or an unknown card is an error", async () => {
    const db = await freshDb();
    const w = await world(db);
    const cta = (await one<{ id: string }>(db, `insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed)
      select $1, theme_id, 'cta', 9, 'Follow', '', 's', 'p', 1 from posts where id=$1 returning id`, [w.post])).id;
    expect((await swap(db, cta, w.cyrus)).status).toBe("error");
    expect((await swap(db, crypto.randomUUID(), w.cyrus)).status).toBe("error");
    expect((await swap(db, w.card, w.cyrus, { mode: "bogus" })).status).toBe("error");
  });
});
