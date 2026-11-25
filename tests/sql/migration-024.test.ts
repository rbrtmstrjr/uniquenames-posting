import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// 024 keeps the names skipped as "Not a US name" in the shop: shop_info counts them and download_shop_order sells them
// (with their note, so the PDF can tell them from other skips). Other skipped names stay out.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql", "019_shop.sql",
  "020_one_claim.sql", "021_facebook_posting.sql", "022_autopilot.sql", "023_front_card.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m024 = stripSupabase(read("supabase", "migrations", "024_us_names_shop.sql"));
const SECRET = "a".repeat(40) + "-shop-key-for-tests-only";

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...ALL]) await db.exec(sql);
  return db;
}
const fn = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) =>
  (await one<{ r: T }>(db, `select ${sql} r`, params)).r;
async function seed(db: PGlite) {
  await db.query(`select set_shop_secret($1)`, [SECRET]);
  const add = (name: string, status: string, note: string | null, gender = "girl") =>
    db.query(`insert into names (name, meaning, gender, style, status, autopilot_note) values ($1, 'a kind meaning', $2, 'single', $3, $4)`, [name, gender, status, note]);
  await add("Wren", "available", null);
  await add("Sakura", "skip", "Not a US name"); // the US check's skip: still sold
  await add("Kip", "skip", null); // a plain skip: never sold
  await add("Odd", "skip", "made up"); // Autopilot's own skip: never sold
  await add("Tariq", "skip", "Not a US name", "boy");
}
const counts = async (db: PGlite) => (await fn<{ counts: Record<string, number> }>(db, `shop_info($1)`, [SECRET])).counts;
async function paidOrder(db: PGlite, product = "girl") {
  const o = await fn<{ id: string; token: string }>(db, `create_shop_order($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    ["unique-names", product, 5000, "PHP", "Maria Santos", "maria@example.com", null, null, true, SECRET]);
  await fn(db, `mark_shop_order_paid($1, $2, $3, $4, $5, $6, $7, $8)`, [o.id, "cs_test_1", "pay_test_1", 5000, "PHP", product, "Kp7m-Xr4d-Tq9w", SECRET]);
  return o.token;
}

describe("024_us_names_shop.sql on the live database (v1 + 002..023)", () => {
  it("before 024 the shop leaves the \"Not a US name\" skips out", async () => {
    const db = await liveDb();
    await seed(db);
    expect(await counts(db)).toEqual({ girl_single: 1, girl_combo: 0, boy_single: 0, boy_combo: 0 });
  });

  it("after 024 a skipped \"Not a US name\" name is counted and sold, a plain skipped name is not; safe to run twice", async () => {
    const db = await liveDb();
    await db.exec(m024);
    await db.exec(m024);
    await seed(db);
    expect(await counts(db)).toEqual({ girl_single: 2, girl_combo: 0, boy_single: 1, boy_combo: 0 });
    const d = await fn<{ status: string; names: { name: string; status: string; autopilot_note: string | null }[] }>(db, `download_shop_order($1)`, [await paidOrder(db)]);
    expect(d.status).toBe("ok");
    expect(d.names.map((n) => [n.name, n.status, n.autopilot_note])).toEqual([["Sakura", "skip", "Not a US name"], ["Wren", "available", null]]);
  });

  it("needs 019 and 022 first", async () => {
    const db = new PGlite();
    for (const sql of [v1, ...ALL.slice(0, 17)]) await db.exec(sql); // up to 018
    await expect(db.exec(m024)).rejects.toThrow(/needs 019_shop.sql and 022_autopilot.sql first/);
  });
});

describe("fresh schema.sql matches the live database + 024", () => {
  it("has the same shop_info and download_shop_order", async () => {
    const defs = async (db: PGlite) => (await db.query<{ proname: string; def: string }>(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname in ('shop_info','download_shop_order') order by 1`))
      .rows.map((r) => ({ ...r, def: r.def.replace(/\r\n/g, "\n") }));
    const live = await liveDb();
    await live.exec(m024);
    const want = await defs(live);
    expect(want).toHaveLength(2);
    expect(await defs(await freshDb())).toEqual(want);
  });

  it("counts the same way", async () => {
    const db = await freshDb();
    await seed(db);
    expect(await counts(db)).toEqual({ girl_single: 2, girl_combo: 0, boy_single: 1, boy_combo: 0 });
  });
});
