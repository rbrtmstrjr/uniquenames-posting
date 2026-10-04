# Unique Names Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, mobile-first website (Vercel) plus an upgraded PC worker that lets the owner generate, review, fix, order and save the daily "Unique Names" album post, with live status at every moment.

**Architecture:** Next.js 16 App Router site talks to Supabase (Postgres + Storage + Realtime + Auth). Creating a post plans it in TypeScript (`lib/planner`) and calls one SQL function that reserves names/theme and queues cards atomically. The Python worker on the owner's PC polls Supabase with the service-role key, claims one card at a time, renders it with ComfyUI + Pillow (existing code), uploads it, and heartbeats. The browser shows everything live via Realtime.

**Tech Stack:** Next.js 16.2.9, React 19.2.4, TypeScript 5, Tailwind CSS 4, `@supabase/ssr` 0.12 + `@supabase/supabase-js` 2, `next-themes`, `sonner`, `lucide-react`, `@radix-ui/react-dialog`, `@dnd-kit/core` + `@dnd-kit/sortable`, `jszip`, Vitest 5, `@electric-sql/pglite` (SQL tests), `tsx` (import script). Worker: Python 3.12 stdlib + Pillow.

## Global Constraints

- Repo root: `C:\Users\rober\OneDrive\Documents\uniquenames-posting` (git, branch `main`). The Next.js app lives at the root; `worker/` is Python and is never imported by the app.
- Spec: `docs/superpowers/specs/2026-10-04-uniquenames-posting-design.md`. Behaviour rules there win over anything here.
- Light theme "Warm Studio": bg `#FBF6EF`, surface `#FFFFFF`, surface-2 `#F5EDE3`, line `#EADFD2`, ink `#3B2A20`, muted `#8C7768`, accent `#8A5A3B`, accent-ink `#FFFFFF`. Dark theme (warm "Dark Pro"): bg `#0F0E0D`, surface `#191715`, surface-2 `#24201C`, line `#2A2622`, ink `#F1ECE6`, muted `#9A9087`, accent `#E8A87C`, accent-ink `#1A1009`. Status: ok `#2F7A45`/`#34D399`, warn `#B7791F`/`#F5B454`, bad `#C2413B`/`#F87171` (light/dark).
- Post rules: one gender (`boy|girl`) + one style (`two-word|single`) per post; 9–13 cards (`min_images`/`max_images` from settings); Auto = seeded random in range capped by stock; first card is a baby shot; props-only shots: 1 for ≤10 cards, 2 for ≥11, never adjacent; 1080×1080; caption = template with `{gender}` + blank line + hashtags.
- Card statuses: `queued | generating | restamp | done | failed`. Post statuses: `generating | ready | posted`. Name statuses: `available | reserved | used | skip`. Theme statuses: `available | used | archived`.
- Worker offline = `worker_status.last_seen` older than 45 s. Stuck card = claimed more than 5 min ago; after 3 attempts → `failed`.
- Secrets: Vercel/`.env.local` hold only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_EMAIL`. The service-role key lives only in `worker/worker.env` and `.env.import` (both git-ignored).
- Touch targets ≥ 44 px; WCAG AA contrast; respect `prefers-reduced-motion`.
- Commit after every task with a Conventional Commit message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Structure

```
package.json, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs, vitest.config.ts
proxy.ts                         session refresh + login gate (Next 16 "proxy"; see Task 6)
app/
  globals.css                    tokens (light/dark), base styles, shimmer keyframes
  layout.tsx                     fonts, ThemeProvider, Toaster
  login/page.tsx, login/login-form.tsx
  (app)/layout.tsx               AppShell (sidebar / bottom tabs / header) — auth-gated
  (app)/page.tsx                 Today
  (app)/posts/page.tsx, (app)/posts/[id]/page.tsx
  (app)/names/page.tsx, (app)/themes/page.tsx, (app)/settings/page.tsx
components/
  ui/ (button.tsx, chip.tsx, panel.tsx, badge.tsx, dialog.tsx, empty.tsx, skeleton.tsx)
  shell/ (app-shell.tsx, nav.tsx, activity-pill.tsx, pc-status.tsx, theme-toggle.tsx, tab-title.tsx)
  cards/ (card-tile.tsx, card-dialog.tsx, card-grid.tsx)
  today/ (new-post-panel.tsx, active-post.tsx, stock.tsx)
  posts/ (post-list.tsx, post-detail.tsx, save-actions.tsx, caption-box.tsx)
  names/ (names-table.tsx, bulk-paste.tsx, name-form.tsx)
  themes/ (theme-list.tsx, theme-form.tsx)
  settings/ (settings-form.tsx)
lib/
  utils/cn.ts
  db/types.ts                    row types shared by UI, actions, planner
  planner/random.ts, planner/shots.ts, planner/prompt.ts, planner/caption.ts, planner/plan.ts, planner/index.ts
  status/card-state.ts, status/worker-health.ts, status/eta.ts
  names/bulk-paste.ts
  files/download-name.ts
  supabase/client.ts, supabase/server.ts, supabase/proxy.ts
  realtime/use-table.ts, realtime/hooks.ts, realtime/signed-urls.ts
  actions/posts.ts, actions/cards.ts, actions/names.ts, actions/themes.ts, actions/settings.ts, actions/result.ts
