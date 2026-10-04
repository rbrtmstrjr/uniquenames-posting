import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export function schemaForTests(): string {
  const sql = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");
  return sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
}

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(schemaForTests());
  return db;
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
