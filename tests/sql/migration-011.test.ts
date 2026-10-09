import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..010. 011 adds the A–Z series (two posts made together).
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
  read("supabase", "migrations", "010_cta_card.sql"),
];
const m011raw = read("supabase", "migrations", "011_az_series.sql");
const m011 = stripSupabase(m011raw);

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...earlier]) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m011);
  return db;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
async function seed(db: PGlite, gender = "boy") {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,$2,'b','o','p','l','c') returning id`, [`T ${gender} ${crypto.randomUUID()}`, gender])).id;
  const names: string[] = [];
  const tag = Math.random().toString(36).slice(2, 8);
  for (const l of LETTERS) names.push((await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1,'a meaning',$2,'single') returning id`, [`${l}name${gender}${tag}`, gender])).id);
  return { theme, names };
}
const card = (id: string, i: number) => ({ position: i + 1, name_id: id, name: `N${i}`, meaning: "a meaning", shot: "s", prompt: "p", seed: 100 + i });
const series = (theme: string, ids: string[], extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(), post_date: "2026-10-09", gender: "boy", theme_id: theme, subject_age: "random", title_font: "poppins",
  parts: [
    { caption: "Part 1 caption", caption_style: "story", hashtag_set: "#uniquenames #atozbabynames", cards: ids.slice(0, 13).map(card) },
    { caption: "Part 2 caption", caption_style: "question", hashtag_set: "#uniquenames #babynames", cards: ids.slice(13).map(card) },
  ],
  ...extra,
});
type R = { status: string; post_ids?: string[]; reason?: string };
const createSeries = async (db: PGlite, p: unknown) => (await one<{ r: R }>(db, `select create_series($1::jsonb) as r`, [JSON.stringify(p)])).r;
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int n from (${sql}) x`, params)).n;

describe("011_az_series.sql on the live schema (v1 + 002..010)", () => {
  it("runs twice; old posts keep series / series_id / series_part null", async () => {
    const db = await liveDb();
    const { theme } = await seed(db);
    const post = (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id, caption) values ('2026-10-09','boy','single',$1,'c') returning id`, [theme])).id;
    await db.exec(m011);
    await db.exec(m011);
    expect(await one(db, `select series, series_id, series_part from posts where id=$1`, [post])).toEqual({ series: null, series_id: null, series_part: null });
  });

  it("a series row needs all three fields, 'az' and part 1 or 2", async () => {
    const db = await migratedDb();
    const { theme } = await seed(db);
    const ins = (series: string | null, id: string | null, part: number | null) => db.query(
      `insert into posts (post_date, gender, style, theme_id, caption, series, series_id, series_part) values ('2026-10-09','boy','single',$1,'c',$2,$3,$4)`,
      [theme, series, id, part]);
    await ins("az", crypto.randomUUID(), 1);
    await expect(ins("az", null, 1)).rejects.toThrow(/posts_series_check/);
    await expect(ins("az", crypto.randomUUID(), 3)).rejects.toThrow(/posts_series_check/);
    await expect(ins("other", crypto.randomUUID(), 1)).rejects.toThrow(/posts_series_check/);
    await expect(ins(null, null, 2)).rejects.toThrow(/posts_series_check/);
  });

  it("create_series makes both parts at once: 13 + 13 queued cards in order, names reserved, the theme used once", async () => {
    const db = await migratedDb();
    const { theme, names } = await seed(db);
    const p = series(theme, names);
    const r = await createSeries(db, p);
    expect(r.status).toBe("ok");
    expect(r.post_ids).toHaveLength(2);
    const posts = (await db.query<Record<string, unknown>>(`select id, request_id, series, series_id, series_part, style, gender, caption, caption_style, hashtag_set, subject_age, title_font, theme_id
      from posts order by created_at`)).rows;
    expect(posts.map((x) => x.id)).toEqual(r.post_ids);
    expect(posts.map((x) => [x.series, x.series_id, x.series_part, x.style])).toEqual([["az", p.request_id, 1, "single"], ["az", p.request_id, 2, "single"]]);
    expect(posts[0]).toMatchObject({ request_id: p.request_id, caption: "Part 1 caption", caption_style: "story", hashtag_set: "#uniquenames #atozbabynames", subject_age: "random", title_font: "poppins", theme_id: theme });
    expect(posts[1]).toMatchObject({ caption: "Part 2 caption", caption_style: "question", hashtag_set: "#uniquenames #babynames", theme_id: theme });
    expect(posts[1].request_id).not.toBe(p.request_id);
    for (const [k, id] of r.post_ids!.entries()) {
      const cards = (await db.query<{ position: number; order_index: number; name_id: string; status: string; kind: string }>(
        `select position, order_index, name_id, status, kind from cards where post_id=$1 order by position`, [id])).rows;
      expect(cards.map((c) => c.name_id)).toEqual(names.slice(k * 13, k * 13 + 13));
      expect(cards.every((c, i) => c.position === i + 1 && c.order_index === i + 1 && c.status === "queued" && c.kind === "post")).toBe(true);
    }
    expect(await count(db, `select 1 from names where status='reserved'`)).toBe(26);
    expect(await one(db, `select status, used_on::text from themes where id=$1`, [theme])).toEqual({ status: "used", used_on: "2026-10-09" });
  });

  it("is idempotent per request (a double press makes one series, never two)", async () => {
    const db = await migratedDb();
    const { theme, names } = await seed(db);
    const p = series(theme, names);
    const a = await createSeries(db, p);
    const b = await createSeries(db, p);
    expect(b).toEqual(a);
    expect(await count(db, `select 1 from posts`)).toBe(2);
    expect(await count(db, `select 1 from cards`)).toBe(26);
  });

  it("a second request for the same names or theme conflicts and changes nothing", async () => {
    const db = await migratedDb();
    const { theme, names } = await seed(db);
    await createSeries(db, series(theme, names));
    expect(await createSeries(db, series(theme, names))).toEqual({ status: "conflict", reason: "theme" });
    const other = await seed(db);
    expect(await createSeries(db, series(other.theme, names))).toEqual({ status: "conflict", reason: "names" });
    expect(await count(db, `select 1 from posts`)).toBe(2);
    expect(await one(db, `select status from themes where id=$1`, [other.theme])).toEqual({ status: "available" });
  });

  it("refuses a name twice, a part without cards, other genders' or two-word names, a wrong-gender theme", async () => {
    const db = await migratedDb();
    const { theme, names } = await seed(db);
    const twice = series(theme, [...names.slice(0, 25), names[0]]);
    expect((await createSeries(db, twice)).status).toBe("error");
    const empty = series(theme, names);
    empty.parts[1].cards = [];
    expect((await createSeries(db, empty)).status).toBe("error");
    const onePart = series(theme, names);
    onePart.parts = [onePart.parts[0]];
    expect((await createSeries(db, onePart)).status).toBe("error");
    const girl = await seed(db, "girl");
    expect(await createSeries(db, series(theme, girl.names))).toEqual({ status: "conflict", reason: "names" });
    expect(await createSeries(db, series(girl.theme, names))).toEqual({ status: "conflict", reason: "theme" });
    await db.query(`update names set style='two-word', name = name || ' X' where id=$1`, [names[5]]);
    expect(await createSeries(db, series(theme, names))).toEqual({ status: "conflict", reason: "names" });
    expect(await count(db, `select 1 from posts`)).toBe(0);
    expect(await count(db, `select 1 from names where status <> 'available'`)).toBe(0);
  });

  it("each part is a normal post: ready on its own, deleting one part keeps the theme used for the other", async () => {
    const db = await migratedDb();
    const { theme, names } = await seed(db);
    const { post_ids } = await createSeries(db, series(theme, names));
    await db.query(`update cards set status='done', card_path='x' where post_id=$1`, [post_ids![0]]);
    expect((await db.query(`select series_part, status from posts order by series_part`)).rows).toEqual([{ series_part: 1, status: "ready" }, { series_part: 2, status: "generating" }]);
    await db.query(`select delete_post($1)`, [post_ids![0]]);
    expect(await one(db, `select status from themes where id=$1`, [theme])).toEqual({ status: "used" });
    expect(await count(db, `select 1 from names where status='available'`)).toBe(13);
    await db.query(`select delete_post($1)`, [post_ids![1]]);
    expect(await one(db, `select status from themes where id=$1`, [theme])).toEqual({ status: "available" });
  });

  it("the worker's claim is unchanged: every series card is handed out like any other", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname <> 'create_series' order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m011);
    expect(await defs(db)).toEqual(want);
  });

  it("is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m011);
    await db.exec(m011);
    const { theme, names } = await seed(db);
    expect((await createSeries(db, series(theme, names))).status).toBe("ok");
  });

  it("grants create_series to the app only (Supabase block)", () => {
    expect(m011raw).toMatch(/revoke execute on function public\.create_series\(jsonb\) from public, anon;/);
    expect(m011raw).toMatch(/grant execute on function public\.create_series\(jsonb\) to authenticated, service_role;/);
  });
});

describe("fresh schema.sql matches v1 + 002..011 (+ 012)", () => {
  const TABLES = "('settings','cards','posts','themes','names')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
    functions: (await db.query<{ proname: string; def: string }>(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname = 'create_series'`)).rows.map((r) => ({ ...r, def: r.def.replace(/\r\n/g, "\n") })),
  });

  it("has the same columns, constraints, indexes and create_series body", async () => {
    const db = await migratedDb();
    await db.exec(stripSupabase(read("supabase", "migrations", "012_two_styles.sql")));
    const want = await shape(db);
    const cols = (want.columns as { table_name: string; column_name: string }[]).map((c) => `${c.table_name}.${c.column_name}`);
    expect(cols).toEqual(expect.arrayContaining(["posts.series", "posts.series_id", "posts.series_part"]));
    expect(want.functions).toHaveLength(1);
    expect(await shape(await freshDb())).toEqual(want);
  });

  it("schema.sql grants create_series like the migration", () => {
    const schema = read("supabase", "schema.sql");
    expect(schema).toMatch(/revoke execute on function public\.create_series\(jsonb\) from public, anon;/);
    expect(schema).toMatch(/public\.create_series\(jsonb\)[^;]*to authenticated, service_role;/);
  });
});
