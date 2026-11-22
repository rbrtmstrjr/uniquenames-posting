import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// 023 adds the front card: cards.kind 'cover' (one per post), cards.title_pos (top / bottom) and settings.cover_enabled.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql", "019_shop.sql",
  "020_one_claim.sql", "021_facebook_posting.sql", "022_autopilot.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m023 = stripSupabase(read("supabase", "migrations", "023_front_card.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...ALL]) await db.exec(sql);
  return db;
}
async function seedPost(db: PGlite) {
  const theme = (await one<{ id: string }>(db, `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ('T' || gen_random_uuid(),'boy','b','o','p','l','c') returning id`)).id;
  const post = (await one<{ id: string }>(db, `insert into posts (post_date, gender, style, theme_id, caption, status) values ('2026-11-22','boy','single',$1,'c','generating') returning id`, [theme])).id;
  return { theme, post };
}
const insertCover = (db: PGlite, post: string, theme: string, titlePos: string | null = "top") =>
  db.query(`insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed, order_index, title_pos)
    values ($1,$2,'cover',0,'''S'' Names','for baby boy','front card: wide: x','p',3,0,$3) returning id`, [post, theme, titlePos]);

describe("023_front_card.sql on the live database (v1 + 002..022)", () => {
  it("before 023 a front card is refused by the kind check (the app then skips it)", async () => {
    const db = await liveDb();
    const { post, theme } = await seedPost(db);
    await expect(db.query(`insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed, order_index)
      values ($1,$2,'cover',0,'x','','front card: wide: x','p',3,0)`, [post, theme])).rejects.toThrow(/cards_kind_check/);
  });

  it("adds kind 'cover' (one per post), title_pos (top / bottom) and cover_enabled (on); safe to run twice", async () => {
    const db = await liveDb();
    await db.exec(m023);
    await db.exec(m023);
    await db.exec(`insert into public.settings (id) values (1) on conflict do nothing`);
    expect(await one(db, `select cover_enabled from settings where id = 1`)).toEqual({ cover_enabled: true });
    const { post, theme } = await seedPost(db);
    await insertCover(db, post, theme, "bottom");
    expect(await one(db, `select kind, position, order_index, title_pos from cards where kind = 'cover'`))
      .toEqual({ kind: "cover", position: 0, order_index: 0, title_pos: "bottom" });
    await expect(insertCover(db, post, theme)).rejects.toThrow(/cards_one_cover/);
    const other = await seedPost(db);
    await expect(insertCover(db, other.post, other.theme, "middle")).rejects.toThrow(/cards_title_pos_check/);
    // the other kinds are untouched: name cards and the closing card still go in, with no title place
    await db.query(`insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed) values ($1,$2,'post',1,'Arlo','m','s','p',1)`, [post, theme]);
    await db.query(`insert into cards (post_id, theme_id, kind, position, name, meaning, shot, prompt, seed) values ($1,$2,'cta',2,'Follow','','closing card: s','p',2)`, [post, theme]);
    expect(await one(db, `select count(*)::int n from cards where title_pos is null`)).toEqual({ n: 2 });
  });
});

describe("fresh schema.sql matches the live database + 023", () => {
  it("has the same rules", async () => {
    const db = await freshDb();
    expect(await one(db, `select cover_enabled from settings where id = 1`)).toEqual({ cover_enabled: true });
    const { post, theme } = await seedPost(db);
    await insertCover(db, post, theme);
    await expect(insertCover(db, post, theme)).rejects.toThrow(/cards_one_cover/);
  });

  it("has the same columns, constraints and indexes on settings and cards", async () => {
    const TABLES = "('settings','cards')";
    const shape = async (db: PGlite) => ({
      columns: (await db.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema='public' and table_name in ${TABLES} order by table_name, column_name`)).rows,
      constraints: (await db.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint
        where conrelid::regclass::text in ${TABLES} order by 1, 2`)).rows,
      indexes: (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ${TABLES} order by 1, 2`)).rows,
    });
    const live = await liveDb();
    await live.exec(m023);
    const want = await shape(live);
    expect((want.indexes as { indexname: string }[]).map((i) => i.indexname)).toContain("cards_one_cover");
    expect(await shape(await freshDb())).toEqual(want);
  });
});
