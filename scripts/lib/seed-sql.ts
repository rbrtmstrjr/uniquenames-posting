// The SQL that seeds a NEW Supabase project for a pack: its settings (packs/seed settingsSeed), its starter themes and
// its names. Safe to run more than once: settings are set again, existing themes / names are kept. Pure (tested in
// tests/name-nest-seed.test.ts); scripts/seed-name-nest.ts writes supabase/seed/name-nest.sql with it.
import type { Gender } from "@/lib/db/types";

export interface SeedThemeRow { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string }
export interface SeedNameRow { name: string; meaning: string; gender: Gender; style: "single" | "two-word"; origin: string | null; us_rank: number | null; us_year: number | null }

/** A SQL string literal: E'...' with backslashes, quotes and line breaks escaped. */
export const lit = (s: string) => `E'${s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\r?\n/g, "\\n")}'`;
const val = (v: string | number | null) => (v === null ? "null" : typeof v === "number" ? String(Math.trunc(v)) : lit(v));

export function seedSql(o: { pack: string; settings: Record<string, string>; themes: SeedThemeRow[]; names: SeedNameRow[]; note?: string }): string {
  const out = [
    `-- Seed for a NEW ${o.pack} Supabase project (docs/SETUP-NAME-NEST.md). Run AFTER supabase/schema.sql. Safe to run again.`,
    ...(o.note ? [`-- ${o.note}`] : []),
    "begin;",
    "",
    ...(o.settings.handle
      ? [
          "-- Guard: never seed a database that already holds another page's work (e.g. the live Unique Names project).",
          "do $$ begin",
          `  if (exists (select 1 from public.names) or exists (select 1 from public.posts))`,
          `     and not exists (select 1 from public.settings where id = 1 and handle = ${lit(o.settings.handle)}) then`,
          `    raise exception 'STOP: this database already has names or posts and is not ${o.pack}. Run this seed only in the new ${o.pack} project.';`,
          "  end if;",
          "end $$;",
          "",
        ]
      : []),
    "-- settings: the page's handle, caption template, hashtags, closing-card messages, narrator, card fonts and layout",
    `update public.settings set ${Object.entries(o.settings).map(([k, v]) => `${k} = ${lit(v)}`).join(", ")}, updated_at = now() where id = 1;`,
    "",
    `-- ${o.themes.length} starter photoshoot themes, in use order (available)`,
    "insert into public.themes (title, gender, backdrop, outfit, props, lighting, palette, sort_order) values",
    o.themes.map((t, i) => `  (${[t.title, t.gender, t.backdrop, t.outfit, t.props, t.lighting, t.palette].map(lit).join(", ")}, ${i + 1})`).join(",\n"),
    "on conflict (title) do nothing;",
    "",
    `-- ${o.names.length} names, 'pending': approve them on the Names page (Pending > Approve all) before they are used`,
  ];
  for (let i = 0; i < o.names.length; i += 250) {
    out.push("insert into public.names (name, meaning, gender, style, origin, us_rank, us_year, status) values",
      o.names.slice(i, i + 250).map((n) => `  (${[n.name, n.meaning, n.gender, n.style].map(lit).join(", ")}, ${val(n.origin)}, ${val(n.us_rank)}, ${val(n.us_year)}, 'pending')`).join(",\n"),
      "on conflict (lower(name)) do nothing;");
  }
  out.push("", "commit;", "");
  return out.join("\n");
}
