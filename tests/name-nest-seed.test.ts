import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshDb, one } from "./helpers/pglite";
import { NAME_NEST_THEMES } from "@/packs/name-nest/seed/themes";
import { SEED_THEMES } from "@/supabase/seed/themes";
import { propsKey, themeTitleKey, unsafeThemeWording } from "@/lib/ai/suggest-filter";
import { NAME_RE } from "@/lib/names/bulk-paste";
import { packById } from "@/packs";
import { settingsSeed } from "@/packs/seed";
import { lit, seedSql } from "@/scripts/lib/seed-sql";
import { nameNestSeed } from "@/scripts/lib/name-nest-seed";
import { meaningProblem, originProblem, type NameFacts } from "@/scripts/lib/meanings";
import type { SsaName } from "@/scripts/lib/ssa";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const ssa = JSON.parse(read("packs", "name-nest", "seed", "ssa-names.json")) as { year: number; names: SsaName[] };
const facts = JSON.parse(read("packs", "name-nest", "seed", "name-meanings.json")) as Record<string, NameFacts>;

describe("Name Nest starter themes", () => {
  it("40 themes, 20 per gender, unique titles, studio backdrops, safe wording", () => {
    expect(NAME_NEST_THEMES.filter((t) => t.gender === "boy")).toHaveLength(20);
    expect(NAME_NEST_THEMES.filter((t) => t.gender === "girl")).toHaveLength(20);
    expect(new Set(NAME_NEST_THEMES.map((t) => themeTitleKey(t.title))).size).toBe(40);
    for (const t of NAME_NEST_THEMES) {
      expect(t.backdrop).toMatch(/^smooth seamless .* studio backdrop/);
      expect([t.title, unsafeThemeWording(t)]).toEqual([t.title, null]);
      expect([t.title, t.title.length <= 40]).toEqual([t.title, true]);
      const n = t.props.split(",").length;
      expect([t.title, n >= 2 && n <= 4]).toEqual([t.title, true]);
    }
  });

  it("every theme has exactly one strawberry-red accent prop", () => {
    for (const t of NAME_NEST_THEMES) expect([t.title, (t.props.match(/strawberry-red/g) ?? []).length]).toEqual([t.title, 1]);
  });

  it("covers the American nursery styles and the US holidays", () => {
    const titles = NAME_NEST_THEMES.map((t) => t.title).join(" | ");
    for (const w of ["Farmhouse", "Boho", "Scandi", "Americana", "Cabin", "Garden", "Thanksgiving", "Christmas", "Fourth of July", "Halloween|Pumpkin", "Back-to-School", "Easter", "Valentine"]) {
      expect([w, new RegExp(w).test(titles)]).toEqual([w, true]);
    }
  });

  it("never reuses a Unique Names title or prop set", () => {
    const unTitles = new Set(SEED_THEMES.map((t) => themeTitleKey(t.title)));
    const unProps = new Set(SEED_THEMES.map((t) => propsKey(t.props)));
    for (const t of NAME_NEST_THEMES) {
      expect([t.title, unTitles.has(themeTitleKey(t.title))]).toEqual([t.title, false]);
      expect([t.title, unProps.has(propsKey(t.props))]).toEqual([t.title, false]);
    }
  });
});

describe("Name Nest names (SSA + validated AI meanings)", () => {
  it("the SSA list: 500 girl + 500 boy single names, each once, with the SSA rank and year", () => {
    expect(ssa.names.filter((n) => n.gender === "girl")).toHaveLength(500);
    expect(ssa.names.filter((n) => n.gender === "boy")).toHaveLength(500);
    expect(new Set(ssa.names.map((n) => n.name.toLowerCase())).size).toBe(1000);
    for (const n of ssa.names) {
      expect([n.name, NAME_RE.test(n.name), n.style, n.us_year, n.us_rank >= 1]).toEqual([n.name, true, "single", ssa.year, true]);
    }
    expect(ssa.year).toBeGreaterThanOrEqual(2024);
    expect(ssa.names[0]).toMatchObject({ gender: "girl", us_rank: 1 });
  });

  it("every stored meaning and origin passes the checks; most names have one", () => {
    const names = new Set(ssa.names.map((n) => n.name));
    for (const [name, f] of Object.entries(facts)) {
      expect([name, names.has(name), meaningProblem(f.meaning), originProblem(f.origin)]).toEqual([name, true, null, null]);
    }
    expect(Object.keys(facts).length).toBeGreaterThanOrEqual(900);
  });
});

describe("the seed SQL for the new project", () => {
  it("is up to date with the pack and the seed data (re-run scripts/seed-name-nest.ts after a change)", () => {
    const sql = read("supabase", "seed", "name-nest.sql").replace(/\r\n/g, "\n");
    expect(sql).toBe(nameNestSeed(root).sql);
    expect(sql).toContain(lit("@namenest"));
  });

  it("runs on a fresh schema.sql project, twice: settings, themes and pending names with origin / rank", async () => {
    const db = await freshDb();
    const sql = read("supabase", "seed", "name-nest.sql");
    await db.exec(sql);
    await db.exec(sql);
    const seed = settingsSeed(packById("name-nest"));
    const s = await one<Record<string, unknown>>(db, `select * from settings`);
    for (const [k, v] of Object.entries(seed)) expect([k, s[k]]).toEqual([k, v]);
    expect(await one(db, `select count(*)::int n from themes where status='available'`)).toEqual({ n: 40 });
    const named = ssa.names.filter((n) => facts[n.name]).length;
    expect(await one(db, `select count(*)::int n from names where status='pending' and style='single'`)).toEqual({ n: named });
    const olivia = ssa.names.find((n) => n.name === "Olivia")!;
    expect(await one(db, `select gender, us_rank, us_year, origin is not null as has_origin from names where name='Olivia'`))
      .toEqual({ gender: "girl", us_rank: olivia.us_rank, us_year: ssa.year, has_origin: true });
  });

  it("refuses to run on a database that already has names or posts and is not this page (e.g. live Unique Names)", async () => {
    const db = await freshDb();
    await db.exec(`insert into names (name, meaning, gender, style) values ('Amara', 'grace', 'girl', 'single')`);
    const sql = read("supabase", "seed", "name-nest.sql");
    await expect(db.exec(sql)).rejects.toThrow(/STOP/);
    await db.exec("rollback");   // the SQL editor rolls the failed transaction back by itself
    expect(await one(db, `select handle from settings`)).toEqual({ handle: "@unique_names" });   // nothing changed
    expect(await one(db, `select count(*)::int n from themes`)).toEqual({ n: 0 });
  });

  it("escapes quotes, backslashes and line breaks", async () => {
    const db = await freshDb();
    await db.exec(seedSql({ pack: "Test", settings: { caption_template: "it's a {gender}\\n" }, themes: [], names: [] }).replace("values\n\non conflict", "values ('x','boy','b','o','p','l','c',1) on conflict"));
    expect(await one(db, `select caption_template from settings`)).toEqual({ caption_template: "it's a {gender}\\n" });
  });
});
