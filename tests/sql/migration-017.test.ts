import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002..016. 017 adds posts by initials: posts.initials ('AR') and three functions that make
// a post / add a card / swap a card's name with names from three sources (unused, fresh AI, used before), atomically.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql",
];
const earlier = ALL.map((m) => stripSupabase(read("supabase", "migrations", m)));
const m017raw = read("supabase", "migrations", "017_initials_posts.sql");
const m017 = stripSupabase(m017raw);

async function liveDb(skip015 = false) {
  const db = new PGlite();
  for (const [i, sql] of [v1, ...earlier].entries()) if (!(skip015 && ALL[i - 1] === "015_name_nest.sql")) await db.exec(sql);
  return db;
}
async function migratedDb() {
  const db = await liveDb();
  await db.exec(m017);
  return db;
}

type R = { status: string; post_id?: string; card_id?: string; reason?: string; mode?: string };
const addName = async (db: PGlite, name: string, o: { gender?: string; style?: string; status?: string } = {}) =>
  (await one<{ id: string }>(db, `insert into names (name, meaning, gender, style, status) values ($1, 'a kind meaning', $2, $3, $4) returning id`,
    [name, o.gender ?? "boy", o.style ?? "two-word", o.status ?? "available"])).id;
const addTheme = async (db: PGlite, gender = "boy") =>
  (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,$2,'b','o','p','l','c') returning id`,
    [`T ${crypto.randomUUID()}`, gender])).id;
type Card = { source: string; name: string; meaning?: string; name_id?: string };
const plan = (theme: string, cards: Card[], extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(), post_date: "2026-10-11", gender: "boy", theme_id: theme, caption: "cap", initials: "AR",
  caption_style: "choice", hashtag_set: "#a #b", subject_age: "random",
  cards: cards.map((c, i) => ({ position: i + 1, meaning: "noble and kingly", shot: "s", prompt: "p", seed: 10 + i, ...c })),
  ...extra,
});
const create = async (db: PGlite, p: unknown) => (await one<{ r: R }>(db, `select create_initials_post($1::jsonb) r`, [JSON.stringify(p)])).r;
const addCard = async (db: PGlite, post: string, c: Card) =>
  (await one<{ r: R }>(db, `select add_initials_card($1, $2::jsonb) r`, [post, JSON.stringify({ meaning: "bright and brave", shot: "s", prompt: "p", seed: 7, ...c })])).r;
const nameRow = (db: PGlite, id: string) => one<Record<string, unknown>>(db, `select name, status, post_id, position, style from names where id=$1`, [id]);
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows.length;

/** A used A·R name on an older, finished post (its own theme). */
async function usedOnOldPost(db: PGlite, name: string) {
  const id = await addName(db, name);
  const theme = await addTheme(db);
  const r = (await one<{ r: R }>(db, `select create_post($1::jsonb) r`, [JSON.stringify({
    request_id: crypto.randomUUID(), post_date: "2026-10-01", gender: "boy", style: "two-word", theme_id: theme, caption: "c",
    cards: [{ position: 1, name_id: id, name, meaning: "a kind meaning", shot: "s", prompt: "p", seed: 1 }],
  })])).r;
  await db.query(`update cards set status='done', card_path='x' where post_id=$1`, [r.post_id]);
  return { id, post: r.post_id! };
}

describe("017_initials_posts.sql on the live schema (v1 + 002..016)", () => {
  it("runs twice; existing posts keep a null initials", async () => {
    const db = await liveDb();
    const theme = await addTheme(db);
    const old = (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id) values ('2026-10-09','boy','single',$1) returning id`, [theme])).id;
    await db.exec(m017);
    await db.exec(m017);
    expect(await one(db, `select initials from posts where id=$1`, [old])).toEqual({ initials: null });
  });

  it("also runs without 015 (Unique Names may not have it)", async () => {
    const db = await liveDb(true);
    await db.exec(m017);
    const theme = await addTheme(db);
    const a = await addName(db, "Arlo Rhys");
    // a fresh name's origin is simply left out without 015's names.origin column
    expect((await create(db, plan(theme, [{ source: "available", name: "Arlo Rhys", name_id: a }, { source: "new", name: "Asher Rowan", origin: "Hebrew · Irish" } as Card])))).toMatchObject({ status: "ok" });
  });

  it("stores two capitals A–Z, nothing else", async () => {
    const db = await migratedDb();
    const theme = await addTheme(db);
    const p = (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id) values ('2026-10-09','boy','two-word',$1) returning id`, [theme])).id;
    await db.query(`update posts set initials='AR' where id=$1`, [p]);
    for (const bad of ["ar", "A", "ARJ", "", "A1", "ÉR"]) {
      await expect(db.query(`update posts set initials=$2 where id=$1`, [p, bad])).rejects.toThrow(/posts_initials_check/);
    }
  });

  it("grants the three functions to the app (authenticated), never to anon", async () => {
    const db = await liveDb();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(m017raw);
    await db.exec(m017raw);
    for (const fn of ["set_name_origin(uuid, text)", "create_initials_post(jsonb)", "add_initials_card(uuid, jsonb)", "swap_initials_card_name(uuid, uuid, int, text, text, bigint)"]) {
      const can = async (role: string) => (await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).ok;
      expect(await can("authenticated")).toBe(true);
      expect(await can("anon")).toBe(false);
    }
  });

  it("changes no existing function", async () => {
    const defs = async (db: PGlite) => (await db.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname not in ('create_initials_post','add_initials_card','swap_initials_card_name','set_name_origin') order by 1`)).rows;
    const db = await liveDb();
    const want = await defs(db);
    await db.exec(m017);
    expect(await defs(db)).toEqual(want);
  });
});

