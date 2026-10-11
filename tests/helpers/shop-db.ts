import { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./pglite";
import type { ShopDb } from "@/lib/shop/service";

// The shop's database for tests: a fresh schema.sql (with migration 019) in PGlite, called the way supabase-js calls
// it (`rpc(name, {p_arg: value})` -> {data, error}). The real SQL functions run, so the tests cover both sides.

export function pgliteShopDb(db: PGlite): ShopDb & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn, args = {}) {
      calls.push(fn);
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`;
      return db.query<{ r: unknown }>(sql, names.map((n) => args[n])).then(
        (res) => ({ data: res.rows[0]?.r ?? null, error: null }),
        (e: { message: string; code?: string }) => ({ data: null, error: { message: e.message, code: e.code } }),
      );
    },
  };
}

export async function shopDb(o: { key?: string; names?: [string, "girl" | "boy", "single" | "two-word"][] } = {}) {
  const db = await freshDb();
  if (o.key) await db.query(`select set_shop_secret($1)`, [o.key]);
  for (const [name, gender, style] of o.names ?? []) {
    await db.query(`insert into names (name, meaning, gender, style) values ($1, 'a kind meaning', $2, $3)`, [name, gender, style]);
  }
  return { db, rpc: pgliteShopDb(db) };
}
