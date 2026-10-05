import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// The live DB = v1 snapshot + 002 + 003. 004 adds the child's age per post.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const m002 = read("supabase", "migrations", "002_v2.sql");
const m003 = read("supabase", "migrations", "003_post_fonts.sql");
const m004 = read("supabase", "migrations", "004_subject_age.sql");

async function liveDb() {
  const db = new PGlite();
  await db.exec(v1);
  await db.exec(m002);
  await db.exec(m003);
  return db;
}

async function seed(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T','boy','b','o','p','l','c') returning id`)).id;
  const names: string[] = [];
  for (let i = 0; i < 4; i++) names.push((await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1,'m','boy','two-word') returning id`, [`Name ${i}`])).id);
  return { theme, names };
}
const plan = (theme: string, ids: string[], extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(), post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: theme, caption: "c",
  cards: ids.map((id, i) => ({ position: i + 1, name_id: id, name: `N${i}`, meaning: "m", shot: "s", prompt: "p", seed: i })),
  title_font: "quicksand", ...extra,
});
const createPost = async (db: PGlite, p: unknown) => (await one<{ r: { status: string; post_id?: string } }>(db, `select create_post($1::jsonb) r`, [JSON.stringify(p)])).r;
const ageOf = async (db: PGlite, id?: string) => (await one<{ subject_age: string | null }>(db, `select subject_age from posts where id=$1`, [id])).subject_age;
const fnDef = async (db: PGlite) =>
  (await one<{ def: string }>(db, `select pg_get_functiondef('public.create_post(jsonb)'::regprocedure) def`)).def.replace(/\r\n/g, "\n");

describe("004_subject_age.sql on the live schema (v1 + 002 + 003)", () => {
  it("before 004 create_post ignores subject_age (Generate keeps working)", async () => {
    const db = await liveDb();
    const { theme, names } = await seed(db);
    expect((await createPost(db, plan(theme, names.slice(0, 1), { subject_age: "5" }))).status).toBe("ok");
  });

  it("runs twice, keeps existing posts (subject_age null) and their fonts", async () => {
    const db = await liveDb();
    const { theme, names } = await seed(db);
    const before = await createPost(db, plan(theme, names.slice(0, 1), { subject_age: "5" }));
    await db.exec(m004);
    await db.exec(m004);
    expect(await ageOf(db, before.post_id)).toBeNull();
    expect(await one(db, `select title_font from posts where id=$1`, [before.post_id])).toEqual({ title_font: "quicksand" });
  });

  it("create_post stores random / a fixed age / newborn; blank or missing = null; fonts still stored", async () => {
    const db = await liveDb();
    await db.exec(m004);
    const { names } = await seed(db);
    const cases: [unknown, string | null][] = [["random", "random"], ["7", "7"], ["newborn", "newborn"], ["", null], [undefined, null]];
    for (const [i, [age, want]] of cases.entries()) {
      // a fresh theme per post (a used theme is a conflict)
      const t = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,'boy','b','o','p','l','c') returning id`, [`T${i}`])).id;
      const n = (await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1,'m','boy','two-word') returning id`, [`Extra ${i}`])).id;
      const r = await createPost(db, plan(t, [n], age === undefined ? {} : { subject_age: age }));
      expect(r.status).toBe("ok");
      expect(await ageOf(db, r.post_id)).toBe(want);
      expect(await one(db, `select title_font from posts where id=$1`, [r.post_id])).toEqual({ title_font: "quicksand" });
    }
    expect(names).toHaveLength(4);
  });

  it("the column only takes known ages", async () => {
    const db = await liveDb();
    await db.exec(m004);
    const { theme, names } = await seed(db);
    const r = await createPost(db, plan(theme, names.slice(0, 1), { subject_age: "3" }));
    await expect(db.query(`update posts set subject_age='8' where id=$1`, [r.post_id])).rejects.toThrow(/check/i);
    const t2 = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T2','boy','b','o','p','l','c') returning id`)).id;
    await expect(createPost(db, plan(t2, names.slice(1, 2), { subject_age: "12" }))).rejects.toThrow(/check/i);
  });

  it("create_post is the exact 003 body plus subject_age", async () => {
    const db = await liveDb();
    const before = await fnDef(db);
    await db.exec(m004);
    const after = await fnDef(db);
    const strip = (s: string) => s.replace(/, subject_age\)/, ")").replace(/,\n\s*nullif\(btrim\(p->>'subject_age'\), ''\)\)/, ")");
    expect(after).not.toBe(before);
    expect(strip(after)).toBe(before);
  });

  it("004 is also safe on a fresh schema.sql project", async () => {
    const db = await freshDb();
    await db.exec(m004);
    const { theme, names } = await seed(db);
    const r = await createPost(db, plan(theme, names.slice(0, 1), { subject_age: "2" }));
    expect(await ageOf(db, r.post_id)).toBe("2");
  });
});