supabase/schema.sql              tables, triggers, functions, RLS, storage, realtime
supabase/seed/names.ts, supabase/seed/themes.ts
scripts/import.ts                one-time import (seed + 2026-10-04 post)
tests/ (*.test.ts, sql/*.test.ts, helpers/pglite.ts)
worker/ worker.py, jobs.py, supa.py, test_worker.py, test_jobs.py, worker.env.example, install-autostart.ps1, .gitignore
docs/SETUP.md, README.md
```

---

### Task 1: Project scaffold, design tokens, test runner

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `next-env.d.ts` (generated), `app/globals.css`, `app/layout.tsx`, `lib/utils/cn.ts`, `tests/smoke.test.ts`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `cn(...classes)` from `@/lib/utils/cn`; Tailwind color utilities `bg-bg bg-surface bg-surface-2 border-line text-ink text-muted bg-accent text-accent-ink bg-accent-soft text-ok text-warn text-bad`; `font-sans` (Plus Jakarta Sans), `font-display` (Fraunces); keyframes classes `animate-shimmer`, `animate-pop`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "uniquenames-posting",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "import": "tsx scripts/import.ts"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@radix-ui/react-dialog": "^1.1.15",
    "@supabase/ssr": "^0.12.0",
    "@supabase/supabase-js": "^2.108.2",
    "clsx": "^2.1.1",
    "jszip": "^3.10.1",
    "lucide-react": "^0.469.0",
    "next": "16.2.9",
    "next-themes": "^0.4.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sonner": "^2.0.8",
    "tailwind-merge": "^3.6.0"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.3.0",
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.9",
    "tailwindcss": "^4",
    "tsx": "^4.19.0",
    "typescript": "^5",
    "vitest": "^5.0.1"
  }
}
```

- [ ] **Step 2: Config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "worker"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true }, // card images come from short-lived signed URLs
};

export default nextConfig;
```

`postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`eslint.config.mjs`:
```js
import next from "eslint-config-next";

const config = [...next, { ignores: ["worker/**", ".next/**", "node_modules/**"] }];
export default config;
```

`vitest.config.ts`:
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
```

`.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
ADMIN_EMAIL=you@example.com
```

Append to `.gitignore`:
```
.env.import
next-env.d.ts
*.tsbuildinfo
worker/worker.env
worker/fonts/
worker/cache/
worker/worker.log
__pycache__/
```

- [ ] **Step 3: Tokens and base layout**

`app/globals.css`:
```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: #FBF6EF; --surface: #FFFFFF; --surface-2: #F5EDE3; --line: #EADFD2;
  --ink: #3B2A20; --muted: #8C7768; --accent: #8A5A3B; --accent-ink: #FFFFFF; --accent-soft: #F1E4D6;
  --ok: #2F7A45; --warn: #B7791F; --bad: #C2413B; --shadow: 0 1px 2px rgba(80, 50, 20, .06), 0 4px 16px rgba(80, 50, 20, .05);
}
.dark {
  --bg: #0F0E0D; --surface: #191715; --surface-2: #24201C; --line: #2A2622;
  --ink: #F1ECE6; --muted: #9A9087; --accent: #E8A87C; --accent-ink: #1A1009; --accent-soft: #2E241C;
  --ok: #34D399; --warn: #F5B454; --bad: #F87171; --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .25);
}

@theme inline {
  --color-bg: var(--bg); --color-surface: var(--surface); --color-surface-2: var(--surface-2); --color-line: var(--line);
  --color-ink: var(--ink); --color-muted: var(--muted); --color-accent: var(--accent); --color-accent-ink: var(--accent-ink);
  --color-accent-soft: var(--accent-soft); --color-ok: var(--ok); --color-warn: var(--warn); --color-bad: var(--bad);
  --font-sans: var(--font-jakarta), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-fraunces), ui-serif, Georgia, serif;
  --shadow-soft: var(--shadow);
  --animate-shimmer: shimmer 1.4s linear infinite;
  --animate-pop: pop .35s cubic-bezier(.2, .9, .3, 1.2);
  @keyframes shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
  @keyframes pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
}

html, body { background: var(--bg); color: var(--ink); }
body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
.shimmer {
  background: linear-gradient(100deg, var(--surface-2) 30%, var(--accent-soft) 50%, var(--surface-2) 70%);
  background-size: 200% 100%;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
```

`app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Fraunces } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"] });

export const metadata: Metadata = { title: "Unique Names", description: "Daily name-card posts" };
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FBF6EF" }, { media: "(prefers-color-scheme: dark)", color: "#0F0E0D" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${fraunces.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`lib/utils/cn.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Temporary `app/page.tsx` (replaced by the `(app)` route group in Task 7):
```tsx
export default function Page() {
  return <main className="p-6 font-display text-2xl">Unique Names</main>;
}
```

- [ ] **Step 4: Smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils/cn";

describe("cn", () => {
  it("merges tailwind classes, last wins", () => {
    expect(cn("p-2", "p-4", false && "hidden")).toBe("p-4");
  });
});
```

- [ ] **Step 5: Install and verify**

Run: `npm install` then `npm test` → Expected: `1 passed`. Run: `npm run build` → Expected: build succeeds. Run: `npm run lint` → no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with warm light/dark tokens and vitest"
```

---

### Task 2: Shared types and the planner (ported from n8n build)

**Files:**
- Create: `lib/db/types.ts`, `lib/planner/random.ts`, `lib/planner/shots.ts`, `lib/planner/prompt.ts`, `lib/planner/caption.ts`, `lib/planner/plan.ts`, `lib/planner/index.ts`
- Test: `tests/planner.test.ts`

**Interfaces:**
- Produces (`@/lib/db/types`): `Gender = "boy"|"girl"`, `NameStyle = "two-word"|"single"`, `NameStatus`, `ThemeStatus`, `PostStatus`, `CardStatus`, `CardKind = "post"|"preview"`, row types `NameRow`, `ThemeRow`, `PostRow`, `CardRow`, `SettingsRow`, `WorkerStatusRow` (fields exactly as in Task 4's SQL, snake_case).
- Produces (`@/lib/planner`): `hashSeed(s: string): number`, `seededRandom(seed: number): () => number`, `shuffle<T>(a: T[], rng): T[]`, `BABY_SHOTS: string[]`, `PROPS_SHOTS: string[]`, `isPropsOnly(shot): boolean`, `buildShots(n, rng): string[]`, `buildPrompt(theme: ThemePromptFields, shot: string, gender: Gender): string`, `buildCaption(gender, settings: {caption_template, hashtags}): string`, `planPost(input: PlanInput): PlanResult`, `planExtraCard(input: ExtraCardInput): ExtraCardResult`, `PREVIEW_NAME = "Sample Name"`, `PREVIEW_MEANING = "meaning appears here"`.

- [ ] **Step 1: Types**

`lib/db/types.ts`:
```ts
export type Gender = "boy" | "girl";
export type NameStyle = "two-word" | "single";
export type NameStatus = "available" | "reserved" | "used" | "skip";
export type ThemeStatus = "available" | "used" | "archived";
export type PostStatus = "generating" | "ready" | "posted";
export type CardStatus = "queued" | "generating" | "restamp" | "done" | "failed";
export type CardKind = "post" | "preview";

export interface NameRow {
  id: string; name: string; meaning: string; gender: Gender; style: NameStyle; status: NameStatus;
  post_id: string | null; position: number | null; created_at: string; updated_at: string;
}
export interface ThemeRow {
  id: string; title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string;
  status: ThemeStatus; sort_order: number; used_on: string | null; preview_card_id: string | null; created_at: string; updated_at: string;
}
export interface PostRow {
  id: string; request_id: string | null; post_date: string; gender: Gender; style: NameStyle; theme_id: string; caption: string;
  status: PostStatus; posted_at: string | null; created_at: string; updated_at: string;
}
export interface CardRow {
  id: string; post_id: string | null; theme_id: string; kind: CardKind; position: number; name_id: string | null;
  name: string; meaning: string; shot: string; prompt: string; seed: number; status: CardStatus; error: string | null;
  photo_path: string | null; card_path: string | null; version: number; selected: boolean; order_index: number;
  queued_at: string; claimed_at: string | null; started_at: string | null; finished_at: string | null; attempts: number;
  created_at: string; updated_at: string;
}
export interface SettingsRow {
  id: 1; caption_template: string; hashtags: string; handle: string; min_images: number; max_images: number;
  width: number; height: number; sound_on: boolean; updated_at: string;
}
export interface WorkerStatusRow {
  id: 1; last_seen: string | null; comfyui_ok: boolean; gpu: string | null; current_card_id: string | null;
  worker_version: string | null; message: string | null; updated_at: string;
}
```

- [ ] **Step 2: Write the failing planner tests**

`tests/planner.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  BABY_SHOTS, buildCaption, buildPrompt, buildShots, hashSeed, isPropsOnly, planExtraCard, planPost, seededRandom,
} from "@/lib/planner";
import type { NameRow, ThemeRow } from "@/lib/db/types";

const now = "2026-10-04T00:00:00Z";
let n = 0;
const name = (nm: string, gender: "boy" | "girl" = "boy", style: "two-word" | "single" = "two-word", status: NameRow["status"] = "available"): NameRow => ({
  id: `n${++n}`, name: nm, meaning: "a meaning", gender, style, status, post_id: null, position: null, created_at: now, updated_at: now,
});
const theme = (title: string, gender: "boy" | "girl", sort_order: number, status: ThemeRow["status"] = "available"): ThemeRow => ({
  id: `t-${title}`, title, gender, backdrop: "smooth seamless chocolate brown studio backdrop", outfit: "knit romper",
  props: "wicker basket, pampas grass", lighting: "soft light", palette: "brown and cream", status, sort_order, used_on: null,
  preview_card_id: null, created_at: now, updated_at: now,
});
const boys = Array.from({ length: 20 }, (_, i) => name(`Boy Name${String.fromCharCode(65 + i)}`));
const themes = [theme("Boho Pampas", "boy", 1), theme("Little Star", "boy", 2), theme("Blush Floral", "girl", 1)];
const settings = { caption_template: "Here are some beautiful names you can give to your baby {gender}. 🥰", hashtags: "#parenting #uniquenames", min_images: 9, max_images: 13 };
const req = { gender: "boy" as const, style: "two-word" as const, count: null, postDate: "2026-10-05" };

describe("random", () => {
  it("is deterministic", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    const a = seededRandom(5), b = seededRandom(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("shots", () => {
  it.each([9, 10, 11, 12, 13])("%i shots: first is a baby, right props-only count, never adjacent", (count) => {
    const s = buildShots(count, seededRandom(count));
    expect(s).toHaveLength(count);
    expect(s[0]).toBe(BABY_SHOTS[0]);
    expect(s.filter(isPropsOnly)).toHaveLength(count >= 11 ? 2 : 1);
    s.forEach((x, i) => { if (i > 0) expect(isPropsOnly(x) && isPropsOnly(s[i - 1])).toBe(false); });
  });
});

describe("prompt", () => {
  it("baby shot keeps the whole set and the no-text rule", () => {
    const p = buildPrompt(themes[0], BABY_SHOTS[0], "boy");
    expect(p).toContain("baby boy");
    expect(p).toContain("chocolate brown");
    expect(p).toContain("wicker basket");
    expect(p).toMatch(/No text, no letters/);
  });
  it("props-only never says baby photoshoot", () => {
    const p = buildPrompt(themes[0], "a props-only still life with no baby in the picture: x", "girl");
    expect(p).not.toContain("baby photoshoot");
    expect(p).toMatch(/no baby, no child, no person/);
    expect(p).toContain("wicker basket");
  });
});

describe("caption", () => {
  it("fills gender and appends hashtags", () => {
    expect(buildCaption("girl", settings)).toBe("Here are some beautiful names you can give to your baby girl. 🥰\n\n#parenting #uniquenames");
  });
});

describe("planPost", () => {
  it("plans 9-13 distinct boy names on the first boy theme", () => {
    const r = planPost({ request: req, names: boys, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards.length).toBeGreaterThanOrEqual(9);
    expect(r.cards.length).toBeLessThanOrEqual(13);
    expect(new Set(r.cards.map((c) => c.name_id)).size).toBe(r.cards.length);
    expect(r.theme_id).toBe("t-Boho Pampas");
    expect(r.cards.map((c) => c.position)).toEqual(r.cards.map((_, i) => i + 1));
    expect(r.cards.every((c) => Number.isSafeInteger(c.seed) && c.seed > 0)).toBe(true);
    expect(r.cards.every((c) => r.cards.every((d) => !c.prompt.includes(d.name)))).toBe(true);
    expect(r.caption).toContain("baby boy");
  });
  it("is deterministic for the same date", () => {
    const a = planPost({ request: req, names: boys, themes, settings });
    const b = planPost({ request: req, names: boys, themes, settings });
    expect(a).toEqual(b);
  });
  it("honours an exact count and a chosen theme", () => {
    const r = planPost({ request: { ...req, count: 12 }, names: boys, themes, settings, themeId: "t-Little Star" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards).toHaveLength(12);
    expect(r.theme_id).toBe("t-Little Star");
  });
  it("skips used, reserved and skip names and other genders/styles", () => {
    const mixed = [...boys.slice(0, 10), name("Taken One", "boy", "two-word", "used"), name("Skip Me", "boy", "two-word", "skip"), name("Girl Name", "girl"), name("Solo", "boy", "single")];
    const r = planPost({ request: { ...req, count: 10 }, names: mixed, themes, settings });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cards.map((c) => c.name).sort()).toEqual(boys.slice(0, 10).map((b) => b.name).sort());
  });
  it("stops clearly when too few names", () => {
    const r = planPost({ request: req, names: boys.slice(0, 5), themes, settings });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Only 5 unused boy two-word names/);
  });
  it("stops clearly when no theme is left", () => {
    const r = planPost({ request: req, names: boys, themes: themes.map((t) => ({ ...t, status: "used" as const })), settings });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/No unused boy theme/);
  });
  it("rejects a chosen theme of the wrong gender", () => {
    const r = planPost({ request: req, names: boys, themes, settings, themeId: "t-Blush Floral" });
    expect(r.ok).toBe(false);
  });
});

describe("planExtraCard", () => {
  it("picks one more available name with a baby shot", () => {
    const r = planExtraCard({ theme: themes[0], gender: "boy", style: "two-word", names: boys, usedNameIds: [boys[0].id], nextPosition: 10, salt: "x" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.card.position).toBe(10);
    expect(r.card.name_id).not.toBe(boys[0].id);
    expect(isPropsOnly(r.card.shot)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run tests/planner.test.ts` → Expected: FAIL, cannot resolve `@/lib/planner`.

- [ ] **Step 4: Implement the planner**

`lib/planner/random.ts`:
```ts
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: T[], rng: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

`lib/planner/shots.ts`:
```ts
import { shuffle } from "./random";

// Shots vary; the set (backdrop, outfit, props, light) never does.
export const BABY_SHOTS = [
  "a chubby {baby} around 8 months old sitting upright among the props, looking at the camera",
  "a newborn {baby} sleeping peacefully, curled up and nestled among the props, seen from slightly above",
  "a {baby} around 1 year old sitting and gently playing with one of the props",
  "a {baby} around 6 months old lying on the tummy with the head lifted, soft smile",
  "a close-up portrait of a {baby} around 9 months old with a soft smile, the props softly blurred behind",
  "a side profile of a {baby} around 1 year old sitting calmly with the hands together",
  "a wide shot of a small {baby} sitting in the middle of the set with the props around",
  "a {baby} around 10 months old laughing happily, sitting beside the props",
  "a newborn {baby} swaddled and sleeping on a soft blanket among the props",
  "a {baby} around 9 months old crawling toward the camera between the props",
  "a {baby} around 11 months old looking up curiously, sitting next to the props",
  "a {baby} around 7 months old sitting and reaching for one of the props",
];
export const PROPS_SHOTS = [
  "a props-only still life with no baby in the picture: the outfit laid out neatly among the props",
  "a props-only flat arrangement with no baby in the picture: the props and the folded outfit on the floor",
];

export const isPropsOnly = (shot: string) => /props-only/.test(shot);

export function buildShots(n: number, rng: () => number): string[] {
  const propsCount = n >= 11 ? 2 : 1;
  const babies = shuffle(BABY_SHOTS.slice(1), rng);
  const out = [BABY_SHOTS[0]];
  let b = 0;
  while (out.length < n - propsCount) out.push(babies[b++ % babies.length]);
  const props = shuffle(PROPS_SHOTS, rng).slice(0, propsCount);
  props.forEach((p, i) => {
    const at = Math.min(out.length, 2 + Math.floor(((i + 1) * (n - 2)) / (propsCount + 1)));
    out.splice(at, 0, p);
  });
  return out.slice(0, n);
}
```

`lib/planner/prompt.ts`:
```ts
import type { Gender, ThemeRow } from "@/lib/db/types";
import { isPropsOnly } from "./shots";

export type ThemePromptFields = Pick<ThemeRow, "backdrop" | "outfit" | "props" | "lighting" | "palette">;

const NO_TEXT = "No text, no letters, no words, no logo, no watermark anywhere.";
const COMPOSITION_TAIL = "props are short and low, nothing rises above the middle of the frame. The top 40 percent is only smooth empty backdrop.";

export function buildPrompt(theme: ThemePromptFields, shot: string, gender: Gender): string {
  const baby = gender === "girl" ? "baby girl" : "baby boy";
  const shotLine = "Shot: " + shot.replace(/\{baby\}/g, baby) + ".";
  if (isPropsOnly(shot)) {
    // "baby photoshoot" alone makes the model add a baby, so describe an empty set.
    return [
      "Professional studio still life photograph of an empty newborn photoshoot set, photorealistic, styled flat lay.",
      shotLine,
      "There is no baby, no child, no person and no hands anywhere in the picture. The outfit is empty, folded or laid flat.",
      `Backdrop: ${theme.backdrop}.`,
      `Outfit (empty, no one wearing it): ${theme.outfit}.`,
      `Props: ${theme.props}.`,
      `Lighting: ${theme.lighting}.`,
      `Color palette: ${theme.palette}.`,
      "Camera: 85mm lens, shallow depth of field, sharp focus on the props, high detail.",
      `Composition: square frame. Every prop sits in the lower 60 percent of the frame; ${COMPOSITION_TAIL}`,
      NO_TEXT,
    ].join("\n");
  }
  return [
    "Professional studio baby photoshoot photograph, photorealistic, fine art baby photography.",
    shotLine,
    `Backdrop: ${theme.backdrop}.`,
    `Outfit: ${theme.outfit}.`,
    `Props: ${theme.props}.`,
    `Lighting: ${theme.lighting}.`,
    `Color palette: ${theme.palette}.`,
    "Camera: 85mm lens, shallow depth of field, sharp focus on the subject, high detail, natural skin.",
    `Composition: square frame. Everything (baby and every prop) sits in the lower 60 percent of the frame; ${COMPOSITION_TAIL}`,
    NO_TEXT,
  ].join("\n");
}
```

`lib/planner/caption.ts`:
```ts
import type { Gender, SettingsRow } from "@/lib/db/types";

export function buildCaption(gender: Gender, s: Pick<SettingsRow, "caption_template" | "hashtags">): string {
  const lines = [s.caption_template.replace(/\{gender\}/g, gender)];
  if (s.hashtags.trim()) lines.push("", s.hashtags.trim());
  return lines.join("\n");
}
```

`lib/planner/plan.ts`:
```ts
import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { buildCaption } from "./caption";
import { buildPrompt } from "./prompt";
import { hashSeed, seededRandom, shuffle } from "./random";
import { BABY_SHOTS, buildShots } from "./shots";

export interface PlannedCard { position: number; name_id: string; name: string; meaning: string; shot: string; prompt: string; seed: number }
export interface PlanInput {
  request: { gender: Gender; style: NameStyle; count: number | null; postDate: string };
  names: NameRow[]; themes: ThemeRow[];
  settings: Pick<SettingsRow, "caption_template" | "hashtags" | "min_images" | "max_images">;
  themeId?: string;
}
export type PlanResult = { ok: true; theme_id: string; caption: string; cards: PlannedCard[] } | { ok: false; reason: string };

const lower = (s: string) => s.trim().toLowerCase();
const themeComplete = (t: ThemeRow) => [t.title, t.backdrop, t.outfit, t.props, t.lighting, t.palette].every((x) => x && x.trim());
const cardSeed = (date: string, name: string, k: number) => hashSeed(`${date}|${name}`) * 4096 + k;

export function availablePool(names: NameRow[], gender: Gender, style: NameStyle): NameRow[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = lower(n.name);
    const ok = key && n.meaning.trim() && n.gender === gender && n.style === style && n.status === "available" && !seen.has(key);
    if (ok) seen.add(key);
    return ok;
  });
}

export function nextTheme(themes: ThemeRow[], gender: Gender): ThemeRow | undefined {
  return themes
    .filter((t) => t.gender === gender && t.status === "available" && themeComplete(t))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))[0];
}

export function planPost(input: PlanInput): PlanResult {
  const { request: r, settings: s } = input;
  const label = r.gender;
  const pool = availablePool(input.names, r.gender, r.style);
  if (pool.length < s.min_images) {
    return { ok: false, reason: `Only ${pool.length} unused ${label} ${r.style} names are left; a post needs at least ${s.min_images}. Add names on the Names page.` };
  }
  let theme: ThemeRow | undefined;
  if (input.themeId) {
    theme = input.themeId ? input.themes.find((t) => t.id === input.themeId) : undefined;
    if (!theme || theme.gender !== r.gender || theme.status !== "available" || !themeComplete(theme)) {
      return { ok: false, reason: "That theme is not available for a " + label + " post. Pick another theme." };
    }
  } else {
    theme = nextTheme(input.themes, r.gender);
    if (!theme) return { ok: false, reason: `No unused ${label} theme is left. Add a theme on the Themes page.` };
  }
  const rng = seededRandom(hashSeed(`${r.postDate}|${r.gender}|${r.style}`));
  const want = r.count ?? s.min_images + Math.floor(rng() * (s.max_images - s.min_images + 1));
  if (r.count !== null && (r.count < s.min_images || r.count > s.max_images)) {
    return { ok: false, reason: `Number of cards must be ${s.min_images} to ${s.max_images}.` };
  }
  const chosen = shuffle(pool, rng).slice(0, Math.min(want, pool.length));
  const shots = buildShots(chosen.length, seededRandom(hashSeed(`${r.postDate}|${r.gender}|${r.style}|shots`)));
  const cards = chosen.map((n, k) => ({
    position: k + 1, name_id: n.id, name: n.name.trim(), meaning: n.meaning.trim(), shot: shots[k],
    prompt: buildPrompt(theme!, shots[k], r.gender), seed: cardSeed(r.postDate, n.name, k),
  }));
  return { ok: true, theme_id: theme.id, caption: buildCaption(r.gender, s), cards };
}

export interface ExtraCardInput {
  theme: ThemeRow; gender: Gender; style: NameStyle; names: NameRow[]; usedNameIds: string[]; nextPosition: number; salt: string;
}
export type ExtraCardResult = { ok: true; card: PlannedCard } | { ok: false; reason: string };

export function planExtraCard(i: ExtraCardInput): ExtraCardResult {
  const pool = availablePool(i.names, i.gender, i.style).filter((n) => !i.usedNameIds.includes(n.id));
  if (!pool.length) return { ok: false, reason: `No unused ${i.gender} ${i.style} names left. Add names on the Names page.` };
  const rng = seededRandom(hashSeed(i.salt));
  const pick = pool[Math.floor(rng() * pool.length)];
  const shot = BABY_SHOTS[1 + Math.floor(rng() * (BABY_SHOTS.length - 1))];
  return {
    ok: true,
    card: { position: i.nextPosition, name_id: pick.id, name: pick.name.trim(), meaning: pick.meaning.trim(), shot,
      prompt: buildPrompt(i.theme, shot, i.gender), seed: cardSeed(i.salt, pick.name, i.nextPosition) },
  };
}
```

`lib/planner/index.ts`:
```ts
export * from "./random";
export * from "./shots";
export * from "./prompt";
export * from "./caption";
export * from "./plan";
export const PREVIEW_NAME = "Sample Name";
export const PREVIEW_MEANING = "meaning appears here";
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/planner.test.ts` → Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db lib/planner tests/planner.test.ts
git commit -m "feat(planner): port post planning rules from the n8n build with tests"
```

---

### Task 3: Status, ETA, bulk-paste and file-name helpers

**Files:**
- Create: `lib/status/card-state.ts`, `lib/status/worker-health.ts`, `lib/status/eta.ts`, `lib/names/bulk-paste.ts`, `lib/files/download-name.ts`
- Test: `tests/status.test.ts`, `tests/bulk-paste.test.ts`

**Interfaces:**
- Produces:
  - `type WorkerHealth = "ready" | "comfy-off" | "offline" | "unknown"`; `workerHealth(w: WorkerStatusRow | null, now: number): WorkerHealth`; `OFFLINE_AFTER_MS = 45000`; `lastSeenText(w, now): string` (e.g. "14 min ago").
  - `type CardVisual = "queued" | "generating" | "regenerating" | "restamp" | "done" | "failed" | "waiting"`; `cardVisual(card: Pick<CardRow,"status"|"card_path">, health: WorkerHealth): CardVisual`; `queuePosition(card, allQueued: Pick<CardRow,"id"|"status"|"queued_at"|"claimed_at">[]): number` (1-based; restamp first, then queued_at).
  - `etaSeconds(remaining: number, recentDurationsSec: number[]): number` (average of up to the last 10, default 33); `formatEta(sec): string` ("about 1 min left", "under a minute left", "about 5 min left"); `formatElapsed(sec): string` ("0:18", "1:05").
  - `parseBulkNames(text: string, defaults: { gender: Gender }): { rows: { name: string; meaning: string; gender: Gender; style: NameStyle }[]; issues: { line: number; text: string; reason: string }[] }` — accepts `Name - meaning`, `Name – meaning`, `Name: meaning`, `Name | meaning`; style inferred from word count (1 = single, 2+ = two-word); rejects names with digits or symbols, > 40 chars, meaning missing or > 80 chars, and duplicates within the paste (case-insensitive). Meaning is lower-cased.
  - `NAME_RE` (same rule as the worker): `/^\p{L}+(?:[ '\-.]\p{L}+)*$/u`.
  - `downloadName(orderNumber: number, name: string): string` → `"01-arlo-zenith.jpg"`.

- [ ] **Step 1: Failing tests**

`tests/status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cardVisual, queuePosition, workerHealth, lastSeenText } from "@/lib/status/card-state-exports";
import { etaSeconds, formatElapsed, formatEta } from "@/lib/status/eta";
import { downloadName } from "@/lib/files/download-name";
import type { WorkerStatusRow } from "@/lib/db/types";

const NOW = Date.parse("2026-10-05T10:00:00Z");
const ws = (secondsAgo: number | null, comfy = true): WorkerStatusRow => ({
  id: 1, last_seen: secondsAgo === null ? null : new Date(NOW - secondsAgo * 1000).toISOString(), comfyui_ok: comfy,
  gpu: null, current_card_id: null, worker_version: null, message: null, updated_at: "",
});

describe("workerHealth", () => {
  it("ready / comfy-off / offline / unknown", () => {
    expect(workerHealth(ws(5), NOW)).toBe("ready");
    expect(workerHealth(ws(5, false), NOW)).toBe("comfy-off");
    expect(workerHealth(ws(46), NOW)).toBe("offline");
    expect(workerHealth(ws(null), NOW)).toBe("unknown");
    expect(workerHealth(null, NOW)).toBe("unknown");
  });
  it("last seen text", () => {
    expect(lastSeenText(ws(14 * 60), NOW)).toBe("14 min ago");
    expect(lastSeenText(ws(20), NOW)).toBe("just now");
    expect(lastSeenText(ws(3 * 3600), NOW)).toBe("3 h ago");
  });
});

describe("cardVisual", () => {
  it("maps status + worker health", () => {
    expect(cardVisual({ status: "queued", card_path: null }, "ready")).toBe("queued");
    expect(cardVisual({ status: "queued", card_path: null }, "offline")).toBe("waiting");
    expect(cardVisual({ status: "generating", card_path: null }, "ready")).toBe("generating");
    expect(cardVisual({ status: "generating", card_path: "x" }, "ready")).toBe("regenerating");
    expect(cardVisual({ status: "queued", card_path: "x" }, "ready")).toBe("regenerating");
    expect(cardVisual({ status: "restamp", card_path: "x" }, "ready")).toBe("restamp");
    expect(cardVisual({ status: "restamp", card_path: "x" }, "comfy-off")).toBe("restamp");
    expect(cardVisual({ status: "restamp", card_path: "x" }, "offline")).toBe("waiting");
    expect(cardVisual({ status: "generating", card_path: "x" }, "offline")).toBe("waiting");
    expect(cardVisual({ status: "done", card_path: "x" }, "offline")).toBe("done");
    expect(cardVisual({ status: "failed", card_path: null }, "ready")).toBe("failed");
  });
  it("queue position puts restamp first then oldest", () => {
    const q = [
      { id: "a", status: "queued" as const, queued_at: "2026-10-05T09:00:00Z", claimed_at: null },
      { id: "b", status: "restamp" as const, queued_at: "2026-10-05T09:05:00Z", claimed_at: null },
      { id: "c", status: "queued" as const, queued_at: "2026-10-05T09:01:00Z", claimed_at: null },
    ];
    expect(queuePosition(q[0], q)).toBe(2);
    expect(queuePosition(q[1], q)).toBe(1);
    expect(queuePosition(q[2], q)).toBe(3);
  });
});

describe("eta", () => {
  it("averages recent durations, defaults to 33 s", () => {
    expect(etaSeconds(3, [])).toBe(99);
    expect(etaSeconds(2, [30, 40])).toBe(70);
    expect(etaSeconds(0, [30])).toBe(0);
  });
  it("formats", () => {
    expect(formatEta(0)).toBe("finishing…");
    expect(formatEta(40)).toBe("under a minute left");
    expect(formatEta(99)).toBe("about 2 min left");
    expect(formatElapsed(18)).toBe("0:18");
    expect(formatElapsed(65)).toBe("1:05");
  });
});

describe("downloadName", () => {
  it("numbers and slugs", () => {
    expect(downloadName(1, "Arlo Zenith")).toBe("01-arlo-zenith.jpg");
    expect(downloadName(12, "D'Angelo")).toBe("12-d-angelo.jpg");
  });
});
```

`tests/bulk-paste.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseBulkNames } from "@/lib/names/bulk-paste";

describe("parseBulkNames", () => {
  it("parses common separators and infers style", () => {
    const r = parseBulkNames("Arlo Zenith - Peak strength with calm\nLuna – the moon\nIsla Grace: calm waters\nNova | new star", { gender: "girl" });
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { name: "Arlo Zenith", meaning: "peak strength with calm", gender: "girl", style: "two-word" },
      { name: "Luna", meaning: "the moon", gender: "girl", style: "single" },
      { name: "Isla Grace", meaning: "calm waters", gender: "girl", style: "two-word" },
      { name: "Nova", meaning: "new star", gender: "girl", style: "single" },
    ]);
  });
  it("skips blank lines and reports problems with line numbers", () => {
    const r = parseBulkNames("\nArlo2 - x\nNoMeaning\nLuna - the moon\nluna - again\n" + "A".repeat(41) + " - long", { gender: "boy" });
    expect(r.rows.map((x) => x.name)).toEqual(["Luna"]);
    expect(r.issues.map((i) => [i.line, i.reason])).toEqual([
      [2, "Name can only have letters, spaces, hyphens and apostrophes."],
      [3, "Missing meaning. Use: Name - meaning"],
      [5, "Duplicate of another line in this paste."],
      [6, "Name is longer than 40 characters."],
    ]);
  });
});
```

Note: the status test imports from `@/lib/status/card-state-exports`; create that barrel so one import covers both status files.

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run tests/status.test.ts tests/bulk-paste.test.ts` → module not found.

- [ ] **Step 3: Implement**

`lib/status/worker-health.ts`:
```ts
import type { WorkerStatusRow } from "@/lib/db/types";

export type WorkerHealth = "ready" | "comfy-off" | "offline" | "unknown";
export const OFFLINE_AFTER_MS = 45_000;

export function workerHealth(w: WorkerStatusRow | null, now: number): WorkerHealth {
  if (!w || !w.last_seen) return "unknown";
  if (now - Date.parse(w.last_seen) > OFFLINE_AFTER_MS) return "offline";
  return w.comfyui_ok ? "ready" : "comfy-off";
}

export function lastSeenText(w: WorkerStatusRow | null, now: number): string {
  if (!w?.last_seen) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(w.last_seen)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
```

`lib/status/card-state.ts`:
```ts
import type { CardRow } from "@/lib/db/types";
import type { WorkerHealth } from "./worker-health";

export type CardVisual = "queued" | "generating" | "regenerating" | "restamp" | "done" | "failed" | "waiting";

export function cardVisual(card: Pick<CardRow, "status" | "card_path">, health: WorkerHealth): CardVisual {
  if (card.status === "done") return "done";
  if (card.status === "failed") return "failed";
  // Any unfinished card waits while the PC is offline. A re-stamp does not need
  // ComfyUI, so "comfy-off" does not block it.
  if (health === "offline" || health === "unknown") return "waiting";
  if (card.status === "restamp") return "restamp";
  if (card.card_path) return "regenerating";
  return card.status === "generating" ? "generating" : "queued";
}

type QueueItem = Pick<CardRow, "id" | "status" | "queued_at" | "claimed_at">;

export function queuePosition(card: QueueItem, all: QueueItem[]): number {
  const line = all
    .filter((c) => (c.status === "queued" || c.status === "restamp") && !c.claimed_at)
    .sort((a, b) => (a.status === "restamp" ? 0 : 1) - (b.status === "restamp" ? 0 : 1) || Date.parse(a.queued_at) - Date.parse(b.queued_at));
  const i = line.findIndex((c) => c.id === card.id);
  return i < 0 ? 0 : i + 1;
}
```

`lib/status/card-state-exports.ts`:
```ts
export * from "./card-state";
export * from "./worker-health";
```

`lib/status/eta.ts`:
```ts
export function etaSeconds(remaining: number, recentDurationsSec: number[]): number {
  if (remaining <= 0) return 0;
  const recent = recentDurationsSec.filter((d) => d > 0).slice(-10);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 33;
  return Math.round(remaining * avg);
}

export function formatEta(sec: number): string {
  if (sec <= 0) return "finishing…";
  if (sec < 60) return "under a minute left";
  return `about ${Math.round(sec / 60)} min left`;
}

export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
```

`lib/names/bulk-paste.ts`:
```ts
import type { Gender, NameStyle } from "@/lib/db/types";

export const NAME_RE = /^\p{L}+(?:[ '\-.]\p{L}+)*$/u;

export interface BulkRow { name: string; meaning: string; gender: Gender; style: NameStyle }
export interface BulkIssue { line: number; text: string; reason: string }

export function parseBulkNames(text: string, defaults: { gender: Gender }) {
  const rows: BulkRow[] = [];
  const issues: BulkIssue[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t) return;
    const m = t.match(/^(.+?)\s*(?:\s[-–—]\s|:|\|)\s*(.+)$/);
    if (!m) { issues.push({ line, text: t, reason: "Missing meaning. Use: Name - meaning" }); return; }
    const name = m[1].replace(/\s+/g, " ").trim();
    const meaning = m[2].replace(/\s+/g, " ").trim().toLowerCase();
    if (name.length > 40) { issues.push({ line, text: t, reason: "Name is longer than 40 characters." }); return; }
    if (!NAME_RE.test(name)) { issues.push({ line, text: t, reason: "Name can only have letters, spaces, hyphens and apostrophes." }); return; }
    if (!meaning) { issues.push({ line, text: t, reason: "Missing meaning. Use: Name - meaning" }); return; }
    if (meaning.length > 80) { issues.push({ line, text: t, reason: "Meaning is longer than 80 characters." }); return; }
    const key = name.toLowerCase();
    if (seen.has(key)) { issues.push({ line, text: t, reason: "Duplicate of another line in this paste." }); return; }
    seen.add(key);
    rows.push({ name, meaning, gender: defaults.gender, style: name.split(" ").length > 1 ? "two-word" : "single" });
  });
  return { rows, issues };
}
```

Note on the separator regex: ` - ` (spaced hyphen/en/em dash), `:` and `|` split; a hyphen inside a name like `Anne-Marie - grace` is safe because the split needs spaces around the dash.

`lib/files/download-name.ts`:
```ts
export function downloadName(order: number, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
  return `${String(order).padStart(2, "0")}-${slug}.jpg`;
}
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/status lib/names lib/files tests/status.test.ts tests/bulk-paste.test.ts
git commit -m "feat: card/worker status, ETA, bulk-paste parser and download names"
```

---

### Task 4: Database schema, functions and SQL tests

**Files:**
- Create: `supabase/schema.sql`, `tests/helpers/pglite.ts`, `tests/sql/schema.test.ts`

**Interfaces:**
- Produces SQL (all in `public`):
  - Tables `settings`, `worker_status`, `themes`, `posts`, `names`, `cards` (columns exactly as `lib/db/types.ts`).
  - `create_post(p jsonb) returns jsonb` — input `{request_id, post_date, gender, style, theme_id, caption, cards:[{position,name_id,name,meaning,shot,prompt,seed}]}`; returns `{status:"ok", post_id}` or `{status:"conflict", reason:"theme"|"names"}` or `{status:"error", reason}`.
  - `add_card(p_post uuid, c jsonb) returns jsonb` — `c` = one planned card; returns `{status:"ok", card_id}` | `{status:"conflict"}`.
  - `delete_post(p_post uuid) returns jsonb` — returns `{status:"ok", paths:[...storage paths]}`; names → available, theme → available.
  - `delete_card(p_card uuid) returns jsonb` — returns `{status:"ok", paths:[...]}`; its name → available.
  - `claim_next_card() returns jsonb` — service role only; returns `null` or `{job:"generate"|"restamp", card:{...card row}, post_date, gender_label:"Boy"|"Girl"|null}`.
  - `requeue_stuck_cards() returns int` — service role only.
  - Trigger: card status changes recompute the post status (`generating` ⇄ `ready`; `posted` is sticky) and mark the post's reserved names `used` once ready; a finished preview card sets `themes.preview_card_id`.
- Storage bucket `cards` (private). Object paths: `photos/<card_id>/v<version>.jpg` and `cards/<card_id>/v<version>.jpg`.
- `-- @supabase-only begin` / `-- @supabase-only end` markers wrap statements PGlite cannot run (RLS policies that need Supabase roles, storage, realtime). The test loader strips them.

- [ ] **Step 1: Write the schema**

`supabase/schema.sql`:
```sql
-- Unique Names posting: database. Paste the whole file into the Supabase SQL editor and run it once.

-- ---------------------------------------------------------------- tables
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  caption_template text not null default 'Here are some beautiful names you can give to your baby {gender}. 🥰',
  hashtags text not null default '#parenting #uniquenames #fypシ #highlights #follower',
  handle text not null default '@unique_names',
  min_images int not null default 9 check (min_images between 1 and 30),
  max_images int not null default 13 check (max_images between 1 and 30),
  width int not null default 1080 check (width between 512 and 2048),
  height int not null default 1080 check (height between 512 and 2048),
  sound_on boolean not null default true,
  updated_at timestamptz not null default now(),
  check (min_images <= max_images)
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.worker_status (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  comfyui_ok boolean not null default false,
  gpu text,
  current_card_id uuid,
  worker_version text,
  message text,
  updated_at timestamptz not null default now()
);
insert into public.worker_status (id) values (1) on conflict do nothing;

create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  gender text not null check (gender in ('boy', 'girl')),
  backdrop text not null, outfit text not null, props text not null, lighting text not null, palette text not null,
  status text not null default 'available' check (status in ('available', 'used', 'archived')),
  sort_order int not null default 0,
  used_on date,
  preview_card_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  post_date date not null,
  gender text not null check (gender in ('boy', 'girl')),
  style text not null check (style in ('two-word', 'single')),
  theme_id uuid not null references public.themes (id),
  caption text not null default '',
  status text not null default 'generating' check (status in ('generating', 'ready', 'posted')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.names (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  meaning text not null check (char_length(meaning) between 1 and 80),
  gender text not null check (gender in ('boy', 'girl')),
  style text not null check (style in ('two-word', 'single')),
  status text not null default 'available' check (status in ('available', 'reserved', 'used', 'skip')),
  post_id uuid references public.posts (id) on delete set null,
  position int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists names_lower_name on public.names (lower(name));

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id) on delete cascade,
  theme_id uuid not null references public.themes (id) on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'preview')),
  position int not null default 1,
  name_id uuid references public.names (id) on delete set null,
  name text not null, meaning text not null, shot text not null, prompt text not null,
  seed bigint not null,
  status text not null default 'queued' check (status in ('queued', 'generating', 'restamp', 'done', 'failed')),
  error text,
  photo_path text, card_path text,
  version int not null default 1,
  selected boolean not null default true,
  order_index int not null default 0,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz, started_at timestamptz, finished_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'preview' or post_id is not null)
);
create index if not exists cards_queue on public.cards (status, queued_at) where status in ('queued', 'restamp');
create index if not exists cards_post on public.cards (post_id, position);
alter table public.themes drop constraint if exists themes_preview_fk;
alter table public.themes add constraint themes_preview_fk foreign key (preview_card_id) references public.cards (id) on delete set null;

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['settings', 'worker_status', 'themes', 'posts', 'names', 'cards'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- post status follows its cards
create or replace function public.refresh_post(p_post uuid) returns void language plpgsql as $$
declare v_status text; v_open int; v_total int;
begin
  if p_post is null then return; end if;
  select status into v_status from public.posts where id = p_post;
  if not found or v_status = 'posted' then return; end if;
  select count(*) filter (where status <> 'done'), count(*) into v_open, v_total from public.cards where post_id = p_post;
  if v_open = 0 and v_total > 0 then
    update public.posts set status = 'ready' where id = p_post and status <> 'ready';
    update public.names set status = 'used' where post_id = p_post and status = 'reserved';
  else
    update public.posts set status = 'generating' where id = p_post and status <> 'generating';
  end if;
end $$;

create or replace function public.cards_after_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_post(old.post_id);
    return old;
  end if;
  perform public.refresh_post(new.post_id);
  if new.kind = 'preview' and new.status = 'done' then
    update public.themes set preview_card_id = new.id where id = new.theme_id and preview_card_id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists cards_after_change on public.cards;
create trigger cards_after_change after insert or delete or update of status on public.cards
  for each row execute function public.cards_after_change();

-- ---------------------------------------------------------------- create_post
create or replace function public.create_post(p jsonb) returns jsonb language plpgsql as $$
declare
  v_existing uuid; v_post uuid; v_ids uuid[]; v_locked int; v_theme public.themes%rowtype;
  v_theme_id uuid := (p->>'theme_id')::uuid;
begin
  select id into v_existing from public.posts where request_id = (p->>'request_id')::uuid;
  if found then return jsonb_build_object('status', 'ok', 'post_id', v_existing); end if;

  select array_agg((c->>'name_id')::uuid) into v_ids from jsonb_array_elements(p->'cards') c;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    return jsonb_build_object('status', 'error', 'reason', 'The plan has no cards.');
  end if;

  select * into v_theme from public.themes where id = v_theme_id for update;
  if not found or v_theme.status <> 'available' or v_theme.gender <> p->>'gender' then
    return jsonb_build_object('status', 'conflict', 'reason', 'theme');
  end if;

  select count(*) into v_locked from (
    select id from public.names
    where id = any (v_ids) and status = 'available' and gender = p->>'gender' and style = p->>'style'
    for update
  ) s;
  if v_locked <> array_length(v_ids, 1) then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;

  insert into public.posts (request_id, post_date, gender, style, theme_id, caption)
  values ((p->>'request_id')::uuid, (p->>'post_date')::date, p->>'gender', p->>'style', v_theme_id, coalesce(p->>'caption', ''))
  returning id into v_post;

  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  select v_post, v_theme_id, 'post', (c->>'position')::int, (c->>'name_id')::uuid, c->>'name', c->>'meaning',
         c->>'shot', c->>'prompt', (c->>'seed')::bigint, (c->>'position')::int
  from jsonb_array_elements(p->'cards') c;

  update public.names n set status = 'reserved', post_id = v_post, position = (c->>'position')::int
  from jsonb_array_elements(p->'cards') c where n.id = (c->>'name_id')::uuid;

  update public.themes set status = 'used', used_on = (p->>'post_date')::date where id = v_theme_id;

  return jsonb_build_object('status', 'ok', 'post_id', v_post);
exception when unique_violation then
  select id into v_existing from public.posts where request_id = (p->>'request_id')::uuid;
  return jsonb_build_object('status', 'ok', 'post_id', v_existing);
end $$;

-- ---------------------------------------------------------------- add_card
create or replace function public.add_card(p_post uuid, c jsonb) returns jsonb language plpgsql as $$
declare v_post public.posts%rowtype; v_card uuid; v_pos int;
begin
  select * into v_post from public.posts where id = p_post for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Post not found.'); end if;
  perform 1 from public.names
    where id = (c->>'name_id')::uuid and status = 'available' and gender = v_post.gender and style = v_post.style for update;
  if not found then return jsonb_build_object('status', 'conflict'); end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.cards where post_id = p_post;
  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  values (p_post, v_post.theme_id, 'post', v_pos, (c->>'name_id')::uuid, c->>'name', c->>'meaning', c->>'shot', c->>'prompt',
          (c->>'seed')::bigint, v_pos)
  returning id into v_card;
  update public.names set status = 'reserved', post_id = p_post, position = v_pos where id = (c->>'name_id')::uuid;
  if v_post.status = 'posted' then update public.posts set status = 'generating' where id = p_post; end if;
  return jsonb_build_object('status', 'ok', 'card_id', v_card);
end $$;

-- ---------------------------------------------------------------- deletes (return storage paths for the caller to remove)
create or replace function public.delete_card(p_card uuid) returns jsonb language plpgsql as $$
declare v_paths jsonb; v_name uuid;
begin
  select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb), max(name_id::text)::uuid
    into v_paths, v_name
  from public.cards, lateral unnest(array[photo_path, card_path]) x where id = p_card;
  update public.names set status = 'available', post_id = null, position = null where id = v_name and status in ('reserved', 'used');
  delete from public.cards where id = p_card;
  return jsonb_build_object('status', 'ok', 'paths', coalesce(v_paths, '[]'::jsonb));
end $$;

create or replace function public.delete_post(p_post uuid) returns jsonb language plpgsql as $$
declare v_paths jsonb; v_theme uuid;
begin
  select theme_id into v_theme from public.posts where id = p_post;
  if not found then return jsonb_build_object('status', 'ok', 'paths', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb) into v_paths
  from public.cards, lateral unnest(array[photo_path, card_path]) x where post_id = p_post;
  update public.names set status = 'available', post_id = null, position = null where post_id = p_post;
  delete from public.posts where id = p_post;
  update public.themes set status = 'available', used_on = null
    where id = v_theme and not exists (select 1 from public.posts where theme_id = v_theme);
  return jsonb_build_object('status', 'ok', 'paths', v_paths);
end $$;

-- ---------------------------------------------------------------- worker: claim + stuck recovery
create or replace function public.claim_next_card() returns jsonb language plpgsql as $$
declare v_card public.cards%rowtype; v_job text; v_date date; v_gender text;
begin
  select * into v_card from public.cards
  where claimed_at is null and status in ('restamp', 'queued')
  order by (status = 'restamp') desc, queued_at
  limit 1 for update skip locked;
  if not found then return null; end if;

  v_job := case when v_card.status = 'restamp' then 'restamp' else 'generate' end;
  update public.cards set
    claimed_at = now(), started_at = now(), error = null,
    status = case when v_job = 'generate' then 'generating' else 'restamp' end,
    attempts = attempts + case when v_job = 'generate' then 1 else 0 end
  where id = v_card.id
  returning * into v_card;

  select post_date, gender into v_date, v_gender from public.posts where id = v_card.post_id;
  return jsonb_build_object(
    'job', v_job, 'card', to_jsonb(v_card), 'post_date', v_date,
    'gender_label', case v_gender when 'boy' then 'Boy' when 'girl' then 'Girl' else null end);
end $$;

create or replace function public.requeue_stuck_cards() returns int language plpgsql as $$
declare v_n int;
begin
  with stuck as (
    select id, status, attempts from public.cards
    where claimed_at < now() - interval '5 minutes' and status in ('generating', 'restamp')
    for update skip locked
  )
  update public.cards c set
    claimed_at = null, started_at = null,
    status = case when s.status = 'generating' and s.attempts >= 3 then 'failed' when s.status = 'generating' then 'queued' else 'restamp' end,
    error = case when s.status = 'generating' and s.attempts >= 3 then 'Gave up after 3 tries: the PC stopped responding in the middle of this card.' else null end,
    queued_at = now()
  from stuck s where c.id = s.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- @supabase-only begin
-- ---------------------------------------------------------------- security
alter table public.settings enable row level security;
alter table public.worker_status enable row level security;
alter table public.themes enable row level security;
alter table public.posts enable row level security;
alter table public.names enable row level security;
alter table public.cards enable row level security;

do $$ declare t text; begin
  foreach t in array array['settings', 'themes', 'posts', 'names', 'cards'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists owner_read on public.worker_status;
create policy owner_read on public.worker_status for select to authenticated using (true);

revoke execute on function public.claim_next_card() from public, anon, authenticated;
revoke execute on function public.requeue_stuck_cards() from public, anon, authenticated;
grant execute on function public.claim_next_card() to service_role;
grant execute on function public.requeue_stuck_cards() to service_role;
revoke execute on function public.create_post(jsonb) from public, anon;
revoke execute on function public.add_card(uuid, jsonb) from public, anon;
revoke execute on function public.delete_card(uuid) from public, anon;
revoke execute on function public.delete_post(uuid) from public, anon;
revoke execute on function public.refresh_post(uuid) from public, anon;
grant execute on function public.refresh_post(uuid) to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('cards', 'cards', false) on conflict (id) do nothing;
drop policy if exists cards_read on storage.objects;
create policy cards_read on storage.objects for select to authenticated using (bucket_id = 'cards');
drop policy if exists cards_delete on storage.objects;
create policy cards_delete on storage.objects for delete to authenticated using (bucket_id = 'cards');

-- ---------------------------------------------------------------- realtime
alter table public.cards replica identity full;
alter table public.posts replica identity full;
do $$ declare t text; begin
  foreach t in array array['cards', 'posts', 'worker_status', 'themes', 'names'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
-- @supabase-only end
```

- [ ] **Step 2: PGlite helper**

`tests/helpers/pglite.ts`:
```ts
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
```

- [ ] **Step 3: Failing SQL tests**

`tests/sql/schema.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

let db: PGlite;
let themeId: string;
let nameIds: string[];

async function addTheme(title: string, gender = "boy") {
  const r = await one<{ id: string }>(db,
    `insert into themes (title, gender, backdrop, outfit, props, lighting, palette) values ($1,$2,'b','o','p','l','c') returning id`, [title, gender]);
  return r.id;
}
async function addNames(count: number, gender = "boy", style = "two-word") {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await one<{ id: string }>(db, `insert into names (name, meaning, gender, style) values ($1,'m',$2,$3) returning id`,
      [`Name${gender}${style}${i} X`, gender, style]);
    ids.push(r.id);
  }
  return ids;
}
const plan = (ids: string[], extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(), post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: themeId, caption: "cap",
  cards: ids.map((id, i) => ({ position: i + 1, name_id: id, name: `N${i}`, meaning: "m", shot: "s", prompt: "p", seed: 100 + i })),
  ...extra,
});
const createPost = async (p: unknown) => (await one<{ r: { status: string; post_id?: string; reason?: string } }>(db, `select create_post($1::jsonb) as r`, [JSON.stringify(p)])).r;
const claim = async () => (await one<{ r: { job: string; card: { id: string; status: string }; gender_label: string } | null }>(db, `select claim_next_card() as r`)).r;

beforeEach(async () => {
  db = await freshDb();
  themeId = await addTheme("Boho");
  nameIds = await addNames(10);
});

describe("create_post", () => {
  it("reserves names, uses the theme, queues cards", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    expect(r.status).toBe("ok");
    const c = await one<{ n: number }>(db, `select count(*)::int n from cards where post_id=$1 and status='queued'`, [r.post_id]);
    expect(c.n).toBe(9);
    const names = await one<{ n: number }>(db, `select count(*)::int n from names where status='reserved' and post_id=$1`, [r.post_id]);
    expect(names.n).toBe(9);
    const t = await one<{ status: string; used_on: string }>(db, `select status, used_on::text from themes where id=$1`, [themeId]);
    expect(t).toEqual({ status: "used", used_on: "2026-10-05" });
  });
  it("is idempotent per request_id", async () => {
    const p = plan(nameIds.slice(0, 9));
    const a = await createPost(p);
    const b = await createPost(p);
    expect(b.post_id).toBe(a.post_id);
    expect((await one<{ n: number }>(db, `select count(*)::int n from posts`)).n).toBe(1);
  });
  it("conflicts when a name was taken meanwhile", async () => {
    await db.query(`update names set status='used' where id=$1`, [nameIds[0]]);
    expect(await createPost(plan(nameIds.slice(0, 9)))).toEqual({ status: "conflict", reason: "names" });
    expect((await one<{ n: number }>(db, `select count(*)::int n from posts`)).n).toBe(0);
  });
  it("conflicts when the theme is used or wrong gender", async () => {
    await createPost(plan(nameIds.slice(0, 9)));
    expect((await createPost(plan([nameIds[9]]))).reason).toBe("theme");
    const girlTheme = await addTheme("Blush", "girl");
    expect((await createPost(plan([nameIds[9]], { theme_id: girlTheme }))).reason).toBe("theme");
  });
});

describe("post status follows cards", () => {
  it("becomes ready and names used when every card is done; back to generating on regenerate", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    await db.query(`update cards set status='done', card_path='x' where post_id=$1`, [r.post_id]);
    expect((await one<{ status: string }>(db, `select status from posts where id=$1`, [r.post_id])).status).toBe("ready");
    expect((await one<{ n: number }>(db, `select count(*)::int n from names where status='used'`)).n).toBe(9);
    await db.query(`update cards set status='queued' where post_id=$1 and position=1`, [r.post_id]);
    expect((await one<{ status: string }>(db, `select status from posts where id=$1`, [r.post_id])).status).toBe("generating");
  });
  it("posted stays posted", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    await db.query(`update posts set status='posted' where id=$1`, [r.post_id]);
    await db.query(`update cards set status='done' where post_id=$1`, [r.post_id]);
    expect((await one<{ status: string }>(db, `select status from posts where id=$1`, [r.post_id])).status).toBe("posted");
  });
});

describe("worker queue", () => {
  it("claims restamp first, then oldest queued; never the same card twice", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    await db.query(`update cards set status='done' where post_id=$1 and position=5`, [r.post_id]);
    await db.query(`update cards set status='restamp', queued_at=now() + interval '1 hour' where post_id=$1 and position=5`, [r.post_id]);
    const first = await claim();
    expect(first?.job).toBe("restamp");
    expect(first?.gender_label).toBe("Boy");
    const second = await claim();
    expect(second?.job).toBe("generate");
    expect(second?.card.status).toBe("generating");
    expect(second?.card.id).not.toBe(first?.card.id);
    const ids = new Set<string>([first!.card.id, second!.card.id]);
    for (let i = 0; i < 7; i++) ids.add((await claim())!.card.id);
    expect(ids.size).toBe(9);
    expect(await claim()).toBeNull();
  });
  it("requeues stuck cards and fails them after 3 attempts", async () => {
    await createPost(plan(nameIds.slice(0, 9)));
    const c = await claim();
    await db.query(`update cards set claimed_at = now() - interval '6 minutes' where id=$1`, [c!.card.id]);
    expect((await one<{ n: number }>(db, `select requeue_stuck_cards() n`)).n).toBe(1);
    expect((await one<{ status: string }>(db, `select status from cards where id=$1`, [c!.card.id])).status).toBe("queued");
    await db.query(`update cards set status='generating', attempts=3, claimed_at = now() - interval '6 minutes' where id=$1`, [c!.card.id]);
    await db.query(`select requeue_stuck_cards()`);
    const f = await one<{ status: string; error: string }>(db, `select status, error from cards where id=$1`, [c!.card.id]);
    expect(f.status).toBe("failed");
    expect(f.error).toMatch(/3 tries/);
  });
});

describe("add / delete", () => {
  it("add_card appends at the next position and reserves the name", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    const a = (await one<{ r: { status: string } }>(db, `select add_card($1, $2::jsonb) r`,
      [r.post_id, JSON.stringify({ name_id: nameIds[9], name: "N9", meaning: "m", shot: "s", prompt: "p", seed: 1 })])).r;
    expect(a.status).toBe("ok");
    expect((await one<{ m: number }>(db, `select max(position)::int m from cards where post_id=$1`, [r.post_id])).m).toBe(10);
    expect((await one<{ status: string }>(db, `select status from names where id=$1`, [nameIds[9]])).status).toBe("reserved");
  });
  it("delete_card frees the name and returns paths", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    const card = await one<{ id: string; name_id: string }>(db, `select id, name_id from cards where post_id=$1 and position=1`, [r.post_id]);
    await db.query(`update cards set photo_path='photos/a/v1.jpg', card_path='cards/a/v1.jpg' where id=$1`, [card.id]);
    const d = (await one<{ r: { paths: string[] } }>(db, `select delete_card($1) r`, [card.id])).r;
    expect(d.paths.sort()).toEqual(["cards/a/v1.jpg", "photos/a/v1.jpg"]);
    expect((await one<{ status: string }>(db, `select status from names where id=$1`, [card.name_id])).status).toBe("available");
  });
  it("delete_post frees names and the theme", async () => {
    const r = await createPost(plan(nameIds.slice(0, 9)));
    const d = (await one<{ r: { status: string } }>(db, `select delete_post($1) r`, [r.post_id])).r;
    expect(d.status).toBe("ok");
    expect((await one<{ n: number }>(db, `select count(*)::int n from names where status='available'`)).n).toBe(10);
    expect((await one<{ status: string }>(db, `select status from themes where id=$1`, [themeId])).status).toBe("available");
    expect((await one<{ n: number }>(db, `select count(*)::int n from cards`)).n).toBe(0);
  });
  it("a finished preview card becomes the theme preview", async () => {
    const c = await one<{ id: string }>(db,
      `insert into cards (theme_id, kind, name, meaning, shot, prompt, seed) values ($1,'preview','Sample Name','m','s','p',1) returning id`, [themeId]);
    await db.query(`update cards set status='done' where id=$1`, [c.id]);
    expect((await one<{ preview_card_id: string }>(db, `select preview_card_id from themes where id=$1`, [themeId])).preview_card_id).toBe(c.id);
  });
});
```

- [ ] **Step 4: Run, verify FAIL then PASS**

Run `npx vitest run tests/sql` before creating `schema.sql` → FAIL (file missing). After Step 1 → PASS. If PGlite rejects a statement outside the markers, fix the SQL (not the test) so it stays valid Postgres 15+.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql tests/helpers tests/sql
git commit -m "feat(db): schema, queue functions, post status trigger, RLS/storage/realtime with PGlite tests"
```

---

### Task 5: Seed data and the one-time import script

**Files:**
- Create: `supabase/seed/names.ts`, `supabase/seed/themes.ts`, `scripts/import.ts`, `.env.import.example`
- Test: `tests/seed.test.ts`

**Interfaces:**
- Consumes: `NAME_RE` (Task 3), `buildPrompt`, `BABY_SHOTS`, `PROPS_SHOTS` (Task 2).
- Produces: `SEED_NAMES: {name, meaning, gender, style}[]` (212), `SEED_THEMES: {title, gender, backdrop, outfit, props, lighting, palette}[]` (60, 30 per gender, in use order).
- `npm run import` reads `.env.import` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LEGACY_DIR` default `C:\Users\rober\OneDrive\Pictures\Unique Names\2026-10-04 Boy`). Idempotent: skips if any post exists.

- [ ] **Step 1: Port the seed data**

Create `supabase/seed/names.ts` and `supabase/seed/themes.ts` by converting `C:\Users\rober\OneDrive\Documents\automation\n8n-control\builds\unique-names-cards\lib\seed-data.js` mechanically:
- `names.ts`: `export const SEED_NAMES: { name: string; meaning: string; gender: Gender; style: NameStyle }[] = [...]` with the same four groups and order (boy two-word 60, girl two-word 60, boy single 45, girl single 47).
- `themes.ts`: `export const SEED_THEMES: { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string }[] = [...]` (the `theme` field renamed to `title`; same order: 30 boy then 30 girl).

Use this one-off converter (run once, then delete it; do not commit it):
```bash
node -e "
const {SEED_NAMES,SEED_THEMES}=require('C:/Users/rober/OneDrive/Documents/automation/n8n-control/builds/unique-names-cards/lib/seed-data.js');
const fs=require('fs');
fs.writeFileSync('supabase/seed/names.ts','// Starter names (ported from the n8n build). Imported once by scripts/import.ts.\nimport type { Gender, NameStyle } from \"@/lib/db/types\";\n\nexport const SEED_NAMES: { name: string; meaning: string; gender: Gender; style: NameStyle }[] = '+JSON.stringify(SEED_NAMES,null,2)+';\n');
fs.writeFileSync('supabase/seed/themes.ts','// Starter themes (ported from the n8n build), in use order. Imported once by scripts/import.ts.\nimport type { Gender } from \"@/lib/db/types\";\n\nexport const SEED_THEMES: { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string }[] = '+JSON.stringify(SEED_THEMES.map(({theme,...t})=>({title:theme,...t})),null,2)+';\n');
"
```

- [ ] **Step 2: Seed tests**

`tests/seed.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SEED_NAMES } from "@/supabase/seed/names";
import { SEED_THEMES } from "@/supabase/seed/themes";
import { NAME_RE } from "@/lib/names/bulk-paste";

describe("seed data", () => {
  it("212 valid, unique names in four buckets", () => {
    expect(SEED_NAMES).toHaveLength(212);
    expect(new Set(SEED_NAMES.map((n) => n.name.toLowerCase())).size).toBe(212);
    for (const n of SEED_NAMES) {
      expect(NAME_RE.test(n.name)).toBe(true);
      expect(n.meaning.length).toBeGreaterThan(2);
      expect(n.meaning.length).toBeLessThanOrEqual(80);
      expect(n.style === "single").toBe(n.name.split(" ").length === 1);
    }
  });
  it("60 complete studio themes, 30 per gender", () => {
    expect(SEED_THEMES.filter((t) => t.gender === "boy")).toHaveLength(30);
    expect(SEED_THEMES.filter((t) => t.gender === "girl")).toHaveLength(30);
    expect(new Set(SEED_THEMES.map((t) => t.title)).size).toBe(60);
    for (const t of SEED_THEMES) expect(t.backdrop).toMatch(/seamless .*studio backdrop/);
  });
});
```

Run `npx vitest run tests/seed.test.ts` → PASS.

- [ ] **Step 3: Import script**

`.env.import.example`:
```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
LEGACY_DIR=C:\Users\rober\OneDrive\Pictures\Unique Names\2026-10-04 Boy
```

`scripts/import.ts`:
```ts
// One-time import into a fresh Supabase project: starter names + themes, and
// the 2026-10-04 Boy post made by the n8n flow (9 finished cards from disk).
// Run: npm run import   (reads .env.import; safe to re-run: stops if any post exists)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SEED_NAMES } from "../supabase/seed/names";
import { SEED_THEMES } from "../supabase/seed/themes";
import { BABY_SHOTS, PROPS_SHOTS, buildPrompt, buildCaption, hashSeed } from "../lib/planner";

function loadEnv(file: string): Record<string, string> {
  if (!existsSync(file)) throw new Error(`${file} not found. Copy .env.import.example to .env.import and fill it in.`);
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
}

// The n8n run (execution 3313): card order, names and shots.
const LEGACY = [
  { file: "01-ronan-ellis.jpg", name: "Ronan Ellis", shot: BABY_SHOTS[0] },
  { file: "02-kian-holt.jpg", name: "Kian Holt", shot: BABY_SHOTS[3] },
  { file: "03-ryker-stone.jpg", name: "Ryker Stone", shot: BABY_SHOTS[7] },
  { file: "04-tobias-quinn.jpg", name: "Tobias Quinn", shot: BABY_SHOTS[2] },
  { file: "05-kael-orion.jpg", name: "Kael Orion", shot: BABY_SHOTS[1] },
  { file: "06-theo-alaric.jpg", name: "Theo Alaric", shot: PROPS_SHOTS[0] },
  { file: "07-cyrus-vaughn.jpg", name: "Cyrus Vaughn", shot: BABY_SHOTS[10] },
  { file: "08-nico-ashford.jpg", name: "Nico Ashford", shot: BABY_SHOTS[11] },
  { file: "09-nolan-pierce.jpg", name: "Nolan Pierce", shot: BABY_SHOTS[8] },
];

async function main() {
  const env = loadEnv(join(process.cwd(), ".env.import"));
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const legacyDir = env.LEGACY_DIR || "C:\\Users\\rober\\OneDrive\\Pictures\\Unique Names\\2026-10-04 Boy";

  const { count } = await sb.from("posts").select("id", { count: "exact", head: true });
  if (count) { console.log(`Stopping: ${count} post(s) already exist, the import already ran.`); return; }

  const themes = SEED_THEMES.map((t, i) => ({ ...t, sort_order: i + 1 }));
  const { error: te } = await sb.from("themes").upsert(themes, { onConflict: "title", ignoreDuplicates: true });
  if (te) throw te;
  const { error: ne } = await sb.from("names").insert(SEED_NAMES.map((n) => ({ ...n })));
  if (ne && !String(ne.message).includes("duplicate")) throw ne;
  console.log(`Seeded ${themes.length} themes and ${SEED_NAMES.length} names.`);

  const { data: theme } = await sb.from("themes").select("*").eq("title", "Boho Pampas").single();
  const { data: settings } = await sb.from("settings").select("*").eq("id", 1).single();
  const { data: post, error: pe } = await sb.from("posts").insert({
    post_date: "2026-10-04", gender: "boy", style: "two-word", theme_id: theme.id, caption: buildCaption("boy", settings), status: "generating",
  }).select().single();
  if (pe) throw pe;

  for (const [i, c] of LEGACY.entries()) {
    const { data: nm } = await sb.from("names").select("*").ilike("name", c.name).single();
    const { data: card, error: ce } = await sb.from("cards").insert({
      post_id: post.id, theme_id: theme.id, kind: "post", position: i + 1, order_index: i + 1, name_id: nm.id, name: nm.name,
      meaning: nm.meaning, shot: c.shot, prompt: buildPrompt(theme, c.shot, "boy"), seed: hashSeed(`2026-10-04|${nm.name}`) * 4096 + i,
      status: "queued", claimed_at: new Date().toISOString(),
    }).select().single();
    if (ce) throw ce;
    const path = `cards/${card.id}/v1.jpg`;
    const bytes = readFileSync(join(legacyDir, c.file));
    const { error: ue } = await sb.storage.from("cards").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (ue) throw ue;
    await sb.from("names").update({ status: "reserved", post_id: post.id, position: i + 1 }).eq("id", nm.id);
    const { error: de } = await sb.from("cards").update({
      status: "done", card_path: path, claimed_at: null, started_at: new Date(Date.now() - 33000).toISOString(), finished_at: new Date().toISOString(),
    }).eq("id", card.id);
    if (de) throw de;
    console.log(`  ${c.file} uploaded`);
  }
  await sb.from("themes").update({ status: "used", used_on: "2026-10-04" }).eq("id", theme.id);
  console.log("Imported the 2026-10-04 Boy post (9 cards). Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Note: the legacy cards are inserted with `claimed_at` set so the worker never picks them up before they are marked `done`. Their `photo_path` stays null, so Edit text on them falls back to regenerate (Task 8).

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed scripts/import.ts .env.import.example tests/seed.test.ts
git commit -m "feat: seed names/themes and one-time import of the first post"
```

---

### Task 6: Supabase clients, login gate, login page

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/proxy.ts`, `proxy.ts`, `app/login/page.tsx`, `app/login/login-form.tsx`, `lib/actions/result.ts`
- Test: `tests/proxy-gate.test.ts`

**Interfaces:**
- Produces: `createClient()` (browser) from `@/lib/supabase/client`; `createClient()` (server, async) and `getOwner(): Promise<User | null>` (cached; null unless email === `ADMIN_EMAIL`) from `@/lib/supabase/server`; `isOwnerEmail(email?: string | null, admin?: string): boolean` from `@/lib/supabase/proxy`; `type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }` and `fail(error: string)`, `requireOwner()` (throws if not owner) from `@/lib/actions/result`.

- [ ] **Step 1: Failing gate test**

`tests/proxy-gate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isOwnerEmail } from "@/lib/supabase/proxy";

describe("isOwnerEmail", () => {
  it("matches case-insensitively and needs a configured admin", () => {
    expect(isOwnerEmail("Robert@Example.com", "robert@example.com")).toBe(true);
    expect(isOwnerEmail("other@example.com", "robert@example.com")).toBe(false);
    expect(isOwnerEmail("robert@example.com", "")).toBe(false);
    expect(isOwnerEmail(null, "robert@example.com")).toBe(false);
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Clients and gate**

`lib/supabase/client.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

// One browser client per tab (Realtime shares its socket).
export function createClient() {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}
```

`lib/supabase/server.ts`:
```ts
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isOwnerEmail } from "./proxy";

export async function createClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* server component: proxy refreshes */ }
      },
    },
  });
}

