import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";
import { filterNameSuggestions, filterThemeSuggestions } from "@/lib/ai/suggest-filter";

// The rows the suggest actions insert, against the real v2 schema (PGlite): pending rows are
// accepted, never planned, and approve/reject touch only pending rows.
let db: PGlite;
beforeEach(async () => { db = await freshDb(); });

const insertName = (r: { name: string; meaning: string; gender: string; style: string; status: string }) =>
  db.query(`insert into names (name, meaning, gender, style, status) values ($1,$2,$3,$4,$5)`, [r.name, r.meaning, r.gender, r.style, r.status]);

describe("pending suggestions in the v2 schema", () => {
  it("stores filtered name suggestions as pending; the lower(name) index backs the filter", async () => {
    const { fresh } = filterNameSuggestions([{ name: "  wren   solene ", meaning: "Little Bird Of The Sun" }], [], "two-word");
    await insertName({ ...fresh[0], gender: "girl", style: "two-word", status: "pending" });
    const row = await one<{ name: string; meaning: string; status: string }>(db, `select name, meaning, status from names`);
    expect(row).toEqual({ name: "Wren Solene", meaning: "little bird of the sun", status: "pending" });
    await expect(insertName({ name: "WREN SOLENE", meaning: "x y", gender: "girl", style: "two-word", status: "pending" })).rejects.toThrow();
  });

  it("stores filtered theme suggestions as pending, and create_post refuses a pending theme", async () => {
    const { fresh } = filterThemeSuggestions([{
      title: "Forest Nook", backdrop: "smooth seamless deep sage studio backdrop", outfit: "knitted forest green romper",
      props: "soft felt squirrel toy, small wooden acorn", lighting: "soft diffused light, peaceful", palette: "sage, cream, light brown",
    }], [], "boy");
    const t = fresh[0];
    const { id } = await one<{ id: string }>(db,
      `insert into themes (title, gender, backdrop, outfit, props, lighting, palette, status, sort_order) values ($1,$2,$3,$4,$5,$6,$7,'pending',9) returning id`,
      [t.title, t.gender, t.backdrop, t.outfit, t.props, t.lighting, t.palette]);
    const n = await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ('Orion Vale','hunter of the valley','boy','two-word') returning id`);
    const r = await one<{ r: { status: string; reason?: string } }>(db, `select create_post($1::jsonb) as r`, [JSON.stringify({
      request_id: crypto.randomUUID(), post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: id, caption: "c",
      cards: [{ position: 1, name_id: n.id, name: "Orion Vale", meaning: "m", shot: "s", prompt: "p", seed: 1 }],
    })]);
    expect(r.r).toEqual({ status: "conflict", reason: "theme" });
  });

  it("approve/reject statements only touch pending rows", async () => {
    for (const [name, status] of [["Aa Bb", "pending"], ["Cc Dd", "available"], ["Ee Ff", "used"]]) {
      await insertName({ name, meaning: "m m", gender: "boy", style: "two-word", status });
    }
    await db.query(`delete from names where status = 'pending' and name in ('Aa Bb','Cc Dd','Ee Ff')`);
    const left = await db.query<{ name: string }>(`select name from names order by name`);
    expect(left.rows.map((x) => x.name)).toEqual(["Cc Dd", "Ee Ff"]);
  });
});