describe("fresh schema.sql matches v1 + 002..017 (+ 018)", () => {
  const TABLES = "('settings','cards','posts','themes','names')";
  const FUNCS = "('create_initials_post','add_initials_card','swap_initials_card_name','set_name_origin')";
  const shape = async (db: PGlite) => ({
    columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
    constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
      where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
    indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
    functions: (await db.query<{ proname: string; def: string }>(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ${FUNCS} order by 1`)).rows.map((r) => ({ ...r, def: r.def.replace(/\r\n/g, "\n") })),
  });

  it("has the same tables and the same four functions", async () => {
    const migrated = await migratedDb();
    await migrated.exec(stripSupabase(read("supabase", "migrations", "018_names_pdf.sql")));
    await migrated.exec(stripSupabase(read("supabase", "migrations", "019_shop.sql"))); // 019: settings.shop_enabled
    const want = await shape(migrated);
    expect((want.columns as { column_name: string }[]).map((c) => c.column_name)).toContain("initials");
    expect(want.functions).toHaveLength(4);
    expect(await shape(await freshDb())).toEqual(want);
  });
});

describe("create_initials_post (fresh schema.sql)", () => {
  it("one post from all three sources: unused reserved, fresh AI inserted, used ones reused untouched", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    const avail = await addName(db, "Arlo Reed");
    const old = await usedOnOldPost(db, "Amos Rhett");
    const r = await create(db, plan(theme, [
      { source: "available", name: "Arlo Reed", name_id: avail },
      { source: "new", name: "Asher Rowan", meaning: "happy little tree" },
      { source: "used", name: "Amos Rhett", name_id: old.id, meaning: "a kind meaning" },
    ]));
    expect(r.status).toBe("ok");
    expect(await one(db, `select initials, style, caption_style, hashtag_set, subject_age, status from posts where id=$1`, [r.post_id]))
      .toEqual({ initials: "AR", style: "two-word", caption_style: "choice", hashtag_set: "#a #b", subject_age: "random", status: "generating" });
    expect(await nameRow(db, avail)).toMatchObject({ status: "reserved", post_id: r.post_id, position: 1 });
    const fresh = await one<{ id: string; status: string; post_id: string; position: number; style: string; meaning: string; gender: string }>(db,
      `select id, status, post_id, position, style, meaning, gender from names where name='Asher Rowan'`);
    expect(fresh).toMatchObject({ status: "reserved", post_id: r.post_id, position: 2, style: "two-word", meaning: "happy little tree", gender: "boy" });
    // The used name stays on its first post; its new card carries the text without a name_id.
    expect(await nameRow(db, old.id)).toMatchObject({ status: "used", post_id: old.post });
    const cards = (await db.query<{ position: number; name: string; name_id: string | null }>(`select position, name, name_id from cards where post_id=$1 order by position`, [r.post_id])).rows;
    expect(cards).toEqual([
      { position: 1, name: "Arlo Reed", name_id: avail }, { position: 2, name: "Asher Rowan", name_id: fresh.id }, { position: 3, name: "Amos Rhett", name_id: null },
    ]);
    expect(await one(db, `select status from themes where id=$1`, [theme])).toEqual({ status: "used" });
    // Done: its own names become used; the reused one is untouched.
    await db.query(`update cards set status='done', card_path='y' where post_id=$1`, [r.post_id]);
    expect(await nameRow(db, avail)).toMatchObject({ status: "used" });
    expect(await nameRow(db, fresh.id)).toMatchObject({ status: "used" });
    expect(await nameRow(db, old.id)).toMatchObject({ status: "used", post_id: old.post });
  });

  it("is idempotent per request_id (double press = one post, one set of fresh names)", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    const p = plan(theme, [{ source: "new", name: "Asher Rowan" }]);
    const a = await create(db, p);
    const b = await create(db, p);
    expect(b).toEqual(a);
    expect(await count(db, `select 1 from posts`)).toBe(1);
    expect(await count(db, `select 1 from names where lower(name)='asher rowan'`)).toBe(1);
  });

  it("conflicts (changes nothing) when an unused name was taken, a fresh name now exists, a used one is on a post being made, or the theme is gone", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    const taken = await addName(db, "Arlo Reed", { status: "used" });
    expect(await create(db, plan(theme, [{ source: "available", name: "Arlo Reed", name_id: taken }]))).toEqual({ status: "conflict", reason: "names" });
    await addName(db, "asher rowan", { status: "skip" });
    expect(await create(db, plan(theme, [{ source: "new", name: "Asher Rowan" }]))).toEqual({ status: "conflict", reason: "names" });
    // a reserved name on a post still being made is not reusable; a skipped or pending one never is
    const busyName = await addName(db, "Abel Ross");
    const busyTheme = await addTheme(db);
    await one(db, `select create_post($1::jsonb) r`, [JSON.stringify({ request_id: crypto.randomUUID(), post_date: "2026-10-02", gender: "boy", style: "two-word", theme_id: busyTheme, caption: "c",
      cards: [{ position: 1, name_id: busyName, name: "Abel Ross", meaning: "m", shot: "s", prompt: "p", seed: 1 }] })]);
    for (const id of [busyName, await addName(db, "Ari Rune", { status: "skip" }), await addName(db, "Ash Ryder", { status: "pending" }), await addName(db, "Ava Rose", { gender: "girl", status: "used" })]) {
      expect(await create(db, plan(theme, [{ source: "used", name: "X Y", name_id: id }]))).toEqual({ status: "conflict", reason: "names" });
    }
    const girlTheme = await addTheme(db, "girl");
    expect(await create(db, plan(girlTheme, [{ source: "new", name: "Axel Reid" }]))).toEqual({ status: "conflict", reason: "theme" });
    expect(await count(db, `select 1 from posts where initials is not null`)).toBe(0);
    expect(await count(db, `select 1 from names where name='Axel Reid'`)).toBe(0);
  });

  it("a reserved name whose post is not being made any more may be reused", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    const stray = await addName(db, "Abel Ross", { status: "reserved" });
    expect((await create(db, plan(theme, [{ source: "used", name: "Abel Ross", name_id: stray }]))).status).toBe("ok");
  });

  it("rejects bad plans: no cards, bad initials, a name twice, an unknown source", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    expect((await create(db, plan(theme, []))).status).toBe("error");
    expect((await create(db, plan(theme, [{ source: "new", name: "Asher Rowan" }], { initials: "ar" }))).status).toBe("error");
    expect((await create(db, plan(theme, [{ source: "new", name: "Asher Rowan" }, { source: "new", name: "asher rowan" }]))).status).toBe("error");
    expect((await create(db, plan(theme, [{ source: "bogus", name: "Asher Rowan" }]))).status).toBe("error");
    expect((await create(db, plan(theme, [{ source: "used", name: "Asher Rowan" }]))).status).toBe("error");
    expect(await count(db, `select 1 from posts`)).toBe(0);
  });

  it("deleting the post frees its own names and leaves names used before alone", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    const avail = await addName(db, "Arlo Reed");
    const old = await usedOnOldPost(db, "Amos Rhett");
    const r = await create(db, plan(theme, [{ source: "available", name: "Arlo Reed", name_id: avail }, { source: "used", name: "Amos Rhett", name_id: old.id }]));
    const reusedCard = (await one<{ id: string }>(db, `select id from cards where post_id=$1 and position=2`, [r.post_id])).id;
    await db.query(`select delete_card($1)`, [reusedCard]);
    expect(await nameRow(db, old.id)).toMatchObject({ status: "used", post_id: old.post });
    await db.query(`select delete_post($1)`, [r.post_id]);
    expect(await nameRow(db, avail)).toMatchObject({ status: "available", post_id: null });
    expect(await nameRow(db, old.id)).toMatchObject({ status: "used", post_id: old.post });
  });
});

describe("origins of fresh names (Name Nest chip)", () => {
  it("a fresh name keeps its origin (create and add card); blank or missing = none, never longer than 40", async () => {
    const db = await freshDb();
    const theme = await addTheme(db);
    const r = await create(db, plan(theme, [{ source: "new", name: "Hazel June", origin: " English · Latin " } as Card, { source: "new", name: "Holly Jane" }]));
    expect(await one(db, `select origin from names where name='Hazel June'`)).toEqual({ origin: "English · Latin" });
    expect(await one(db, `select origin from names where name='Holly Jane'`)).toEqual({ origin: null });
    await addCard(db, r.post_id!, { source: "new", name: "Hope Juniper", origin: "x".repeat(60) } as Card);
    expect(await one(db, `select length(origin) n from names where name='Hope Juniper'`)).toEqual({ n: 40 });
  });
});

describe("add_initials_card (fresh schema.sql)", () => {
  async function post(db: PGlite) {
    const theme = await addTheme(db);
    const r = await create(db, plan(theme, [{ source: "new", name: "Asher Rowan" }]));
    return r.post_id!;
  }

  it("adds a card from each source; a posted post goes back to generating", async () => {
    const db = await freshDb();
    const p = await post(db);
    const avail = await addName(db, "Arlo Reed");
    const old = await usedOnOldPost(db, "Amos Rhett");
    await db.query(`update cards set status='done', card_path='x' where post_id=$1`, [p]);
    await db.query(`update posts set status='posted' where id=$1`, [p]);
    expect((await addCard(db, p, { source: "available", name: "Arlo Reed", name_id: avail })).status).toBe("ok");
    expect(await one(db, `select status from posts where id=$1`, [p])).toEqual({ status: "generating" });
    expect(await nameRow(db, avail)).toMatchObject({ status: "reserved", post_id: p, position: 2 });
    expect((await addCard(db, p, { source: "new", name: "Axel Reid" })).status).toBe("ok");
    expect(await one(db, `select status, position from names where name='Axel Reid'`)).toEqual({ status: "reserved", position: 3 });
    expect((await addCard(db, p, { source: "used", name: "Amos Rhett", name_id: old.id })).status).toBe("ok");
    expect(await nameRow(db, old.id)).toMatchObject({ status: "used", post_id: old.post });
    expect(await one(db, `select name_id, position from cards where post_id=$1 and name='Amos Rhett'`, [p])).toEqual({ name_id: null, position: 4 });
  });

  it("conflicts on a name already on the post, a taken name or an existing fresh name; errors on a post not by initials", async () => {
    const db = await freshDb();
    const p = await post(db);
    const old = await usedOnOldPost(db, "Amos Rhett");
    expect(await addCard(db, p, { source: "used", name: "Asher Rowan", name_id: old.id })).toEqual({ status: "conflict" });
    expect(await addCard(db, p, { source: "available", name: "Amos Rhett", name_id: old.id })).toEqual({ status: "conflict" });
    expect(await addCard(db, p, { source: "new", name: "AMOS RHETT" })).toEqual({ status: "conflict" });
    expect((await addCard(db, old.post, { source: "new", name: "Axel Reid" })).status).toBe("error");
    expect(await count(db, `select 1 from cards where post_id=$1`, [p])).toBe(1);
  });
});

describe("swap_initials_card_name (fresh schema.sql)", () => {
  async function world(db: PGlite) {
    const theme = await addTheme(db);
    const avail = await addName(db, "Arlo Reed");
    const r = await create(db, plan(theme, [{ source: "available", name: "Arlo Reed", name_id: avail }, { source: "new", name: "Asher Rowan" }]));
    await db.query(`update cards set status='done', photo_path='p', card_path='c' where post_id=$1`, [r.post_id]);
    const card = (await one<{ id: string }>(db, `select id from cards where post_id=$1 and position=1`, [r.post_id])).id;
    return { post: r.post_id!, card, avail };
  }
  const swap = async (db: PGlite, card: string, name: string, o: { version?: number; mode?: string } = {}) =>
    (await one<{ r: R }>(db, `select swap_initials_card_name($1, $2, $3, $4, $5, $6) r`, [card, name, o.version ?? 1, "", o.mode ?? "restamp", 99])).r;

  it("a used name goes on the card without a name_id (left on its first post); the card's own name is freed", async () => {
    const db = await freshDb();
    const w = await world(db);
    const old = await usedOnOldPost(db, "Amos Rhett");
    expect(await swap(db, w.card, old.id)).toEqual({ status: "ok", mode: "restamp" });
    expect(await one(db, `select name, meaning, name_id, status, version from cards where id=$1`, [w.card]))
      .toEqual({ name: "Amos Rhett", meaning: "a kind meaning", name_id: null, status: "restamp", version: 2 });
    expect(await nameRow(db, old.id)).toMatchObject({ status: "used", post_id: old.post });
    expect(await nameRow(db, w.avail)).toMatchObject({ status: "available", post_id: null });
    // again: ok, nothing more
    expect(await swap(db, w.card, old.id, { version: 2 })).toEqual({ status: "ok", mode: "restamp" });
    expect(await one(db, `select version from cards where id=$1`, [w.card])).toEqual({ version: 2 });
  });

  it("an available name is reserved for the post like swap_card_name", async () => {
    const db = await freshDb();
    const w = await world(db);
    const next = await addName(db, "Axel Reid");
    expect(await swap(db, w.card, next, { mode: "regenerate" })).toEqual({ status: "ok", mode: "regenerate" });
    expect(await nameRow(db, next)).toMatchObject({ status: "reserved", post_id: w.post, position: 1 });
    expect(await one(db, `select name_id, status, seed from cards where id=$1`, [w.card])).toEqual({ name_id: next, status: "queued", seed: 99 });
  });

  it("taken: already on the post, the other gender, a single name, skipped; stale on another version", async () => {
    const db = await freshDb();
    const w = await world(db);
    const onPost = (await one<{ id: string }>(db, `select id from names where name='Asher Rowan'`)).id;
    for (const id of [onPost, await addName(db, "Ava Rose", { gender: "girl" }), await addName(db, "Arlo", { style: "single" }), await addName(db, "Ari Rune", { status: "skip" })]) {
      expect(await swap(db, w.card, id)).toEqual({ status: "taken" });
    }
    expect(await swap(db, w.card, await addName(db, "Axel Reid"), { version: 5 })).toEqual({ status: "stale" });
    expect(await one(db, `select name, version from cards where id=$1`, [w.card])).toEqual({ name: "Arlo Reed", version: 1 });
  });
});