export const getOwner = cache(async () => {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user && isOwnerEmail(user.email, process.env.ADMIN_EMAIL) ? user : null;
});
```

`lib/supabase/proxy.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export function isOwnerEmail(email?: string | null, admin?: string): boolean {
  return !!email && !!admin && email.toLowerCase() === admin.toLowerCase();
}

// Refreshes the session cookie on every request and sends anyone who is not
// the owner to /login (sign-ups are off; the email check is defense in depth).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  const owner = !!user && isOwnerEmail(user.email, process.env.ADMIN_EMAIL);
  const path = request.nextUrl.pathname;
  const carry = (res: NextResponse) => { response.cookies.getAll().forEach((c) => res.cookies.set(c)); return res; };

  if (!owner && path !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    return carry(NextResponse.redirect(url));
  }
  if (owner && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return carry(NextResponse.redirect(url));
  }
  return response;
}
```

`proxy.ts` (Next 16 renamed `middleware.ts` to `proxy.ts`; check `node_modules/next/dist/docs` or the build output. If the installed version warns that `proxy` is unknown, rename the file to `middleware.ts` and the export to `middleware`):
```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
```

`lib/actions/result.ts`:
```ts
import { getOwner } from "@/lib/supabase/server";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function requireOwner() {
  const user = await getOwner();
  if (!user) throw new Error("Not signed in.");
  return user;
}
```

- [ ] **Step 3: Login page**

`app/login/page.tsx`:
```tsx
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-display text-4xl italic text-accent">✿</div>
          <h1 className="mt-2 font-display text-3xl text-ink">Unique Names</h1>
          <p className="mt-1 text-sm text-muted">Daily name-card posts</p>
        </div>
        <LoginForm next={next && next.startsWith("/") ? next : "/"} />
      </div>
    </main>
  );
}
```

`app/login/login-form.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setError("Wrong email or password."); setBusy(false); return; }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-soft">
      <label className="block">
        <span className="text-sm font-semibold text-ink">Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent" />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}
      <button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-bold text-accent-ink transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />} Sign in
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Verify** — `npx vitest run tests/proxy-gate.test.ts` → PASS; `npm run build` → succeeds (env vars may be empty at build; pages are dynamic).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase lib/actions/result.ts proxy.ts app/login tests/proxy-gate.test.ts
git commit -m "feat(auth): owner-only login gate with Supabase SSR"
```

---

### Task 7: UI kit, live-data hooks, app shell (nav, activity pill, PC status, theme toggle)

**Files:**
- Create: `app/(app)/loading.tsx`, `components/ui/button.tsx`, `components/ui/segmented.tsx`, `components/ui/panel.tsx`, `components/ui/badge.tsx`, `components/ui/dialog.tsx`, `components/ui/empty.tsx`, `components/ui/skeleton.tsx`, `components/ui/page-header.tsx`, `lib/realtime/use-table.ts`, `lib/realtime/hooks.ts`, `lib/realtime/signed-urls.ts`, `lib/realtime/hotkey.ts`, `lib/realtime/chime.ts`, `components/shell/app-shell.tsx`, `components/shell/nav.tsx`, `components/shell/activity-pill.tsx`, `components/shell/pc-status.tsx`, `components/shell/theme-toggle.tsx`, `app/(app)/layout.tsx`
- Delete: `app/page.tsx` (the temporary page from Task 1; `app/(app)/page.tsx` replaces it in Task 9 — create a placeholder there now: `export default function Today() { return null; }`)

**Interfaces:**
- Consumes: `createClient` (browser), `getOwner`, `createClient` (server) from Task 6; `workerHealth`, `lastSeenText`, `etaSeconds`, `formatEta` from Task 3; row types from Task 2.
- Produces:
  - UI: `Button({variant:"primary"|"subtle"|"ghost"|"danger", size:"sm"|"md"|"lg", loading?})`, `Segmented<T>({value,onChange,options:{value,label}[],label})`, `Panel({title?, action?, className?, children})`, `Badge({tone:"ok"|"warn"|"bad"|"muted"|"accent", children, pulse?})`, `Dialog({open,onOpenChange,title,description?,wide?,children})`, `Empty({icon, title, text, action?})`, `Skeleton({className})`, `PageHeader({title, subtitle?, action?})`.
  - Hooks: `useRealtimeRows<T extends {id: string|number}>(table, initial, {key, filter?, sort?, refetch?}) → [rows, setRows]`; `useNow(ms=1000) → number`; `useWorker(initial: WorkerStatusRow|null) → {row, health, lastSeen}`; `useActivity(onFinish?: (postId) => void) → Activity` where `Activity = {post: PostRow|null, done, total, failed, etaText, finishedPostId: string|null}`; `useSignedUrls(paths) → (path) => string | undefined`; `useHotkey(key, handler)`; `chime()`; `notify(title, body)`.
  - `AppShell({initialWorker, soundOn, children})` used by `app/(app)/layout.tsx`.

- [ ] **Step 1: UI primitives**

`components/ui/button.tsx`:
```tsx
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "subtle" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean }

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 shadow-soft",
  subtle: "bg-surface-2 text-ink hover:bg-accent-soft",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-bad/10 text-bad hover:bg-bad/15",
};
const SIZE: Record<Size, string> = { sm: "min-h-9 px-3 text-sm rounded-lg", md: "min-h-11 px-4 text-sm rounded-xl", lg: "min-h-12 px-5 text-base rounded-xl" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-55", VARIANT[variant], SIZE[size], className)}
      {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
```

`components/ui/segmented.tsx`:
```tsx
"use client";
import { cn } from "@/lib/utils/cn";

export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("min-h-10 rounded-lg px-3.5 text-sm font-semibold transition",
            value === o.value ? "bg-accent text-accent-ink shadow-soft" : "text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

`components/ui/panel.tsx`:
```tsx
import { cn } from "@/lib/utils/cn";

export function Panel({ title, action, className, children }: { title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-xs font-bold uppercase tracking-[.08em] text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
```

`components/ui/badge.tsx`:
```tsx
import { cn } from "@/lib/utils/cn";

const TONE = { ok: "bg-ok/12 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/12 text-bad", muted: "bg-surface-2 text-muted", accent: "bg-accent-soft text-accent" };

export function Badge({ tone = "muted", pulse, className, children }: { tone?: keyof typeof TONE; pulse?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", TONE[tone], className)}>
      {pulse && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-current" /></span>}
      {children}
    </span>
  );
}
```

`components/ui/dialog.tsx`:
```tsx
"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Bottom sheet on phones, centered dialog on desktop.
export function Dialog({ open, onOpenChange, title, description, wide, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]" />
        <D.Content className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-soft animate-pop",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          wide && "sm:w-[min(94vw,920px)]")}>
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4">
            <div>
              <D.Title className="font-display text-xl text-ink">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>}
            </div>
            <D.Close className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X className="size-5" /></D.Close>
          </div>
          <div className="mt-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
```

`components/ui/empty.tsx`:
```tsx
export function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="mt-3 font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

`components/ui/skeleton.tsx`:
```tsx
import { cn } from "@/lib/utils/cn";
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer animate-shimmer rounded-xl", className)} />;
}
```

`components/ui/page-header.tsx`:
```tsx
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 2: Live-data hooks**

`lib/realtime/use-table.ts`:
```ts
"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string | number };

// Keeps a list of rows in sync with Postgres changes. `refetch` (optional)
// resyncs after the socket reconnects or the tab/phone wakes up, so events
// missed while asleep never leave stale cards on screen.
export function useRealtimeRows<T extends Row>(table: string, initial: T[], opts: {
  key: string; filter?: string; sort?: (a: T, b: T) => number; refetch?: () => Promise<T[]>;
}) {
  const [rows, setRows] = useState<T[]>(initial);
  const sortRef = useRef(opts.sort);
  const refetchRef = useRef(opts.refetch);
  sortRef.current = opts.sort;
  refetchRef.current = opts.refetch;

  useEffect(() => { setRows(initial); }, [initial]);

  useEffect(() => {
    const sb = createClient();
    const sortIt = (list: T[]) => (sortRef.current ? [...list].sort(sortRef.current) : list);
    const resync = async () => { if (refetchRef.current) setRows(sortIt(await refetchRef.current())); };
    const channel = sb.channel(`${table}:${opts.key}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(opts.filter ? { filter: opts.filter } : {}) }, (payload) => {
        setRows((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== (payload.old as T).id);
          const row = payload.new as T;
          const exists = prev.some((r) => r.id === row.id);
          return sortIt(exists ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]);
        });
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") void resync(); });
    const onVisible = () => { if (document.visibilityState === "visible") void resync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); void sb.removeChannel(channel); };
  }, [table, opts.key, opts.filter]);

  return [rows, setRows] as const;
}
```

`lib/realtime/hooks.ts`:
```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CardRow, PostRow, WorkerStatusRow } from "@/lib/db/types";
import { lastSeenText, workerHealth } from "@/lib/status/worker-health";
import { etaSeconds, formatEta } from "@/lib/status/eta";
import { useRealtimeRows } from "./use-table";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function useWorker(initial: WorkerStatusRow | null) {
  const [rows] = useRealtimeRows<WorkerStatusRow>("worker_status", initial ? [initial] : [], {
    key: "worker",
    refetch: async () => ((await createClient().from("worker_status").select("*").eq("id", 1)).data ?? []) as WorkerStatusRow[],
  });
  const now = useNow(5000);
  const row = rows[0] ?? null;
  return { row, health: workerHealth(row, now), lastSeen: lastSeenText(row, now) };
}

