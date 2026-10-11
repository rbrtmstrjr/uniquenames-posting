import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activePack, DEFAULT_NICHE, nicheId, packById, PACK_IDS } from "@/packs";
import { brand, sharedPack } from "@/packs/shared";
import { brandCss } from "@/packs/theme";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const filesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? filesUnder(p) : [p];
  });

const saved = process.env.NICHE;
afterEach(() => {
  if (saved === undefined) delete process.env.NICHE;
  else process.env.NICHE = saved;
});

describe("NICHE selects the pack", () => {
  it("defaults to unique-names when unset or blank", () => {
    delete process.env.NICHE;
    expect(nicheId()).toBe(DEFAULT_NICHE);
    process.env.NICHE = "  ";
    expect(nicheId()).toBe("unique-names");
    expect(activePack().id).toBe("unique-names");
  });

  it("refuses an unknown pack instead of posting as another page", () => {
    process.env.NICHE = "no-such-page";
    expect(() => nicheId()).toThrow(/Unknown NICHE "no-such-page"/);
    expect(() => activePack()).toThrow();
    expect(() => sharedPack()).toThrow();
  });

  it("every registered pack's full form carries its client-safe part", () => {
    for (const id of PACK_IDS) {
      process.env.NICHE = id;
      const full = packById(id);
      const shared = sharedPack();
      expect(full.id).toBe(id);
      const { cards: _c, captions: _p, suggest: _s, reels: _r, pdf: _d, shop: _h, ...clientPart } = full;
      expect(clientPart).toEqual(shared);
      expect([_c, _p, _s, _r, _d, _h].every(Boolean)).toBe(true);
    }
  });
});

describe("unique-names brand (today's live values)", () => {
  it("names, handle and texts", () => {
    delete process.env.NICHE;
    expect(brand()).toMatchObject({
      name: "Unique Names", description: "Daily name-card posts", mark: "✿", handle: "@unique_names",
      loginTagline: "Welcome back to the studio", loginFooter: "Every name is a blessing ✿",
      postReadyText: "Your Unique Names cards are done.", zipPrefix: "unique-names", pcFolder: "Unique Names", postingTimeHint: "",
    });
    expect(brand().assets).toEqual({
      icon: "/icon.svg",
      login: { lightWide: "/login/light-wide.webp", lightTall: "/login/light-tall.webp", darkWide: "/login/dark-wide.webp", darkTall: "/login/dark-tall.webp" },
      loginColor: { light: "#EFE3D2", dark: "#3A2418" },
    });
  });

  it("its assets exist in public/", () => {
    const a = brand().assets;
    for (const p of [a.icon, ...Object.values(a.login)]) expect(statSync(join(root, "public", p)).isFile()).toBe(true);
  });

  it("its colours are exactly app/globals.css's (the fallbacks), so the injected tokens change nothing", () => {
    const css = read("app/globals.css");
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
    const tokens = (b: string) => Object.fromEntries([...b.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const light = tokens(block(":root")), dark = tokens(block(".dark"));
    const c = brand().colors;
    for (const [k, v] of Object.entries(c.light)) expect([k, light[k]]).toEqual([k, v]);
    for (const [k, v] of Object.entries(c.dark)) expect([k, dark[k]]).toEqual([k, v]);
    expect(c.themeColor).toEqual({ light: light.bg, dark: dark.bg });
  });

  it("brandCss: html:root / html.dark tokens, nothing else gets through", () => {
    expect(brandCss({ light: { bg: "#FFF", accent: "#A8323A" }, dark: { bg: "#000" }, themeColor: { light: "#FFF", dark: "#000" } }))
      .toBe("html:root{--bg:#FFF;--accent:#A8323A}html.dark{--bg:#000}");
    expect(brandCss({ light: { "x}body{": "red", ok: "red;}</style>" }, dark: {}, themeColor: { light: "", dark: "" } })).toBe("html:root{}html.dark{}");
  });
});

describe("pack modules stay plain and the prompts stay out of the browser", () => {
  const packFiles = filesUnder("packs").filter((f) => f.endsWith(".ts"));

  it("no pack module is a client or server-only module", () => {
    for (const f of packFiles) {
      const src = read(f);
      expect([f, /^\s*["']use (client|server)["']/m.test(src)]).toEqual([f, false]);
      expect([f, src.includes("server-only")]).toEqual([f, false]);
    }
  });

  it("the client-safe modules never import the full pack", () => {
    for (const f of ["packs/shared.ts", "packs/theme.ts", "packs/niche.ts", ...packFiles.filter((p) => /[\\/]shared\.ts$/.test(p))]) {
      expect([f, /from\s+["'](?:@\/packs|\.\/index|\.\.\/index|\.\/unique-names|\.\/name-nest)["']/.test(read(f).replace(/import type[^;]+;/g, ""))]).toEqual([f, false]);
    }
  });

  const clientFiles = [...filesUnder("components"), ...filesUnder("app"), ...filesUnder("lib")]
    .filter((f) => /\.tsx?$/.test(f) && /^\s*["']use client["']/m.test(read(f)));

  it("client components read packs/shared, never @/packs", () => {
    expect(clientFiles.length).toBeGreaterThan(10);
    for (const f of clientFiles) expect([f, /from\s+["']@\/packs["']/.test(read(f))]).toEqual([f, false]);
  });

  it("nothing a client component loads (transitively) reaches the full pack", () => {
    // Value imports only (import type is erased); server actions ("use server") reach the browser as references.
    const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? join(root, from, "..", spec) : null;
      if (!base) return null;
      for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        try { if (statSync(base + ext).isFile()) return (base + ext).slice(root.length + 1); } catch { /* next */ }
      }
      return null;
    };
    const seen = new Set<string>();
    const walk = (f: string, chain: string[]) => {
      if (seen.has(f)) return;
      seen.add(f);
      const src = read(f);
      if (/^\s*["']use server["']/m.test(src)) return;
      expect([chain.join(" > "), f.replace(/\\/g, "/")]).not.toEqual([chain.join(" > "), "packs/index.ts"]);
      for (const m of src.matchAll(IMPORT_RE)) {
        const next = resolve(f, m[1]);
        if (next && /\.tsx?$/.test(next)) walk(next, [...chain, f]);
      }
    };
    for (const f of clientFiles) walk(f, []);
    expect(seen.size).toBeGreaterThan(clientFiles.length);
  });
});

describe("settings seed", () => {
  it("unique-names = the supabase/schema.sql column defaults (the live project keeps its rows untouched)", async () => {
    const { settingsSeed } = await import("@/packs/seed");
    const sql = read("supabase/schema.sql");
    const table = sql.slice(sql.indexOf("create table if not exists public.settings"), sql.indexOf("insert into public.settings"));
    const literal = (col: string) => {
      const m = table.match(new RegExp(String.raw`\n\s*${col} text not null default\s+(E?)'((?:[^']|'')*)'`));
      if (!m) throw new Error(`no default for ${col}`);
      const s = m[2].replace(/''/g, "'");
      return m[1] ? s.replace(/\\n/g, "\n") : s;
    };
    const seed = settingsSeed(packById("unique-names"));
    for (const [col, v] of Object.entries(seed)) expect([col, literal(col)]).toEqual([col, v]);
  });
});