export async function recentDurations(): Promise<number[]> {
  const { data } = await createClient().from("cards").select("started_at, finished_at")
    .eq("status", "done").not("finished_at", "is", null).not("started_at", "is", null)
    .order("finished_at", { ascending: false }).limit(10);
  return (data ?? []).map((c) => (Date.parse(c.finished_at!) - Date.parse(c.started_at!)) / 1000).filter((s) => s > 0 && s < 600);
}

export interface Activity { post: PostRow | null; done: number; total: number; failed: number; etaText: string; finishedPostId: string | null }

// Powers the header pill on every page. Refetches a small summary whenever a
// card or post changes (debounced), instead of tracking every row.
export function useActivity(onFinish?: (postId: string) => void): Activity {
  const [state, setState] = useState<Activity>({ post: null, done: 0, total: 0, failed: 0, etaText: "", finishedPostId: null });
  const lastActive = useRef<string | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: posts } = await sb.from("posts").select("*").eq("status", "generating").order("created_at", { ascending: false }).limit(1);
    const post = (posts?.[0] ?? null) as PostRow | null;
    if (!post) {
      const finished = lastActive.current;
      lastActive.current = null;
      if (finished) {
        onFinishRef.current?.(finished);
        setState({ post: null, done: 0, total: 0, failed: 0, etaText: "", finishedPostId: finished });
        setTimeout(() => setState((s) => (s.finishedPostId === finished ? { ...s, finishedPostId: null } : s)), 20000);
      } else setState((s) => ({ ...s, post: null }));
      return;
    }
    lastActive.current = post.id;
    const { data: cards } = await sb.from("cards").select("status").eq("post_id", post.id);
    const list = (cards ?? []) as Pick<CardRow, "status">[];
    const done = list.filter((c) => c.status === "done").length;
    const failed = list.filter((c) => c.status === "failed").length;
    const remaining = list.length - done - failed;
    setState({ post, done, total: list.length, failed, etaText: formatEta(etaSeconds(remaining, await recentDurations())), finishedPostId: null });
  }, []);

  useEffect(() => {
    void load();
    const sb = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const kick = () => { clearTimeout(t); t = setTimeout(() => void load(), 400); };
    const ch = sb.channel("activity").on("postgres_changes", { event: "*", schema: "public", table: "cards" }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, kick).subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") kick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVisible); void sb.removeChannel(ch); };
  }, [load]);

  return state;
}
```

`lib/realtime/signed-urls.ts`:
```ts
"use client";
import { useEffect, useReducer } from "react";
import { createClient } from "@/lib/supabase/client";

const cache = new Map<string, { url: string; exp: number }>();

// Private bucket: images are shown through signed URLs (1 h), cached per path.
// Paths include the card version, so a regenerated card never shows the old image.
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const key = wanted.join("|");
  useEffect(() => {
    const need = wanted.filter((p) => { const c = cache.get(p); return !c || c.exp < Date.now() + 60_000; });
    if (!need.length) return;
    let alive = true;
    void createClient().storage.from("cards").createSignedUrls(need, 3600).then(({ data }) => {
      (data ?? []).forEach((d) => { if (d.path && d.signedUrl) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3_600_000 }); });
      if (alive) bump();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (p?: string | null) => (p ? cache.get(p)?.url : undefined);
}

export async function signedUrlsNow(paths: string[]): Promise<Record<string, string>> {
  const { data } = await createClient().storage.from("cards").createSignedUrls(paths, 600);
  return Object.fromEntries((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path!, d.signedUrl]));
}
```

`lib/realtime/hotkey.ts`:
```ts
"use client";
import { useEffect, useRef } from "react";

// Single-key shortcuts on desktop; ignored while typing in a field.
export function useHotkey(key: string, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (e.key.toLowerCase() === key) { e.preventDefault(); ref.current(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [key]);
}
```

`lib/realtime/chime.ts`:
```ts
"use client";

export function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.35);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.16); o.stop(ctx.currentTime + i * 0.16 + 0.4);
    });
  } catch { /* audio blocked: silent */ }
}

export function notify(title: string, body: string) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
    new Notification(title, { body, icon: "/icon.svg" });
  }
}
```

Also create `public/icon.svg` (the ✿ mark on the accent color) and `app/icon.svg` with the same content:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#8A5A3B"/><text x="32" y="44" font-size="36" text-anchor="middle" fill="#FBF6EF" font-family="Georgia, serif">✿</text></svg>
```

- [ ] **Step 3: Shell components**

`components/shell/nav.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarHeart, Images, Type, Palette, Settings } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const NAV = [
  { href: "/", label: "Today", short: "Today", icon: CalendarHeart },
  { href: "/posts", label: "Posts", short: "Posts", icon: Images },
  { href: "/names", label: "Names", short: "Names", icon: Type },
  { href: "/themes", label: "Themes", short: "Themes", icon: Palette },
  { href: "/settings", label: "Settings", short: "More", icon: Settings },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}
          className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition",
            isActive(path, href) ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink")}>
          <Icon className="size-[18px]" aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {NAV.map(({ href, short, icon: Icon }) => (
          <li key={href}>
            <Link href={href} aria-current={isActive(path, href) ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                isActive(path, href) ? "text-accent" : "text-muted")}>
              <Icon className="size-5" aria-hidden /> {short}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`components/shell/pc-status.tsx`:
```tsx
"use client";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { cn } from "@/lib/utils/cn";

const TEXT: Record<WorkerHealth, { label: string; fix: string; dot: string }> = {
  ready: { label: "PC ready", fix: "Your PC and ComfyUI are on.", dot: "bg-ok" },
  "comfy-off": { label: "ComfyUI closed", fix: "Open ComfyUI Desktop on your PC.", dot: "bg-warn" },
  offline: { label: "PC offline", fix: "Turn on your PC (the card worker starts by itself).", dot: "bg-bad" },
  unknown: { label: "PC not seen yet", fix: "Start the card worker on your PC.", dot: "bg-muted" },
};

export function PcStatus({ health, lastSeen, compact }: { health: WorkerHealth; lastSeen: string; compact?: boolean }) {
  const t = TEXT[health];
  return (
    <div className="flex items-center gap-2" title={`${t.label}. ${t.fix}`} role="status" aria-live="polite">
      <span className={cn("size-2.5 shrink-0 rounded-full", t.dot, health === "ready" && "shadow-[0_0_0_4px_color-mix(in_oklab,var(--ok)_20%,transparent)]")} />
      {!compact && (
        <div className="min-w-0 text-xs leading-tight">
          <div className="font-semibold text-ink">{t.label}</div>
          <div className="text-muted">{health === "offline" ? `Last seen ${lastSeen}` : t.fix}</div>
        </div>
      )}
      {compact && <span className="text-xs font-semibold text-muted">{t.label}</span>}
    </div>
  );
}

export const PC_TEXT = TEXT;
```

`components/shell/activity-pill.tsx`:
```tsx
"use client";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { Activity } from "@/lib/realtime/hooks";
import { cn } from "@/lib/utils/cn";

export function ActivityPill({ a }: { a: Activity }) {
  if (a.post) {
    const bad = a.failed > 0;
    return (
      <Link href={`/posts/${a.post.id}`} aria-live="polite"
        className={cn("inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold shadow-soft",
          bad ? "bg-bad/12 text-bad" : "bg-accent-soft text-accent")}>
        {bad ? <AlertTriangle className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
        <span>{bad ? `${a.failed} failed · ${a.done}/${a.total}` : `Generating ${a.done}/${a.total}`}</span>
        <span className="hidden font-medium opacity-80 sm:inline">· {a.etaText}</span>
      </Link>
    );
  }
  if (a.finishedPostId) {
    return (
      <Link href={`/posts/${a.finishedPostId}`} aria-live="polite" className="inline-flex min-h-9 items-center gap-2 rounded-full bg-ok/12 px-3 text-xs font-bold text-ok shadow-soft">
        <CheckCircle2 className="size-3.5" /> Post ready
      </Link>
    );
  }
  return null;
}
```

`components/shell/theme-toggle.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = !mounted ? Monitor : theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = !mounted ? "Theme" : theme === "light" ? "Light" : theme === "dark" ? "Dark" : "Auto";
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={`Theme: ${label}. Switch to ${next}`}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink">
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );
}
```

`components/shell/app-shell.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { BottomTabs, SideNav } from "./nav";
import { ActivityPill } from "./activity-pill";
import { PcStatus } from "./pc-status";
import { ThemeToggle } from "./theme-toggle";
import { useActivity, useWorker } from "@/lib/realtime/hooks";
import { chime, notify } from "@/lib/realtime/chime";
import type { WorkerStatusRow } from "@/lib/db/types";
import { createContext, useContext } from "react";
import type { WorkerHealth } from "@/lib/status/worker-health";

const WorkerCtx = createContext<{ health: WorkerHealth; lastSeen: string; row: WorkerStatusRow | null }>({ health: "unknown", lastSeen: "never", row: null });
export const useWorkerContext = () => useContext(WorkerCtx);

export function AppShell({ initialWorker, soundOn, children }: { initialWorker: WorkerStatusRow | null; soundOn: boolean; children: React.ReactNode }) {
  const worker = useWorker(initialWorker);
  const activity = useActivity(() => {
    if (soundOn) chime();
    notify("Post ready", "Your Unique Names cards are done.");
  });

  useEffect(() => {
    const base = "Unique Names";
    document.title = activity.post ? `(${activity.done}/${activity.total}) ${base}` : activity.finishedPostId ? `✓ ${base}` : base;
  }, [activity.post, activity.done, activity.total, activity.finishedPostId]);

  return (
    <WorkerCtx.Provider value={worker}>
      <div className="min-h-dvh bg-bg md:grid md:grid-cols-[232px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-3 py-5 md:flex">
          <div className="mb-6 px-3 font-display text-xl text-ink"><span className="italic text-accent">✿</span> Unique Names</div>
          <SideNav />
          <div className="mt-auto space-y-3 px-3">
            <PcStatus health={worker.health} lastSeen={worker.lastSeen} />
            <ThemeToggle />
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:justify-end md:px-8">
            <div className="font-display text-lg text-ink md:hidden"><span className="italic text-accent">✿</span> Unique Names</div>
            <div className="flex items-center gap-3">
              <ActivityPill a={activity} />
              <div className="md:hidden"><PcStatus health={worker.health} lastSeen={worker.lastSeen} compact /></div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 md:px-8 md:pb-12">{children}</main>
        </div>
      </div>
      <BottomTabs />
    </WorkerCtx.Provider>
  );
}
```

`app/(app)/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { createClient, getOwner } from "@/lib/supabase/server";
import type { SettingsRow, WorkerStatusRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getOwner())) redirect("/login");
  const sb = await createClient();
  const [{ data: worker }, { data: settings }] = await Promise.all([
    sb.from("worker_status").select("*").eq("id", 1).maybeSingle(),
    sb.from("settings").select("sound_on").eq("id", 1).maybeSingle(),
  ]);
  return (
    <AppShell initialWorker={(worker as WorkerStatusRow) ?? null} soundOn={(settings as Pick<SettingsRow, "sound_on">)?.sound_on ?? true}>
      {children}
    </AppShell>
  );
}
```

`app/(app)/loading.tsx` (shown instantly on every page change, so the owner never sees a blank screen):
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint && npm run build` → all succeed. `npm run dev`, sign-in page renders in light and dark (toggle the OS theme).

- [ ] **Step 5: Commit**

```bash
git add components lib/realtime app public
git commit -m "feat(shell): UI kit, realtime hooks, app shell with activity pill and PC status"
```

---

### Task 8: Server actions

**Files:**
- Create: `lib/actions/posts.ts`, `lib/actions/cards.ts`, `lib/actions/names.ts`, `lib/actions/themes.ts`, `lib/actions/settings.ts`, `lib/actions/validate.ts`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Consumes: `planPost`, `planExtraCard`, `buildPrompt`, `PREVIEW_NAME`, `PREVIEW_MEANING`, `BABY_SHOTS` (Task 2); `NAME_RE` (Task 3); `createClient`, `requireOwner`, `fail`, `ActionResult` (Task 6); SQL functions (Task 4).
- Produces (all `"use server"`, all return `ActionResult`):
  - posts: `createPostAction({gender, style, count: number|null, postDate, themeId?: string, requestId}) → {postId}`, `setPostedAction(postId, posted: boolean)`, `updateCaptionAction(postId, caption)`, `deletePostAction(postId)`, `addCardAction(postId) → {cardId}`
  - cards: `regenerateCardAction(cardId)`, `restampCardAction(cardId, name, meaning) → {mode: "restamp"|"regenerate"}`, `deleteCardAction(cardId)`, `setSelectedAction(cardId, selected)`, `selectAllAction(postId, selected)`, `reorderCardsAction(postId, orderedIds: string[])`
  - names: `addNamesAction(rows: {name, meaning, gender, style}[]) → {added: number, skipped: string[]}`, `updateNameAction(id, {name, meaning, gender})`, `setSkipAction(id, skip: boolean)`, `deleteNameAction(id)`
  - themes: `saveThemeAction(input: ThemeInput & {id?: string}) → {id}`, `setArchivedAction(id, archived: boolean)`, `reorderThemesAction(orderedIds: string[])`, `moveThemeNextAction(id)`, `makePreviewAction(themeId) → {cardId}`
  - settings: `saveSettingsAction(input: SettingsInput)`
  - validate: `validateName(name, meaning): string | null`, `validateTheme(t): string | null`, `validateSettings(s): string | null`, `ThemeInput`, `SettingsInput` types.

- [ ] **Step 1: Validation tests (pure)**

`tests/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateName, validateSettings, validateTheme } from "@/lib/actions/validate";

describe("validate", () => {
  it("names", () => {
    expect(validateName("Arlo Zenith", "peak strength")).toBeNull();
    expect(validateName("Arlo2", "x")).toMatch(/letters/);
    expect(validateName("Arlo", "")).toMatch(/meaning/i);
    expect(validateName("A".repeat(41), "x")).toMatch(/40/);
  });
  it("themes", () => {
    const t = { title: "Boho", gender: "boy" as const, backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c" };
    expect(validateTheme(t)).toBeNull();
    expect(validateTheme({ ...t, props: " " })).toMatch(/props/);
  });
  it("settings", () => {
    const s = { caption_template: "x {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true };
    expect(validateSettings(s)).toBeNull();
    expect(validateSettings({ ...s, min_images: 14 })).toMatch(/min/i);
    expect(validateSettings({ ...s, handle: "" })).toMatch(/handle/i);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement validation**

`lib/actions/validate.ts`:
```ts
import type { Gender } from "@/lib/db/types";
import { NAME_RE } from "@/lib/names/bulk-paste";

export interface ThemeInput { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string }
export interface SettingsInput { caption_template: string; hashtags: string; handle: string; min_images: number; max_images: number; sound_on: boolean }

export function validateName(name: string, meaning: string): string | null {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return "Type a name.";
  if (n.length > 40) return "Names can be at most 40 characters.";
  if (!NAME_RE.test(n)) return "Names can only have letters, spaces, hyphens and apostrophes.";
  const m = meaning.trim();
  if (!m) return "Type the meaning.";
  if (m.length > 80) return "Meanings can be at most 80 characters.";
  return null;
}

export function validateTheme(t: ThemeInput): string | null {
  for (const k of ["title", "backdrop", "outfit", "props", "lighting", "palette"] as const) {
    if (!t[k] || !t[k].trim()) return `Fill in ${k}.`;
  }
  if (t.title.trim().length > 60) return "Theme titles can be at most 60 characters.";
  if (t.gender !== "boy" && t.gender !== "girl") return "Pick Boy or Girl.";
  return null;
}

export function validateSettings(s: SettingsInput): string | null {
  if (!s.caption_template.trim()) return "The caption template cannot be empty.";
  if (!s.handle.trim()) return "The handle cannot be empty.";
  if (s.handle.length > 40) return "The handle can be at most 40 characters.";
  if (!Number.isInteger(s.min_images) || !Number.isInteger(s.max_images) || s.min_images < 1 || s.max_images > 30) return "Card counts must be 1 to 30.";
  if (s.min_images > s.max_images) return "The min card count cannot be above the max.";
  return null;
}
```

Run → PASS.

- [ ] **Step 3: Post actions**

`lib/actions/posts.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { planExtraCard, planPost } from "@/lib/planner";
import type { Gender, NameRow, NameStyle, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { fail, requireOwner, type ActionResult } from "./result";

export async function createPostAction(input: {
  gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string;
}): Promise<ActionResult<{ postId: string }>> {
  await requireOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate)) return fail("Pick a valid date.");
  const sb = await createClient();
  for (let attempt = 0; attempt < 2; attempt++) {
    const [{ data: settings }, { data: names }, { data: themes }] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("names").select("*").eq("gender", input.gender).eq("style", input.style).eq("status", "available"),
      sb.from("themes").select("*").eq("gender", input.gender).eq("status", "available"),
    ]);
    if (!settings) return fail("Settings are missing. Run supabase/schema.sql.");
    const plan = planPost({
      request: { gender: input.gender, style: input.style, count: input.count, postDate: input.postDate },
      names: (names ?? []) as NameRow[], themes: (themes ?? []) as ThemeRow[], settings: settings as SettingsRow, themeId: input.themeId,
    });
    if (!plan.ok) return fail(plan.reason);
    const { data, error } = await sb.rpc("create_post", { p: {
      request_id: input.requestId, post_date: input.postDate, gender: input.gender, style: input.style,
      theme_id: plan.theme_id, caption: plan.caption, cards: plan.cards,
    } });
    if (error) return fail(`Could not create the post: ${error.message}`);
    const r = data as { status: string; post_id?: string; reason?: string };
    if (r.status === "ok" && r.post_id) { revalidatePath("/", "layout"); return { ok: true, postId: r.post_id }; }
    if (r.status !== "conflict") return fail(r.reason ?? "Could not create the post.");
  }
  return fail("Those names or that theme were just used by another post. Try again.");
}

export async function setPostedAction(postId: string, posted: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("id").eq("id", postId).single();
  if (!post) return fail("Post not found.");
  const { error } = posted
    ? await sb.from("posts").update({ status: "posted", posted_at: new Date().toISOString() }).eq("id", postId)
    : await sb.from("posts").update({ status: "ready", posted_at: null }).eq("id", postId);
  if (error) return fail(error.message);
  if (!posted) await sb.rpc("refresh_post", { p_post: postId });
  revalidatePath("/posts");
  return { ok: true };
}

export async function updateCaptionAction(postId: string, caption: string): Promise<ActionResult> {
  await requireOwner();
  if (caption.length > 5000) return fail("The caption is too long.");
  const { error } = await (await createClient()).from("posts").update({ caption }).eq("id", postId);
  return error ? fail(error.message) : { ok: true };
}

export async function deletePostAction(postId: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.rpc("delete_post", { p_post: postId });
  if (error) return fail(error.message);
  const paths = (data as { paths: string[] }).paths ?? [];
  if (paths.length) await sb.storage.from("cards").remove(paths);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addCardAction(postId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("*").eq("id", postId).single();
  if (!post) return fail("Post not found.");
  const p = post as PostRow;
  const [{ data: theme }, { data: names }, { data: cards }] = await Promise.all([
    sb.from("themes").select("*").eq("id", p.theme_id).single(),
    sb.from("names").select("*").eq("gender", p.gender).eq("style", p.style).eq("status", "available"),
    sb.from("cards").select("name_id, position").eq("post_id", postId),
  ]);
  const used = (cards ?? []).map((c) => c.name_id).filter(Boolean) as string[];
  const next = Math.max(0, ...(cards ?? []).map((c) => c.position as number)) + 1;
  const plan = planExtraCard({ theme: theme as ThemeRow, gender: p.gender, style: p.style, names: (names ?? []) as NameRow[], usedNameIds: used, nextPosition: next, salt: `${postId}|${Date.now()}` });
  if (!plan.ok) return fail(plan.reason);
  const { data, error } = await sb.rpc("add_card", { p_post: postId, c: plan.card });
  if (error) return fail(error.message);
  const r = data as { status: string; card_id?: string };
  if (r.status !== "ok" || !r.card_id) return fail("That name was just taken. Try again.");
  return { ok: true, cardId: r.card_id };
}
```

- [ ] **Step 4: Card actions**

`lib/actions/cards.ts`:
```ts
"use server";
import { createClient } from "@/lib/supabase/server";
import type { CardRow } from "@/lib/db/types";
import { validateName } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

const REQUEUE = { status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0 };

async function getCard(id: string) {
  const sb = await createClient();
  const { data } = await sb.from("cards").select("*").eq("id", id).single();
  return { sb, card: data as CardRow | null };
}

export async function regenerateCardAction(cardId: string): Promise<ActionResult> {
  await requireOwner();
  const { sb, card } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail("This card is being made right now. Wait for it to finish.");
  const { error } = await sb.from("cards").update({ ...REQUEUE, version: card.version + 1, queued_at: new Date().toISOString() }).eq("id", cardId);
  return error ? fail(error.message) : { ok: true };
}

export async function restampCardAction(cardId: string, name: string, meaning: string): Promise<ActionResult<{ mode: "restamp" | "regenerate" }>> {
  await requireOwner();
  const bad = validateName(name, meaning);
  if (bad) return fail(bad);
  const { sb, card } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail("This card is being made right now. Wait for it to finish.");
  const clean = { name: name.replace(/\s+/g, " ").trim(), meaning: meaning.trim().toLowerCase() };
  if (card.name_id) {
    const { error: ne } = await sb.from("names").update(clean).eq("id", card.name_id);
    if (ne) return fail(ne.message.includes("names_lower_name") ? "Another name in your list already has that spelling." : ne.message);
  }
  // Cards imported from the n8n flow have no clean photo, so they regenerate instead.
  const mode = card.photo_path ? "restamp" : "regenerate";
  const patch = mode === "restamp"
    ? { ...clean, status: "restamp", claimed_at: null, error: null, version: card.version + 1, queued_at: new Date().toISOString() }
    : { ...clean, ...REQUEUE, version: card.version + 1, queued_at: new Date().toISOString() };
  const { error } = await sb.from("cards").update(patch).eq("id", cardId);
  return error ? fail(error.message) : { ok: true, mode };
}

export async function deleteCardAction(cardId: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.rpc("delete_card", { p_card: cardId });
  if (error) return fail(error.message);
  const paths = (data as { paths: string[] }).paths ?? [];
  if (paths.length) await sb.storage.from("cards").remove(paths);
  return { ok: true };
}

export async function setSelectedAction(cardId: string, selected: boolean): Promise<ActionResult> {
  await requireOwner();
  const { error } = await (await createClient()).from("cards").update({ selected }).eq("id", cardId);
  return error ? fail(error.message) : { ok: true };
}

export async function selectAllAction(postId: string, selected: boolean): Promise<ActionResult> {
  await requireOwner();
  const { error } = await (await createClient()).from("cards").update({ selected }).eq("post_id", postId);
  return error ? fail(error.message) : { ok: true };
}

export async function reorderCardsAction(postId: string, orderedIds: string[]): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const results = await Promise.all(orderedIds.map((id, i) => sb.from("cards").update({ order_index: i + 1 }).eq("id", id).eq("post_id", postId)));
  const err = results.find((r) => r.error)?.error;
  return err ? fail(err.message) : { ok: true };
}
```

- [ ] **Step 5: Name, theme, settings actions**

`lib/actions/names.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle } from "@/lib/db/types";
import { validateName } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

const styleOf = (name: string): NameStyle => (name.trim().split(/\s+/).length > 1 ? "two-word" : "single");

export async function addNamesAction(rows: { name: string; meaning: string; gender: Gender }[]): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  await requireOwner();
  if (!rows.length) return fail("Nothing to add.");
  if (rows.length > 1000) return fail("Add at most 1000 names at a time.");
  for (const r of rows) { const bad = validateName(r.name, r.meaning); if (bad) return fail(`${r.name}: ${bad}`); }
  const sb = await createClient();
  const { data: existing } = await sb.from("names").select("name");
  const have = new Set((existing ?? []).map((n) => (n.name as string).toLowerCase()));
  const skipped: string[] = [];
  const fresh = rows.filter((r) => { const k = r.name.trim().toLowerCase(); if (have.has(k)) { skipped.push(r.name); return false; } have.add(k); return true; })
    .map((r) => ({ name: r.name.replace(/\s+/g, " ").trim(), meaning: r.meaning.trim().toLowerCase(), gender: r.gender, style: styleOf(r.name) }));
  if (fresh.length) {
    const { error } = await sb.from("names").insert(fresh);
    if (error) return fail(error.message);
  }
  revalidatePath("/names");
  revalidatePath("/");
  return { ok: true, added: fresh.length, skipped };
}

export async function updateNameAction(id: string, v: { name: string; meaning: string; gender: Gender }): Promise<ActionResult> {
  await requireOwner();
  const bad = validateName(v.name, v.meaning);
  if (bad) return fail(bad);
  const sb = await createClient();
  const { data: row } = await sb.from("names").select("status").eq("id", id).single();
  if (!row) return fail("Name not found.");
  if (row.status === "reserved" || row.status === "used") return fail("This name is in a post. Edit it on the card instead, so the picture updates too.");
  const { error } = await sb.from("names").update({ name: v.name.replace(/\s+/g, " ").trim(), meaning: v.meaning.trim().toLowerCase(), gender: v.gender, style: styleOf(v.name) }).eq("id", id);
  if (error) return fail(error.message.includes("names_lower_name") ? "That name is already in your list." : error.message);
  revalidatePath("/names");
  return { ok: true };
}

export async function setSkipAction(id: string, skip: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { error } = await sb.from("names").update({ status: skip ? "skip" : "available" }).eq("id", id).in("status", skip ? ["available"] : ["skip"]);
  if (error) return fail(error.message);
  revalidatePath("/names");
  return { ok: true };
}

export async function deleteNameAction(id: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.from("names").delete().eq("id", id).in("status", ["available", "skip"]).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Names that were used in a post cannot be deleted. Mark it Skip instead.");
  revalidatePath("/names");
  return { ok: true };
}
```

`lib/actions/themes.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BABY_SHOTS, PREVIEW_MEANING, PREVIEW_NAME, buildPrompt, hashSeed } from "@/lib/planner";
import type { ThemeRow } from "@/lib/db/types";
import { validateTheme, type ThemeInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

export async function saveThemeAction(input: ThemeInput & { id?: string }): Promise<ActionResult<{ id: string }>> {
  await requireOwner();
  const bad = validateTheme(input);
  if (bad) return fail(bad);
  const sb = await createClient();
  const row = { title: input.title.trim(), gender: input.gender, backdrop: input.backdrop.trim(), outfit: input.outfit.trim(), props: input.props.trim(), lighting: input.lighting.trim(), palette: input.palette.trim() };
  if (input.id) {
    const { error } = await sb.from("themes").update(row).eq("id", input.id);
    if (error) return fail(error.message.includes("title") ? "Another theme already has that title." : error.message);
    revalidatePath("/themes");
    return { ok: true, id: input.id };
  }
  const { data: last } = await sb.from("themes").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { data, error } = await sb.from("themes").insert({ ...row, sort_order: ((last?.[0]?.sort_order as number) ?? 0) + 1 }).select("id").single();
  if (error) return fail(error.message.includes("title") ? "Another theme already has that title." : error.message);
  revalidatePath("/themes");
  return { ok: true, id: data.id as string };
}

export async function setArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { error } = await sb.from("themes").update({ status: archived ? "archived" : "available" }).eq("id", id).neq("status", "used");
  if (error) return fail(error.message);
  revalidatePath("/themes");
  return { ok: true };
}

export async function reorderThemesAction(orderedIds: string[]): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const rs = await Promise.all(orderedIds.map((id, i) => sb.from("themes").update({ sort_order: i + 1 }).eq("id", id)));
  const err = rs.find((r) => r.error)?.error;
  if (err) return fail(err.message);
  revalidatePath("/themes");
  revalidatePath("/");
  return { ok: true };
}

export async function moveThemeNextAction(id: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data: first } = await sb.from("themes").select("sort_order").order("sort_order", { ascending: true }).limit(1);
  const { error } = await sb.from("themes").update({ sort_order: ((first?.[0]?.sort_order as number) ?? 1) - 1 }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/themes");
  revalidatePath("/");
  return { ok: true };
}

export async function makePreviewAction(themeId: string): Promise<ActionResult<{ cardId: string }>> {
  await requireOwner();
  const sb = await createClient();
  const { data: theme } = await sb.from("themes").select("*").eq("id", themeId).single();
  if (!theme) return fail("Theme not found.");
  const t = theme as ThemeRow;
  const { data: busy } = await sb.from("cards").select("id").eq("theme_id", themeId).eq("kind", "preview").in("status", ["queued", "generating"]).limit(1);
  if (busy?.length) return { ok: true, cardId: busy[0].id as string };
  const shot = BABY_SHOTS[0];
  const { data, error } = await sb.from("cards").insert({
    theme_id: themeId, kind: "preview", position: 1, name: PREVIEW_NAME, meaning: PREVIEW_MEANING, shot,
    prompt: buildPrompt(t, shot, t.gender), seed: hashSeed(`${themeId}|${Date.now()}`),
  }).select("id").single();
  if (error) return fail(error.message);
  return { ok: true, cardId: data.id as string };
}
```

`lib/actions/settings.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateSettings, type SettingsInput } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

export async function saveSettingsAction(s: SettingsInput): Promise<ActionResult> {
  await requireOwner();
  const bad = validateSettings(s);
  if (bad) return fail(bad);
  const { error } = await (await createClient()).from("settings").update({
    caption_template: s.caption_template.trim(), hashtags: s.hashtags.trim(), handle: s.handle.trim(),
    min_images: s.min_images, max_images: s.max_images, sound_on: s.sound_on,
  }).eq("id", 1);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 6: Verify** — `npm test && npm run typecheck && npm run lint` → pass.

- [ ] **Step 7: Commit**

```bash
git add lib/actions tests/validate.test.ts supabase/schema.sql
git commit -m "feat(actions): post, card, name, theme and settings server actions"
```

---

### Task 9: Card tile (all states) and the Today page

**Files:**
- Create: `components/cards/card-tile.tsx`, `components/today/new-post-panel.tsx`, `components/today/active-post.tsx`, `components/today/stock.tsx`, `app/(app)/page.tsx`, `lib/data/today.ts`
- Test: none new (states are covered by `tests/status.test.ts`); verified in the browser in Step 5.

**Interfaces:**
- Consumes: `cardVisual`, `queuePosition` (Task 3), `formatElapsed`, `useNow`, `useSignedUrls`, `useRealtimeRows`, `useWorkerContext`, `useHotkey`, `Button`, `Segmented`, `Panel`, `Badge`, `Empty`, `Skeleton`, `createPostAction`.
- Produces: `CardTile({card, url, health, queuePos, onOpen?, onRetry?, selection?: {selected: boolean, order: number|null, onToggle: () => void}, className?})` — tapping the picture calls `onOpen`; with `selection`, the corner number is a separate button that calls `onToggle`; `getTodayData()` → `{settings, themes: ThemeRow[] (available, ordered), stock: {key: "boy two-word"|..., count}[], activePost: PostRow|null, activeCards: CardRow[]}`.

- [ ] **Step 1: Card tile**

`components/cards/card-tile.tsx`:
```tsx
"use client";
import { AlertTriangle, Clock3, Loader2, PenLine, PlugZap, RotateCw } from "lucide-react";
import type { CardRow } from "@/lib/db/types";
import { cardVisual } from "@/lib/status/card-state";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { formatElapsed } from "@/lib/status/eta";
import { useNow } from "@/lib/realtime/hooks";
import { cn } from "@/lib/utils/cn";

export function CardTile({ card, url, health, queuePos, onOpen, onRetry, selection, className }: {
  card: CardRow; url?: string; health: WorkerHealth; queuePos: number; onOpen?: () => void; onRetry?: () => void;
  selection?: { selected: boolean; order: number | null; onToggle: () => void }; className?: string;
}) {
  const v = cardVisual(card, health);
  const now = useNow(1000);
  const elapsed = card.started_at ? (now - Date.parse(card.started_at)) / 1000 : 0;
  const showImage = !!url && (v === "done" || v === "restamp" || v === "regenerating" || (v === "waiting" && !!card.card_path) || (v === "failed" && !!card.card_path));
  const label = `${card.name}: ${({ queued: "in line", generating: "being made", regenerating: "being remade", restamp: "updating text", done: "ready", failed: "failed", waiting: "waiting for your PC" } as const)[v]}`;

  return (
    <div className={cn("group relative aspect-square overflow-hidden rounded-xl bg-surface-2", v === "failed" && "ring-2 ring-bad", className)}>
      <button type="button" onClick={onOpen} aria-label={`Open ${label}`}
        className="absolute inset-0 z-[1] block size-full">
        {showImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt="" loading="lazy" decoding="async"
            className={cn("size-full object-cover animate-pop transition duration-500", v === "regenerating" && "scale-[1.02] opacity-30 blur-[2px]", selection && !selection.selected && "opacity-45 saturate-50")} />
        )}
        {!showImage && (v === "generating" || v === "regenerating") && <div className="absolute inset-0 shimmer animate-shimmer" />}
      </button>

      {/* state overlay */}
      <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 p-2 text-center">
        {v === "queued" && <><Clock3 className="size-5 text-muted" /><span className="text-xs font-semibold text-muted">#{queuePos || "…"} in line</span></>}
        {(v === "generating" || v === "regenerating") && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-xs font-bold text-ink shadow-soft" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin text-accent" /> {v === "regenerating" ? "Remaking" : "Making"}… {formatElapsed(elapsed)}
          </span>
        )}
        {v === "waiting" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/90 px-2.5 py-1 text-xs font-bold text-white shadow-soft">
            <PlugZap className="size-3.5" /> Waiting for your PC
          </span>
        )}
      </div>
      {v === "restamp" && (
        <span className="absolute left-2 top-2 z-[2] inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-1 text-[11px] font-bold text-ink shadow-soft">
          <PenLine className="size-3 text-accent" /> Updating text…
        </span>
      )}
      {v === "failed" && (
        <div className="absolute inset-x-2 bottom-2 z-[3] rounded-lg bg-surface/95 p-2 text-left shadow-soft">
          <div className="flex items-center gap-1.5 text-xs font-bold text-bad"><AlertTriangle className="size-3.5" /> Failed</div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{card.error ?? "Unknown error"}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="pointer-events-auto mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-md bg-bad px-2 text-[11px] font-bold text-white">
              <RotateCw className="size-3" /> Retry
            </button>
          )}
        </div>
      )}
      {selection && (
        // 44 px hit area around a 28 px badge: tap the number to select/unselect, tap the picture to open it.
        <button type="button" onClick={selection.onToggle} aria-pressed={selection.selected}
          aria-label={selection.selected ? `Unselect ${card.name} (upload number ${selection.order})` : `Select ${card.name}`}
          className="absolute left-0 top-0 z-[3] grid size-11 place-items-center">
          <span className={cn("grid size-7 place-items-center rounded-lg text-xs font-extrabold shadow-soft",
            selection.selected ? "bg-accent text-accent-ink" : "border-2 border-white/90 bg-black/25")}>
            {selection.selected ? selection.order : ""}
          </span>
        </button>
      )}
      {!selection && v !== "failed" && (
        <span className="absolute inset-x-0 bottom-0 z-[2] truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-5 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {card.position}. {card.name}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Today data loader**

`lib/data/today.ts`:
```ts
import { createClient } from "@/lib/supabase/server";
import type { CardRow, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";

export const STOCK_KEYS = [
  { gender: "boy", style: "two-word", label: "Boy · two-word" }, { gender: "boy", style: "single", label: "Boy · single" },
  { gender: "girl", style: "two-word", label: "Girl · two-word" }, { gender: "girl", style: "single", label: "Girl · single" },
] as const;

export async function getTodayData() {
  const sb = await createClient();
  const [{ data: settings }, { data: themes }, { data: names }, { data: active }] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("themes").select("*").eq("status", "available").order("sort_order").order("title"),
    sb.from("names").select("gender, style").eq("status", "available"),
    sb.from("posts").select("*").order("created_at", { ascending: false }).limit(1),
  ]);
  const stock = STOCK_KEYS.map((k) => ({ ...k, count: (names ?? []).filter((n) => n.gender === k.gender && n.style === k.style).length }));
  const latest = (active?.[0] ?? null) as PostRow | null;
  // Show the latest post on Today while it is generating, or for 12 h after it finished.
  const show = latest && (latest.status === "generating" || Date.now() - Date.parse(latest.updated_at) < 12 * 3600_000) ? latest : null;
  const { data: cards } = show ? await sb.from("cards").select("*").eq("post_id", show.id).order("position") : { data: [] };
  return { settings: settings as SettingsRow, themes: (themes ?? []) as ThemeRow[], stock, activePost: show, activeCards: (cards ?? []) as CardRow[] };
}
```

- [ ] **Step 3: Today components**

`components/today/new-post-panel.tsx`:
```tsx
"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { useHotkey } from "@/lib/realtime/hotkey";
import { createPostAction } from "@/lib/actions/posts";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { useWorkerContext } from "@/components/shell/app-shell";
import { PC_TEXT } from "@/components/shell/pc-status";

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function NewPostPanel({ settings, themes, stock, busy }: {
  settings: SettingsRow; themes: ThemeRow[]; stock: { gender: Gender; style: NameStyle; count: number }[]; busy: boolean;
}) {
  const router = useRouter();
  const { health } = useWorkerContext();
  const [gender, setGender] = useState<Gender>("boy");
  const [style, setStyle] = useState<NameStyle>("two-word");
  const [count, setCount] = useState<string>("auto");
  const [date, setDate] = useState(manilaToday);
  const [themeId, setThemeId] = useState<string>("");
  const [pending, start] = useTransition();

  const genderThemes = useMemo(() => themes.filter((t) => t.gender === gender), [themes, gender]);
  const theme = genderThemes.find((t) => t.id === themeId) ?? genderThemes[0];
  const left = stock.find((s) => s.gender === gender && s.style === style)?.count ?? 0;
  const counts = Array.from({ length: settings.max_images - settings.min_images + 1 }, (_, i) => String(settings.min_images + i));
  const blocked = left < settings.min_images ? `Only ${left} ${gender} ${style} names left. Add names first.` : !theme ? `No ${gender} theme left. Add a theme first.` : null;

  const generate = () => {
    if (blocked || pending) return;
    start(async () => {
      const r = await createPostAction({ gender, style, count: count === "auto" ? null : Number(count), postDate: date, themeId: theme?.id, requestId: crypto.randomUUID() });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(health === "ready" ? "Post queued. Cards will appear as they are made." : `Post queued. ${PC_TEXT[health].fix}`);
      router.refresh();
    });
  };
  useHotkey("g", generate);

  return (
    <Panel title={`New post · ${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Segmented label="Gender" value={gender} onChange={(v) => { setGender(v); setThemeId(""); }} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
          <Segmented label="Name style" value={style} onChange={setStyle} options={[{ value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">Cards</div>
          <Segmented label="Number of cards" value={count} onChange={setCount}
            options={[{ value: "auto", label: `Auto ${settings.min_images}–${settings.max_images}` }, ...counts.map((c) => ({ value: c, label: c }))]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-1.5 text-xs font-semibold text-muted">
              <span className="flex items-center gap-1.5"><Palette className="size-3.5" /> Theme</span>
              <Link href="/themes" className="text-accent hover:underline">Preview / change order</Link>
            </span>
            <select value={theme?.id ?? ""} onChange={(e) => setThemeId(e.target.value)} disabled={!genderThemes.length}
              className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm font-semibold text-ink">
              {genderThemes.map((t, i) => <option key={t.id} value={t.id}>{i === 0 ? `${t.title} (next)` : t.title}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Post date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-sm text-ink" />
          </label>
        </div>
        {theme && <p className="text-xs text-muted">{theme.backdrop} · {theme.outfit} · {theme.props}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={generate} loading={pending} disabled={!!blocked} className="w-full sm:w-auto">
            <Sparkles className="size-4" /> Generate post
          </Button>
          <span className="text-xs text-muted">{blocked ?? (busy ? "Another post is still generating; this one will wait in line." : `${left} names left for this style · press G`)}</span>
        </div>
      </div>
    </Panel>
  );
}
```

`components/today/stock.tsx`:
```tsx
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

export function Stock({ stock, themes, min }: { stock: { label: string; count: number }[]; themes: { boy: number; girl: number }; min: number }) {
  const low = (n: number) => n < min * 2;
  return (
    <Panel title="Stock left">
      <ul className="space-y-2 text-sm">
        {stock.map((s) => (
          <li key={s.label} className="flex items-center justify-between">
            <span className="text-muted">{s.label}</span>
            <span className={cn("font-bold", low(s.count) ? "text-warn" : "text-ink")}>{s.count}</span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-line pt-2">
          <span className="text-muted">Themes · boy / girl</span>
          <span className={cn("font-bold", (themes.boy < 3 || themes.girl < 3) ? "text-warn" : "text-ink")}>{themes.boy} / {themes.girl}</span>
        </li>
      </ul>
      {stock.some((s) => low(s.count)) && <Link href="/names" className="mt-3 inline-block text-xs font-bold text-accent">Running low: add names →</Link>}
    </Panel>
  );
}
```

`components/today/active-post.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { CardRow, PostRow } from "@/lib/db/types";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { CardTile } from "@/components/cards/card-tile";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useWorkerContext } from "@/components/shell/app-shell";
import { queuePosition } from "@/lib/status/card-state";
import { etaSeconds, formatEta } from "@/lib/status/eta";
import { createClient } from "@/lib/supabase/client";
import { regenerateCardAction } from "@/lib/actions/cards";

export function ActivePost({ post, initialCards }: { post: PostRow; initialCards: CardRow[] }) {
  const { health } = useWorkerContext();
  const refetch = useCallback(async () => ((await createClient().from("cards").select("*").eq("post_id", post.id).order("position")).data ?? []) as CardRow[], [post.id]);
  const [cards] = useRealtimeRows<CardRow>("cards", initialCards, { key: `today-${post.id}`, filter: `post_id=eq.${post.id}`, sort: (a, b) => a.position - b.position, refetch });
  const urlFor = useSignedUrls(cards.map((c) => c.card_path));
  const done = cards.filter((c) => c.status === "done").length;
  const failed = cards.filter((c) => c.status === "failed").length;
  const durations = cards.filter((c) => c.finished_at && c.started_at).map((c) => (Date.parse(c.finished_at!) - Date.parse(c.started_at!)) / 1000);
  const pct = cards.length ? Math.round((done / cards.length) * 100) : 0;
  const finished = done === cards.length && cards.length > 0;
  const label = post.gender === "girl" ? "Girl" : "Boy";

  return (
    <Panel
      title={finished ? "Just finished" : "Making now"}
      action={<Link href={`/posts/${post.id}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-accent">Open post <ArrowRight className="size-3.5" /></Link>}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{new Date(post.post_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {label} · {post.style}</div>
          <div className="text-sm text-muted" aria-live="polite">
            {finished ? `All ${cards.length} cards are ready.` : `${done} of ${cards.length} cards · ${formatEta(etaSeconds(cards.length - done - failed, durations))}`}
          </div>
        </div>
        {failed > 0 ? <Badge tone="bad">{failed} failed</Badge> : finished ? <Badge tone="ok">Ready</Badge> : <Badge tone="accent" pulse>Generating</Badge>}
      </div>
      <div className="my-4 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cards finished">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {cards.map((c) => (
          <CardTile key={c.id} card={c} url={urlFor(c.card_path)} health={health} queuePos={queuePosition(c, cards)}
            onOpen={() => { window.location.href = `/posts/${post.id}?card=${c.id}`; }}
            onRetry={async () => { const r = await regenerateCardAction(c.id); if (!r.ok) toast.error(r.error); }} />
        ))}
      </div>
    </Panel>
  );
}
```

Note: `queuePosition` here only sees this post's cards; that is the right number for the owner ("#4 in line" within the post being watched).

`app/(app)/page.tsx`:
```tsx
import { getTodayData } from "@/lib/data/today";
import { NewPostPanel } from "@/components/today/new-post-panel";
import { ActivePost } from "@/components/today/active-post";
import { Stock } from "@/components/today/stock";
import { PageHeader } from "@/components/ui/page-header";

export default async function TodayPage() {
  const d = await getTodayData();
  const themesLeft = { boy: d.themes.filter((t) => t.gender === "boy").length, girl: d.themes.filter((t) => t.gender === "girl").length };
  return (
    <>
      <PageHeader title="Today" subtitle="Make today's post. Cards appear here as your PC finishes them." />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <NewPostPanel settings={d.settings} themes={d.themes} stock={d.stock} busy={d.activePost?.status === "generating"} />
        <Stock stock={d.stock} themes={themesLeft} min={d.settings.min_images} />
      </div>
      {d.activePost && <div className="mt-4"><ActivePost key={d.activePost.id} post={d.activePost} initialCards={d.activeCards} /></div>}
    </>
  );
}
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint && npm run build` → pass.

- [ ] **Step 5: Browser check (after Task 15's Supabase setup exists; otherwise defer to Task 15)** — Today renders, Generate creates a post, tiles show "#n in line" → "Making… 0:12" → image pop-in; with the worker stopped, tiles show "Waiting for your PC" and the header dot turns red after 45 s.

- [ ] **Step 6: Commit**

```bash
git add components/cards components/today lib/data app/(app)/page.tsx
git commit -m "feat(today): new post panel, live active post with card states, stock"
```

---

### Task 10: Posts list and post detail (select, order, save to phone, edit/regenerate/delete)

**Files:**
- Create: `lib/data/posts.ts`, `lib/files/save.ts`, `components/posts/post-list.tsx`, `components/posts/post-detail.tsx`, `components/posts/caption-box.tsx`, `components/posts/save-actions.tsx`, `components/cards/card-dialog.tsx`, `app/(app)/posts/page.tsx`, `app/(app)/posts/[id]/page.tsx`, `app/(app)/posts/[id]/not-found.tsx`
- Test: `tests/save.test.ts`

**Interfaces:**
- Consumes: Task 7 UI/hooks, Task 8 actions, Task 9 `CardTile`, Task 3 `downloadName`, `signedUrlsNow`.
- Produces: `getPostList()` → `PostListItem[]` (`PostRow & {theme_title: string, cards: Pick<CardRow,"id"|"status"|"card_path"|"position">[]}`); `getPost(id)` → `{post, theme, cards} | null`; `orderedSelection(cards) → CardRow[]` (selected, by `order_index` then `position`); `uploadNumbers(cards) → Map<cardId, number>`; `saveCards(files: {name, blob}[], caption, mode: "share"|"zip", zipName)`.

- [ ] **Step 1: Failing test for selection order**

`tests/save.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { orderedSelection, uploadNumbers } from "@/lib/files/save";
import type { CardRow } from "@/lib/db/types";

const c = (id: string, position: number, order_index: number, selected = true, status: CardRow["status"] = "done") =>
  ({ id, position, order_index, selected, status, name: id, card_path: `cards/${id}/v1.jpg` }) as CardRow;

describe("selection order", () => {
  it("orders selected cards by order_index then position and numbers them 1..n", () => {
    const cards = [c("a", 1, 3), c("b", 2, 1), c("c", 3, 2, false), c("d", 4, 2)];
    expect(orderedSelection(cards).map((x) => x.id)).toEqual(["b", "d", "a"]);
    expect([...uploadNumbers(cards)]).toEqual([["b", 1], ["d", 2], ["a", 3]]);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Save helpers**

`lib/files/save.ts`:
```ts
import type { CardRow } from "@/lib/db/types";

export function orderedSelection<T extends Pick<CardRow, "id" | "selected" | "order_index" | "position">>(cards: T[]): T[] {
  return cards.filter((c) => c.selected).sort((a, b) => a.order_index - b.order_index || a.position - b.position);
}

export function uploadNumbers(cards: Pick<CardRow, "id" | "selected" | "order_index" | "position">[]): Map<string, number> {
  return new Map(orderedSelection(cards).map((c, i) => [c.id, i + 1]));
}

// Phone: the share sheet ("Save images" puts them in the gallery, in order).
// Desktop or no share support: a zip download.
export async function saveCards(files: { name: string; blob: Blob }[], caption: string, mode: "share" | "zip", zipName: string): Promise<"shared" | "zipped" | "cancelled"> {
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: "image/jpeg" }));
  if (mode === "share" && typeof navigator !== "undefined" && navigator.canShare?.({ files: asFiles })) {
    try {
      await navigator.share({ files: asFiles, title: "Unique Names", text: caption });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  zip.file("caption.txt", caption);
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "zipped";
}
```

Run `npx vitest run tests/save.test.ts` → PASS.

- [ ] **Step 3: Data loaders**

`lib/data/posts.ts`:
```ts
import { createClient } from "@/lib/supabase/server";
import type { CardRow, PostRow, ThemeRow } from "@/lib/db/types";

export type PostListItem = PostRow & { theme_title: string; cards: Pick<CardRow, "id" | "status" | "card_path" | "position">[] };

export async function getPostList(): Promise<PostListItem[]> {
  const sb = await createClient();
  const { data } = await sb.from("posts").select("*, themes(title), cards(id, status, card_path, position)")
    .order("post_date", { ascending: false }).order("created_at", { ascending: false }).limit(90);
  return (data ?? []).map((p) => {
    const { themes, cards, ...rest } = p as PostRow & { themes: { title: string } | null; cards: PostListItem["cards"] };
    return { ...rest, theme_title: themes?.title ?? "", cards: [...(cards ?? [])].sort((a, b) => a.position - b.position) };
  });
}

export async function getPost(id: string) {
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("*").eq("id", id).maybeSingle();
  if (!post) return null;
  const [{ data: theme }, { data: cards }] = await Promise.all([
    sb.from("themes").select("*").eq("id", (post as PostRow).theme_id).single(),
    sb.from("cards").select("*").eq("post_id", id).order("position"),
  ]);
  return { post: post as PostRow, theme: theme as ThemeRow, cards: (cards ?? []) as CardRow[] };
}
```

- [ ] **Step 4: Post list**

`components/posts/post-list.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { Images, Plus } from "lucide-react";
import type { PostListItem } from "@/lib/data/posts";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { useSignedUrls } from "@/lib/realtime/signed-urls";

type Filter = "all" | "ready" | "posted";

export function statusBadge(p: Pick<PostListItem, "status" | "cards">) {
  const failed = p.cards.filter((c) => c.status === "failed").length;
  const done = p.cards.filter((c) => c.status === "done").length;
  if (failed) return <Badge tone="bad">{failed} failed</Badge>;
  if (p.status === "generating") return <Badge tone="accent" pulse>Generating {done}/{p.cards.length}</Badge>;
  if (p.status === "posted") return <Badge tone="muted">Posted</Badge>;
  return <Badge tone="ok">Ready</Badge>;
}

export function PostList({ posts }: { posts: PostListItem[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = posts.filter((p) => filter === "all" || (filter === "ready" ? p.status !== "posted" : p.status === "posted"));
  const urlFor = useSignedUrls(shown.flatMap((p) => p.cards.slice(0, 6).map((c) => c.card_path)));

  if (!posts.length) {
    return <Empty icon={<Images className="size-6" />} title="No posts yet" text="Make your first post on the Today page."
      action={<Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink"><Plus className="size-4" /> New post</Link>} />;
  }
  return (
    <div className="space-y-4">
      <Segmented label="Filter posts" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "ready", label: "Not posted" }, { value: "posted", label: "Posted" }]} />
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((p) => (
          <li key={p.id}>
            <Link href={`/posts/${p.id}`} className="block rounded-2xl border border-line bg-surface p-3 shadow-soft transition hover:border-accent/40">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">
                    {new Date(p.post_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {p.gender === "girl" ? "Girl" : "Boy"}
                  </div>
                  <div className="text-xs text-muted">{p.theme_title} · {p.style} · {p.cards.length} cards</div>
                </div>
                {statusBadge(p)}
              </div>
              <div className="mt-3 grid grid-cols-6 gap-1.5">
                {p.cards.slice(0, 6).map((c) => (
                  <div key={c.id} className="aspect-square overflow-hidden rounded-lg bg-surface-2">
                    {urlFor(c.card_path) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urlFor(c.card_path)} alt="" loading="lazy" className="size-full object-cover" />
                    ) : <div className={c.status === "done" ? "size-full" : "size-full shimmer animate-shimmer"} />}
                  </div>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`app/(app)/posts/page.tsx`:
```tsx
import { getPostList } from "@/lib/data/posts";
import { PostList } from "@/components/posts/post-list";
import { PageHeader } from "@/components/ui/page-header";

export default async function PostsPage() {
  const posts = await getPostList();
  return (
    <>
      <PageHeader title="Posts" subtitle="Every post you made. Open one to pick, order and save its cards." />
      <PostList posts={posts} />
    </>
  );
}
```

- [ ] **Step 5: Caption box and save actions**

`components/posts/caption-box.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateCaptionAction } from "@/lib/actions/posts";

export function CaptionBox({ postId, initial }: { postId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    if (text === saved) return;
    const r = await updateCaptionAction(postId, text);
    if (r.ok) { setSaved(text); toast.success("Caption saved"); } else toast.error(r.error);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Caption copied");
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-2">
      <label htmlFor="caption" className="text-xs font-bold uppercase tracking-[.08em] text-muted">Caption</label>
      <textarea id="caption" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} rows={4}
        className="w-full resize-y rounded-xl border border-line bg-bg p-3 text-sm leading-relaxed text-ink outline-none focus:border-accent" />
      <Button variant="subtle" size="sm" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy caption</Button>
    </div>
  );
}
```

`components/posts/save-actions.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CardRow, PostRow } from "@/lib/db/types";
import { orderedSelection, saveCards } from "@/lib/files/save";
import { downloadName } from "@/lib/files/download-name";
import { signedUrlsNow } from "@/lib/realtime/signed-urls";

export function SaveActions({ post, cards, caption }: { post: PostRow; cards: CardRow[]; caption: string }) {
  const [busy, setBusy] = useState<"share" | "zip" | null>(null);
  const picked = orderedSelection(cards);
  const ready = picked.filter((c) => c.status === "done" && c.card_path);

  const run = async (mode: "share" | "zip") => {
    if (!ready.length) { toast.error("Select at least one finished card."); return; }
    if (ready.length < picked.length) toast.warning(`${picked.length - ready.length} selected card(s) are not ready yet and are left out.`);
    setBusy(mode);
    try {
      const urls = await signedUrlsNow(ready.map((c) => c.card_path!));
      const files = await Promise.all(ready.map(async (c, i) => ({ name: downloadName(i + 1, c.name), blob: await (await fetch(urls[c.card_path!])).blob() })));
      const r = await saveCards(files, caption, mode, `unique-names-${post.post_date}-${post.gender}.zip`);
      if (r === "shared") toast.success(`Shared ${files.length} cards`);
      if (r === "zipped") toast.success(`Downloaded ${files.length} cards + caption.txt`);
    } catch (e) {
      toast.error(`Could not save the cards: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => run("share")} loading={busy === "share"} className="md:hidden"><Share2 className="size-4" /> Save {ready.length} to phone</Button>
      <Button onClick={() => run("zip")} loading={busy === "zip"} variant="subtle" className="max-md:hidden"><Download className="size-4" /> Download {ready.length} as zip</Button>
      <Button onClick={() => run("zip")} loading={busy === "zip"} variant="ghost" size="sm" className="md:hidden">Zip instead</Button>
    </div>
  );
}
```

- [ ] **Step 6: Card dialog**

`components/cards/card-dialog.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { RotateCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CardRow } from "@/lib/db/types";
import { cardVisual } from "@/lib/status/card-state";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { regenerateCardAction, restampCardAction } from "@/lib/actions/cards";
import { CardTile } from "./card-tile";

export function CardDialog({ card, url, health, onClose, onDelete }: {
  card: CardRow | null; url?: string; health: WorkerHealth; onClose: () => void; onDelete: (c: CardRow) => void;
}) {
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState<"text" | "regen" | null>(null);
  useEffect(() => { if (card) { setName(card.name); setMeaning(card.meaning); } }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!card) return null;
  const v = cardVisual(card, health);
  const working = card.status === "generating";
  const changed = name.trim() !== card.name || meaning.trim().toLowerCase() !== card.meaning;
  const took = card.started_at && card.finished_at ? Math.round((Date.parse(card.finished_at) - Date.parse(card.started_at)) / 1000) : null;

  const saveText = async () => {
    setBusy("text");
    const r = await restampCardAction(card.id, name, meaning);
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.mode === "restamp" ? "Updating the text… (about a second once your PC picks it up)" : "This older card has no clean photo, so it is being remade with the new text.");
  };
  const regen = async () => {
    setBusy("regen");
    const r = await regenerateCardAction(card.id);
    setBusy(null);
    if (r.ok) toast.success("Making a new picture for this card…"); else toast.error(r.error);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${card.position}. ${card.name}`} description={card.meaning} wide>
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <CardTile card={card} url={url} health={health} queuePos={0} className="rounded-2xl" />
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={v === "done" ? "ok" : v === "failed" ? "bad" : v === "waiting" ? "warn" : "accent"} pulse={!["done", "failed"].includes(v)}>
              {({ queued: "In line", generating: "Being made", regenerating: "Being remade", restamp: "Updating text", done: "Ready", failed: "Failed", waiting: "Waiting for your PC" } as const)[v]}
            </Badge>
            {took !== null && v === "done" && <Badge tone="muted">Made in {took}s</Badge>}
            {card.attempts > 1 && <Badge tone="muted">{card.attempts} tries</Badge>}
          </div>
          {card.error && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{card.error}</p>}
          <label className="block">
            <span className="text-xs font-semibold text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-semibold text-ink" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted">Meaning</span>
            <input value={meaning} onChange={(e) => setMeaning(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveText} loading={busy === "text"} disabled={!changed || working}><Save className="size-4" /> Save text</Button>
            <Button variant="subtle" onClick={regen} loading={busy === "regen"} disabled={working}><RotateCw className="size-4" /> New picture</Button>
            <Button variant="danger" onClick={() => { onDelete(card); onClose(); }} disabled={working}><Trash2 className="size-4" /> Delete</Button>
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer font-semibold">Shot and prompt</summary>
            <p className="mt-2 whitespace-pre-wrap">{card.prompt}</p>
          </details>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 7: Post detail**

`components/posts/post-detail.tsx`:
```tsx
"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleDashed, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow, PostRow, ThemeRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Dialog } from "@/components/ui/dialog";
import { CardTile } from "@/components/cards/card-tile";
import { CardDialog } from "@/components/cards/card-dialog";
import { CaptionBox } from "./caption-box";
import { SaveActions } from "./save-actions";
import { statusBadge } from "./post-list";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useHotkey } from "@/lib/realtime/hotkey";
import { useWorkerContext } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { queuePosition } from "@/lib/status/card-state";
import { uploadNumbers } from "@/lib/files/save";
import { addCardAction, deletePostAction, setPostedAction } from "@/lib/actions/posts";
import { deleteCardAction, regenerateCardAction, reorderCardsAction, selectAllAction, setSelectedAction } from "@/lib/actions/cards";

function Sortable({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={isDragging ? "scale-[1.03] opacity-90 shadow-soft" : ""} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export function PostDetail({ post: initialPost, theme, initialCards }: { post: PostRow; theme: ThemeRow; initialCards: CardRow[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const { health } = useWorkerContext();
  const refetch = useCallback(async () => ((await createClient().from("cards").select("*").eq("post_id", initialPost.id)).data ?? []) as CardRow[], [initialPost.id]);
  const byOrder = (a: CardRow, b: CardRow) => a.order_index - b.order_index || a.position - b.position;
  const [cards, setCards] = useRealtimeRows<CardRow>("cards", initialCards, { key: `post-${initialPost.id}`, filter: `post_id=eq.${initialPost.id}`, sort: byOrder, refetch });
  const [posts] = useRealtimeRows<PostRow>("posts", [initialPost], { key: `post-row-${initialPost.id}`, filter: `id=eq.${initialPost.id}` });
  const post = posts[0] ?? initialPost;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(params.get("card"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const visible = useMemo(() => [...cards].sort(byOrder).filter((c) => !hidden.has(c.id)), [cards, hidden]);
  const numbers = uploadNumbers(visible);
  const urlFor = useSignedUrls(visible.map((c) => c.card_path));
  const open = visible.find((c) => c.id === openId) ?? null;
  const allSelected = visible.length > 0 && visible.every((c) => c.selected);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));

  const toggle = async (c: CardRow) => {
    setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, selected: !x.selected } : x)));
    const r = await setSelectedAction(c.id, !c.selected);
    if (!r.ok) toast.error(r.error);
  };
  const selectAll = async () => {
    const next = !allSelected;
    setCards((prev) => prev.map((x) => ({ ...x, selected: next })));
    const r = await selectAllAction(post.id, next);
    if (!r.ok) toast.error(r.error);
  };
  useHotkey("a", selectAll);

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = visible.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setCards((prev) => prev.map((c) => ({ ...c, order_index: next.indexOf(c.id) + 1 || c.order_index })));
    const r = await reorderCardsAction(post.id, next);
    if (!r.ok) toast.error(r.error);
  };

  const deleteCard = (c: CardRow) => {
    setHidden((h) => new Set(h).add(c.id));
    const t = setTimeout(async () => {
      timers.current.delete(c.id);
      const r = await deleteCardAction(c.id);
      if (!r.ok) { toast.error(r.error); setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }); }
    }, 5000);
    timers.current.set(c.id, t);
    toast(`Deleted ${c.name}`, {
      duration: 5000,
      action: { label: "Undo", onClick: () => { clearTimeout(timers.current.get(c.id)); timers.current.delete(c.id); setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }); } },
    });
  };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(ok); else toast.error(r.error ?? "Something went wrong.");
    return r.ok;
  };

  const label = post.gender === "girl" ? "Girl" : "Boy";
  const failed = visible.filter((c) => c.status === "failed");

  return (
    <div className="space-y-4">
      <Link href="/posts" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" /> Posts</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink sm:text-3xl">
            {new Date(post.post_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {label}
          </h1>
          <p className="mt-1 text-sm text-muted">{theme.title} · {post.style} · {visible.length} cards</p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge({ status: post.status, cards: visible })}
          {post.status === "posted"
            ? <Button variant="ghost" size="sm" loading={busy === "posted"} onClick={() => run("posted", () => setPostedAction(post.id, false), "Marked as not posted")}><CircleDashed className="size-4" /> Undo posted</Button>
            : <Button variant="subtle" size="sm" loading={busy === "posted"} disabled={post.status !== "ready"} onClick={() => run("posted", () => setPostedAction(post.id, true), "Marked as posted")}><CheckCircle2 className="size-4" /> Mark posted</Button>}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-bad/30 bg-bad/8 p-3 text-sm text-bad">
          <span>{failed.length} card(s) failed. {failed[0].error}</span>
          <Button variant="danger" size="sm" onClick={() => failed.forEach((c) => void regenerateCardAction(c.id))}>Retry all</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title="Cards" action={
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted">{numbers.size} selected</span>
            <Button variant="ghost" size="sm" onClick={selectAll}>{allSelected ? "Select none" : "Select all"}</Button>
          </div>}>
          <p className="mb-3 text-xs text-muted">Tap a picture to open it. Tap the number to select or unselect. Drag to change the upload order (press and hold on a phone).</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((c) => c.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((c) => (
                  <Sortable key={c.id} id={c.id}>
                    <CardTile card={c} url={urlFor(c.card_path)} health={health} queuePos={queuePosition(c, visible)}
                      onOpen={() => setOpenId(c.id)} onRetry={() => void regenerateCardAction(c.id)}
                      selection={{ selected: c.selected, order: numbers.get(c.id) ?? null, onToggle: () => void toggle(c) }} />
                  </Sortable>
                ))}
                <button type="button" onClick={() => run("add", () => addCardAction(post.id), "Adding one more card…")} disabled={busy === "add"}
                  className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:border-accent hover:text-accent">
                  <span className="flex flex-col items-center gap-1"><Plus className="size-5" /> Add a card</span>
                </button>
              </div>
            </SortableContext>
          </DndContext>
        </Panel>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Panel title="Save for Facebook">
            <div className="space-y-4">
              <SaveActions post={post} cards={visible} caption={post.caption} />
              <CaptionBox postId={post.id} initial={post.caption} />
            </div>
          </Panel>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /> Delete post</Button>
        </div>
      </div>

      <CardDialog card={open} url={open ? urlFor(open.card_path) : undefined} health={health} onClose={() => setOpenId(null)} onDelete={deleteCard} />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this post?"
        description="Its cards are deleted from the website and its names and theme go back on the list. The copies on your PC stay.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" loading={busy === "delete"} onClick={async () => { if (await run("delete", () => deletePostAction(post.id), "Post deleted")) router.push("/posts"); }}>Delete post</Button>
        </div>
      </Dialog>
    </div>
  );
}
```

`app/(app)/posts/[id]/page.tsx`:
```tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/data/posts";
import { PostDetail } from "@/components/posts/post-detail";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPost(id);
  if (!data) notFound();
  // PostDetail reads ?card= (open that card), which needs a Suspense boundary.
  return <Suspense><PostDetail key={id} post={data.post} theme={data.theme} initialCards={data.cards} /></Suspense>;
}
```

`app/(app)/posts/[id]/not-found.tsx`:
```tsx
import Link from "next/link";
export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl text-ink">Post not found</h1>
      <p className="mt-2 text-sm text-muted">It may have been deleted.</p>
      <Link href="/posts" className="mt-4 inline-block font-bold text-accent">Back to posts</Link>
    </div>
  );
}
```

- [ ] **Step 8: Verify** — `npm test && npm run typecheck && npm run lint && npm run build` → pass.

- [ ] **Step 9: Commit**

```bash
git add lib/data/posts.ts lib/files/save.ts components/posts components/cards/card-dialog.tsx "app/(app)/posts" tests/save.test.ts
git commit -m "feat(posts): post list and detail with select/order, save to phone, card edit/regenerate/delete with undo"
```

---

### Task 11: Names page

**Files:**
- Create: `components/names/names-table.tsx`, `components/names/name-form.tsx`, `components/names/bulk-paste.tsx`, `app/(app)/names/page.tsx`

**Interfaces:**
- Consumes: `parseBulkNames`, `NAME_RE` (Task 3); `addNamesAction`, `updateNameAction`, `setSkipAction`, `deleteNameAction` (Task 8); UI kit.
- Produces: the `/names` page.

- [ ] **Step 1: Name form dialog**

`components/names/name-form.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Gender, NameRow } from "@/lib/db/types";
import { addNamesAction, updateNameAction } from "@/lib/actions/names";
import { validateName } from "@/lib/actions/validate";

export function NameForm({ open, onOpenChange, editing, defaultGender, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: NameRow | null; defaultGender: Gender; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [gender, setGender] = useState<Gender>(defaultGender);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setName(editing?.name ?? ""); setMeaning(editing?.meaning ?? ""); setGender(editing?.gender ?? defaultGender); }
  }, [open, editing, defaultGender]);
  const problem = name || meaning ? validateName(name, meaning) : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = editing ? await updateNameAction(editing.id, { name, meaning, gender }) : await addNamesAction([{ name, meaning, gender }]);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    if (!editing && "skipped" in r && r.skipped.length) { toast.error(`${name} is already in your list.`); return; }
    toast.success(editing ? "Name updated" : `Added ${name.trim()}`);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? "Edit name" : "Add a name"} description="Two words (Arlo Zenith) or one (Arlo). The style is set automatically.">
      <form onSubmit={save} className="space-y-4">
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
        <label className="block"><span className="text-xs font-semibold text-muted">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-semibold text-ink" /></label>
        <label className="block"><span className="text-xs font-semibold text-muted">Meaning</span>
          <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="peak strength with calm" className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink" /></label>
        {problem && <p className="text-sm text-bad">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!!problem || !name || !meaning}>{editing ? "Save" : "Add name"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Bulk paste dialog**

`components/names/bulk-paste.tsx`:
```tsx
"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Gender } from "@/lib/db/types";
import { parseBulkNames } from "@/lib/names/bulk-paste";
import { addNamesAction } from "@/lib/actions/names";

export function BulkPaste({ open, onOpenChange, existing, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; existing: Set<string>; onSaved: () => void }) {
  const [gender, setGender] = useState<Gender>("boy");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseBulkNames(text, { gender }), [text, gender]);
  const dupes = parsed.rows.filter((r) => existing.has(r.name.toLowerCase()));
  const fresh = parsed.rows.filter((r) => !existing.has(r.name.toLowerCase()));

  const save = async () => {
    setBusy(true);
    const r = await addNamesAction(fresh);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Added ${r.added} names${r.skipped.length ? `, skipped ${r.skipped.length} already in the list` : ""}`);
    setText("");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Paste many names" description="One per line: Name - meaning. Two-word and single names can be mixed.">
      <div className="space-y-4">
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "boy", label: "Boy names" }, { value: "girl", label: "Girl names" }]} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={"Arlo Zenith - peak strength with calm\nLuna - the moon"}
          className="w-full rounded-xl border border-line bg-bg p-3 font-mono text-sm text-ink" />
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-xl bg-ok/10 p-3"><div className="text-2xl font-bold text-ok">{fresh.length}</div><div className="text-muted">new names ready</div></div>
          <div className="rounded-xl bg-surface-2 p-3"><div className="text-2xl font-bold text-ink">{dupes.length}</div><div className="text-muted">already in your list (skipped)</div></div>
          <div className="rounded-xl bg-bad/10 p-3"><div className="text-2xl font-bold text-bad">{parsed.issues.length}</div><div className="text-muted">lines with problems</div></div>
        </div>
        {parsed.issues.length > 0 && (
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line p-3 text-xs">
            {parsed.issues.map((i) => <li key={i.line}><span className="font-bold text-bad">Line {i.line}:</span> {i.reason} <span className="text-muted">({i.text})</span></li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!fresh.length}>Add {fresh.length} names</Button>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 3: Names table**

`components/names/names-table.tsx`:
```tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ClipboardPaste, Pencil, Plus, Search, Trash2, Undo2, Type } from "lucide-react";
import { toast } from "sonner";
import type { Gender, NameRow, NameStatus, NameStyle } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { deleteNameAction, setSkipAction } from "@/lib/actions/names";
import { NameForm } from "./name-form";
import { BulkPaste } from "./bulk-paste";

const STATUS_TONE: Record<NameStatus, "ok" | "accent" | "muted" | "warn"> = { available: "ok", reserved: "accent", used: "muted", skip: "warn" };
const STATUS_TEXT: Record<NameStatus, string> = { available: "Available", reserved: "In a post", used: "Used", skip: "Skip" };

export function NamesTable({ names }: { names: NameRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<"all" | Gender>("all");
  const [style, setStyle] = useState<"all" | NameStyle>("all");
  const [status, setStatus] = useState<"all" | NameStatus>("available");
  const [form, setForm] = useState<{ open: boolean; editing: NameRow | null }>({ open: false, editing: null });
  const [bulk, setBulk] = useState(false);
  const existing = useMemo(() => new Set(names.map((n) => n.name.toLowerCase())), [names]);

  const shown = useMemo(() => names.filter((n) =>
    (gender === "all" || n.gender === gender) && (style === "all" || n.style === style) && (status === "all" || n.status === status) &&
    (!q || n.name.toLowerCase().includes(q.toLowerCase()) || n.meaning.toLowerCase().includes(q.toLowerCase())),
  ).sort((a, b) => a.name.localeCompare(b.name)), [names, q, gender, style, status]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    const r = await fn();
    if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "Something went wrong.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" /> Add name</Button>
        <Button variant="subtle" onClick={() => setBulk(true)}><ClipboardPaste className="size-4" /> Paste many</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <span className="sr-only">Search names</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or meanings" className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink" />
        </label>
        <Segmented label="Gender" value={gender} onChange={setGender} options={[{ value: "all", label: "All" }, { value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} />
        <Segmented label="Style" value={style} onChange={setStyle} options={[{ value: "all", label: "Any" }, { value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }]} />
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "available", label: "Available" }, { value: "used", label: "Used" }, { value: "skip", label: "Skip" }, { value: "all", label: "All" }]} />
      </div>
      <p className="text-xs text-muted">{shown.length} of {names.length} names</p>

      {shown.length === 0 ? (
        <Empty icon={<Type className="size-6" />} title="No names here" text={names.length ? "Nothing matches these filters." : "Add your first names, or paste a list."}
          action={<Button variant="subtle" onClick={() => setBulk(true)}><ClipboardPaste className="size-4" /> Paste many</Button>} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {shown.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">{n.name}</div>
                <div className="truncate text-sm text-muted">{n.meaning}</div>
              </div>
              <Badge tone="muted">{n.gender === "boy" ? "Boy" : "Girl"} · {n.style}</Badge>
              <Badge tone={STATUS_TONE[n.status]}>{STATUS_TEXT[n.status]}</Badge>
              <div className="flex gap-1">
                {(n.status === "available" || n.status === "skip") && (
                  <>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${n.name}`} onClick={() => setForm({ open: true, editing: n })}><Pencil className="size-4" /></Button>
                    {n.status === "available"
                      ? <Button variant="ghost" size="sm" aria-label={`Skip ${n.name}`} onClick={() => act(() => setSkipAction(n.id, true), `${n.name} will be skipped`)}><Ban className="size-4" /></Button>
                      : <Button variant="ghost" size="sm" aria-label={`Use ${n.name} again`} onClick={() => act(() => setSkipAction(n.id, false), `${n.name} is available again`)}><Undo2 className="size-4" /></Button>}
                    <Button variant="ghost" size="sm" aria-label={`Delete ${n.name}`} onClick={() => act(() => deleteNameAction(n.id), `Deleted ${n.name}`)}><Trash2 className="size-4 text-bad" /></Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <NameForm open={form.open} editing={form.editing} defaultGender={gender === "girl" ? "girl" : "boy"} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => router.refresh()} />
      <BulkPaste open={bulk} onOpenChange={setBulk} existing={existing} onSaved={() => router.refresh()} />
    </div>
  );
}
```

`app/(app)/names/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import type { NameRow } from "@/lib/db/types";
import { NamesTable } from "@/components/names/names-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function NamesPage() {
  const sb = await createClient();
  const { data } = await sb.from("names").select("*").order("name").limit(5000);
  return (
    <>
      <PageHeader title="Names" subtitle="The names and meanings your posts use. Exact spelling here is exactly what goes on the card." />
      <NamesTable names={(data ?? []) as NameRow[]} />
    </>
  );
}
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint && npm run build` → pass.

- [ ] **Step 5: Commit**

```bash
git add components/names "app/(app)/names"
git commit -m "feat(names): search, filters, add, bulk paste with preview, skip/edit/delete"
```

---

### Task 12: Themes page (order, preview, add/edit, archive)

**Files:**
- Create: `components/themes/theme-form.tsx`, `components/themes/theme-list.tsx`, `app/(app)/themes/page.tsx`

**Interfaces:**
- Consumes: `saveThemeAction`, `setArchivedAction`, `reorderThemesAction`, `moveThemeNextAction`, `makePreviewAction` (Task 8); `CardTile`, `useRealtimeRows`, `useSignedUrls`, `useWorkerContext`.
- Produces: the `/themes` page.

- [ ] **Step 1: Theme form**

`components/themes/theme-form.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Gender, ThemeRow } from "@/lib/db/types";
import { saveThemeAction } from "@/lib/actions/themes";

const FIELDS = [
  { key: "backdrop", label: "Backdrop", hint: "Always a seamless studio backdrop, e.g. smooth seamless sage green studio backdrop" },
  { key: "outfit", label: "Outfit", hint: "e.g. cream cable-knit romper with a tiny bonnet" },
  { key: "props", label: "Props", hint: "Keep them short and low, e.g. wicker basket, small pumpkins, knitted blanket" },
  { key: "lighting", label: "Lighting", hint: "e.g. warm low golden light, cozy" },
  { key: "palette", label: "Color palette", hint: "e.g. rust, mustard, cream and brown" },
] as const;

type Form = { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string };
const EMPTY: Form = { title: "", gender: "boy", backdrop: "", outfit: "", props: "", lighting: "", palette: "" };

export function ThemeForm({ open, onOpenChange, editing, defaultGender, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: ThemeRow | null; defaultGender: Gender; onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(editing ? { ...editing } : { ...EMPTY, gender: defaultGender }); }, [open, editing, defaultGender]);
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await saveThemeAction({ ...f, id: editing?.id });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(editing ? "Theme saved" : "Theme added to the end of the line");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={editing ? "Edit theme" : "New theme"}
      description="Every picture in a post repeats these words exactly, so the whole album looks like one photoshoot.">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="text-xs font-semibold text-muted">Title</span>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Autumn Harvest" className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-semibold text-ink" /></label>
        <div className="sm:col-span-2"><Segmented label="Gender" value={f.gender} onChange={(v) => set("gender", v)} options={[{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }]} /></div>
        {FIELDS.map((x) => (
          <label key={x.key} className="block">
            <span className="text-xs font-semibold text-muted">{x.label}</span>
            <textarea value={f[x.key]} onChange={(e) => set(x.key, e.target.value)} rows={2} placeholder={x.hint} className="mt-1 w-full rounded-xl border border-line bg-bg p-3 text-sm text-ink" />
          </label>
        ))}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>{editing ? "Save theme" : "Add theme"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Theme list**

`components/themes/theme-list.tsx`:
```tsx
"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowUpToLine, GripVertical, Palette, Pencil, Plus, Sparkles } from "lucide-react";
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow, Gender, ThemeRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { CardTile } from "@/components/cards/card-tile";
import { useRealtimeRows } from "@/lib/realtime/use-table";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { useWorkerContext } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { makePreviewAction, moveThemeNextAction, reorderThemesAction, setArchivedAction } from "@/lib/actions/themes";
import { ThemeForm } from "./theme-form";

function Row({ t, next, preview, url, onEdit, onPreview, onArchive, onNext }: {
  t: ThemeRow; next: boolean; preview: CardRow | null; url?: string; onEdit: () => void; onPreview: () => void; onArchive: () => void; onNext: () => void;
}) {
  const { health } = useWorkerContext();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-soft ${isDragging ? "z-10 opacity-90" : ""}`}>
      <button type="button" className="grid w-8 shrink-0 cursor-grab touch-none place-items-center text-muted" aria-label={`Drag ${t.title} to reorder`} {...attributes} {...listeners}>
        <GripVertical className="size-5" />
      </button>
      <div className="w-24 shrink-0 sm:w-28">
        {preview ? <CardTile card={preview} url={url} health={health} queuePos={0} />
          : <button type="button" onClick={onPreview} className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-line text-[11px] font-semibold text-muted hover:border-accent hover:text-accent"><span className="flex flex-col items-center gap-1"><Sparkles className="size-4" /> Make preview</span></button>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{t.title}</span>
          {next && <Badge tone="accent">Next</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{t.backdrop} · {t.outfit} · {t.props}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="size-4" /> Edit</Button>
          {preview && <Button variant="ghost" size="sm" onClick={onPreview}><Sparkles className="size-4" /> New preview</Button>}
          {!next && <Button variant="ghost" size="sm" onClick={onNext}><ArrowUpToLine className="size-4" /> Use next</Button>}
          <Button variant="ghost" size="sm" onClick={onArchive}><Archive className="size-4" /> Archive</Button>
        </div>
      </div>
    </li>
  );
}

export function ThemeList({ themes, previews: initialPreviews }: { themes: ThemeRow[]; previews: CardRow[] }) {
  const router = useRouter();
  const [gender, setGender] = useState<Gender>("boy");
  const [form, setForm] = useState<{ open: boolean; editing: ThemeRow | null }>({ open: false, editing: null });
  const [order, setOrder] = useState<string[] | null>(null);
  const refetch = useCallback(async () => ((await createClient().from("cards").select("*").eq("kind", "preview")).data ?? []) as CardRow[], []);
  const [previews] = useRealtimeRows<CardRow>("cards", initialPreviews, { key: "previews", filter: "kind=eq.preview", refetch });
  const latestPreview = useMemo(() => {
    const m = new Map<string, CardRow>();
    [...previews].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).forEach((p) => m.set(p.theme_id, p));
    return m;
  }, [previews]);
  const urlFor = useSignedUrls([...latestPreview.values()].map((p) => p.card_path));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));

  const mine = themes.filter((t) => t.gender === gender);
  const availableSorted = mine.filter((t) => t.status === "available").sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  const available = order ? order.map((id) => availableSorted.find((t) => t.id === id)).filter((t): t is ThemeRow => !!t) : availableSorted;
  const used = mine.filter((t) => t.status === "used").sort((a, b) => (b.used_on ?? "").localeCompare(a.used_on ?? ""));
  const archived = mine.filter((t) => t.status === "archived");

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    const r = await fn();
    if (r.ok) { toast.success(ok); setOrder(null); router.refresh(); } else toast.error(r.error ?? "Something went wrong.");
  };
  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = available.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    // sort_order is only ever compared within one gender, so numbering this gender's list 1..n is safe.
    const r = await reorderThemesAction(next);
    if (!r.ok) { toast.error(r.error); setOrder(null); } else router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Gender" value={gender} onChange={(g) => { setGender(g); setOrder(null); }} options={[{ value: "boy", label: "Boy themes" }, { value: "girl", label: "Girl themes" }]} />
        <Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" /> New theme</Button>
      </div>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-[.08em] text-muted">Up next · {available.length} left</h2>
        {available.length === 0 ? (
          <Empty icon={<Palette className="size-6" />} title={`No ${gender} themes left`} text="Add a new photoshoot theme, or restore an archived one." action={<Button onClick={() => setForm({ open: true, editing: null })}><Plus className="size-4" /> New theme</Button>} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={available.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {available.map((t, i) => {
                  const p = latestPreview.get(t.id) ?? null;
                  return (
                    <Row key={t.id} t={t} next={i === 0} preview={p} url={urlFor(p?.card_path)}
                      onEdit={() => setForm({ open: true, editing: t })}
                      onPreview={() => act(() => makePreviewAction(t.id), "Making a preview… it appears here in about 30 s")}
                      onArchive={() => act(() => setArchivedAction(t.id, true), `${t.title} archived`)}
                      onNext={() => act(() => moveThemeNextAction(t.id), `${t.title} is next`)} />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
      {used.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Used · {used.length}</summary>
          <ul className="mt-3 space-y-1 text-sm">{used.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="text-ink">{t.title}</span><span className="text-muted">{t.used_on}</span></li>)}</ul>
        </details>
      )}
      {archived.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Archived · {archived.length}</summary>
          <ul className="mt-3 space-y-1">{archived.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm"><span className="text-ink">{t.title}</span>
              <Button variant="ghost" size="sm" onClick={() => act(() => setArchivedAction(t.id, false), `${t.title} restored`)}><ArchiveRestore className="size-4" /> Restore</Button></li>
          ))}</ul>
        </details>
      )}
      <ThemeForm open={form.open} editing={form.editing} defaultGender={gender} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} onSaved={() => router.refresh()} />
    </div>
  );
}
```

`app/(app)/themes/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import type { CardRow, ThemeRow } from "@/lib/db/types";
import { ThemeList } from "@/components/themes/theme-list";
import { PageHeader } from "@/components/ui/page-header";

export default async function ThemesPage() {
  const sb = await createClient();
  const [{ data: themes }, { data: previews }] = await Promise.all([
    sb.from("themes").select("*").order("sort_order"),
    sb.from("cards").select("*").eq("kind", "preview"),
  ]);
  return (
    <>
      <PageHeader title="Themes" subtitle="One photoshoot per post, used once. Drag to choose what comes next; make a preview to see the look first." />
      <ThemeList themes={(themes ?? []) as ThemeRow[]} previews={(previews ?? []) as CardRow[]} />
    </>
  );
}
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint && npm run build` → pass.

- [ ] **Step 4: Commit**

```bash
git add components/themes "app/(app)/themes"
git commit -m "feat(themes): ordered queue with drag, live previews, add/edit, archive/restore"
```

---

### Task 13: Settings page

**Files:**
- Create: `components/settings/settings-form.tsx`, `components/settings/worker-card.tsx`, `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `saveSettingsAction`, `validateSettings` (Task 8), `useWorkerContext`, `PC_TEXT`, `ThemeToggle`, `buildCaption`.

- [ ] **Step 1: Settings form with live caption preview**

`components/settings/settings-form.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, LogOut } from "lucide-react";
import type { SettingsRow } from "@/lib/db/types";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { saveSettingsAction } from "@/lib/actions/settings";
import { validateSettings } from "@/lib/actions/validate";
import { buildCaption } from "@/lib/planner";
import { createClient } from "@/lib/supabase/client";

export function SettingsForm({ initial }: { initial: SettingsRow }) {
  const router = useRouter();
  const [s, setS] = useState({ caption_template: initial.caption_template, hashtags: initial.hashtags, handle: initial.handle, min_images: initial.min_images, max_images: initial.max_images, sound_on: initial.sound_on });
  const [busy, setBusy] = useState(false);
  const problem = validateSettings(s);

  const save = async () => {
    setBusy(true);
    const r = await saveSettingsAction(s);
    setBusy(false);
    if (r.ok) { toast.success("Settings saved"); router.refresh(); } else toast.error(r.error);
  };
  const enableNotifications = async () => {
    const p = await Notification.requestPermission();
    toast[p === "granted" ? "success" : "error"](p === "granted" ? "You will get a notification when a post is ready." : "Notifications are blocked in this browser.");
  };
  const signOut = async () => { await createClient().auth.signOut(); router.replace("/login"); };

  return (
    <div className="space-y-4">
      <Panel title="Caption">
        <div className="space-y-3">
          <label className="block"><span className="text-xs font-semibold text-muted">Caption template ({"{gender}"} becomes boy or girl)</span>
            <textarea value={s.caption_template} onChange={(e) => setS({ ...s, caption_template: e.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-line bg-bg p-3 text-sm text-ink" /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Hashtags</span>
            <input value={s.hashtags} onChange={(e) => setS({ ...s, hashtags: e.target.value })} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink" /></label>
          <div className="rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-wrap text-ink"><span className="mb-1 block text-xs font-semibold text-muted">Preview</span>{buildCaption("girl", s)}</div>
        </div>
      </Panel>
      <Panel title="Cards">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="text-xs font-semibold text-muted">Watermark handle</span>
            <input value={s.handle} onChange={(e) => setS({ ...s, handle: e.target.value })} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink" /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Fewest cards (Auto)</span>
            <input type="number" min={1} max={30} value={s.min_images} onChange={(e) => setS({ ...s, min_images: Number(e.target.value) })} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink" /></label>
          <label className="block"><span className="text-xs font-semibold text-muted">Most cards (Auto)</span>
            <input type="number" min={1} max={30} value={s.max_images} onChange={(e) => setS({ ...s, max_images: Number(e.target.value) })} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink" /></label>
        </div>
        <p className="mt-2 text-xs text-muted">The handle change applies to cards made from now on.</p>
      </Panel>
      <Panel title="App">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={s.sound_on} onChange={(e) => setS({ ...s, sound_on: e.target.checked })} className="size-5 accent-[var(--accent)]" /> Chime when a post is ready
          </label>
          <Button variant="subtle" size="sm" onClick={enableNotifications}><Bell className="size-4" /> Allow notifications</Button>
          <ThemeToggle />
        </div>
      </Panel>
      {problem && <p className="text-sm font-semibold text-bad">{problem}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={save} loading={busy} disabled={!!problem}>Save settings</Button>
        <Button variant="ghost" onClick={signOut}><LogOut className="size-4" /> Sign out</Button>
      </div>
    </div>
  );
}
```

`components/settings/worker-card.tsx`:
```tsx
"use client";
import { Panel } from "@/components/ui/panel";
import { PcStatus, PC_TEXT } from "@/components/shell/pc-status";
import { useWorkerContext } from "@/components/shell/app-shell";

export function WorkerCard() {
  const { health, lastSeen, row } = useWorkerContext();
  return (
    <Panel title="Your PC">
      <PcStatus health={health} lastSeen={lastSeen} />
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Last seen</dt><dd className="text-ink">{lastSeen}</dd>
        <dt className="text-muted">GPU</dt><dd className="truncate text-ink">{row?.gpu ?? "—"}</dd>
        <dt className="text-muted">Worker</dt><dd className="text-ink">{row?.worker_version ?? "—"}</dd>
        <dt className="text-muted">Working on</dt><dd className="text-ink">{row?.current_card_id ? "a card" : "nothing"}</dd>
        {row?.message && (<><dt className="text-muted">Note</dt><dd className="text-ink">{row.message}</dd></>)}
      </dl>
      {health !== "ready" && <p className="mt-3 rounded-xl bg-warn/12 p-3 text-sm text-warn">{PC_TEXT[health].fix}</p>}
    </Panel>
  );
}
```

`app/(app)/settings/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import type { SettingsRow } from "@/lib/db/types";
import { SettingsForm } from "@/components/settings/settings-form";
import { WorkerCard } from "@/components/settings/worker-card";
import { PageHeader } from "@/components/ui/page-header";

export default async function SettingsPage() {
  const { data } = await (await createClient()).from("settings").select("*").eq("id", 1).single();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <SettingsForm initial={data as SettingsRow} />
        <div className="lg:sticky lg:top-20 lg:self-start"><WorkerCard /></div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck && npm run lint && npm run build` → pass.

- [ ] **Step 3: Commit**

```bash
git add components/settings "app/(app)/settings"
git commit -m "feat(settings): caption template with preview, card counts, sound, notifications, PC details"
```

---

### Task 14: PC worker: job loop (claim → render → upload → backup), restamp, heartbeat, recovery

**Files:**
- Create: `worker/render.py` (from the existing n8n worker), `worker/supa.py`, `worker/jobs.py`, `worker/main.py`, `worker/test_render.py`, `worker/test_supa.py`, `worker/test_jobs.py`, `worker/worker.env.example`, `worker/install-autostart.ps1`, `worker/.gitignore`, `worker/README.md`

**Interfaces:**
- Consumes: SQL `claim_next_card()` / `requeue_stuck_cards()` and the card/worker_status columns (Task 4); storage paths `photos/<id>/v<version>.jpg`, `cards/<id>/v<version>.jpg`.
- Produces:
  - `render.py`: everything from the old worker's pure layer (`comfy_graph`, `pick_band`, `compose_card`, `fit_to_size`, `fit_font`, `slugify`, `ensure_fonts`, `load_env`, `default_output_root`, `http_json`, `HERE`) plus `JobError(Exception)` and `ComfyRenderer(comfy_url, timeout, fonts)` with `health() -> {"ok", "gpu", "error"}`, `generate_photo(prompt, seed, width, height) -> PIL.Image` (already `fit_to_size`d), `compose(photo, name, meaning, handle) -> PIL.Image`.
  - `supa.py`: `SupaError`, `Supa(url, key, timeout=30)` with `rpc(fn, args=None)`, `select(table, query)`, `update(table, match, values)`, `upload(bucket, path, data, content_type="image/jpeg")`, `download(bucket, path) -> bytes`, `remove(bucket, paths)`.
  - `jobs.py`: `VERSION = "2.0.0"`, `Runner(supa, renderer, output_root, cache_dir, poll_seconds=3, heartbeat_seconds=15, log=print)` with `tick() -> bool`, `heartbeat_once()`, `run_forever()`.
  - `main.py`: entry point (`python main.py`, or hidden via `pythonw` at logon).

- [ ] **Step 1: Bring over the render layer**

```bash
cp "C:/Users/rober/OneDrive/Documents/automation/n8n-control/builds/unique-names-cards/worker/worker.py" worker/render.py
cp "C:/Users/rober/OneDrive/Documents/automation/n8n-control/builds/unique-names-cards/worker/test_worker.py" worker/test_render.py
```

In `worker/render.py`:
1. Replace the module header comment with:
```python
# Unique Names card rendering: ComfyUI makes a TEXT-FREE photo, Pillow stamps
# the exact name, meaning and handle. Pure helpers + ComfyRenderer. No HTTP server.
```
2. Delete everything from the line `class Worker:` to the end of the file (the old `Worker`, `make_handler`, `main` and `if __name__ == "__main__"` blocks).
3. Append:
```python
class JobError(Exception):
    """A failure whose message is written for the owner and shown on the card."""


class ComfyRenderer:
    def __init__(self, comfy_url, timeout, fonts):
        self.comfy = comfy_url.rstrip("/")
        self.timeout = int(timeout)
        self.fonts = fonts

    def health(self):
        try:
            stats = http_json(self.comfy + "/system_stats", timeout=5)
            dev = (stats.get("devices") or [{}])[0]
            return {"ok": True, "gpu": dev.get("name"), "error": None}
        except Exception:
            return {"ok": False, "gpu": None, "error": "ComfyUI is not reachable at %s" % self.comfy}

    def generate_photo(self, prompt, seed, width, height):
        graph = comfy_graph(prompt, seed, width, height, "unique-names/raw")
        try:
            sub = http_json(self.comfy + "/prompt", {"prompt": graph, "client_id": "unique-names-worker"}, timeout=30)
        except urllib.error.HTTPError as e:
            raise JobError("ComfyUI refused the job: %s" % e.read().decode("utf-8", "replace")[:300])
        except Exception:
            raise JobError("ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry.")
        pid = sub.get("prompt_id")
        if not pid:
            raise JobError("ComfyUI did not accept the job: %s" % json.dumps(sub)[:300])
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            time.sleep(1.5)
            try:
                entry = http_json(self.comfy + "/history/" + pid, timeout=15).get(pid)
            except Exception:
                raise JobError("ComfyUI stopped answering while making the picture. Is it still open?")
            if not entry:
                continue
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise JobError("ComfyUI failed while making the picture: %s" % json.dumps(status.get("messages"))[:300])
            if status.get("completed"):
                imgs = (entry.get("outputs", {}).get("10", {}) or {}).get("images") or []
                if not imgs:
                    raise JobError("ComfyUI finished without a picture.")
                im = imgs[0]
                q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                with urllib.request.urlopen(self.comfy + "/view?" + q, timeout=60) as r:
                    data = r.read()
                return fit_to_size(Image.open(io.BytesIO(data)).convert("RGB"), width, height)
        raise JobError("ComfyUI did not finish within %d seconds." % self.timeout)

    def compose(self, photo, name, meaning, handle):
        img, _band, _scores = compose_card(photo, name, meaning, handle, self.fonts)
        return img
```

In `worker/test_render.py`: change `import worker as w` to `import render as w`; delete the `FakeWorker` and `Server` classes (they tested the removed HTTP server). Keep `Validate`, `Names`, `Graph`, `Layout`.

Run: `cd worker && python -m unittest test_render -v` → all pass.

- [ ] **Step 2: Failing tests for the Supabase client**

`worker/test_supa.py`:
```python
# The Supabase REST client against a local fake server: request shapes and errors.
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from supa import Supa, SupaError

SEEN = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _record(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        SEEN.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": body})
        return body

    def _send(self, code, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self._record()
        if self.path == "/rest/v1/rpc/claim_next_card":
            return self._send(200, b"null")
        if self.path == "/rest/v1/rpc/boom":
            return self._send(400, {"message": "bad"})
        self._send(200, {"Key": "ok"})

    def do_PATCH(self):
        self._record()
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        self._record()
        if self.path.startswith("/storage/"):
            return self._send(200, b"JPEGDATA", "image/jpeg")
        self._send(200, [{"handle": "@unique_names"}])

    def do_DELETE(self):
        self._record()
        self._send(200, [])


class SupaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        SEEN.clear()

    def test_rpc_null_and_auth_headers_for_jwt_keys(self):
        s = Supa(self.base, "eyJhbGciOi.jwt.key")
        self.assertIsNone(s.rpc("claim_next_card"))
        h = SEEN[0]["headers"]
        self.assertEqual(h["apikey"], "eyJhbGciOi.jwt.key")
        self.assertEqual(h["Authorization"], "Bearer eyJhbGciOi.jwt.key")

    def test_new_secret_keys_send_only_apikey(self):
        Supa(self.base, "sb_secret_abc").rpc("claim_next_card")
        self.assertNotIn("Authorization", SEEN[0]["headers"])
        self.assertEqual(SEEN[0]["headers"]["apikey"], "sb_secret_abc")

    def test_update_select_upload_download_remove(self):
        s = Supa(self.base, "k")
        s.update("cards", "id=eq.1&version=eq.2", {"status": "done", "claimed_at": None})
        self.assertEqual(SEEN[-1]["method"], "PATCH")
        self.assertEqual(SEEN[-1]["path"], "/rest/v1/cards?id=eq.1&version=eq.2")
        self.assertEqual(json.loads(SEEN[-1]["body"]), {"status": "done", "claimed_at": None})
        self.assertEqual(s.select("settings", "id=eq.1&select=handle"), [{"handle": "@unique_names"}])
        s.upload("cards", "cards/abc/v1.jpg", b"\xff\xd8x")
        self.assertEqual(SEEN[-1]["path"], "/storage/v1/object/cards/cards/abc/v1.jpg")
        self.assertEqual(SEEN[-1]["headers"]["x-upsert"], "true")
        self.assertEqual(SEEN[-1]["body"], b"\xff\xd8x")
        self.assertEqual(s.download("cards", "photos/abc/v1.jpg"), b"JPEGDATA")
        self.assertEqual(SEEN[-1]["path"], "/storage/v1/object/authenticated/cards/photos/abc/v1.jpg")
        s.remove("cards", ["cards/abc/v1.jpg"])
        self.assertEqual(SEEN[-1]["method"], "DELETE")
        self.assertEqual(json.loads(SEEN[-1]["body"]), {"prefixes": ["cards/abc/v1.jpg"]})

    def test_http_error_and_network_error(self):
        with self.assertRaises(SupaError) as cm:
            Supa(self.base, "k").rpc("boom")
        self.assertIn("400", str(cm.exception))
        with self.assertRaises(SupaError):
            Supa("http://127.0.0.1:1", "k", timeout=2).rpc("claim_next_card")


if __name__ == "__main__":
    unittest.main()
```

Run → FAIL (no `supa` module).

- [ ] **Step 3: Supabase client**

`worker/supa.py`:
```python
# Tiny Supabase REST + Storage client (stdlib only). Uses the service-role key,
# which lives only in worker.env on the owner's PC.
import json
import urllib.error
import urllib.parse
import urllib.request


class SupaError(Exception):
    pass


class Supa:
    def __init__(self, url, key, timeout=30):
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    def _headers(self):
        h = {"apikey": self.key}
        # New-style secret keys (sb_secret_...) are not JWTs and must not be sent as Bearer.
        if not self.key.startswith("sb_"):
            h["Authorization"] = "Bearer " + self.key
        return h

    def _req(self, method, path, body=None, headers=None, raw=False):
        h = self._headers()
        data = None
        if body is not None:
            if isinstance(body, (bytes, bytearray)):
                data = bytes(body)
            else:
                data = json.dumps(body).encode("utf-8")
                h["Content-Type"] = "application/json"
        if headers:
            h.update(headers)
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                out = r.read()
        except urllib.error.HTTPError as e:
            raise SupaError("%s %s -> HTTP %d %s" % (method, path, e.code, e.read().decode("utf-8", "replace")[:300]))
        except (urllib.error.URLError, OSError) as e:
            raise SupaError("%s %s -> network error: %s" % (method, path, e))
        if raw:
            return out
        return json.loads(out) if out else None

    def rpc(self, fn, args=None):
        return self._req("POST", "/rest/v1/rpc/" + fn, args or {})

    def select(self, table, query):
        return self._req("GET", "/rest/v1/%s?%s" % (table, query))

    def update(self, table, match, values):
        return self._req("PATCH", "/rest/v1/%s?%s" % (table, match), values, {"Prefer": "return=minimal"})

    def upload(self, bucket, path, data, content_type="image/jpeg"):
        return self._req("POST", "/storage/v1/object/%s/%s" % (bucket, urllib.parse.quote(path)), data,
                         {"Content-Type": content_type, "x-upsert": "true"})

    def download(self, bucket, path):
        return self._req("GET", "/storage/v1/object/authenticated/%s/%s" % (bucket, urllib.parse.quote(path)), raw=True)

    def remove(self, bucket, paths):
        return self._req("DELETE", "/storage/v1/object/%s" % bucket, {"prefixes": list(paths)})
```

Run `python -m unittest test_supa -v` → PASS.

- [ ] **Step 4: Failing job-loop tests**

`worker/test_jobs.py`:
```python
# The job loop against an in-memory Supabase and a fake renderer.
import os
import shutil
import tempfile
import unittest
from unittest import mock

from PIL import Image

import jobs
from render import JobError
from supa import SupaError


class FakeSupa:
    def __init__(self):
        self.jobs, self.updates, self.uploads, self.removed, self.rpcs = [], [], {}, [], []
        self.settings = [{"handle": "@unique_names", "width": 1080, "height": 1080}]
        self.fail_updates = 0

    def rpc(self, fn, args=None):
        self.rpcs.append(fn)
        if fn == "claim_next_card":
            return self.jobs.pop(0) if self.jobs else None
        return 0

    def select(self, table, query):
        return self.settings

    def update(self, table, match, values):
        if self.fail_updates:
            self.fail_updates -= 1
            raise SupaError("network down")
        self.updates.append((table, match, values))

    def upload(self, bucket, path, data, content_type="image/jpeg"):
        self.uploads[path] = data

    def download(self, bucket, path):
        return self.uploads[path]

    def remove(self, bucket, paths):
        self.removed.extend(paths)


class FakeRenderer:
    def __init__(self, ok=True, boom=None):
        self.ok, self.boom, self.composed, self.generated = ok, boom, [], 0

    def health(self):
        return {"ok": self.ok, "gpu": "Fake GPU", "error": None if self.ok else "ComfyUI is not reachable"}

    def generate_photo(self, prompt, seed, width, height):
        if self.boom:
            raise self.boom
        self.generated += 1
        return Image.new("RGB", (width, height), (90, 60, 40))

    def compose(self, photo, name, meaning, handle):
        self.composed.append((name, meaning, handle))
        return photo


def job(job_type="generate", **over):
    card = {"id": "c1", "kind": "post", "position": 3, "name": "Arlo Zenith", "meaning": "peak strength", "prompt": "p", "seed": 7,
            "version": 1, "photo_path": None, "card_path": None}
    card.update(over)
    return {"job": job_type, "card": card, "post_date": "2026-10-05", "gender_label": "Boy" if card["kind"] == "post" else None}


class JobsTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.supa = FakeSupa()
        self.r = FakeRenderer()
        self.run_ = jobs.Runner(self.supa, self.r, os.path.join(self.root, "out"), os.path.join(self.root, "cache"), log=lambda m: None)
        patcher = mock.patch("jobs.time.sleep")
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def last_card_update(self):
        return [u for u in self.supa.updates if u[0] == "cards"][-1]

    def test_no_job(self):
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["requeue_stuck_cards", "claim_next_card"])

    def test_generate_uploads_finishes_and_backs_up(self):
        self.supa.jobs.append(job())
        self.assertTrue(self.run_.tick())
        self.assertEqual(sorted(self.supa.uploads), ["cards/c1/v1.jpg", "photos/c1/v1.jpg"])
        table, match, values = self.last_card_update()
        self.assertEqual(match, "id=eq.c1&version=eq.1")
        self.assertEqual(values["status"], "done")
        self.assertEqual(values["card_path"], "cards/c1/v1.jpg")
        self.assertEqual(values["photo_path"], "photos/c1/v1.jpg")
        self.assertIsNone(values["claimed_at"])
        self.assertTrue(os.path.exists(os.path.join(self.root, "out", "2026-10-05 Boy", "03-arlo-zenith.jpg")))
        self.assertEqual(self.r.composed, [("Arlo Zenith", "peak strength", "@unique_names")])
        self.assertIsNone(self.run_.current)

    def test_regenerate_removes_the_previous_version(self):
        self.supa.jobs.append(job(version=2, photo_path="photos/c1/v1.jpg", card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(sorted(self.supa.removed), ["cards/c1/v1.jpg", "photos/c1/v1.jpg"])
        self.assertIn("cards/c1/v2.jpg", self.supa.uploads)

    def test_restamp_reuses_the_clean_photo(self):
        buf = Image.new("RGB", (1080, 1080), (10, 10, 10))
        import io
        b = io.BytesIO()
        buf.save(b, "JPEG")
        self.supa.uploads["photos/c1/v1.jpg"] = b.getvalue()
        folder = os.path.join(self.root, "out", "2026-10-05 Boy")
        os.makedirs(folder)
        open(os.path.join(folder, "03-arlo-zenit.jpg"), "wb").write(b"old")
        self.supa.jobs.append(job("restamp", version=2, name="Arlo Zenith", photo_path="photos/c1/v1.jpg", card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(self.r.generated, 0)
        self.assertIn("cards/c1/v2.jpg", self.supa.uploads)
        self.assertEqual(self.supa.removed, ["cards/c1/v1.jpg"])
        values = self.last_card_update()[2]
        self.assertEqual(values["card_path"], "cards/c1/v2.jpg")
        self.assertNotIn("photo_path", values)
        self.assertEqual(sorted(os.listdir(folder)), ["03-arlo-zenith.jpg"])

    def test_restamp_without_photo_falls_back_to_generate(self):
        self.supa.jobs.append(job("restamp", version=2, card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(self.r.generated, 1)

    def test_comfy_down_fails_with_a_friendly_reason(self):
        self.run_.renderer = FakeRenderer(ok=False)
        self.supa.jobs.append(job())
        self.run_.tick()
        values = self.last_card_update()[2]
        self.assertEqual(values["status"], "failed")
        self.assertIn("Open ComfyUI Desktop", values["error"])
        self.assertEqual(self.supa.uploads, {})

    def test_job_error_and_unexpected_error(self):
        self.run_.renderer = FakeRenderer(boom=JobError("ComfyUI did not finish within 300 seconds."))
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertEqual(self.last_card_update()[2]["error"], "ComfyUI did not finish within 300 seconds.")
        self.run_.renderer = FakeRenderer(boom=ValueError("bad pixels"))
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertIn("Something went wrong on your PC: bad pixels", self.last_card_update()[2]["error"])

    def test_finish_retries_through_network_blips(self):
        self.supa.fail_updates = 2
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertEqual(self.last_card_update()[2]["status"], "done")

    def test_preview_cards_are_not_backed_up(self):
        self.supa.jobs.append(job(kind="preview"))
        self.run_.tick()
        self.assertFalse(os.path.exists(os.path.join(self.root, "out")))

    def test_heartbeat(self):
        self.run_.current = "c9"
        self.run_.heartbeat_once()
        table, match, values = self.supa.updates[-1]
        self.assertEqual((table, match), ("worker_status", "id=eq.1"))
        self.assertTrue(values["comfyui_ok"])
        self.assertEqual(values["gpu"], "Fake GPU")
        self.assertEqual(values["current_card_id"], "c9")
        self.assertEqual(values["worker_version"], jobs.VERSION)


if __name__ == "__main__":
    unittest.main()
```

Run → FAIL (no `jobs` module).

- [ ] **Step 5: Job loop**

`worker/jobs.py`:
```python
# The worker's job loop: claim one card at a time from Supabase, make it with
# ComfyUI + Pillow, upload it, keep a backup copy on the PC, and heartbeat.
import datetime
import io
import os
import threading
import time
import traceback

from PIL import Image

from render import JobError, slugify
from supa import SupaError

VERSION = "2.0.0"
BUCKET = "cards"
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def to_jpeg(img, quality):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


class Runner:
    def __init__(self, supa, renderer, output_root, cache_dir, poll_seconds=3.0, heartbeat_seconds=15.0, log=print):
        self.supa = supa
        self.renderer = renderer
        self.output_root = output_root
        self.cache_dir = cache_dir
        self.poll_seconds = poll_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.log = log
        self.current = None
        self.stop_event = threading.Event()

    # ------------------------------------------------------------ heartbeat
    def heartbeat_once(self):
        h = self.renderer.health()
        self.supa.update("worker_status", "id=eq.1", {
            "last_seen": now_iso(), "comfyui_ok": bool(h["ok"]), "gpu": h.get("gpu"),
            "current_card_id": self.current, "worker_version": VERSION, "message": h.get("error"),
        })

    def _heartbeat_loop(self):
        while not self.stop_event.is_set():
            try:
                self.heartbeat_once()
            except Exception as e:
                self.log("heartbeat failed: %s" % e)
            self.stop_event.wait(self.heartbeat_seconds)

    # ------------------------------------------------------------ one job
    def tick(self):
        self.supa.rpc("requeue_stuck_cards")
        job = self.supa.rpc("claim_next_card")
        if not job:
            return False
        card = job["card"]
        self.current = card["id"]
        self.log("%s: %s (%s)" % (job["job"], card["name"], card["id"]))
        try:
            settings = self._settings()
            if job["job"] == "restamp" and card.get("photo_path"):
                self._restamp(job, settings)
            else:
                self._generate(job, settings)
        except Exception as e:
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            self._fail(card, e)
        finally:
            self.current = None
        return True

    def _settings(self):
        rows = self.supa.select("settings", "id=eq.1&select=handle,width,height")
        if not rows:
            raise JobError("The settings row is missing. Run supabase/schema.sql again.")
        return rows[0]

    def _generate(self, job, s):
        card = job["card"]
        if not self.renderer.health()["ok"]:
            raise JobError(COMFY_CLOSED)
        photo = self.renderer.generate_photo(card["prompt"], int(card["seed"]), int(s["width"]), int(s["height"]))
        photo_bytes = to_jpeg(photo, 92)
        card_bytes = to_jpeg(self.renderer.compose(photo, card["name"], card["meaning"], s["handle"]), 93)
        v = int(card["version"])
        photo_path = "photos/%s/v%d.jpg" % (card["id"], v)
        card_path = "cards/%s/v%d.jpg" % (card["id"], v)
        self.supa.upload(BUCKET, photo_path, photo_bytes)
        self.supa.upload(BUCKET, card_path, card_bytes)
        self._cache_put(photo_path, photo_bytes)
        self._finish(card, {"photo_path": photo_path, "card_path": card_path})
        self._cleanup(card, keep={photo_path, card_path})
        self._backup(job, card_bytes)

    def _restamp(self, job, s):
        card = job["card"]
        photo = Image.open(io.BytesIO(self._load_photo(card["photo_path"]))).convert("RGB")
        card_bytes = to_jpeg(self.renderer.compose(photo, card["name"], card["meaning"], s["handle"]), 93)
        card_path = "cards/%s/v%d.jpg" % (card["id"], int(card["version"]))
        self.supa.upload(BUCKET, card_path, card_bytes)
        self._finish(card, {"card_path": card_path})
        self._cleanup(card, keep={card["photo_path"], card_path})
        self._backup(job, card_bytes)

    # ------------------------------------------------------------ results
    def _match(self, card):
        # The version guard: if the owner pressed Regenerate or edited the text
        # meanwhile, the version moved on and this stale result is dropped.
        return "id=eq.%s&version=eq.%d" % (card["id"], int(card["version"]))

    def _finish(self, card, values):
        body = dict(values, status="done", finished_at=now_iso(), claimed_at=None, error=None)
        self._retry(lambda: self.supa.update("cards", self._match(card), body))

    def _fail(self, card, e):
        msg = str(e) if isinstance(e, JobError) else "Something went wrong on your PC: %s" % (str(e) or type(e).__name__)
        body = {"status": "failed", "error": msg[:300], "claimed_at": None, "finished_at": now_iso()}
        try:
            self._retry(lambda: self.supa.update("cards", self._match(card), body))
        except Exception as e2:
            self.log("could not mark the card failed: %s" % e2)

    def _retry(self, fn, tries=5):
        delay = 1.0
        for i in range(tries):
            try:
                return fn()
            except SupaError:
                if i == tries - 1:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 15)

    def _cleanup(self, card, keep):
        old = [p for p in (card.get("photo_path"), card.get("card_path")) if p and p not in keep]
        if not old:
            return
        try:
            self.supa.remove(BUCKET, old)
        except Exception as e:
            self.log("could not remove old files: %s" % e)
        for p in old:
            try:
                os.remove(self._cache_file(p))
            except OSError:
                pass

    # ------------------------------------------------------------ local files
    def _cache_file(self, path):
        return os.path.join(self.cache_dir, path.replace("/", "_"))

    def _cache_put(self, path, data):
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
            with open(self._cache_file(path), "wb") as f:
                f.write(data)
        except OSError as e:
            self.log("cache write failed: %s" % e)

    def _load_photo(self, path):
        f = self._cache_file(path)
        if os.path.exists(f):
            with open(f, "rb") as fh:
                return fh.read()
        data = self.supa.download(BUCKET, path)
        self._cache_put(path, data)
        return data

    def _backup(self, job, data):
        card = job["card"]
        if card.get("kind") != "post" or not job.get("post_date") or not job.get("gender_label"):
            return
        try:
            folder = os.path.join(self.output_root, "%s %s" % (job["post_date"], job["gender_label"]))
            os.makedirs(folder, exist_ok=True)
            prefix = "%02d-" % int(card["position"])
            name = prefix + slugify(card["name"]) + ".jpg"
            for f in os.listdir(folder):
                if f.startswith(prefix) and f.endswith(".jpg") and f != name:
                    os.remove(os.path.join(folder, f))
            tmp = os.path.join(folder, name + ".part")
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, os.path.join(folder, name))
        except OSError as e:
            self.log("backup copy failed: %s" % e)

    # ------------------------------------------------------------ forever
    def run_forever(self):
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        backoff = self.poll_seconds
        while not self.stop_event.is_set():
            try:
                ran = self.tick()
                backoff = self.poll_seconds
                if not ran:
                    self.stop_event.wait(self.poll_seconds)
            except Exception as e:
                self.log("loop error (retrying in %ds): %s" % (backoff, e))
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)
```

Run `python -m unittest test_jobs -v` → PASS.

- [ ] **Step 6: Entry point, config, autostart**

`worker/main.py`:
```python
# Unique Names card worker. Start: python main.py   (autostart: install-autostart.ps1)
import os
import socket
import sys
import time

from jobs import VERSION, Runner
from render import HERE, ComfyRenderer, default_output_root, ensure_fonts, load_env
from supa import Supa

_LOCK = None


def main():
    global _LOCK
    if sys.stdout is None or sys.stderr is None:
        # started hidden (pythonw at Windows logon): log to worker.log
        sys.stdout = sys.stderr = open(os.path.join(HERE, "worker.log"), "a", encoding="utf-8", buffering=1)
    cfg = load_env(os.path.join(HERE, "worker.env"))
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not cfg.get(k)]
    if missing:
        sys.exit("worker.env is missing: " + ", ".join(missing) + ". See worker.env.example.")
    _LOCK = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _LOCK.bind(("127.0.0.1", 47821))  # one worker per PC
    except OSError:
        sys.exit("The card worker is already running.")
    renderer = ComfyRenderer(cfg.get("COMFY_URL", "http://127.0.0.1:8188"), int(cfg.get("GENERATE_TIMEOUT_SECONDS", "300")), ensure_fonts())
    runner = Runner(Supa(cfg["SUPABASE_URL"], cfg["SUPABASE_SERVICE_ROLE_KEY"]), renderer,
                    cfg.get("OUTPUT_ROOT") or default_output_root(), os.path.join(HERE, "cache"),
                    float(cfg.get("POLL_SECONDS", "3")), float(cfg.get("HEARTBEAT_SECONDS", "15")),
                    log=lambda m: print(time.strftime("%Y-%m-%d %H:%M:%S"), m, flush=True))
    print("Unique Names worker %s -> %s (ComfyUI %s)" % (VERSION, cfg["SUPABASE_URL"], renderer.comfy), flush=True)
    runner.run_forever()


if __name__ == "__main__":
    main()
```

`worker/worker.env.example`:
```
# Copy to worker.env (git-ignored). The service-role key never leaves this PC.
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=paste-the-service-role-or-secret-key
COMFY_URL=http://127.0.0.1:8188
# Empty = <OneDrive>\Pictures\Unique Names
OUTPUT_ROOT=
POLL_SECONDS=3
HEARTBEAT_SECONDS=15
GENERATE_TIMEOUT_SECONDS=300
```

`worker/.gitignore`:
```
worker.env
worker.log
fonts/
cache/
__pycache__/
```

`worker/install-autostart.ps1`:
```powershell
# Starts the Unique Names card worker hidden every time you log in to Windows.
#   Install:  powershell -ExecutionPolicy Bypass -File install-autostart.ps1
#   Remove:   Unregister-ScheduledTask -TaskName "Unique Names card worker" -Confirm:$false
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = Join-Path (Split-Path -Parent (Get-Command python).Source) "pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "pythonw.exe not found next to python.exe" }
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $here "main.py") + '"') -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Unique Names card worker" -Action $action -Trigger $trigger -Settings $settings -Description "Makes Unique Names cards: Supabase queue -> ComfyUI -> upload" -Force | Out-Null
Start-ScheduledTask -TaskName "Unique Names card worker"
Write-Host "Installed and started. Log: $here\worker.log"
```

`worker/README.md`:
```markdown
# Card worker (runs on the owner's PC)

Takes queued cards from Supabase one at a time, makes the text-free photo in ComfyUI Desktop
(Z-Image Turbo), stamps the exact name, meaning and handle with Pillow, uploads both to the
private `cards` bucket, and keeps a backup copy in `OneDrive\Pictures\Unique Names\<date> <Boy|Girl>\`.
Sends a heartbeat every 15 s so the website can show "PC ready / ComfyUI closed / PC offline".

- Setup: copy `worker.env.example` to `worker.env`, fill in the Supabase URL and service-role key.
- Run once by hand: `python main.py`. Autostart at login: `powershell -ExecutionPolicy Bypass -File install-autostart.ps1`.
- Tests: `python -m unittest -v` (no ComfyUI or network needed).
- Needs: Python 3.12 + Pillow, ComfyUI Desktop with `z_image_turbo_bf16`, `qwen_3_4b`, `ae`.
```

- [ ] **Step 7: Verify** — `cd worker && python -m unittest -v` → all pass (render + supa + jobs).

- [ ] **Step 8: Commit**

```bash
git add worker
git commit -m "feat(worker): Supabase job loop with restamp, version guard, backup copy, heartbeat and recovery"
```

---

### Task 15: Setup guide, go-live and end-to-end verification

**Files:**
- Create: `docs/SETUP.md`, `README.md`
- Modify: none in code unless verification finds bugs (fix them in the task that owns the file, re-run its tests, commit separately).

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `docs/SETUP.md`**

```markdown
# Setup (about 15 minutes)

## 1. Supabase (database, images, login)
1. Go to https://supabase.com → New project. Name: `unique-names`. Region: Southeast Asia (Singapore). Save the database password somewhere safe.
2. Left menu → **SQL Editor** → New query → paste all of `supabase/schema.sql` → **Run**. It should say "Success".
3. **Authentication → Sign In / Providers → Email**: keep Email on, turn **off** "Allow new users to sign up". Save.
4. **Authentication → Users → Add user → Create new user**: your email + a strong password, tick "Auto confirm". This is your login.
5. **Project Settings → API Keys**: copy the **Project URL**, the **anon / publishable** key, and the **service_role / secret** key.

## 2. Keys on your PC
- `.env.local` (website, for local testing): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_EMAIL` (your login email).
- `.env.import` (one-time import): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `worker/worker.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
The service-role key is only in the last two files. Both are git-ignored. Never put it in Vercel.

## 3. Import and start the worker
- `npm run import` → 212 names, 60 themes and the 2026-10-04 post.
- `cd worker && powershell -ExecutionPolicy Bypass -File install-autostart.ps1` → the worker starts now and at every login.
- Keep ComfyUI Desktop open while posts are being made.

## 4. Vercel
1. Push this folder to a new private GitHub repo.
2. vercel.com → Add New → Project → import the repo (Framework: Next.js, root: the repo root).
3. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_EMAIL`. Deploy.
4. Open the site on your phone → Share → **Add to Home Screen** for an app-like icon.

## Daily use
Today → Boy/Girl, style → **Generate post** → watch the cards appear → Posts → open the post → pick and order →
**Save to phone** → **Copy caption** → post on Facebook → **Mark posted**.

## When something is wrong
- Header dot red "PC offline": turn on the PC; the worker starts at login.
- Amber "ComfyUI closed": open ComfyUI Desktop.
- A card failed: open it and press Retry; the reason is shown on the card.
- Worker log: `worker/worker.log`.
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Unique Names Posting

A private website for the Unique Names Facebook page: one tap makes the day's album post, 9 to 13
baby-name cards from one studio photoshoot theme, made for free on the owner's own GPU, then picked,
ordered and saved to the phone with the caption.

- **Website** (Next.js 16, Vercel): Today, Posts, Names, Themes, Settings. Live progress for every card.
- **Supabase**: database, private image storage, live updates, owner-only login.
- **Card worker** (`worker/`, Python, runs on the PC): ComfyUI makes a text-free photo; Pillow stamps the exact
  name, meaning and @unique_names, so spelling is always right.

Setup: `docs/SETUP.md`. Design: `docs/superpowers/specs/2026-10-04-uniquenames-posting-design.md`.

## Commands
- `npm run dev` · `npm run build` · `npm test` · `npm run typecheck` · `npm run lint`
- `npm run import` (once) · `cd worker && python -m unittest -v`
```

- [ ] **Step 3: Full automated verification**

Run, in order, and confirm each is clean: `npm test` (all suites incl. SQL), `npm run typecheck`, `npm run lint`, `npm run build`, `cd worker && python -m unittest -v`.

- [ ] **Step 4: Owner setup (needs the owner)** — walk the owner through `docs/SETUP.md` sections 1–2. Receive the URL + anon key + service-role key + login email. Write `.env.local`, `.env.import`, `worker/worker.env`.

- [ ] **Step 5: Go-live on the PC** — `npm run import`; stop any old n8n-era worker (`Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" | ? CommandLine -like '*unique-names-cards*worker.py*' | % { Stop-Process -Id $_.ProcessId }`); install the new worker autostart; confirm `worker_status.last_seen` updates (Settings page shows "PC ready").

- [ ] **Step 6: End-to-end on localhost (`npm run dev`)**, with ComfyUI open:
  1. Sign in. Today shows "PC ready", stock 51/45/60/47, themes 29/30.
  2. Generate a Girl · Two-word post (Auto). Tiles go "#n in line" → "Making… 0:xx" → image; progress bar and header pill update; tab title shows "(n/N)".
  3. Close ComfyUI mid-run → the next card fails with "ComfyUI is closed…" → reopen → Retry → it completes.
  4. Open a card → edit the meaning → Save text → "Updating text…" → new text within seconds.
  5. New picture on another card → old image fades, timer runs, new image appears; the PC backup folder file is replaced.
  6. Delete a card → Undo within 5 s restores it; delete again and let it go → the name is available again on Names.
  7. Reorder by drag, unselect one, Download zip → files `01-…jpg` in the new order + `caption.txt`.
  8. Names: paste 3 lines (one invalid, one duplicate) → preview counts 1/1/1 → add. Themes: make a preview, drag a theme to the top, archive and restore one.
  9. Stop the worker → within 45 s the dot turns red "PC offline", queued tiles show "Waiting for your PC"; start it → work resumes.
  10. Mark the post posted → Posts list shows Posted.
  11. Toggle light/dark; check the phone layout at 390 px wide (bottom tabs, bottom-sheet dialogs, no horizontal scroll).

- [ ] **Step 7: After the owner deploys to Vercel** — sign in on the phone, open a post, **Save to phone** opens the share sheet with the cards in order.

- [ ] **Step 8: Retire the n8n flow** — deactivate workflow `NKNnmkI8tORQQnIt` via the n8n API (`POST /api/v1/workflows/NKNnmkI8tORQQnIt/deactivate`), leaving it in n8n for the portfolio. Update the automation repo's `CLAUDE.md` progress log and the `unique-names-cards` memory.

- [ ] **Step 9: Commit**

```bash
git add docs/SETUP.md README.md
git commit -m "docs: setup guide and README"
```
