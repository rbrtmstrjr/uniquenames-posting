# Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tap on **Make N days** (Autopilot page) makes, checks and schedules the next N days of posts (one boy + one
girl a day) with no further input, following the owner's name flow, with every name and every photo checked by Claude.

**Architecture:** The website does all the thinking in one bounded, repeat-safe step (`POST /api/autopilot/tick`,
service-role Supabase client, guarded by `AUTOPILOT_SECRET`). The PC worker is the clock: `claim_next_job` tells it a
run is active and a background thread knocks on the tick route every 30 s. The step engine (`lib/autopilot/engine.ts`)
talks to the database only through a small repo interface, so it is tested with an in-memory repo, a fake Claude and a
fake Facebook. Post creation, Facebook scheduling and card remakes reuse the existing code, moved into plain
(`server-only`, not `"use server"`) core functions that both the owner's actions and the tick call.

**Tech Stack:** Next.js 16 (App Router, route handlers, server actions), Supabase (Postgres + PostgREST + storage),
`@anthropic-ai/sdk` (Claude Opus 5.5, structured outputs, server-side refusal fallback), vitest + PGlite, Python 3
worker (unittest).

**Spec:** `docs/superpowers/specs/2026-11-20-autopilot-design.md`. Branch: `feature/autopilot`.

## Global Constraints

- Read `node_modules/next/dist/docs/` for any Next.js API you are unsure of (AGENTS.md: this Next.js has breaking changes).
- Migration number **022**, file `supabase/migrations/022_autopilot.sql`; safe to run twice; `supabase/schema.sql` gets the same result for a fresh project.
- Days per run: **1 to 7** (default 7). Two posts a day: **one boy, one girl**, random which goes in the morning.
- Time windows (Manila, UTC+8): morning **8:00–9:59 AM**, afternoon **1:00–1:59 PM**, a random minute each, every day.
- Names per post: random **10 to 15** (kept inside settings min/max) plus the closing card; a post needs at least **8** good names / passed name cards, else it is **held**.
- Single names only. Child age: Random. Photoshoot theme: the planner's usual pick.
- Name flow: A..Z, then the owner's name themes in order (`settings.autopilot_name_themes`, one per line, `Title` or `Title (hint)`), then A again. Starter list: Unique and modern, Biblical, Soft and cool, Short and sweet, Classic and timeless, Nature-inspired, Royal and elegant, Strong and brave, Heavenly (stars, sky, light).
- Name-theme hashtag: `#` + title in lowercase letters only + `names` unless it already ends in `names` (Biblical → `#biblicalnames`). Label: "Biblical names".
- Photo check: up to **2 remakes** per card; then the card is unselected ("removed"). Could-not-check → remade once → still not checkable → post held. Look-alike: at most **3** cards remade once; skipped if it cannot run.
- A post ready less than **20 minutes** before its time is held, never moved. Nothing is scheduled with an unchecked card.
- Checks: `claude-opus-5-5`, structured output, adaptive thinking at effort `"medium"`, server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). Cost shown at $4 / $20 per MTok.
- Keys (Vercel, Sensitive): `AUTOPILOT_SECRET` (32+ characters), `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. Worker env: `AUTOPILOT_URL`, `AUTOPILOT_SECRET`.
- Never export plain helpers from a `"use server"` file (every export there becomes a callable server action). Shared logic goes in `server-only` modules.
- Owner-facing words: plain English, short sentences, no jargon (match the existing messages in `lib/actions/facebook.ts`).
- Commit after every task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verify with `npx vitest run <files>`, then at the end `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `cd worker && python -m unittest -v`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/022_autopilot.sql` (new) | settings/posts/names/cards columns, `autopilot_runs`, `autopilot_items`, `claim_next_job` flag |
| `supabase/schema.sql` | the same for a fresh project |
| `lib/db/types.ts` | row types for runs, items, events; new optional columns |
| `lib/autopilot/name-themes.ts` (new, pure) | parse/validate the name-theme list, label, hashtag |
| `lib/autopilot/plan.ts` (new, pure) | first day, label flow, random slots and times, preview problems, day labels |
| `lib/autopilot/photo-problems.ts` (new, pure) | photo problem ids/labels, verdict parsing, card check chip text |
| `lib/autopilot/summary.ts` (new, pure) | run summary + cost from events and items |
| `lib/autopilot/claude-judge.ts` (new) | one Claude Opus call with JSON output, usage, stop errors |
| `lib/autopilot/judge-names.ts` (new) | the parent's-eye name check |
| `lib/autopilot/judge-photos.ts` (new) | the card check and the look-alike check |
| `lib/autopilot/names-step.ts` (new) | pick a post's names: stock, AI top-ups, skip/fix, hold |
| `lib/autopilot/repo.ts` (new) | the engine's database interface + its Supabase implementation |
| `lib/autopilot/engine.ts` (new) | one tick: check cards, finish posts, plan the next post, finish the run |
| `lib/autopilot/wiring.ts` (new) | builds the engine's real dependencies from a Supabase client |
| `lib/autopilot/prepare.ts` (new) | reads the database and plans a run (preview + start) |
| `lib/autopilot/key.ts` (new) | constant-time secret check |
| `lib/supabase/admin.ts` (new) | service-role client (tick route only) |
| `lib/posts/create.ts` (new) | `createPostCore` (moved from `createPostAction`, + `nameIds`, `nameTheme`) |
| `lib/facebook/publish.ts` (new) | `publishPost` core (moved from `publishToFacebookAction`, + `errorKind`) |
| `lib/cards/remake.ts` (new) | `REQUEUE`, `remakeCard` |
| `lib/planner/plan.ts` | `request.nameIds` |
| `lib/ai/caption.ts` | name-theme line, check, template and tag |
| `lib/series/letter.ts` | `postLabel` shows name themes |
| `lib/actions/posts.ts`, `lib/actions/facebook.ts`, `lib/actions/cards.ts` | thin wrappers around the cores |
| `lib/actions/autopilot.ts` (new) | preview / start / stop / resume / save name themes |
| `lib/data/autopilot.ts` (new) | the Autopilot page's data |
| `app/api/autopilot/tick/route.ts` (new) | the tick route |
| `lib/supabase/proxy.ts` | `/api/autopilot/tick` is public (the route checks the secret) |
| `app/(app)/autopilot/page.tsx`, `components/autopilot/*` (new) | the Autopilot page |
| `components/shell/nav.tsx`, `app/(app)/settings/page.tsx` | the link |
| `components/cards/card-tile.tsx`, `lib/status/card-check.ts` (new) | the check chip on a card |
| `worker/autopilot.py` (new), `worker/jobs.py`, `worker/pages.py` | the knock |
| `docs/SETUP.md`, `README.md`, `worker/worker.env.example` | setup |

---

### Task 1: Database (migration 022, schema, types)

**Files:**
- Create: `supabase/migrations/022_autopilot.sql`
- Modify: `supabase/schema.sql` (posts ~line 196-219, names ~222-243, cards ~298-325, settings table, touch trigger list ~line 405, claim_next_job ~line 1184, policies ~1427, grants block)
- Modify: `lib/db/types.ts`
- Create: `tests/sql/migration-022.test.ts`
- Modify: the 11 tests in `tests/sql/` that apply `021_facebook_posting.sql` (003, 005, 006, 007, 008, 009, 010, 011, 013, 017, 021) and any other schema-equivalence test that fails

**Interfaces:**
- Produces (SQL): `settings.autopilot_name_themes text not null`, `posts.name_theme text`, `names.autopilot_note text`, `cards.check_state text`, `cards.check_note text`, `cards.remakes int not null default 0`, tables `autopilot_runs`, `autopilot_items` (columns below), `claim_next_job(...)` answers with `"autopilot": true|false` and `{kind:"none", autopilot:true}` when idle during a run.
- Produces (TS, `lib/db/types.ts`): `AutopilotRunStatus`, `AutopilotSlot`, `AutopilotItemState`, `CardCheckState`, `AutopilotEventKind`, `AutopilotEvent`, `AutopilotRunRow`, `AutopilotItemRow`; `CardRow.check_state?/check_note?/remakes?`, `PostRow.name_theme?`, `NameRow.autopilot_note?`, `SettingsRow.autopilot_name_themes?`.

- [ ] **Step 1: Write the failing test** — `tests/sql/migration-022.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "../helpers/pglite";

// 022 adds Autopilot: the run and its planned posts, the card checks, name themes and the claim flag.
const stripSupabase = (sql: string) => sql.replace(/-- @supabase-only begin[\s\S]*?-- @supabase-only end/g, "");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const v1 = stripSupabase(read("tests", "sql", "fixtures", "schema-v1.sql"));
const ALL = [
  "002_v2.sql", "003_post_fonts.sql", "004_subject_age.sql", "005_reels.sql", "006_reel_voices.sql", "007_reel_themes.sql",
  "008_reel_playbook.sql", "009_captions.sql", "010_cta_card.sql", "011_az_series.sql", "012_two_styles.sql", "013_letter_posts.sql",
  "014_reel_formats.sql", "015_name_nest.sql", "016_swap_card_name.sql", "017_initials_posts.sql", "018_names_pdf.sql", "019_shop.sql",
  "020_one_claim.sql", "021_facebook_posting.sql",
].map((m) => stripSupabase(read("supabase", "migrations", m)));
const m022 = stripSupabase(read("supabase", "migrations", "022_autopilot.sql"));

async function liveDb() {
  const db = new PGlite();
  for (const sql of [v1, ...ALL]) await db.exec(sql);
  return db;
}
const cols = async (db: PGlite, table: string) => (await db.query<{ column_name: string }>(
  `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name);

describe("migration 022: Autopilot", () => {
  it("adds the columns and tables to the live database and is safe to run twice", async () => {
    const db = await liveDb();
    await db.exec(m022);
    await db.exec(m022);
    expect(await cols(db, "posts")).toContain("name_theme");
    expect(await cols(db, "names")).toContain("autopilot_note");
    expect(await cols(db, "cards")).toEqual(expect.arrayContaining(["check_state", "check_note", "remakes"]));
    expect(await cols(db, "settings")).toContain("autopilot_name_themes");
    expect(await cols(db, "autopilot_runs")).toEqual(expect.arrayContaining(
      ["id", "status", "days", "first_day", "message", "events", "input_tokens", "output_tokens", "tick_until", "finished_at"]));
    expect(await cols(db, "autopilot_items")).toEqual(expect.arrayContaining(
      ["run_id", "day", "slot", "gender", "scheduled_for", "letter", "name_theme", "name_count", "post_id", "state", "lookalike_done", "attempts", "note"]));
    await db.exec(`insert into public.settings (id) values (1) on conflict do nothing`);
    const s = await one<{ autopilot_name_themes: string }>(db, `select autopilot_name_themes from public.settings where id = 1`);
    expect(s.autopilot_name_themes.split("\n")).toEqual([
      "Unique and modern", "Biblical", "Soft and cool", "Short and sweet", "Classic and timeless",
      "Nature-inspired", "Royal and elegant", "Strong and brave", "Heavenly (stars, sky, light)",
    ]);
  });

  it("schema.sql has the same rules: one active run, one label per planned post, known check states", async () => {
    const db = await freshDb();
    for (const t of ["posts", "names", "cards", "settings", "autopilot_runs", "autopilot_items"]) expect((await cols(db, t)).length).toBeGreaterThan(0);
    const run = await one<{ id: string }>(db, `insert into public.autopilot_runs (days, first_day) values (7, '2026-11-21') returning id`);
    await expect(db.query(`insert into public.autopilot_runs (days, first_day) values (1, '2026-11-21')`)).rejects.toThrow(/autopilot_runs_one_active/);
    const item = `insert into public.autopilot_items (run_id, day, slot, gender, scheduled_for, letter, name_theme, name_count) values ($1, '2026-11-21', 'morning', 'boy', now(), $2, $3, 12)`;
    await expect(db.query(item, [run.id, null, null])).rejects.toThrow(/autopilot_items_label/);
    await expect(db.query(item, [run.id, "S", "Biblical"])).rejects.toThrow(/autopilot_items_label/);
    await db.query(item, [run.id, "S", null]);
    await expect(db.query(`insert into public.autopilot_runs (days, first_day) values (8, '2026-11-21')`)).rejects.toThrow();
    await db.query(`update public.autopilot_runs set status = 'done' where id = $1`, [run.id]);
    await db.query(`insert into public.autopilot_runs (days, first_day) values (1, '2026-11-28')`); // a finished run frees the slot
    const checks = await db.query<{ conname: string }>(`select conname from pg_constraint where conname in ('cards_check_state_check', 'posts_name_theme_len', 'names_autopilot_note_len')`);
    expect(checks.rows.map((r) => r.conname).sort()).toEqual(["cards_check_state_check", "names_autopilot_note_len", "posts_name_theme_len"]);
  });

  it("claim_next_job says when a run is active, even with nothing to hand out", async () => {
    const db = await freshDb();
    const claim = async () => (await one<{ j: unknown }>(db, `select public.claim_next_job(false, false, false) as j`)).j;
    expect(await claim()).toBeNull();
    await db.exec(`insert into public.autopilot_runs (days, first_day) values (7, '2026-11-21')`);
    expect(await claim()).toEqual({ kind: "none", autopilot: true });
    await db.exec(`update public.autopilot_runs set status = 'waiting'`);
    expect(await claim()).toEqual({ kind: "none", autopilot: true });
    await db.exec(`update public.autopilot_runs set status = 'paused'`);
    expect(await claim()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/sql/migration-022.test.ts`
Expected: FAIL (`ENOENT ... 022_autopilot.sql`).

- [ ] **Step 3: Write the migration** — `supabase/migrations/022_autopilot.sql`

```sql
-- Unique Names posting: Autopilot (the Autopilot page makes, checks and schedules the next days of posts by itself;
-- spec docs/superpowers/specs/2026-11-20-autopilot-design.md). Paste the whole file into the Supabase SQL editor and run
-- it. Safe to run more than once. Needs 020_one_claim.sql and 021_facebook_posting.sql first. A fresh project gets all of
-- this from supabase/schema.sql already. Restart the PC worker afterwards (worker 2.9.0 reads the autopilot flag).

-- The owner's name themes, one per line, in order ("Title" or "Title (hint for the AI)"). After Z the flow goes
-- through them, then back to A.
alter table public.settings add column if not exists autopilot_name_themes text not null default
  E'Unique and modern\nBiblical\nSoft and cool\nShort and sweet\nClassic and timeless\nNature-inspired\nRoyal and elegant\nStrong and brave\nHeavenly (stars, sky, light)';
alter table public.settings drop constraint if exists settings_autopilot_name_themes_len;
alter table public.settings add constraint settings_autopilot_name_themes_len check (char_length(autopilot_name_themes) <= 2000);

-- A name-theme post's title ("Biblical"), like posts.letter for a post by letter.
alter table public.posts add column if not exists name_theme text;
alter table public.posts drop constraint if exists posts_name_theme_len;
alter table public.posts add constraint posts_name_theme_len check (name_theme is null or char_length(name_theme) between 1 and 60);

-- Why Autopilot skipped a saved name (status 'skip'); the owner can bring it back.
alter table public.names add column if not exists autopilot_note text;
alter table public.names drop constraint if exists names_autopilot_note_len;
alter table public.names add constraint names_autopilot_note_len check (autopilot_note is null or char_length(autopilot_note) <= 200);

-- A card's photo check (Autopilot posts only; null on every other card).
alter table public.cards add column if not exists check_state text;
alter table public.cards add column if not exists check_note text;
alter table public.cards add column if not exists remakes int not null default 0;
alter table public.cards drop constraint if exists cards_check_state_check;
alter table public.cards add constraint cards_check_state_check check (check_state is null or check_state in ('pending', 'passed', 'failed', 'removed'));
alter table public.cards drop constraint if exists cards_check_note_len;
alter table public.cards add constraint cards_check_note_len check (check_note is null or char_length(check_note) <= 300);

-- One run = one press of "Make N days". At most one run is active (running / waiting / paused) at a time.
create table if not exists public.autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' constraint autopilot_runs_status_check
    check (status in ('running', 'waiting', 'paused', 'done', 'stopped')),
  days int not null constraint autopilot_runs_days_check check (days between 1 and 7),
  first_day date not null,
  message text constraint autopilot_runs_message_len check (message is null or char_length(message) <= 500),
  events jsonb not null default '[]'::jsonb,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  tick_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists autopilot_runs_one_active on public.autopilot_runs ((true)) where status in ('running', 'waiting', 'paused');

-- One row per planned post of a run.
create table if not exists public.autopilot_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.autopilot_runs (id) on delete cascade,
  day date not null,
  slot text not null constraint autopilot_items_slot_check check (slot in ('morning', 'afternoon')),
  gender text not null constraint autopilot_items_gender_check check (gender in ('boy', 'girl')),
  scheduled_for timestamptz not null,
  letter text constraint autopilot_items_letter_check check (letter is null or letter ~ '^[A-Z]$'),
  name_theme text constraint autopilot_items_name_theme_len check (name_theme is null or char_length(name_theme) between 1 and 60),
  name_count int not null constraint autopilot_items_name_count_check check (name_count between 1 and 30),
  post_id uuid references public.posts (id) on delete set null,
  state text not null default 'planned' constraint autopilot_items_state_check
    check (state in ('planned', 'naming', 'making', 'checking', 'scheduled', 'held')),
  lookalike_done boolean not null default false,
  attempts int not null default 0,
  note text constraint autopilot_items_note_len check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autopilot_items_label check ((letter is null) <> (name_theme is null)),
  constraint autopilot_items_one_slot unique (run_id, day, slot)
);
create index if not exists autopilot_items_run on public.autopilot_items (run_id, scheduled_for);

do $$ declare t text; begin
  foreach t in array array['autopilot_runs', 'autopilot_items'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- claim_next_job (020) + the autopilot flag: every answer says whether a run is active, and with nothing to hand out
-- an active run still answers {kind: 'none', autopilot: true}, so the worker knows to knock on the website.
create or replace function public.claim_next_job(p_comfy_ok boolean, p_music boolean, p_requeue boolean)
returns jsonb language plpgsql as $$
declare v_job jsonb; v_comfy boolean := coalesce(p_comfy_ok, false);
  v_ap boolean := exists (select 1 from public.autopilot_runs where status in ('running', 'waiting'));
begin
  if coalesce(p_requeue, false) then perform public.requeue_stuck_cards(); end if;
  v_job := public.claim_next_card(not v_comfy);
  if v_job is not null then return jsonb_build_object('kind', 'card', 'job', v_job, 'autopilot', v_ap); end if;

  if coalesce(p_requeue, false) then perform public.requeue_stuck_reels(); end if;
  v_job := public.claim_next_reel_step(not v_comfy, coalesce(p_music, false));
  if v_job is not null then return jsonb_build_object('kind', 'reel_step', 'job', v_job, 'autopilot', v_ap); end if;

  if v_comfy then
    v_job := public.claim_next_voice_sample();
    if v_job is not null then return jsonb_build_object('kind', 'voice_sample', 'job', v_job, 'autopilot', v_ap); end if;
    v_job := public.claim_next_theme_preview();
    if v_job is not null then return jsonb_build_object('kind', 'theme_preview', 'job', v_job, 'autopilot', v_ap); end if;
  end if;
  if v_ap then return jsonb_build_object('kind', 'none', 'autopilot', true); end if;
  return null;
end $$;

-- @supabase-only begin
alter table public.autopilot_runs enable row level security;
alter table public.autopilot_items enable row level security;
drop policy if exists owner_all on public.autopilot_runs;
create policy owner_all on public.autopilot_runs for all to authenticated using (true) with check (true);
drop policy if exists owner_all on public.autopilot_items;
create policy owner_all on public.autopilot_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.autopilot_runs, public.autopilot_items to authenticated, service_role;
revoke all on public.autopilot_runs, public.autopilot_items from anon;
revoke execute on function public.claim_next_job(boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.claim_next_job(boolean, boolean, boolean) to service_role;
-- @supabase-only end
```

- [ ] **Step 4: Put the same into `supabase/schema.sql`**
  1. In `create table if not exists public.settings (...)` add the column (with the same default text) and `constraint settings_autopilot_name_themes_len check (char_length(autopilot_name_themes) <= 2000)`.
  2. In `public.posts`, after the `fb_error` lines, add:
     ```sql
       -- Autopilot (022): a name-theme post's title ("Biblical"); null on any other post
       name_theme text,
       constraint posts_name_theme_len check (name_theme is null or char_length(name_theme) between 1 and 60),
     ```
     (move the comma so the table still parses: the last constraint line must not end with a comma).
  3. In `public.names`, before `created_at`: `autopilot_note text constraint names_autopilot_note_len check (autopilot_note is null or char_length(autopilot_note) <= 200),`
  4. In `public.cards`, before `created_at`:
     ```sql
       -- Autopilot (022): the photo check of a card of an Autopilot post (null on every other card)
       check_state text constraint cards_check_state_check check (check_state is null or check_state in ('pending', 'passed', 'failed', 'removed')),
       check_note text constraint cards_check_note_len check (check_note is null or char_length(check_note) <= 300),
       remakes int not null default 0,
     ```
  5. After the cards table (before the reels comment), paste the two `create table` statements, the unique index and the index from the migration.
  6. Add `'autopilot_runs', 'autopilot_items'` to the array of the touch-trigger loop (`foreach t in array array['settings', ...]`, ~line 405).
  7. Replace the body of `claim_next_job` (~line 1184) with the migration's version.
  8. In the `-- @supabase-only` security block: add both tables to the RLS `enable row level security` list and to the `owner_all` policy loop array. The blanket `grant select, insert, update, delete on all tables` already covers them.

- [ ] **Step 5: Types** — `lib/db/types.ts`

Add to `NameRow`: `/** Autopilot (migration 022): why Autopilot skipped this name (status 'skip'). */ autopilot_note?: string | null;`
Add to `PostRow` after `initials`: `/** Autopilot (migration 022): a name-theme post's title ("Biblical"); null otherwise. */ name_theme?: string | null;`
Add to `CardRow`: `/** Autopilot (migration 022): the photo check; null on cards of posts made by hand. */ check_state?: CardCheckState | null; check_note?: string | null; remakes?: number;`
Add to `SettingsRow`: `/** Autopilot (migration 022): the name themes, one per line ("Title" or "Title (hint)"). */ autopilot_name_themes?: string;`
Append:

```ts
/** Autopilot (migration 022). */
export type AutopilotRunStatus = "running" | "waiting" | "paused" | "done" | "stopped";
export type AutopilotSlot = "morning" | "afternoon";
export type AutopilotItemState = "planned" | "naming" | "making" | "checking" | "scheduled" | "held";
export type CardCheckState = "pending" | "passed" | "failed" | "removed";
export type AutopilotEventKind = "run" | "name_added" | "name_skipped" | "card_remade" | "card_removed" | "post_scheduled" | "post_held";
export interface AutopilotEvent { at: string; kind: AutopilotEventKind; text: string }
export interface AutopilotRunRow {
  id: string; status: AutopilotRunStatus; days: number; first_day: string; message: string | null; events: AutopilotEvent[];
  input_tokens: number; output_tokens: number; tick_until: string | null; created_at: string; finished_at: string | null; updated_at: string;
}
export interface AutopilotItemRow {
  id: string; run_id: string; day: string; slot: AutopilotSlot; gender: Gender; scheduled_for: string;
  letter: string | null; name_theme: string | null; name_count: number; post_id: string | null; state: AutopilotItemState;
  lookalike_done: boolean; attempts: number; note: string | null; created_at: string; updated_at: string;
}
```

- [ ] **Step 6: Run the new test**

Run: `npx vitest run tests/sql/migration-022.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Keep the schema-equivalence tests green**

Run: `npx vitest run tests/sql`
In each test that applies `021_facebook_posting.sql` to its migrated database, duplicate that line right after it and change it to:
```ts
    await migrated.exec(stripSupabase(read("supabase", "migrations", "022_autopilot.sql"))); // 022: Autopilot (settings, posts, names, cards)
```
(keep the variable the file uses: `migrated` or `db`). For any other failing equivalence test (one that compares `settings`, `names` or `cards` and stops before 021), add the 021 line and then the 022 line after its last migration, the same way. Re-run until `npx vitest run tests/sql` is all green.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/022_autopilot.sql supabase/schema.sql lib/db/types.ts tests/sql
git commit -m "feat(db): 022 autopilot - runs, planned posts, card checks, name themes, claim flag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Name themes, labels and captions

**Files:**
- Create: `lib/autopilot/name-themes.ts`
- Modify: `lib/series/letter.ts` (`postLabel`)
- Modify: `lib/ai/caption.ts` (`CaptionInput`, `captionPrompt`, `captionProblem`, `templateLine`, `composePostCaption`)
- Test: `tests/autopilot-name-themes.test.ts`

**Interfaces:**
- Produces: `DEFAULT_NAME_THEMES: readonly string[]`, `NAME_THEME_MAX = 60`, `NAME_THEMES_MAX = 30`, `interface NameTheme { title: string; hint: string | null }`, `parseNameTheme(line: string): NameTheme | null`, `parseNameThemes(text: string | null | undefined): NameTheme[]`, `nameThemesProblem(text: string): string | null`, `nameThemeTag(title: string): string`, `nameThemeLabel(p: { name_theme?: string | null }): string | null`.
- Produces: `CaptionInput.nameTheme?: NameTheme | null`; `composePostCaption({..., nameTheme?: string | null})`; `templateLine(gender, template, series?, letter?, initials?, nameTheme?)`.

- [ ] **Step 1: Write the failing test** — `tests/autopilot-name-themes.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NAME_THEMES, nameThemeLabel, nameThemeTag, nameThemesProblem, parseNameTheme, parseNameThemes,
} from "@/lib/autopilot/name-themes";
import { postLabel } from "@/lib/series/letter";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { captionPrompt, captionProblem, composePostCaption, templateLine } = await import("@/lib/ai/caption");
const { postHistory } = await import("@/lib/captions/history");

beforeEach(() => generateJson.mockReset());

describe("name themes", () => {
  it("reads 'Title' and 'Title (hint)' lines, dropping blanks, duplicates and too-long titles", () => {
    expect(parseNameTheme("  Heavenly   (stars, sky, light) ")).toEqual({ title: "Heavenly", hint: "stars, sky, light" });
    expect(parseNameTheme("Biblical")).toEqual({ title: "Biblical", hint: null });
    expect(parseNameTheme("   ")).toBeNull();
    expect(parseNameTheme("x".repeat(61))).toBeNull();
    expect(parseNameThemes("Biblical\n\nbiblical\nSoft and cool").map((t) => t.title)).toEqual(["Biblical", "Soft and cool"]);
    expect(parseNameThemes(null).map((t) => t.title)).toHaveLength(DEFAULT_NAME_THEMES.length);
  });
  it("says why a list can't be saved", () => {
    expect(nameThemesProblem("")).toMatch(/at least one/);
    expect(nameThemesProblem(Array.from({ length: 31 }, (_, i) => `Theme ${i}`).join("\n"))).toMatch(/30/);
    expect(nameThemesProblem(`Biblical\n${"y".repeat(70)}`)).toMatch(/too long/);
    expect(nameThemesProblem(DEFAULT_NAME_THEMES.join("\n"))).toBeNull();
  });
  it("makes the hashtag and the label", () => {
    expect(nameThemeTag("Biblical")).toBe("#biblicalnames");
    expect(nameThemeTag("Nature-inspired")).toBe("#natureinspirednames");
    expect(nameThemeTag("Strong names")).toBe("#strongnames");
    expect(nameThemeLabel({ name_theme: "Biblical" })).toBe("Biblical names");
    expect(nameThemeLabel({ name_theme: "Strong names" })).toBe("Strong names");
    expect(nameThemeLabel({ name_theme: null })).toBeNull();
    expect(postLabel({ name_theme: "Soft and cool" })).toBe("Soft and cool names");
    expect(postLabel({ letter: "S" })).toBe("Letter S");
  });
});

describe("captions for a name-theme post", () => {
  const theme = { title: "Garden", backdrop: "b", outfit: "o", props: "p", lighting: "l", palette: "c" };
  const nameTheme = { title: "Biblical", hint: null };
  it("tells the AI the theme and checks the caption says it", () => {
    const p = captionPrompt({ theme, gender: "girl", captionStyle: "story", nameTheme });
    expect(p).toContain("Every name in this post is one of our biblical names");
    expect(captionProblem("Sweet names for your little one.", { captionStyle: "story", nameTheme })).toMatch(/Biblical/);
    expect(captionProblem("Biblical baby girl names with gentle meanings.", { captionStyle: "story", nameTheme })).toBeNull();
  });
  it("the template names it and the theme tag takes the first theme-tag slot", () => {
    expect(templateLine("boy", "Lovely names.", undefined, null, null, "Biblical")).toBe("Biblical names for your baby boy. Lovely names.");
    const settings = { caption_template: "Lovely names.", hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", caption_ai: true };
    const c = composePostCaption({ ai: { line: "Biblical names for your girl.", tags: ["#faith"] }, aiOn: true, captionStyle: "story", gender: "girl",
      settings, history: postHistory([]), nameTheme: "Biblical" });
    expect(c.hashtag_set.split(" ").slice(0, 2)).toEqual(["#uniquenames", "#biblicalnames"]);
  });
});
```

Note: if `postHistory` has a different signature, build the history the way `tests/ai-caption.test.ts` does (it imports `postHistory` from `@/lib/captions/history`).

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-name-themes.test.ts`
Expected: FAIL (`Cannot find module '@/lib/autopilot/name-themes'`).

- [ ] **Step 3: Write `lib/autopilot/name-themes.ts`**

```ts
// Autopilot's name themes (migration 022, settings.autopilot_name_themes): after Z the name flow goes through them, one
// per day, then back to A. One per line, in order: "Title" or "Title (a hint for the AI)". Pure: used by the website,
// the actions and the Autopilot page.

export const NAME_THEME_MAX = 60;
export const NAME_THEMES_MAX = 30;
export const NAME_THEMES_TEXT_MAX = 2000;

export const DEFAULT_NAME_THEMES = [
  "Unique and modern", "Biblical", "Soft and cool", "Short and sweet", "Classic and timeless",
  "Nature-inspired", "Royal and elegant", "Strong and brave", "Heavenly (stars, sky, light)",
] as const;

export interface NameTheme { title: string; hint: string | null }

/** "Heavenly (stars, sky, light)" -> { title: "Heavenly", hint: "stars, sky, light" }; null for a blank or too-long line. */
export function parseNameTheme(line: string): NameTheme | null {
  const clean = line.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(clean);
  const title = (m ? m[1] : clean).trim();
  const hint = m ? m[2].trim() || null : null;
  if (!title || title.length > NAME_THEME_MAX) return null;
  return { title, hint };
}

/** The settings text as a list: blank and too-long lines dropped, a repeated title (any case) kept once. */
export function parseNameThemes(text: string | null | undefined): NameTheme[] {
  const out: NameTheme[] = [];
  for (const raw of (text ?? DEFAULT_NAME_THEMES.join("\n")).split(/\r?\n/)) {
    const t = parseNameTheme(raw);
    if (t && !out.some((o) => o.title.toLowerCase() === t.title.toLowerCase())) out.push(t);
  }
  return out.slice(0, NAME_THEMES_MAX);
}

/** Why the owner's list can't be saved, or null. */
export function nameThemesProblem(text: string): string | null {
  if (text.length > NAME_THEMES_TEXT_MAX) return `Keep the list under ${NAME_THEMES_TEXT_MAX} characters.`;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "Add at least one name theme.";
  if (lines.length > NAME_THEMES_MAX) return `Keep it to ${NAME_THEMES_MAX} name themes.`;
  const bad = lines.find((l) => !parseNameTheme(l));
  if (bad) return `"${bad.slice(0, 30)}…" is too long: keep each name theme under ${NAME_THEME_MAX} characters (the part before the brackets).`;
  return null;
}

/** "Biblical" -> "#biblicalnames"; "Strong names" -> "#strongnames". */
export function nameThemeTag(title: string): string {
  const core = title.toLowerCase().replace(/[^a-z]/g, "");
  return `#${core.endsWith("names") ? core : `${core}names`}`;
}

/** The label a name-theme post shows ("Biblical names"); null on any other post. */
export function nameThemeLabel(p: { name_theme?: string | null }): string | null {
  const t = p.name_theme?.trim();
  if (!t) return null;
  return /names$/i.test(t) ? t : `${t} names`;
}
```

- [ ] **Step 4: `postLabel` shows name themes** — `lib/series/letter.ts`

```ts
import { nameThemeLabel } from "@/lib/autopilot/name-themes";
// ...
/** A post's small label on Posts / the post page / Today: its A–Z part, its letter, its initials or its name theme. */
export const postLabel = (p: { series?: string | null; series_part?: number | null; letter?: string | null; initials?: string | null; name_theme?: string | null }) =>
  seriesLabel(p) ?? letterLabel(p) ?? initialsLabel(p) ?? nameThemeLabel(p);
```

- [ ] **Step 5: Captions** — `lib/ai/caption.ts`

1. Import: `import { nameThemeLabel, nameThemeTag, type NameTheme } from "@/lib/autopilot/name-themes";`
2. `CaptionInput`, after `initials`: `/** An Autopilot name-theme post (022): every name is one of these, and the caption says so. */ nameTheme?: NameTheme | null;`
3. In `captionPrompt`, after the `isInitials` block:
```ts
  if (input.nameTheme) {
    const label = nameThemeLabel({ name_theme: input.nameTheme.title })!.toLowerCase();
    lines.push("", `Every name in this post is one of our ${label}${input.nameTheme.hint ? ` (${input.nameTheme.hint})` : ""}.`,
      `Say naturally that these are ${label} for a baby ${gender}, for example "${label} for your baby ${gender}".`);
  }
```
4. Above `captionProblem`:
```ts
/** The word that shows the theme was named: its first word of 3+ letters ("Unique and modern" -> "Unique"). */
const themeWord = (title: string) => title.split(/[^\p{L}]+/u).find((w) => w.length >= 3) ?? title;
```
   Change the `Pick<...>` of `captionProblem` to include `"nameTheme"` and add after the initials check:
```ts
  if (input.nameTheme && !new RegExp(`(?<!\\p{L})${escapeRe(themeWord(input.nameTheme.title))}`, "iu").test(line)) {
    return `does not say these are ${input.nameTheme.title} names`;
  }
```
5. `templateLine` gets a 6th parameter `nameTheme?: string | null`; add before the letter line:
```ts
  if (nameTheme) return `${nameThemeLabel({ name_theme: nameTheme })} for your baby ${gender}. ${line}`.trim();
```
6. `composePostCaption` options get `/** An Autopilot name-theme post: its tag takes the first theme-tag slot, and the template names it. */ nameTheme?: string | null;`. Change the theme tags and the template call:
```ts
  const own = o.series ? [AZ_SERIES_TAG] : isLetter(o.letter) ? [letterTag(o.letter)] : o.nameTheme ? [nameThemeTag(o.nameTheme)] : [];
  const themeTags = [...own, ...(ai ? ai.tags : [])];
  // ...
    : { caption: withHashtags(templateLine(o.gender, o.settings.caption_template, o.series, o.letter, o.initials, o.nameTheme), set), caption_style: "template", hashtag_set: set, source: "template" };
```
7. Find any other place that builds the problem input for `captionProblem` from a `CaptionInput` (`grep -n "captionProblem(" lib`) and make sure `nameTheme` is passed through where the input is spread (`aiCaptionLine` passes `input` whole, so it already is).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/autopilot-name-themes.test.ts tests/ai-caption.test.ts tests/letter-actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/autopilot/name-themes.ts lib/series/letter.ts lib/ai/caption.ts tests/autopilot-name-themes.test.ts
git commit -m "feat(autopilot): name themes - list, label, caption line and hashtag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The run planner (pure)

**Files:**
- Create: `lib/autopilot/plan.ts`
- Test: `tests/autopilot-plan.test.ts`

**Interfaces:**
- Consumes: `AZ_LETTERS` (`lib/series/az.ts`, a `string[]`), `nameThemeLabel` (Task 2), `Gender`, `PostRow`.
- Produces:
  - constants `MORNING = { from: 480, to: 599 }`, `AFTERNOON = { from: 780, to: 839 }` (minutes after midnight, Manila), `NAMES_PER_POST = { min: 10, max: 15 }`, `MIN_GOOD_NAMES = 8`, `MAX_DAYS = 7`
  - `type Label = { letter: string; nameTheme: null } | { letter: null; nameTheme: string }`
  - `nextLabel(last: Label | null, themes: string[]): Label`
  - `manilaDay(t: number): string`, `addDays(day: string, n: number): string`, `manilaTime(day: string, minutes: number): Date`
  - `firstDay(lastFacebookAt: string | null, now: number): string`
  - `lastFacebook(posts: Pick<PostRow, "fb_state" | "fb_scheduled_for" | "posted_at" | "letter" | "name_theme">[]): { at: string | null; label: Label | null }`
  - `interface PlannedItem { day: string; slot: "morning" | "afternoon"; gender: Gender; scheduledFor: string; letter: string | null; nameTheme: string | null; nameCount: number }`
  - `planRun(i: { firstDay: string; days: number; last: Label | null; themes: string[]; minImages: number; maxImages: number; rng: () => number }): PlannedItem[]`
  - `planProblems(items: PlannedItem[], themesLeft: Record<Gender, number>): string[]`
  - `dayLabel(day: string): string` ("Sat, Nov 21"), `labelText(p: { letter: string | null; name_theme?: string | null; nameTheme?: string | null }): string` ("Letter S" / "Biblical names")

- [ ] **Step 1: Write the failing test** — `tests/autopilot-plan.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  AFTERNOON, MORNING, addDays, dayLabel, firstDay, labelText, lastFacebook, manilaDay, nextLabel, planProblems, planRun,
} from "@/lib/autopilot/plan";
import { seededRandom } from "@/lib/planner/random";

const THEMES = ["Unique and modern", "Biblical"];
const minuteOfDay = (iso: string) => { const d = new Date(Date.parse(iso) + 8 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

describe("the name flow", () => {
  it("goes A..Z, then the name themes in order, then back to A", () => {
    expect(nextLabel(null, THEMES)).toEqual({ letter: "A", nameTheme: null });
    expect(nextLabel({ letter: "R", nameTheme: null }, THEMES)).toEqual({ letter: "S", nameTheme: null });
    expect(nextLabel({ letter: "Z", nameTheme: null }, THEMES)).toEqual({ letter: null, nameTheme: "Unique and modern" });
    expect(nextLabel({ letter: null, nameTheme: "unique and MODERN" }, THEMES)).toEqual({ letter: null, nameTheme: "Biblical" });
    expect(nextLabel({ letter: null, nameTheme: "Biblical" }, THEMES)).toEqual({ letter: "A", nameTheme: null });
    expect(nextLabel({ letter: null, nameTheme: "Removed theme" }, THEMES)).toEqual({ letter: null, nameTheme: "Unique and modern" });
    expect(nextLabel({ letter: "Z", nameTheme: null }, [])).toEqual({ letter: "A", nameTheme: null });
  });
});

describe("days", () => {
  const now = Date.parse("2026-11-20T03:00:00Z"); // Fri Nov 20, 11 AM Manila
  it("starts the day after the last Facebook post, never before tomorrow", () => {
    expect(manilaDay(now)).toBe("2026-11-20");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(firstDay(null, now)).toBe("2026-11-21");
    expect(firstDay("2026-11-19T05:29:00Z", now)).toBe("2026-11-21");
    expect(firstDay("2026-11-24T05:29:00Z", now)).toBe("2026-11-25");
    expect(firstDay("2026-11-24T17:30:00Z", now)).toBe("2026-11-26"); // 1:30 AM Nov 25 in Manila
    expect(dayLabel("2026-11-21")).toBe("Sat, Nov 21");
  });
  it("finds the last Facebook time and the last letter or theme", () => {
    const posts = [
      { fb_state: "scheduled", fb_scheduled_for: "2026-11-19T05:29:00Z", posted_at: "2026-11-19T05:29:00Z", letter: "R", name_theme: null },
      { fb_state: "published", fb_scheduled_for: null, posted_at: "2026-11-18T01:30:00Z", letter: "Q", name_theme: null },
      { fb_state: "failed", fb_scheduled_for: null, posted_at: "2026-11-25T01:30:00Z", letter: "Z", name_theme: null },
      { fb_state: "published", fb_scheduled_for: null, posted_at: "2026-11-20T01:00:00Z", letter: null, name_theme: null },
    ] as const;
    expect(lastFacebook([...posts])).toEqual({ at: "2026-11-20T01:00:00Z", label: { letter: "R", nameTheme: null } });
    expect(lastFacebook([])).toEqual({ at: null, label: null });
  });
});

describe("planRun", () => {
  const plan = (rng = seededRandom(7)) => planRun({ firstDay: "2026-11-21", days: 7, last: { letter: "R", nameTheme: null }, themes: THEMES, minImages: 6, maxImages: 26, rng });
  it("two posts a day, one boy and one girl, letters S..Y", () => {
    const items = plan();
    expect(items).toHaveLength(14);
    for (let d = 0; d < 7; d++) {
      const day = items.filter((i) => i.day === addDays("2026-11-21", d));
      expect(day.map((i) => i.slot)).toEqual(["morning", "afternoon"]);
      expect(day.map((i) => i.gender).sort()).toEqual(["boy", "girl"]);
      expect(new Set(day.map((i) => i.letter)).size).toBe(1);
    }
    expect([...new Set(items.map((i) => i.letter))]).toEqual(["S", "T", "U", "V", "W", "X", "Y"]);
  });
  it("random minutes inside the windows, different from day to day, and random morning gender", () => {
    const items = plan();
    const mornings = items.filter((i) => i.slot === "morning").map((i) => minuteOfDay(i.scheduledFor));
    const afternoons = items.filter((i) => i.slot === "afternoon").map((i) => minuteOfDay(i.scheduledFor));
    expect(mornings.every((m) => m >= MORNING.from && m <= MORNING.to)).toBe(true);
    expect(afternoons.every((m) => m >= AFTERNOON.from && m <= AFTERNOON.to)).toBe(true);
    expect(new Set(mornings).size).toBeGreaterThan(3);
    expect(new Set(items.filter((i) => i.slot === "morning").map((i) => i.gender)).size).toBe(2);
    expect(items.every((i) => i.nameCount >= 10 && i.nameCount <= 15)).toBe(true);
  });
  it("keeps the name count inside the settings min/max", () => {
    const items = planRun({ firstDay: "2026-11-21", days: 1, last: null, themes: [], minImages: 6, maxImages: 9, rng: () => 0.99 });
    expect(items.every((i) => i.nameCount === 9)).toBe(true);
  });
});

describe("planProblems", () => {
  it("says when a gender runs out of photoshoot themes, and from which day", () => {
    const items = planRun({ firstDay: "2026-11-21", days: 3, last: null, themes: [], minImages: 6, maxImages: 26, rng: seededRandom(1) });
    expect(planProblems(items, { boy: 3, girl: 3 })).toEqual([]);
    expect(planProblems(items, { boy: 3, girl: 1 })).toEqual(["Only 1 girl photoshoot theme is left: the girl posts from Sun, Nov 22 will be held. Add girl themes first."]);
    expect(labelText({ letter: "S" })).toBe("Letter S");
    expect(labelText({ letter: null, nameTheme: "Biblical" })).toBe("Biblical names");
  });
});
```

If `seededRandom` is not exported from `lib/planner/random.ts` under that name, use the name it has (it is used by `lib/planner/plan.ts`: `seededRandom(hashSeed(...))`).

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-plan.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/autopilot/plan.ts`**

```ts
// Autopilot's plan for one run (pure, spec 2026-11-20): which days, which letter or name theme each day, which gender
// in the morning, the random times inside the windows and how many names each post gets.
import type { Gender, PostRow } from "@/lib/db/types";
import { AZ_LETTERS } from "@/lib/series/az";
import { nameThemeLabel } from "./name-themes";

/** Minutes after midnight, Manila: morning 8:00–9:59 AM, afternoon 1:00–1:59 PM. */
export const MORNING = { from: 8 * 60, to: 9 * 60 + 59 } as const;
export const AFTERNOON = { from: 13 * 60, to: 13 * 60 + 59 } as const;
export const NAMES_PER_POST = { min: 10, max: 15 } as const;
/** A post needs at least this many good names (and passed name cards), or it is held. */
export const MIN_GOOD_NAMES = 8;
export const MAX_DAYS = 7;
const MANILA_MS = 8 * 3600_000;
const DAY_MS = 86400_000;

export type Label = { letter: string; nameTheme: null } | { letter: null; nameTheme: string };

/** The label after `last`: A..Z, then the name themes in order, then A again. */
export function nextLabel(last: Label | null, themes: string[]): Label {
  const A: Label = { letter: "A", nameTheme: null };
  const firstTheme: Label = themes.length ? { letter: null, nameTheme: themes[0] } : A;
  if (!last) return A;
  if (last.letter !== null) {
    const i = AZ_LETTERS.indexOf(last.letter);
    return i >= 0 && i < AZ_LETTERS.length - 1 ? { letter: AZ_LETTERS[i + 1], nameTheme: null } : firstTheme;
  }
  const i = themes.findIndex((t) => t.toLowerCase() === last.nameTheme.toLowerCase());
  if (i === -1) return firstTheme;
  return i < themes.length - 1 ? { letter: null, nameTheme: themes[i + 1] } : A;
}

/** The Manila calendar day of `t` ("2026-11-21"). */
export const manilaDay = (t: number) => new Date(t + MANILA_MS).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** `minutes` after midnight Manila on `day`. */
export const manilaTime = (day: string, minutes: number) => new Date(Date.parse(`${day}T00:00:00+08:00`) + minutes * 60_000);

/** The run's first day: the day after the last day with a Facebook post, and never before tomorrow (Manila). */
export function firstDay(lastFacebookAt: string | null, now: number): string {
  const tomorrow = addDays(manilaDay(now), 1);
  if (!lastFacebookAt) return tomorrow;
  const after = addDays(manilaDay(Date.parse(lastFacebookAt)), 1);
  return after > tomorrow ? after : tomorrow;
}

type FbPost = Pick<PostRow, "fb_state" | "fb_scheduled_for" | "posted_at" | "letter" | "name_theme">;

/** The latest Facebook time (scheduled or published) and the label of the latest such post that has one. */
export function lastFacebook(posts: FbPost[]): { at: string | null; label: Label | null } {
  let at: string | null = null;
  let labelAt = -Infinity;
  let label: Label | null = null;
  for (const p of posts) {
    if (p.fb_state !== "scheduled" && p.fb_state !== "published") continue;
    const when = p.fb_scheduled_for ?? p.posted_at;
    if (!when) continue;
    const t = Date.parse(when);
    if (at === null || t > Date.parse(at)) at = when;
    const own: Label | null = p.letter ? { letter: p.letter, nameTheme: null } : p.name_theme ? { letter: null, nameTheme: p.name_theme } : null;
    if (own && t > labelAt) { labelAt = t; label = own; }
  }
  return { at, label };
}

export interface PlannedItem {
  day: string; slot: "morning" | "afternoon"; gender: Gender; scheduledFor: string;
  letter: string | null; nameTheme: string | null; nameCount: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pick = (lo: number, hi: number, rng: () => number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Two posts a day (one boy, one girl, random order), each at a random minute of its window. */
export function planRun(i: { firstDay: string; days: number; last: Label | null; themes: string[]; minImages: number; maxImages: number; rng: () => number }): PlannedItem[] {
  const lo = clamp(NAMES_PER_POST.min, i.minImages, i.maxImages);
  const hi = clamp(NAMES_PER_POST.max, i.minImages, i.maxImages);
  const out: PlannedItem[] = [];
  let label = i.last;
  for (let d = 0; d < i.days; d++) {
    const day = addDays(i.firstDay, d);
    label = nextLabel(label, i.themes);
    const morning: Gender = i.rng() < 0.5 ? "boy" : "girl";
    const slots = [
      { slot: "morning" as const, gender: morning, w: MORNING },
      { slot: "afternoon" as const, gender: (morning === "boy" ? "girl" : "boy") as Gender, w: AFTERNOON },
    ];
    for (const s of slots) {
      out.push({
        day, slot: s.slot, gender: s.gender, scheduledFor: manilaTime(day, pick(s.w.from, s.w.to, i.rng)).toISOString(),
        letter: label.letter, nameTheme: label.nameTheme, nameCount: pick(lo, hi, i.rng),
      });
    }
  }
  return out;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** "2026-11-21" -> "Sat, Nov 21". */
export const dayLabel = (day: string) => DAY_FMT.format(new Date(`${day}T00:00:00Z`));

/** "Letter S" or "Biblical names". */
export function labelText(p: { letter: string | null; name_theme?: string | null; nameTheme?: string | null }): string {
  if (p.letter) return `Letter ${p.letter}`;
  return nameThemeLabel({ name_theme: p.name_theme ?? p.nameTheme ?? null }) ?? "";
}

/** What the owner should know before starting (themes run out). */
export function planProblems(items: PlannedItem[], themesLeft: Record<Gender, number>): string[] {
  const out: string[] = [];
  for (const g of ["girl", "boy"] as const) {
    const mine = items.filter((i) => i.gender === g);
    const left = themesLeft[g] ?? 0;
    if (left >= mine.length) continue;
    out.push(`Only ${left} ${g} photoshoot theme${left === 1 ? " is" : "s are"} left: the ${g} posts from ${dayLabel(mine[left].day)} will be held. Add ${g} themes first.`);
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/autopilot-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/autopilot/plan.ts tests/autopilot-plan.test.ts
git commit -m "feat(autopilot): run planner - days, name flow, random slots in the windows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared cores (create post, publish, remake, admin client)

**Files:**
- Create: `lib/supabase/admin.ts`, `lib/posts/create.ts`, `lib/facebook/publish.ts`, `lib/cards/remake.ts`
- Modify: `lib/planner/plan.ts` (`request.nameIds`), `lib/actions/posts.ts` (`createPostAction` → wrapper), `lib/actions/facebook.ts` (→ wrappers), `lib/actions/cards.ts` (import `REQUEUE`)
- Modify (only if `tsc` complains): `lib/cta/card.ts`, `lib/captions/load.ts` (`type SB = SupabaseClient`)
- Test: `tests/autopilot-cores.test.ts`; existing `tests/letter-actions.test.ts`, `tests/facebook-actions.test.ts`, `tests/card-actions.test.ts`, `tests/post-fonts.test.ts`, `tests/subject-age-actions.test.ts`, `tests/cta-actions.test.ts`, `tests/caption-actions.test.ts` must stay green.

**Interfaces:**
- Produces: `createAdminClient(): SupabaseClient | null`
- Produces: `interface CreatePostInput { gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string; fonts?: PostFonts; subjectAge?: AgeChoice; letter?: string; nameIds?: string[]; nameTheme?: NameTheme | null }`, `createPostCore(sb: SupabaseClient, input: CreatePostInput): Promise<ActionResult<{ postId: string }>>`
- Produces: `type PublishErrorKind = "not_connected" | "invalid" | "auth" | "blocked" | "rate" | "network" | "other" | "unsure" | "db"`, `type PublishResult = { ok: true; state: "published" | "scheduled"; permalink: string | null; scheduledFor: string | null } | { ok: false; error: string; errorKind: PublishErrorKind }`, `publishPost(sb: SupabaseClient, postId: string, input: { caption: string; scheduledAt?: string | null; retryUnsure?: boolean; beforeSend?: (p: PostRow) => Promise<string | null> }): Promise<PublishResult>`, exports `NOT_CONNECTED`, `NOTHING_SENT`, `explain(e, tail?)`.
- Produces: `REQUEUE`, `remakeCard(sb: SupabaseClient, card: Pick<CardRow, "id" | "version" | "seed">, extra?: Record<string, unknown>): Promise<boolean>`
- Produces: `PlanInput.request.nameIds?: string[] | null`

- [ ] **Step 1: Write the failing test** — `tests/autopilot-cores.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";
import { planPost } from "@/lib/planner";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createPostCore } = await import("@/lib/posts/create");
const { remakeCard } = await import("@/lib/cards/remake");
const { publishPost } = await import("@/lib/facebook/publish");

const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const theme: ThemeRow = {
  id: THEME_ID, title: "Olive Grove", gender: "girl", backdrop: "olive trees", outfit: "linen dress", props: "olive branch and a clay jar",
  lighting: "soft light", palette: "olive, cream", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const nm = (name: string): NameRow => ({ id: `n-${name}`, name, meaning: "god is gracious", gender: "girl", style: "single", status: "available", post_id: null, position: null, created_at: "", updated_at: "" });
const names = ["Abigail", "Hannah", "Naomi", "Ruth", "Esther", "Miriam", "Leah", "Rachel", "Sarah", "Deborah", "Eden", "Lydia"].map(nm);
const settings = { id: 1, caption_template: "Lovely names.", hashtags: "", handle: "@unique_names", min_images: 6, max_images: 26, width: 1080, height: 1080, sound_on: true,
  hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", caption_ai: true, cta_enabled: false };

beforeEach(() => {
  generateJson.mockReset();
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: names };
    if (q.table === "themes") return { data: op(q, "single") || op(q, "maybeSingle") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts") return { data: [] };
    if (q.table === "cards" && isUpdate(q)) return { data: [{ id: "c1" }] };
    return undefined;
  };
});
afterEach(() => vi.restoreAllMocks());

describe("planPost with chosen names", () => {
  it("uses exactly those names", () => {
    const ids = names.slice(0, 9).map((n) => n.id);
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", age: "random", nameIds: ids }, names, themes: [theme], settings });
    expect(r.ok && r.cards.map((c) => c.name_id).sort()).toEqual([...ids].sort());
  });
  it("fails when a chosen name was taken meanwhile", () => {
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", nameIds: ["n-Abigail", "n-gone"] }, names, themes: [theme], settings });
    expect(r).toEqual({ ok: false, reason: "1 of the chosen names is no longer available." });
  });
});

describe("createPostCore for Autopilot", () => {
  it("makes a name-theme post from the chosen names: the caption names the theme, the tag is in, posts.name_theme is saved", async () => {
    // Every caption call answers the same line (it names the theme and two of the names, so any caption style passes).
    generateJson.mockResolvedValue({ ok: true, data: { caption: "Biblical baby girl names like Abigail and Hannah, with gentle meanings.", tags: ["#faith"] } });
    const ids = names.slice(0, 10).map((n) => n.id);
    const r = await createPostCore(fake.client as never, { gender: "girl", style: "single", count: null, postDate: "2026-11-21", requestId: "44444444-4444-4444-8444-444444444444",
      subjectAge: "random", nameIds: ids, nameTheme: { title: "Biblical", hint: null } });
    expect(r).toEqual({ ok: true, postId: POST_ID });
    const p = (fake.rpcs.find((x) => x.fn === "create_post")!.args as { p: { caption: string; cards: { name_id: string }[] } }).p;
    expect(p.cards.map((c) => c.name_id).sort()).toEqual([...ids].sort());
    expect(p.caption).toContain("#biblicalnames");
    expect((generateJson.mock.calls[0][0] as { prompt: string }).prompt).toContain("biblical names");
    const updates = fake.queries.filter((q) => q.table === "posts" && isUpdate(q)).map((q) => op(q, "update")![1]);
    expect(updates).toContainEqual({ name_theme: "Biblical" });
  });
});

describe("remakeCard", () => {
  it("puts the card back in line with a new seed, guarded by its version", async () => {
    expect(await remakeCard(fake.client as never, { id: "c1", version: 3, seed: 42 }, { check_state: "pending", remakes: 1 })).toBe(true);
    const q = fake.queries.find((x) => x.table === "cards" && isUpdate(x))!;
    const patch = op(q, "update")![1] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "queued", version: 4, check_state: "pending", remakes: 1, attempts: 0 });
    expect(patch.seed).not.toBe(42);
    expect(q.ops).toContainEqual(["eq", "version", 3]);
    expect(q.ops).toContainEqual(["neq", "status", "generating"]);
  });
});

describe("publishPost", () => {
  it("says what kind of failure it was", async () => {
    for (const k of ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN", "FACEBOOK_APP_SECRET"]) delete process.env[k];
    expect(await publishPost(fake.client as never, POST_ID, { caption: "x" })).toMatchObject({ ok: false, errorKind: "not_connected" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-cores.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: `planPost` takes chosen names** — `lib/planner/plan.ts`

In `PlanInput.request` add:
```ts
    /** Autopilot: exactly these available names, all of them (count must be null). */
    nameIds?: string[] | null;
```
In `planPost`, replace the `pool` line and the `want` line:
```ts
  const only = r.nameIds?.length ? new Set(r.nameIds) : null;
  const pool = availablePool(input.names, r.gender, r.style)
    .filter((n) => (!r.letter || startsWith(n.name, r.letter)) && (!only || only.has(n.id)));
  if (only && pool.length < only.size) {
    const gone = only.size - pool.length;
    return { ok: false, reason: `${gone} of the chosen names ${gone === 1 ? "is" : "are"} no longer available.` };
  }
```
and
```ts
  const want = only ? pool.length : r.count ?? s.min_images + Math.floor(rng() * (s.max_images - s.min_images + 1));
```

- [ ] **Step 4: Admin client** — `lib/supabase/admin.ts`

```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client, for the Autopilot tick route only (there is no owner session there; the route checks
 * AUTOPILOT_SECRET first). Never used in pages or actions, never sent to a browser. Null until the key is set.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

- [ ] **Step 5: Remake core** — `lib/cards/remake.ts`

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardRow } from "@/lib/db/types";
import { nextSeed } from "@/lib/actions/helpers";

/** The fields that put a card back in line (the worker claims it again). */
export const REQUEUE = { status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0 } as const;

/**
 * Autopilot's remake: the same shot with a new seed (ComfyUI is deterministic), back in line, guarded by the card's
 * version so a card that changed meanwhile is left alone. `extra` lands in the same update (the check fields).
 */
export async function remakeCard(sb: SupabaseClient, card: Pick<CardRow, "id" | "version" | "seed">, extra: Record<string, unknown> = {}): Promise<boolean> {
  const version = card.version + 1;
  const { data, error } = await sb.from("cards")
    .update({ ...REQUEUE, ...extra, version, seed: nextSeed(card.id, version, card.seed), queued_at: new Date().toISOString() })
    .eq("id", card.id).eq("version", card.version).neq("status", "generating").select("id");
  return !error && !!data?.length;
}
```
In `lib/actions/cards.ts` delete the local `const REQUEUE = ...` and add `import { REQUEUE } from "@/lib/cards/remake";`.

- [ ] **Step 6: Create-post core** — `lib/posts/create.ts`

Move the whole body of `createPostAction` (everything after `await requireOwner();`) into this function, with these changes: it takes `sb` instead of calling `createClient()`, passes `nameIds` to `planPost`, passes `nameTheme` to the caption, and saves `posts.name_theme`.

```ts
import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planPost, type AgeChoice } from "@/lib/planner";
import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { validateCreatePost } from "@/lib/actions/helpers";
import { generateLockReason } from "@/lib/actions/generate-guard";
import { aiCaptionLine, CAPTION_TIMEOUT_MS, captionAiOn, composePostCaption, type AiCaption } from "@/lib/ai/caption";
import { loadPostHistory, missingColumn as missing009 } from "@/lib/captions/load";
import { NAME_STYLES, pickStyle, type CaptionName, type CaptionStyle } from "@/lib/captions/styles";
import { fail, type ActionResult } from "@/lib/actions/result";
import { fontsOf, sameFonts, validateFonts, type PostFonts } from "@/lib/fonts/post-fonts";
import { addClosingCard } from "@/lib/cta/card";
import { isLetter } from "@/lib/series/letter";
import type { NameTheme } from "@/lib/autopilot/name-themes";

export interface CreatePostInput {
  gender: Gender; style: NameStyle; count: number | null; postDate: string; themeId?: string; requestId: string;
  /** Chosen on Today; stored on the post (migration 003; an older create_post ignores them). */
  fonts?: PostFonts;
  /** The child's age chosen on Today (default Random). */
  subjectAge?: AgeChoice;
  /** A post by letter: every name starts with it; stored as posts.letter (013). */
  letter?: string;
  /** Autopilot: exactly these available names (count must be null). */
  nameIds?: string[];
  /** Autopilot: a name-theme post (stored as posts.name_theme, 022; the caption names it). */
  nameTheme?: NameTheme | null;
}

/** The post itself (the owner's Generate and Autopilot): plan, caption, create_post, closing card, labels. */
export async function createPostCore(sb: SupabaseClient, input: CreatePostInput): Promise<ActionResult<{ postId: string }>> {
  const badInput = validateCreatePost(input) ?? (input.fonts !== undefined ? validateFonts(input.fonts) : null)
    ?? (input.letter !== undefined && !isLetter(input.letter) ? "Pick a letter A to Z." : null)
    ?? (input.nameIds && input.count !== null ? "Chosen names need an automatic card count." : null);
  if (badInput) return fail(badInput);
  const letter = input.letter ?? null;
  const nameTheme = input.nameTheme ?? null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postDate)) return fail("Pick a valid date.");
  const fonts = input.fonts ? fontsOf(input.fonts) : null;
  const age: AgeChoice = input.subjectAge ?? "random";
  // ... from here, paste the existing body of createPostAction unchanged (aiDeadline, lines, historyRead,
  // captionStyle, lineFor, fontsSaved, the two-attempt loop), with exactly these edits:
  //  (a) planPost request: { gender: input.gender, style: input.style, count: input.count, postDate: input.postDate, age, letter, nameIds: input.nameIds ?? null }
  //  (b) in lineFor's aiCaptionLine({...}) call add: nameTheme
  //  (c) composePostCaption({ ..., letter, nameTheme: nameTheme?.title ?? null })
  //  (d) in the Promise.all after create_post succeeded, add a fourth entry:
  //        nameTheme ? sb.from("posts").update({ name_theme: nameTheme.title }).eq("id", r.post_id) : Promise.resolve(null),
  //      and log its error the same way as letterSaved (console.error("createPostCore: could not save the name theme", ...)).
  //  (e) rename the console.error prefixes "createPostAction:" to "createPostCore:".
}
```

The executor writes the full function: the "paste" above means copying lines 37–127 of the current `lib/actions/posts.ts` into the function body and applying (a)–(e). Nothing else in the body changes.

Then `createPostAction` in `lib/actions/posts.ts` becomes:
```ts
export async function createPostAction(input: CreatePostInput): Promise<ActionResult<{ postId: string }>> {
  await requireOwner();
  return createPostCore(await createClient(), input);
}
```
with `import { createPostCore, type CreatePostInput } from "@/lib/posts/create";`, and remove imports that are no longer used there (`tsc` and `lint` tell you which).

If `tsc` reports that a `SupabaseClient` is not assignable to the `SB` type of `addClosingCard` (`lib/cta/card.ts`) or `loadPostHistory` (`lib/captions/load.ts`), change that file's `type SB = Awaited<ReturnType<typeof createClient>>;` to `type SB = SupabaseClient;` (`import type { SupabaseClient } from "@supabase/supabase-js";`).

- [ ] **Step 7: Publish core** — `lib/facebook/publish.ts`

Move everything out of `lib/actions/facebook.ts` except the three actions: `UPLOADS_AT_ONCE`, `LINK_TTL_S`, `NOT_CONNECTED`, `NEEDS_021`, `NOTHING_SENT`, `explain`, `UNSURE`, `inBatches`, and the body of `publishToFacebookAction` as `publishPost`:

```ts
import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardRow, FacebookState, PostRow } from "@/lib/db/types";
import { FacebookError, facebookConfig, graphClient } from "./graph";
import { cardOrder } from "@/lib/files/save";
import { SCHEDULE_MAX_MS, SCHEDULE_MIN_MS, STALE_PUBLISHING_MS } from "./schedule";
import { UUID_RE } from "@/lib/actions/helpers";

// (the constants, explain, UNSURE and inBatches exactly as they are in lib/actions/facebook.ts today; export
//  NOT_CONNECTED, NOTHING_SENT and explain)

export type PublishErrorKind = "not_connected" | "invalid" | "auth" | "blocked" | "rate" | "network" | "other" | "unsure" | "db";
export type PublishResult =
  | { ok: true; state: "published" | "scheduled"; permalink: string | null; scheduledFor: string | null }
  | { ok: false; error: string; errorKind: PublishErrorKind };

const no = (error: string, errorKind: PublishErrorKind): PublishResult => ({ ok: false, error, errorKind });
const kindOf = (e: unknown): PublishErrorKind => (e instanceof FacebookError ? e.kind : "other");

/**
 * The selected cards, in the upload order, as ONE multi-photo post (now, or scheduled): the post page's Post now /
 * Schedule and Autopilot. fb_state is taken with one conditional update before anything is sent, so the same album
 * is never posted twice. `beforeSend` runs after the checks and before the lock (the post page saves an edited caption).
 */
export async function publishPost(sb: SupabaseClient, postId: string, input: {
  caption: string; scheduledAt?: string | null; retryUnsure?: boolean; beforeSend?: (p: PostRow) => Promise<string | null>;
}): Promise<PublishResult> {
  // The body of publishToFacebookAction from `if (!UUID_RE...` to the end, with these edits:
  //  - no requireOwner, no createClient (sb is the parameter)
  //  - every `return fail(x)` becomes `return no(x, <kind>)`: input checks "invalid", NOT_CONNECTED "not_connected",
  //    read/lock/save database errors "db", the upload and createPost catch blocks `kindOf(e)`, the UNSURE return "unsure"
  //  - the caption block becomes:
  //        if (input.beforeSend) { const stop = await input.beforeSend(p); if (stop) return no(stop, "db"); }
  //  - the final success return stays { ok: true, state, permalink, scheduledFor }
}
```

`lib/actions/facebook.ts` keeps only the three actions:
```ts
export async function publishToFacebookAction(postId: string, input: { caption: string; scheduledAt?: string | null; retryUnsure?: boolean }): Promise<PublishResult> {
  await requireOwner();
  const caption = String(input.caption ?? "");
  return publishPost(await createClient(), postId, {
    caption, scheduledAt: input.scheduledAt, retryUnsure: input.retryUnsure,
    // The caption as shown in the box, saved on the post first (the same save as editing it by hand).
    beforeSend: async (p) => {
      if (caption === p.caption) return null;
      const saved = await updateCaptionAction(postId, caption);
      return saved.ok ? null : `Could not save the caption: ${saved.error} ${NOTHING_SENT}`;
    },
  });
}
```
`cancelFacebookScheduleAction` and `checkFacebookAction` stay as they are, importing `NOT_CONNECTED` and `explain` from `@/lib/facebook/publish`. The client (`components/posts/facebook-panel.tsx`) only reads `ok`/`error`, so the extra `errorKind` changes nothing there.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/autopilot-cores.test.ts tests/letter-actions.test.ts tests/facebook-actions.test.ts tests/card-actions.test.ts tests/post-fonts.test.ts tests/subject-age-actions.test.ts tests/cta-actions.test.ts tests/caption-actions.test.ts tests/facebook-panel.test.tsx`
Expected: PASS. Then `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/supabase/admin.ts lib/posts/create.ts lib/facebook/publish.ts lib/cards/remake.ts lib/planner/plan.ts lib/actions/posts.ts lib/actions/facebook.ts lib/actions/cards.ts lib/cta/card.ts lib/captions/load.ts tests/autopilot-cores.test.ts
git commit -m "refactor: create-post, publish and remake cores shared by the owner's actions and Autopilot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Claude checks (names, photos, look-alike)

**Files:**
- Create: `lib/autopilot/claude-judge.ts`, `lib/autopilot/judge-names.ts`, `lib/autopilot/photo-problems.ts`, `lib/autopilot/judge-photos.ts`
- Test: `tests/autopilot-judges.test.ts`

**Interfaces:**
- Consumes: `CLAUDE_OPUS`, `CLAUDE_CREDITS_OUT`, `claudeError` (`lib/ai/claude.ts`), `toClaudeSchema` (`lib/ai/json-schema.ts`), `GeminiSchema` (`lib/ai/gemini.ts`), `chunks` (`lib/actions/helpers.ts`).
- Produces:
  - `interface Usage { input: number; output: number }`, `type JudgeResult<T> = { ok: true; data: T; usage: Usage } | { ok: false; error: string; usage: Usage; stop: boolean }`, `isStopError(msg: string): boolean`, `judgeJson<T>(i: { system: string; content: BetaContentBlockParam[]; schema: GeminiSchema; parse: (raw: unknown) => T | null; timeoutMs?: number }): Promise<JudgeResult<T>>`, `JUDGE_EFFORT = "medium"`
  - `type NameTarget = { kind: "letter"; letter: string } | { kind: "theme"; title: string; hint: string | null }`, `interface NameVerdict { name: string; good: boolean; fits: boolean; reason: string; meaning: string }`, `judgeNames(i: { gender: Gender; target: NameTarget; names: { name: string; meaning: string }[] }): Promise<JudgeResult<NameVerdict[]>>` (verdicts in the input's order)
  - `PHOTO_PROBLEMS`, `type PhotoProblem`, `PROBLEM_LABEL: Record<PhotoProblem, string>`, `interface PhotoVerdict { pass: boolean; problems: PhotoProblem[]; note: string }`, `parsePhotoVerdict(raw): PhotoVerdict | null`, `parseLookAlike(raw, count): number[] | null`
  - `judgeCard(card: Pick<CardRow, "kind" | "name">, url: string): Promise<JudgeResult<PhotoVerdict>>`, `judgeLookAlike(cards: { card: Pick<CardRow, "kind" | "name">; url: string }[]): Promise<JudgeResult<number[]>>`

- [ ] **Step 1: Write the failing test** — `tests/autopilot-judges.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Anthropic client behind the real SDK's error classes (lib/ai/claude.ts uses them).
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", async (real) => {
  const mod = await real<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic { beta = { messages: { create } }; messages = { create }; }
  return { ...mod, default: FakeAnthropic };
});
const { judgeJson, isStopError } = await import("@/lib/autopilot/claude-judge");
const { judgeNames } = await import("@/lib/autopilot/judge-names");
const { judgeCard, judgeLookAlike } = await import("@/lib/autopilot/judge-photos");
const { parsePhotoVerdict, parseLookAlike } = await import("@/lib/autopilot/photo-problems");
const { CLAUDE_CREDITS_OUT } = await import("@/lib/ai/claude");

const answer = (json: unknown, o: { stop?: string; input?: number; output?: number } = {}) => ({
  stop_reason: o.stop ?? "end_turn", content: [{ type: "text", text: JSON.stringify(json) }],
  usage: { input_tokens: o.input ?? 1000, output_tokens: o.output ?? 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

beforeEach(() => { create.mockReset(); process.env.ANTHROPIC_API_KEY = "sk-test"; });

describe("judgeJson", () => {
  it("asks Claude Opus 5.5 with the JSON schema, the refusal fallback and medium effort, and counts tokens", async () => {
    create.mockResolvedValueOnce(answer({ remake: [] }, { input: 1600, output: 300 }));
    const r = await judgeJson({ system: "s", content: [{ type: "text", text: "t" }], schema: { type: "OBJECT", properties: { remake: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["remake"] }, parse: (x) => x });
    expect(r).toEqual({ ok: true, data: { remake: [] }, usage: { input: 1600, output: 300 } });
    const req = create.mock.calls[0][0];
    expect(req).toMatchObject({ model: "claude-opus-5-5", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium" } });
    expect(req.output_config.format.type).toBe("json_schema");
  });
  it("a refusal or a bad shape is a failed check, not a stop; no key or no credits stops the run", async () => {
    create.mockResolvedValueOnce(answer({}, { stop: "refusal" }));
    expect(await judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: (x) => x })).toMatchObject({ ok: false, stop: false });
    create.mockResolvedValueOnce(answer({ wrong: 1 }));
    expect(await judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: () => null })).toMatchObject({ ok: false, stop: false, error: expect.stringMatching(/wrong shape/) });
    delete process.env.ANTHROPIC_API_KEY;
    expect(await judgeJson({ system: "s", content: [], schema: { type: "OBJECT", properties: {} }, parse: (x) => x })).toMatchObject({ ok: false, stop: true });
    expect(isStopError(CLAUDE_CREDITS_OUT)).toBe(true);
    expect(isStopError("Claude rejected the API key (401). Check ANTHROPIC_API_KEY.")).toBe(true);
    expect(isStopError("Claude timed out.")).toBe(false);
  });
});

describe("judgeNames", () => {
  it("sends the post's target and every name; verdicts come back in the input order, a skipped name fails", async () => {
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "Woman From Sabine " },
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "" },
    ] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "letter", letter: "S" }, names: [
      { name: "Sqiggle", meaning: "?" }, { name: "Sabina", meaning: "from sabine" }, { name: "Selah", meaning: "pause" },
    ] });
    expect(r.ok && r.data).toEqual([
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "" },
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "woman from sabine" },
      { name: "Selah", good: false, fits: false, reason: "not judged", meaning: "" },
    ]);
    const prompt = create.mock.calls[0][0].messages[0].content[0].text as string;
    expect(prompt).toContain("start with the letter S");
    expect(prompt).toContain("- Selah: pause");
  });
  it("a kept name without a meaning does not pass", async () => {
    create.mockResolvedValueOnce(answer({ names: [{ name: "Ruth", good: true, fits: true, reason: "", meaning: "" }] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "theme", title: "Biblical", hint: null }, names: [{ name: "Ruth", meaning: "friend" }] });
    expect(r.ok && r.data[0]).toMatchObject({ good: false, reason: "no meaning" });
  });
});

describe("photo checks", () => {
  it("sends the card image by URL with what is stamped on it", async () => {
    create.mockResolvedValueOnce(answer({ pass: false, problems: ["hands"], note: "six fingers" }));
    const r = await judgeCard({ kind: "post", name: "Sabina" }, "https://signed/c1.jpg");
    expect(r.ok && r.data).toEqual({ pass: false, problems: ["hands"], note: "six fingers" });
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0].text).toContain("Sabina");
    expect(content[1]).toEqual({ type: "image", source: { type: "url", url: "https://signed/c1.jpg" } });
  });
  it("parses verdicts strictly: a pass with problems is a fail, unknown problems drop, a fail without problems is 'other'", () => {
    expect(parsePhotoVerdict({ pass: true, problems: ["skin"], note: "" })).toEqual({ pass: false, problems: ["skin"], note: "" });
    expect(parsePhotoVerdict({ pass: false, problems: ["weird"], note: "x" })).toEqual({ pass: false, problems: ["other"], note: "x" });
    expect(parsePhotoVerdict({ pass: true, problems: [], note: "" })).toEqual({ pass: true, problems: [], note: "" });
    expect(parsePhotoVerdict({ problems: [] })).toBeNull();
  });
  it("look-alike: numbered cards, later cards only, at most 3, in range", async () => {
    expect(parseLookAlike({ remake: [1, 3, 3, 9, 4, 5, 6] }, 8)).toEqual([3, 4, 5]);
    create.mockResolvedValueOnce(answer({ remake: [2] }));
    const r = await judgeLookAlike([{ card: { kind: "post", name: "A" }, url: "u1" }, { card: { kind: "post", name: "B" }, url: "u2" }]);
    expect(r.ok && r.data).toEqual([2]);
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content.map((c: { type: string; text?: string }) => c.text ?? c.type)).toEqual(["Card 1:", "image", "Card 2:", "image"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-judges.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: `lib/autopilot/claude-judge.ts`**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_CREDITS_OUT, CLAUDE_OPUS, claudeError } from "@/lib/ai/claude";
import { toClaudeSchema } from "@/lib/ai/json-schema";
import type { GeminiSchema } from "@/lib/ai/gemini";

// Autopilot's checks (names, photos, look-alikes): Claude Opus 5.5, the sharpest at small details, with a JSON answer
// constrained to a schema. The server-side refusal fallback is on: if Opus declines (a rare false positive on child
// photos), the API re-runs the same request on its fallback model inside the same call.

export const JUDGE_MODEL = CLAUDE_OPUS;
export const JUDGE_EFFORT = "medium" as const;
const MAX_TOKENS = 16000;

export interface Usage { input: number; output: number }
export type JudgeResult<T> = { ok: true; data: T; usage: Usage } | { ok: false; error: string; usage: Usage; stop: boolean };

/** Errors that stop the whole run until the owner fixes something (credits, key). */
export const isStopError = (msg: string) => msg === CLAUDE_CREDITS_OUT || /\((401|403)\)/.test(msg) || /ANTHROPIC_API_KEY is not set/.test(msg);

export async function judgeJson<T>(i: {
  system: string; content: Anthropic.Beta.Messages.BetaContentBlockParam[]; schema: GeminiSchema; parse: (raw: unknown) => T | null; timeoutMs?: number;
}): Promise<JudgeResult<T>> {
  const zero: Usage = { input: 0, output: 0 };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set in Vercel.", usage: zero, stop: true };
  const timeoutMs = i.timeoutMs ?? 90_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // authToken: null so a stray ANTHROPIC_AUTH_TOKEN never adds a second auth header (401).
    const client = new Anthropic({ apiKey, authToken: null, maxRetries: 1, timeout: timeoutMs });
    const msg = await client.beta.messages.create({
      model: JUDGE_MODEL, max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: i.system,
      messages: [{ role: "user", content: i.content }],
      output_config: { effort: JUDGE_EFFORT, format: { type: "json_schema", schema: toClaudeSchema(i.schema) } },
    }, { signal: ctrl.signal });
    const u = msg.usage;
    const usage: Usage = { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens };
    if (msg.stop_reason === "refusal") return { ok: false, error: "Claude declined to check this.", usage, stop: false };
    if (msg.stop_reason === "max_tokens") return { ok: false, error: "Claude ran out of room before finishing.", usage, stop: false };
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return { ok: false, error: "Claude returned invalid JSON.", usage, stop: false }; }
    const data = i.parse(raw);
    return data === null ? { ok: false, error: "Claude returned JSON in the wrong shape.", usage, stop: false } : { ok: true, data, usage };
  } catch (e) {
    const error = claudeError(e, ctrl.signal.aborted);
    return { ok: false, error, usage: zero, stop: isStopError(error) };
  } finally {
    clearTimeout(timer);
  }
}
```

If `tsc` rejects `fallbacks: "default"` or the `betas` value on the installed SDK (`node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` lists the accepted shapes), use the shape the types accept for the same beta (e.g. `fallbacks: [{ model: "claude-opus-5" }]`) and keep the test's expectation in sync; do not drop the fallback.

- [ ] **Step 4: `lib/autopilot/judge-names.ts`**

```ts
import "server-only";
import type { Gender } from "@/lib/db/types";
import type { GeminiSchema } from "@/lib/ai/gemini";
import { chunks } from "@/lib/actions/helpers";
import { judgeJson, type JudgeResult, type Usage } from "./claude-judge";

// The parent's-eye check: every name a post would use is judged the way a Filipino mom choosing her own baby's name
// would. "good" = a parent would happily choose it (a saved name that is not good gets skipped); "fits" = right for
// THIS post (the letter or the name theme, and not too close to another name in the list).

export type NameTarget = { kind: "letter"; letter: string } | { kind: "theme"; title: string; hint: string | null };
export interface NameVerdict { name: string; good: boolean; fits: boolean; reason: string; meaning: string }

export const NAMES_JUDGE_SYSTEM = [
  "You are a Filipino mom choosing a name for your own baby, and an expert in baby names and their real meanings.",
  "You review names for a Facebook page that shares baby name ideas with Filipino parents. Only names a real parent would happily choose may pass.",
  "good = false when ANY of these is true:",
  "- it is made up, misspelled, or so rare that almost nobody has it",
  "- it is awkward or hard to say for a Filipino family, or sounds like a joke, a brand, an insult or a word with a bad sense in English or Filipino",
  "- its real meaning is bad, sad, silly or unknown",
  "- it is given mainly to the other gender",
  "fits = false when it does not truly fit this post (the letter or the name theme), or it is too close in sound or spelling to another name in the list (keep the better one).",
  "meaning: for a good name, its standard accepted meaning in 2 to 6 lowercase English words (fix the given meaning if it is wrong); empty otherwise.",
  "reason: why it is not good or does not fit, in a few plain words ('made up', 'hard to say', 'bad meaning', 'mostly a boy name', 'too close to Aria', 'not biblical'); empty when it passes.",
  "Judge every name in the list exactly once.",
].join("\n");

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    names: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" }, good: { type: "BOOLEAN" }, fits: { type: "BOOLEAN" },
          reason: { type: "STRING" }, meaning: { type: "STRING" },
        },
        required: ["name", "good", "fits", "reason", "meaning"],
      },
    },
  },
  required: ["names"],
};

export const JUDGE_NAMES_AT_ONCE = 60;

export function namesJudgePrompt(i: { gender: Gender; target: NameTarget; names: { name: string; meaning: string }[] }): string {
  const fit = i.target.kind === "letter"
    ? `Every name must start with the letter ${i.target.letter}.`
    : `Every name must truly be a "${i.target.title}" name${i.target.hint ? ` (${i.target.hint})` : ""}.`;
  return [`Baby ${i.gender} names for one post. ${fit}`, "Names (name: the meaning we have):", ...i.names.map((n) => `- ${n.name}: ${n.meaning}`)].join("\n");
}

const cleanMeaning = (m: string) => m.toLowerCase().replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);

function parseVerdicts(raw: unknown): NameVerdict[] | null {
  const list = raw && typeof raw === "object" ? (raw as { names?: unknown }).names : null;
  if (!Array.isArray(list)) return null;
  return list.filter((v): v is NameVerdict => !!v && typeof v === "object"
    && typeof (v as NameVerdict).name === "string" && typeof (v as NameVerdict).good === "boolean" && typeof (v as NameVerdict).fits === "boolean"
    && typeof (v as NameVerdict).reason === "string" && typeof (v as NameVerdict).meaning === "string");
}

/** Claude's verdicts in the order of `names` (matched by name, any case); a name it skipped fails as "not judged". */
export async function judgeNames(i: { gender: Gender; target: NameTarget; names: { name: string; meaning: string }[] }): Promise<JudgeResult<NameVerdict[]>> {
  const usage: Usage = { input: 0, output: 0 };
  const out: NameVerdict[] = [];
  for (const batch of chunks(i.names, JUDGE_NAMES_AT_ONCE)) {
    const r = await judgeJson<NameVerdict[]>({
      system: NAMES_JUDGE_SYSTEM, schema: SCHEMA, parse: parseVerdicts, timeoutMs: 120_000,
      content: [{ type: "text", text: namesJudgePrompt({ ...i, names: batch }) }],
    });
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    if (!r.ok) return { ...r, usage };
    const byName = new Map(r.data.map((v) => [v.name.trim().toLowerCase(), v]));
    for (const n of batch) {
      const v = byName.get(n.name.trim().toLowerCase());
      if (!v) { out.push({ name: n.name, good: false, fits: false, reason: "not judged", meaning: "" }); continue; }
      const meaning = cleanMeaning(v.meaning);
      out.push(v.good && v.fits && !meaning
        ? { name: n.name, good: false, fits: v.fits, reason: "no meaning", meaning: "" }
        : { name: n.name, good: v.good, fits: v.fits, reason: v.reason.trim().slice(0, 80), meaning: v.good ? meaning : "" });
    }
  }
  return { ok: true, data: out, usage };
}
```

Note: "not judged" sets `good: false`, but the names step must not skip a saved name for that reason (see Task 6: only `reason !== "not judged"` skips).

- [ ] **Step 5: `lib/autopilot/photo-problems.ts` (pure)**

```ts
// The photo check's problem ids (the Claude schema's enum), their plain labels, and strict parsing.
export const PHOTO_PROBLEMS = ["hands", "feet", "face", "soles", "skin", "split", "text", "name_on_face", "extra_person", "other"] as const;
export type PhotoProblem = (typeof PHOTO_PROBLEMS)[number];
export const PROBLEM_LABEL: Record<PhotoProblem, string> = {
  hands: "odd hands or fingers", feet: "odd feet or toes", face: "warped face or eyes", soles: "soles to the camera",
  skin: "too much skin", split: "split or collage frame", text: "text in the photo", name_on_face: "name covers the face",
  extra_person: "extra baby or body part", other: "something looks wrong",
};
export interface PhotoVerdict { pass: boolean; problems: PhotoProblem[]; note: string }

/** A pass that names problems is a fail; unknown problems drop; a fail without a known problem is "other". */
export function parsePhotoVerdict(raw: unknown): PhotoVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pass !== "boolean" || !Array.isArray(r.problems)) return null;
  const problems = [...new Set(r.problems.filter((p): p is PhotoProblem => typeof p === "string" && (PHOTO_PROBLEMS as readonly string[]).includes(p)))];
  const note = typeof r.note === "string" ? r.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (r.pass && !r.problems.length) return { pass: true, problems: [], note };
  return { pass: false, problems: problems.length ? problems : ["other"], note };
}

/** The later card of each look-alike pair: whole numbers 2..count, each once, at most 3. */
export function parseLookAlike(raw: unknown, count: number): number[] | null {
  const list = raw && typeof raw === "object" ? (raw as { remake?: unknown }).remake : null;
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((n): n is number => Number.isInteger(n) && n >= 2 && n <= count))].slice(0, 3);
}
```

- [ ] **Step 6: `lib/autopilot/judge-photos.ts`**

```ts
import "server-only";
import type { CardRow } from "@/lib/db/types";
import type { GeminiSchema } from "@/lib/ai/gemini";
import { judgeJson, type JudgeResult } from "./claude-judge";
import { PHOTO_PROBLEMS, parseLookAlike, parsePhotoVerdict, type PhotoVerdict } from "./photo-problems";

export const PHOTO_JUDGE_SYSTEM = [
  "You check AI-generated baby photo cards before they are posted on a Facebook page for Filipino parents.",
  "Each card is one square photo with a baby name and its meaning stamped on it; the closing card has a short follow message instead.",
  "Some cards are still lifes on purpose: props and clothes with no baby. That is fine.",
  "A card fails for any of these (use these problem ids):",
  "- hands: extra, missing, fused or twisted fingers, or a deformed hand",
  "- feet: extra, missing or fused toes, or a deformed foot",
  "- face: a warped, melted or uneven face, odd eyes or teeth",
  "- soles: the baby lies on the floor with the soles of the feet toward the camera (it looks lifeless)",
  "- skin: anything beyond bare arms, legs and feet: no bare chest, bare bottom or diaper-only photo",
  "- split: a split, collage, grid or picture-in-picture frame instead of one photo",
  "- text: letters, words or logos inside the photo itself (the stamped name, meaning and handle are fine)",
  "- name_on_face: the stamped name or meaning covers the baby's face",
  "- extra_person: an extra baby, a second head, or stray arms, legs or hands",
  "- other: anything else a parent would find wrong or creepy",
  "Be strict about hands, feet and skin: when in doubt, fail it. Do not fail a card for its style, colors or props.",
].join("\n");

const CARD_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    pass: { type: "BOOLEAN" },
    problems: { type: "ARRAY", items: { type: "STRING", enum: [...PHOTO_PROBLEMS] } },
    note: { type: "STRING", description: "One short sentence: what is wrong (empty when it passes)" },
  },
  required: ["pass", "problems", "note"],
};

/** One card, as its stamped image (a signed URL). */
export function judgeCard(card: Pick<CardRow, "kind" | "name">, url: string): Promise<JudgeResult<PhotoVerdict>> {
  const what = card.kind === "cta" ? "This is the closing card: its stamped text is a follow message." : `The stamped name is ${card.name}.`;
  return judgeJson({
    system: PHOTO_JUDGE_SYSTEM, schema: CARD_SCHEMA, parse: parsePhotoVerdict, timeoutMs: 90_000,
    content: [{ type: "text", text: `${what} Check this card.` }, { type: "image", source: { type: "url", url } }],
  });
}

export const LOOKALIKE_SYSTEM = [
  "You see all the cards of one Facebook album of baby name cards, numbered in posting order.",
  "Albums where photos repeat do badly. Name the cards that look too alike: nearly the same pose, angle, framing and props as an EARLIER card.",
  "A different name, color or a small change does not make two cards different. Still lifes count too.",
  "Return the number of the later card of each look-alike pair (never card 1), at most 3. Return an empty list when every card looks different enough.",
].join("\n");

const LOOKALIKE_SCHEMA: GeminiSchema = { type: "OBJECT", properties: { remake: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["remake"] };

/** All the passed cards of one post together; the numbers (1-based) of cards to remake. */
export function judgeLookAlike(cards: { card: Pick<CardRow, "kind" | "name">; url: string }[]): Promise<JudgeResult<number[]>> {
  const content = cards.flatMap(({ url }, k) => [
    { type: "text" as const, text: `Card ${k + 1}:` },
    { type: "image" as const, source: { type: "url" as const, url } },
  ]);
  return judgeJson({ system: LOOKALIKE_SYSTEM, schema: LOOKALIKE_SCHEMA, parse: (raw) => parseLookAlike(raw, cards.length), timeoutMs: 150_000, content });
}
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run tests/autopilot-judges.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/autopilot/claude-judge.ts lib/autopilot/judge-names.ts lib/autopilot/photo-problems.ts lib/autopilot/judge-photos.ts tests/autopilot-judges.test.ts
git commit -m "feat(autopilot): Claude Opus checks - parent's-eye names, card photos, look-alikes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Repo and the names step

**Files:**
- Create: `lib/autopilot/repo.ts`, `lib/autopilot/names-step.ts`
- Create: `tests/helpers/autopilot-memory.ts` (in-memory repo for tests)
- Test: `tests/autopilot-names-step.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `workerHealth` (`lib/status/worker-health.ts`), `startsWith` (`lib/series/letter.ts`), `shuffle` (`lib/planner/random.ts`), `MIN_GOOD_NAMES` (Task 3), `NameTarget`, `NameVerdict`, `JudgeResult`, `Usage` (Task 5).
- Produces (`lib/autopilot/repo.ts`):
```ts
export type RepoName = Pick<NameRow, "id" | "name" | "meaning" | "gender" | "style" | "status">;
export type TickPatch = Pick<AutopilotRunRow, "status" | "message" | "events" | "input_tokens" | "output_tokens"> & { finished_at?: string };
export interface AutopilotRepo {
  activeRun(): Promise<AutopilotRunRow | null>;
  lockRun(runId: string, until: string, now: string): Promise<boolean>;
  runStatus(runId: string): Promise<AutopilotRunStatus | null>;
  finishTick(runId: string, patch: TickPatch): Promise<void>;
  items(runId: string): Promise<AutopilotItemRow[]>;
  updateItem(id: string, patch: Partial<AutopilotItemRow>): Promise<void>;
  cards(postIds: string[]): Promise<CardRow[]>;
  updateCard(id: string, patch: Partial<CardRow>): Promise<void>;
  markCardsPending(postId: string): Promise<void>;
  signedUrls(paths: string[]): Promise<string[]>;
  pcHealth(now: number): Promise<WorkerHealth>;
  themesLeft(gender: Gender): Promise<number>;
  settings(): Promise<SettingsRow>;
  allNames(): Promise<RepoName[]>;
  skipName(id: string, note: string): Promise<void>;
  setMeaning(id: string, meaning: string): Promise<void>;
  addNames(rows: { name: string; meaning: string; gender: Gender }[]): Promise<{ id: string; name: string }[]>;
}
export function supabaseRepo(sb: SupabaseClient): AutopilotRepo;
```
- Produces (`lib/autopilot/names-step.ts`): `EXTRA_ROUNDS = 2`, `ASK_EXTRA = 4`, `interface NamesDeps`, `type NamesOutcome`, `pickNames(d: NamesDeps, item: Pick<AutopilotItemRow, "gender" | "letter" | "name_theme" | "name_count">, hint: string | null): Promise<NamesOutcome>`

- [ ] **Step 1: The in-memory repo** — `tests/helpers/autopilot-memory.ts`

```ts
import type { AutopilotItemRow, AutopilotRunRow, CardRow, Gender, SettingsRow } from "@/lib/db/types";
import type { WorkerHealth } from "@/lib/status/worker-health";
import type { AutopilotRepo, RepoName, TickPatch } from "@/lib/autopilot/repo";

/** An in-memory AutopilotRepo: plain arrays the tests set up and read back. */
export function memoryRepo(o: {
  runs?: AutopilotRunRow[]; items?: AutopilotItemRow[]; cards?: CardRow[]; names?: RepoName[];
  health?: WorkerHealth; themesLeft?: Partial<Record<Gender, number>>; settings?: Partial<SettingsRow>;
} = {}) {
  const db = {
    runs: o.runs ?? [], items: o.items ?? [], cards: o.cards ?? [], names: o.names ?? [],
    health: o.health ?? ("ready" as WorkerHealth), themesLeft: { boy: 5, girl: 5, ...o.themesLeft },
    settings: { min_images: 6, max_images: 26, autopilot_name_themes: "Biblical (names from the Bible)\nSoft and cool", ...o.settings } as SettingsRow,
    skipped: [] as { id: string; note: string }[], meanings: [] as { id: string; meaning: string }[], nextId: 1,
  };
  const repo: AutopilotRepo = {
    async activeRun() { return db.runs.find((r) => ["running", "waiting", "paused"].includes(r.status)) ?? null; },
    async lockRun(id, until, now) {
      const r = db.runs.find((x) => x.id === id);
      if (!r || (r.tick_until && r.tick_until >= now)) return false;
      r.tick_until = until;
      return true;
    },
    async runStatus(id) { return db.runs.find((x) => x.id === id)?.status ?? null; },
    async finishTick(id, patch: TickPatch) {
      const r = db.runs.find((x) => x.id === id)!;
      const { status, message, finished_at, ...rest } = patch;
      Object.assign(r, rest, { tick_until: null });
      if (r.status !== "stopped") Object.assign(r, { status, message }, finished_at ? { finished_at } : {});
    },
    async items(runId) { return db.items.filter((i) => i.run_id === runId).map((i) => ({ ...i })); },
    async updateItem(id, patch) { Object.assign(db.items.find((i) => i.id === id)!, patch); },
    async cards(postIds) { return db.cards.filter((c) => c.post_id && postIds.includes(c.post_id)).map((c) => ({ ...c })); },
    async updateCard(id, patch) { Object.assign(db.cards.find((c) => c.id === id)!, patch); },
    async markCardsPending(postId) { for (const c of db.cards) if (c.post_id === postId) c.check_state = "pending"; },
    async signedUrls(paths) { return paths.map((p) => `https://signed/${p}`); },
    async pcHealth() { return db.health; },
    async themesLeft(g) { return db.themesLeft[g]; },
    async settings() { return db.settings; },
    async allNames() { return db.names.map((n) => ({ ...n })); },
    async skipName(id, note) { db.skipped.push({ id, note }); const n = db.names.find((x) => x.id === id); if (n) n.status = "skip"; },
    async setMeaning(id, meaning) { db.meanings.push({ id, meaning }); },
    async addNames(rows) {
      return rows.map((r) => {
        const row: RepoName = { id: `new-${db.nextId++}`, name: r.name, meaning: r.meaning, gender: r.gender, style: "single", status: "available" };
        db.names.push(row);
        return { id: row.id, name: row.name };
      });
    },
  };
  return { repo, db };
}
```

- [ ] **Step 2: Write the failing test** — `tests/autopilot-names-step.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { memoryRepo } from "./helpers/autopilot-memory";
import type { RepoName } from "@/lib/autopilot/repo";
import type { NameVerdict } from "@/lib/autopilot/judge-names";
import { pickNames, type NamesDeps } from "@/lib/autopilot/names-step";

const nm = (name: string, o: Partial<RepoName> = {}): RepoName => ({ id: `n-${name}`, name, meaning: "a meaning", gender: "girl", style: "single", status: "available", ...o });
const usage = { input: 10, output: 5 };
/** A judge that passes every name except the ones listed. */
const judgeWith = (bad: Record<string, Partial<NameVerdict>> = {}) => vi.fn(async (i: { names: { name: string; meaning: string }[] }) => ({
  ok: true as const, usage,
  data: i.names.map((n) => ({ name: n.name, good: true, fits: true, reason: "", meaning: n.meaning.toLowerCase(), ...bad[n.name] })),
}));
const item = { gender: "girl" as const, letter: "S", name_theme: null, name_count: 10 };
const S = ["Sabina", "Selah", "Sienna", "Sloane", "Stella", "Sage", "Sora", "Saoirse", "Sylvie", "Seraphina", "Solene", "Sunny"];
const deps = (names: RepoName[], judge: NamesDeps["judge"], suggest?: NamesDeps["suggest"]) => {
  const m = memoryRepo({ names });
  return { m, d: { repo: m.repo, judge, suggest: suggest ?? vi.fn(async () => ({ ok: true as const, names: [] })), rng: () => 0.5 } satisfies NamesDeps };
};

describe("pickNames", () => {
  it("uses the saved names that pass, without asking the AI for more", async () => {
    const { d } = deps([...S.map((n) => nm(n)), nm("Tala"), nm("Sam", { gender: "boy" }), nm("Sky", { status: "used" })], judgeWith());
    const r = await pickNames(d, item, null);
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" && r.nameIds).toHaveLength(10);
    expect(r.kind === "ok" && r.nameIds.every((id) => S.map((n) => `n-${n}`).includes(id))).toBe(true);
    expect(d.suggest).not.toHaveBeenCalled();
    expect(r.usage).toEqual(usage);
  });

  it("skips saved names a parent would not choose (with the reason), fixes meanings, and leaves names that only don't fit", async () => {
    const { d, m } = deps(S.map((n) => nm(n)), judgeWith({
      Saoirse: { good: false, reason: "hard to say" }, Sylvie: { fits: false, reason: "too close to Sienna" }, Selah: { meaning: "a pause to reflect" },
      Sora: { good: false, fits: false, reason: "not judged" },
    }));
    const r = await pickNames(d, item, null);
    expect(m.db.skipped).toEqual([{ id: "n-Saoirse", note: "Skipped by Autopilot: hard to say" }]);
    expect(m.db.meanings).toEqual([{ id: "n-Selah", meaning: "a pause to reflect" }]);
    expect(r.skipped).toEqual([{ name: "Saoirse", why: "hard to say" }]);
    expect(r.kind === "ok" && r.nameIds).not.toContain("n-Sylvie");
  });

  it("asks the AI for more when short, checks them, saves the good ones and uses them", async () => {
    const suggest = vi.fn(async () => ({ ok: true as const, names: [{ name: "Saria", meaning: "princess" }, { name: "Sqiggle", meaning: "?" }, { name: "Sabina", meaning: "dup" }] }));
    const { d, m } = deps(S.slice(0, 7).map((n) => nm(n)), judgeWith({ Sqiggle: { good: false, reason: "made up" } }), suggest);
    const r = await pickNames(d, { ...item, name_count: 8 }, null);
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ gender: "girl", target: { kind: "letter", letter: "S" }, want: 1 + 4 }));
    expect(r.added).toEqual(["Saria"]);
    expect(m.db.names.find((n) => n.name === "Saria")).toMatchObject({ status: "available", meaning: "princess" });
    expect(r.kind === "ok" && r.nameIds).toHaveLength(8);
  });

  it("holds the post when there are still fewer than 8 good names after two extra rounds", async () => {
    const suggest = vi.fn(async () => ({ ok: true as const, names: [] }));
    const { d } = deps(S.slice(0, 5).map((n) => nm(n)), judgeWith(), suggest);
    const r = await pickNames(d, item, null);
    expect(suggest).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ kind: "hold", why: "Only 5 good girl names for letter S (8 needed). Add names, then make this post on Today." });
  });

  it("goes ahead with 8 or more when it can't reach the target", async () => {
    const { d } = deps(S.slice(0, 9).map((n) => nm(n)), judgeWith());
    const r = await pickNames(d, { ...item, name_count: 12 }, null);
    expect(r.kind === "ok" && r.nameIds).toHaveLength(9);
  });

  it("a name-theme post judges every saved name of the gender for fit, with the hint", async () => {
    const judge = judgeWith({ Stella: { fits: false, reason: "not biblical" } });
    const { d, m } = deps([nm("Ruth"), nm("Stella"), nm("Ezra", { gender: "boy" })], judge);
    await pickNames(d, { gender: "girl", letter: null, name_theme: "Biblical", name_count: 10 }, "names from the Bible");
    expect(judge.mock.calls[0][0]).toMatchObject({ target: { kind: "theme", title: "Biblical", hint: "names from the Bible" } });
    expect(judge.mock.calls[0][0].names.map((n: { name: string }) => n.name)).toEqual(["Ruth", "Stella"]);
    expect(m.db.skipped).toEqual([]);
  });

  it("an AI stop (credits, key) stops; any other AI failure is retried later", async () => {
    const stop = vi.fn(async () => ({ ok: false as const, error: "Your Claude credits have run out.", usage, stop: true }));
    expect(await pickNames(deps(S.map((n) => nm(n)), stop).d, item, null)).toMatchObject({ kind: "stop" });
    const flaky = vi.fn(async () => ({ ok: false as const, error: "Claude timed out.", usage, stop: false }));
    expect(await pickNames(deps(S.map((n) => nm(n)), flaky).d, item, null)).toMatchObject({ kind: "retry", error: "Claude timed out." });
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-names-step.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: `lib/autopilot/repo.ts`**

```ts
// The database as the Autopilot engine sees it: a small interface (tested with an in-memory version) and its Supabase
// implementation for the tick route (service-role client). Every method throws on a database error; the engine turns
// that into a logged event and tries again on the next tick.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutopilotItemRow, AutopilotRunRow, AutopilotRunStatus, CardRow, Gender, NameRow, SettingsRow, WorkerStatusRow } from "@/lib/db/types";
import { workerHealth, type WorkerHealth } from "@/lib/status/worker-health";

export type RepoName = Pick<NameRow, "id" | "name" | "meaning" | "gender" | "style" | "status">;
export type TickPatch = Pick<AutopilotRunRow, "status" | "message" | "events" | "input_tokens" | "output_tokens"> & { finished_at?: string };

export interface AutopilotRepo {
  activeRun(): Promise<AutopilotRunRow | null>;
  /** Take the tick lock: only when no tick holds it (tick_until empty or past). */
  lockRun(runId: string, until: string, now: string): Promise<boolean>;
  runStatus(runId: string): Promise<AutopilotRunStatus | null>;
  /** Save the tick's results and free the lock; never brings a stopped run back. */
  finishTick(runId: string, patch: TickPatch): Promise<void>;
  items(runId: string): Promise<AutopilotItemRow[]>;
  updateItem(id: string, patch: Partial<AutopilotItemRow>): Promise<void>;
  cards(postIds: string[]): Promise<CardRow[]>;
  updateCard(id: string, patch: Partial<CardRow>): Promise<void>;
  markCardsPending(postId: string): Promise<void>;
  signedUrls(paths: string[]): Promise<string[]>;
  pcHealth(now: number): Promise<WorkerHealth>;
  themesLeft(gender: Gender): Promise<number>;
  settings(): Promise<SettingsRow>;
  allNames(): Promise<RepoName[]>;
  skipName(id: string, note: string): Promise<void>;
  setMeaning(id: string, meaning: string): Promise<void>;
  addNames(rows: { name: string; meaning: string; gender: Gender }[]): Promise<{ id: string; name: string }[]>;
}

const PAGE = 1000;
const LINK_TTL_S = 3600;

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };
function must<T>(r: Res<T>, what: string): T {
  if (r.error) throw new Error(`Could not ${what}: ${r.error.message}`);
  return r.data as T;
}

export function supabaseRepo(sb: SupabaseClient): AutopilotRepo {
  return {
    async activeRun() {
      const rows = must(await sb.from("autopilot_runs").select("*").in("status", ["running", "waiting", "paused"]).order("created_at", { ascending: false }).limit(1), "read the run");
      return ((rows ?? []) as AutopilotRunRow[])[0] ?? null;
    },
    async lockRun(runId, until, now) {
      const rows = must(await sb.from("autopilot_runs").update({ tick_until: until }).eq("id", runId).or(`tick_until.is.null,tick_until.lt.${now}`).select("id"), "lock the run");
      return !!(rows as unknown[] | null)?.length;
    },
    async runStatus(runId) {
      const row = must(await sb.from("autopilot_runs").select("status").eq("id", runId).maybeSingle(), "read the run");
      return (row as { status: AutopilotRunStatus } | null)?.status ?? null;
    },
    async finishTick(runId, patch) {
      const { status, message, finished_at, ...rest } = patch;
      const rows = must(await sb.from("autopilot_runs").update({ ...rest, status, message, ...(finished_at ? { finished_at } : {}), tick_until: null })
        .eq("id", runId).neq("status", "stopped").select("id"), "save the run");
      if (!(rows as unknown[] | null)?.length) must(await sb.from("autopilot_runs").update({ ...rest, tick_until: null }).eq("id", runId).select("id"), "save the run");
    },
    async items(runId) {
      return (must(await sb.from("autopilot_items").select("*").eq("run_id", runId).order("scheduled_for"), "read the plan") ?? []) as AutopilotItemRow[];
    },
    async updateItem(id, patch) { must(await sb.from("autopilot_items").update(patch).eq("id", id).select("id"), "save a planned post"); },
    async cards(postIds) {
      if (!postIds.length) return [];
      return (must(await sb.from("cards").select("*").in("post_id", postIds), "read the cards") ?? []) as CardRow[];
    },
    async updateCard(id, patch) { must(await sb.from("cards").update(patch).eq("id", id).select("id"), "save a card check"); },
    async markCardsPending(postId) { must(await sb.from("cards").update({ check_state: "pending" }).eq("post_id", postId).select("id"), "mark the cards for checking"); },
    async signedUrls(paths) {
      if (!paths.length) return [];
      const { data, error } = await sb.storage.from("cards").createSignedUrls(paths, LINK_TTL_S);
      if (error) throw new Error(`Could not make links to the cards: ${error.message}`);
      return (data ?? []).map((l) => l.signedUrl ?? "");
    },
    async pcHealth(now) {
      const { data } = await sb.from("worker_status").select("*").eq("id", 1).maybeSingle();
      return workerHealth((data ?? null) as WorkerStatusRow | null, now);
    },
    async themesLeft(gender) {
      const { count, error } = await sb.from("themes").select("id", { count: "exact", head: true }).eq("gender", gender).eq("status", "available");
      if (error) throw new Error(`Could not count the themes: ${error.message}`);
      return count ?? 0;
    },
    async settings() { return must(await sb.from("settings").select("*").eq("id", 1).single(), "read the settings") as SettingsRow; },
    async allNames() {
      const out: RepoName[] = [];
      for (let from = 0; ; from += PAGE) {
        const rows = (must(await sb.from("names").select("id, name, meaning, gender, style, status").order("id").range(from, from + PAGE - 1), "read the names") ?? []) as RepoName[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
    async skipName(id, note) {
      must(await sb.from("names").update({ status: "skip", autopilot_note: note.slice(0, 200) }).eq("id", id).eq("status", "available").select("id"), "skip a name");
    },
    async setMeaning(id, meaning) { must(await sb.from("names").update({ meaning }).eq("id", id).select("id"), "fix a meaning"); },
    async addNames(rows) {
      if (!rows.length) return [];
      const full = rows.map((r) => ({ name: r.name, meaning: r.meaning, gender: r.gender, style: "single" as const, status: "available" as const }));
      const { data, error } = await sb.from("names").insert(full).select("id, name");
      if (!error) return (data ?? []) as { id: string; name: string }[];
      if (error.code !== "23505") throw new Error(`Could not add names: ${error.message}`);
      // One of them was just added elsewhere: add the others one by one.
      const out: { id: string; name: string }[] = [];
      for (const r of full) {
        const one = await sb.from("names").insert(r).select("id, name").single();
        if (!one.error && one.data) out.push(one.data as { id: string; name: string });
      }
      return out;
    },
  };
}
```

- [ ] **Step 5: `lib/autopilot/names-step.ts`**

```ts
// Pick a post's names (spec: "Names: the parent's-eye check"): the saved names that pass, then AI suggestions (checked
// the same way) while short. Saved names a parent would not choose are skipped with the reason; wrong meanings are
// fixed; a name that only does not fit this post is left alone. Fewer than 8 good names = the post is held.
import type { AutopilotItemRow, Gender } from "@/lib/db/types";
import { startsWith } from "@/lib/series/letter";
import { shuffle } from "@/lib/planner/random";
import type { JudgeResult, Usage } from "./claude-judge";
import type { NameTarget, NameVerdict } from "./judge-names";
import type { AutopilotRepo } from "./repo";
import { MIN_GOOD_NAMES } from "./plan";

export const EXTRA_ROUNDS = 2;
/** Asked for on top of the names still missing (the checks drop some). */
export const ASK_EXTRA = 4;

type Simple = { name: string; meaning: string };
export interface NamesDeps {
  repo: Pick<AutopilotRepo, "allNames" | "skipName" | "setMeaning" | "addNames">;
  judge: (i: { gender: Gender; target: NameTarget; names: Simple[] }) => Promise<JudgeResult<NameVerdict[]>>;
  suggest: (i: { gender: Gender; target: NameTarget; want: number; allNames: string[]; existing: string[] }) => Promise<{ ok: true; names: Simple[] } | { ok: false; error: string }>;
  rng: () => number;
}
type Base = { usage: Usage; added: string[]; skipped: { name: string; why: string }[] };
export type NamesOutcome = Base & (
  | { kind: "ok"; nameIds: string[] }
  | { kind: "hold"; why: string }
  | { kind: "retry"; error: string }
  | { kind: "stop"; error: string }
);

export async function pickNames(d: NamesDeps, item: Pick<AutopilotItemRow, "gender" | "letter" | "name_theme" | "name_count">, hint: string | null): Promise<NamesOutcome> {
  const base: Base = { usage: { input: 0, output: 0 }, added: [], skipped: [] };
  const target: NameTarget = item.letter ? { kind: "letter", letter: item.letter } : { kind: "theme", title: item.name_theme ?? "", hint };
  const label = item.letter ? `letter ${item.letter}` : `"${item.name_theme}"`;
  const all = await d.repo.allNames();
  const sameKind = all.filter((n) => n.gender === item.gender && n.style === "single" && (!item.letter || startsWith(n.name, item.letter)));
  const good: { id: string; name: string }[] = [];
  const judge = async (names: Simple[]) => {
    const r = await d.judge({ gender: item.gender, target, names });
    base.usage.input += r.usage.input;
    base.usage.output += r.usage.output;
    return r;
  };
  const failed = (r: { error: string; stop: boolean }): NamesOutcome => (r.stop ? { ...base, kind: "stop", error: r.error } : { ...base, kind: "retry", error: r.error });

  // 1. The saved names.
  const stock = sameKind.filter((n) => n.status === "available");
  if (stock.length) {
    const r = await judge(stock.map((n) => ({ name: n.name, meaning: n.meaning })));
    if (!r.ok) return failed(r);
    for (const [k, v] of r.data.entries()) {
      const n = stock[k];
      if (!v.good && v.reason !== "not judged") {
        const why = v.reason || "not a good pick";
        await d.repo.skipName(n.id, `Skipped by Autopilot: ${why}`);
        base.skipped.push({ name: n.name, why });
        continue;
      }
      if (!v.good || !v.fits) continue;
      if (v.meaning && v.meaning !== n.meaning) await d.repo.setMeaning(n.id, v.meaning);
      good.push({ id: n.id, name: n.name });
    }
  }

  // 2. More from the AI while short, checked the same way.
  const known = new Set(all.map((n) => n.name.toLowerCase()));
  let lastError: string | null = null;
  for (let round = 0; round < EXTRA_ROUNDS && good.length < item.name_count; round++) {
    const s = await d.suggest({
      gender: item.gender, target, want: item.name_count - good.length + ASK_EXTRA,
      allNames: [...all.map((n) => n.name), ...base.added], existing: [...sameKind.map((n) => n.name), ...base.added],
    });
    if (!s.ok) { lastError = s.error; continue; }
    const fresh = s.names.filter((n) => !known.has(n.name.toLowerCase()));
    if (!fresh.length) continue;
    const r = await judge(fresh);
    if (!r.ok) return failed(r);
    const keep = fresh.flatMap((n, k) => (r.data[k].good && r.data[k].fits ? [{ name: n.name, meaning: r.data[k].meaning || n.meaning, gender: item.gender }] : []));
    for (const n of fresh) known.add(n.name.toLowerCase());
    for (const saved of await d.repo.addNames(keep)) {
      good.push(saved);
      base.added.push(saved.name);
    }
  }

  if (good.length < MIN_GOOD_NAMES) {
    if (lastError && good.length === 0) return { ...base, kind: "retry", error: lastError };
    return { ...base, kind: "hold", why: `Only ${good.length} good ${item.gender} names for ${label} (${MIN_GOOD_NAMES} needed). Add names, then make this post on Today.` };
  }
  return { ...base, kind: "ok", nameIds: shuffle(good, d.rng).slice(0, item.name_count).map((g) => g.id) };
}
```

If `shuffle` in `lib/planner/random.ts` mutates its input or has a different signature, adapt the last line to return a shuffled copy (`shuffle([...good], d.rng)`).

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/autopilot-names-step.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/autopilot/repo.ts lib/autopilot/names-step.ts tests/helpers/autopilot-memory.ts tests/autopilot-names-step.test.ts
git commit -m "feat(autopilot): names step - parent-checked saved names, AI top-ups, skip with reason" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The engine (one tick)

**Files:**
- Create: `lib/autopilot/engine.ts`, `lib/autopilot/summary.ts`
- Test: `tests/autopilot-engine.test.ts`

**Interfaces:**
- Consumes: `AutopilotRepo` (Task 6), `NamesOutcome` (Task 6), `CreatePostInput` (Task 4, type only), `PublishResult` (Task 4, type only), `JudgeResult`, `Usage`, `PhotoVerdict`, `PROBLEM_LABEL` (Task 5), `MIN_GOOD_NAMES`, `dayLabel`, `labelText` (Task 3), `parseNameThemes` (Task 2), `manilaLabel` (`lib/facebook/schedule.ts`).
- Produces:
```ts
export interface EngineDeps {
  repo: AutopilotRepo;
  pickNames: (item: AutopilotItemRow, hint: string | null) => Promise<NamesOutcome>;
  createPost: (input: CreatePostInput) => Promise<ActionResult<{ postId: string }>>;
  schedule: (postId: string, at: string) => Promise<PublishResult>;
  remake: (card: CardRow, extra: Partial<CardRow>) => Promise<boolean>;
  judgeCard: (card: CardRow, url: string) => Promise<JudgeResult<PhotoVerdict>>;
  judgeLookAlike: (cards: { card: CardRow; url: string }[]) => Promise<JudgeResult<number[]>>;
  now: () => number;
}
export type TickOutcome = { ran: false; why: "no-run" | "busy" | "paused" } | { ran: true; status: AutopilotRunStatus };
export function tick(d: EngineDeps): Promise<TickOutcome>;
export const TICK_LOCK_MS, TICK_BUDGET_MS, NAMING_NEEDS_MS, MAX_REMAKES, TOO_LATE_MS, PLAN_TOO_LATE_MS, CHECKS_AT_ONCE, MAX_NAMING_ATTEMPTS, MAX_EVENTS, WAIT_PC, WAIT_COMFY;
```
- Produces (`summary.ts`): `runCost(run: Pick<AutopilotRunRow, "input_tokens" | "output_tokens">): number`, `summarize(run: AutopilotRunRow, items: AutopilotItemRow[]): { scheduled: number; held: number; namesAdded: number; namesSkipped: number; remade: number; removed: number; costUsd: number }`

- [ ] **Step 1: Write the failing test** — `tests/autopilot-engine.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import type { AutopilotItemRow, AutopilotRunRow, CardRow } from "@/lib/db/types";
import { memoryRepo } from "./helpers/autopilot-memory";
import { MAX_REMAKES, WAIT_COMFY, tick, type EngineDeps } from "@/lib/autopilot/engine";
import { runCost, summarize } from "@/lib/autopilot/summary";

const NOW = Date.parse("2026-11-20T03:00:00Z");
const run = (o: Partial<AutopilotRunRow> = {}): AutopilotRunRow => ({ id: "run1", status: "running", days: 1, first_day: "2026-11-21", message: null, events: [],
  input_tokens: 0, output_tokens: 0, tick_until: null, created_at: "", finished_at: null, updated_at: "", ...o });
const item = (id: string, o: Partial<AutopilotItemRow> = {}): AutopilotItemRow => ({ id, run_id: "run1", day: "2026-11-21", slot: "morning", gender: "girl",
  scheduled_for: "2026-11-21T01:12:00Z", letter: "S", name_theme: null, name_count: 10, post_id: null, state: "planned", lookalike_done: false, attempts: 0,
  note: null, created_at: "", updated_at: "", ...o });
const card = (id: string, o: Partial<CardRow> = {}): CardRow => ({ id, post_id: "p1", theme_id: "t", kind: "post", position: 1, name_id: null, name: id, meaning: "m",
  shot: "s", prompt: "p", seed: 1, status: "done", error: null, photo_path: "x", card_path: `cards/${id}.jpg`, version: 1, selected: true, order_index: 1,
  queued_at: "", claimed_at: null, started_at: null, finished_at: null, attempts: 0, created_at: "", updated_at: "", check_state: "pending", check_note: null, remakes: 0, ...o });
const usage = { input: 1000, output: 100 };
const pass = { ok: true as const, data: { pass: true, problems: [], note: "" }, usage };
const fail = (p: "hands" | "skin") => ({ ok: true as const, data: { pass: false, problems: [p], note: "" }, usage });

function setup(o: Parameters<typeof memoryRepo>[0] = {}, deps: Partial<EngineDeps> = {}) {
  const m = memoryRepo({ runs: [run()], ...o });
  const d: EngineDeps = {
    repo: m.repo,
    pickNames: vi.fn(async () => ({ kind: "ok" as const, nameIds: Array.from({ length: 10 }, (_, i) => `n${i}`), usage, added: ["Saria"], skipped: [{ name: "Sqig", why: "made up" }] })),
    createPost: vi.fn(async () => ({ ok: true as const, postId: "p1" })),
    schedule: vi.fn(async () => ({ ok: true as const, state: "scheduled" as const, permalink: null, scheduledFor: "x" })),
    remake: vi.fn(async (c: CardRow, extra: Partial<CardRow>) => { Object.assign(m.db.cards.find((x) => x.id === c.id)!, { ...extra, status: "queued" }); return true; }),
    judgeCard: vi.fn(async () => pass),
    judgeLookAlike: vi.fn(async () => ({ ok: true as const, data: [] as number[], usage })),
    now: () => NOW,
    ...deps,
  };
  return { m, d };
}
const tenCards = (o: Partial<CardRow> = {}) => Array.from({ length: 10 }, (_, i) => card(`c${i}`, o));

describe("tick", () => {
  it("does nothing without an active run, while another tick works, or while paused", async () => {
    expect(await tick(setup({ runs: [] }).d)).toEqual({ ran: false, why: "no-run" });
    expect(await tick(setup({ runs: [run({ tick_until: "2026-11-20T03:04:00.000Z" })] }).d)).toEqual({ ran: false, why: "busy" });
    expect(await tick(setup({ runs: [run({ status: "paused" })] }).d)).toEqual({ ran: false, why: "paused" });
  });

  it("plans the next post: names, the post (item id as request id), cards marked for checking", async () => {
    const { m, d } = setup({ items: [item("i1", { name_theme: null }), item("i2", { slot: "afternoon", gender: "boy", scheduled_for: "2026-11-21T05:40:00Z" })], cards: tenCards({ check_state: null }) });
    expect(await tick(d)).toEqual({ ran: true, status: "running" });
    expect(d.createPost).toHaveBeenCalledWith(expect.objectContaining({ gender: "girl", style: "single", count: null, postDate: "2026-11-21", requestId: "i1",
      subjectAge: "random", letter: "S", nameIds: expect.any(Array), nameTheme: null }));
    expect(m.db.items[0]).toMatchObject({ state: "making", post_id: "p1", attempts: 1 });
    expect(m.db.cards.every((c) => c.check_state === "pending")).toBe(true);
    expect(m.db.runs[0].events.map((e) => e.kind)).toEqual(["name_added", "name_skipped"]);
    expect(m.db.runs[0].input_tokens).toBe(1000);
    expect(m.db.runs[0].tick_until).toBeNull();
  });

  it("a name-theme post gets its title and the hint from the settings", async () => {
    const { d } = setup({ items: [item("i1", { letter: null, name_theme: "Biblical" })] });
    await tick(d);
    expect(d.pickNames).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), "names from the Bible");
    expect(d.createPost).toHaveBeenCalledWith(expect.objectContaining({ nameTheme: { title: "Biblical", hint: "names from the Bible" } }));
  });

  it("with the PC not ready it waits: no new posts, but finished cards are still checked", async () => {
    const { m, d } = setup({ health: "comfy-off", items: [item("i1", { state: "making", post_id: "p1" }), item("i2")], cards: [card("c0"), card("c1", { status: "queued" })] });
    expect(await tick(d)).toEqual({ ran: true, status: "waiting" });
    expect(m.db.runs[0].message).toBe(WAIT_COMFY);
    expect(d.createPost).not.toHaveBeenCalled();
    expect(m.db.cards[0].check_state).toBe("passed");
  });

  it("checks cards: pass, fail -> remade (up to 2), then removed and unselected", async () => {
    const judgeCard = vi.fn(async (c: CardRow) => (c.id === "c0" ? pass : fail("hands")));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })],
      cards: [card("c0"), card("c1"), card("c2", { remakes: MAX_REMAKES, check_note: "Remade: odd hands or fingers" })] }, { judgeCard });
    await tick(d);
    const [c0, c1, c2] = m.db.cards;
    expect(c0).toMatchObject({ check_state: "passed", check_note: "Checked" });
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), { check_state: "pending", check_note: "Remade: odd hands or fingers", remakes: 1 });
    expect(c2).toMatchObject({ check_state: "removed", selected: false, check_note: "Removed: odd hands or fingers" });
    expect(m.db.runs[0].events.map((e) => e.kind)).toEqual(["card_remade", "card_removed"]);
  });

  it("a card the PC could not make is remade like a failed check", async () => {
    const { d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0", { status: "failed" })] });
    await tick(d);
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "c0" }), expect.objectContaining({ check_note: "Remade: the PC could not make it" }));
  });

  it("could not check: remade once, then the post is held", async () => {
    const judgeCard = vi.fn(async () => ({ ok: false as const, error: "Claude timed out.", usage, stop: false }));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0")] }, { judgeCard });
    await tick(d);
    expect(m.db.cards[0]).toMatchObject({ check_state: "pending", check_note: "Could not check: Claude timed out.", remakes: 1 });
    Object.assign(m.db.cards[0], { status: "done" });
    m.db.runs[0].tick_until = null;
    await tick(d);
    expect(m.db.cards[0].check_state).toBe("failed");
    expect(m.db.items[0]).toMatchObject({ state: "held", note: "A card could not be checked. Look at the post, then schedule it yourself." });
  });

  it("a Claude stop (credits, key) pauses the run with the reason", async () => {
    const judgeCard = vi.fn(async () => ({ ok: false as const, error: "Your Claude credits have run out.", usage, stop: true }));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [card("c0")] }, { judgeCard });
    expect(await tick(d)).toEqual({ ran: true, status: "paused" });
    expect(m.db.runs[0].message).toBe("Your Claude credits have run out. Fix it, then press Resume.");
  });

  it("all cards passed: one look-alike check, remakes it names, then schedules at the planned time", async () => {
    const judgeLookAlike = vi.fn(async () => ({ ok: true as const, data: [3], usage }));
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1" })], cards: tenCards({ check_state: "passed" }) }, { judgeLookAlike });
    await tick(d);
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }), { check_state: "pending", check_note: "Remade: looked like another card", remakes: 1 });
    expect(m.db.items[0]).toMatchObject({ lookalike_done: true, state: "making" });
    expect(d.schedule).not.toHaveBeenCalled();
    Object.assign(m.db.cards[2], { status: "done" });
    m.db.runs[0].tick_until = null;
    expect(await tick(d)).toEqual({ ran: true, status: "done" }); // its only post is scheduled: the run is finished
    expect(judgeLookAlike).toHaveBeenCalledTimes(1);
    expect(d.schedule).toHaveBeenCalledWith("p1", "2026-11-21T01:12:00Z");
    expect(m.db.items[0].state).toBe("scheduled");
    expect(m.db.runs[0].finished_at).toBeTruthy();
    expect(await tick(d)).toEqual({ ran: false, why: "no-run" });
  });

  it("holds a post with fewer than 8 passed name cards, or one ready too late", async () => {
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }).map((c, i) => (i < 3 ? { ...c, check_state: "removed" as const } : c)) });
    await tick(d);
    expect(m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/^Only 7 name cards passed/) });
    const late = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true, scheduled_for: "2026-11-20T03:10:00Z" })], cards: tenCards({ check_state: "passed" }) });
    await tick(late.d);
    expect(late.m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/ready too late/) });
    expect(late.d.schedule).not.toHaveBeenCalled();
  });

  it("a Facebook key problem pauses the run; another Facebook error holds that post", async () => {
    const auth = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }) },
      { schedule: vi.fn(async () => ({ ok: false as const, error: "Facebook no longer accepts the app's key.", errorKind: "auth" as const })) });
    expect(await tick(auth.d)).toEqual({ ran: true, status: "paused" });
    const other = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }) },
      { schedule: vi.fn(async () => ({ ok: false as const, error: "Facebook refused: x", errorKind: "other" as const })) });
    await tick(other.d);
    expect(other.m.db.items[0]).toMatchObject({ state: "held", note: "Facebook refused: x" });
  });

  it("names: hold, retry (3 tries), no theme left", async () => {
    const hold = setup({ items: [item("i1")] }, { pickNames: vi.fn(async () => ({ kind: "hold" as const, why: "Only 5 good girl names", usage, added: [], skipped: [] })) });
    await tick(hold.d);
    expect(hold.m.db.items[0]).toMatchObject({ state: "held", note: "Only 5 good girl names" });
    const retry = setup({ items: [item("i1", { attempts: 2 })] }, { pickNames: vi.fn(async () => ({ kind: "retry" as const, error: "Claude timed out.", usage, added: [], skipped: [] })) });
    await tick(retry.d);
    expect(retry.m.db.items[0]).toMatchObject({ state: "held", note: "Couldn't pick names: Claude timed out." });
    const noTheme = setup({ items: [item("i1")], themesLeft: { girl: 0 } });
    await tick(noTheme.d);
    expect(noTheme.m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/No girl photoshoot theme/) });
    expect(noTheme.d.pickNames).not.toHaveBeenCalled();
  });

  it("at most two posts are being made at once", async () => {
    const { d } = setup({ items: [item("a", { state: "making", post_id: "pa" }), item("b", { state: "making", post_id: "pb" }), item("c")] });
    await tick(d);
    expect(d.pickNames).not.toHaveBeenCalled();
  });

  it("Stop wins: nothing is scheduled and the run stays stopped", async () => {
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }) });
    const realStatus = m.repo.runStatus;
    m.repo.runStatus = async (id) => { m.db.runs[0].status = "stopped"; return realStatus(id); };
    await tick(d);
    expect(d.schedule).not.toHaveBeenCalled();
    expect(m.db.runs[0].status).toBe("stopped");
    expect(m.db.runs[0].tick_until).toBeNull();
  });

  it("summary and cost", () => {
    const r = run({ input_tokens: 1_000_000, output_tokens: 100_000, events: [
      { at: "", kind: "name_added", text: "" }, { at: "", kind: "card_remade", text: "" }, { at: "", kind: "card_remade", text: "" }, { at: "", kind: "card_removed", text: "" },
    ] });
    expect(runCost(r)).toBeCloseTo(6);
    expect(summarize(r, [item("a", { state: "scheduled" }), item("b", { state: "held" })])).toEqual({ scheduled: 1, held: 1, namesAdded: 1, namesSkipped: 0, remade: 2, removed: 1, costUsd: 6 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-engine.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: `lib/autopilot/summary.ts`**

```ts
import type { AutopilotItemRow, AutopilotRunRow } from "@/lib/db/types";

/** Claude Opus 5.5 list prices (per million tokens): the checks' cost. */
export const OPUS_INPUT_PER_MTOK = 4;
export const OPUS_OUTPUT_PER_MTOK = 20;

export const runCost = (run: Pick<AutopilotRunRow, "input_tokens" | "output_tokens">) =>
  Math.round(((run.input_tokens * OPUS_INPUT_PER_MTOK + run.output_tokens * OPUS_OUTPUT_PER_MTOK) / 1e6) * 100) / 100;

export function summarize(run: AutopilotRunRow, items: AutopilotItemRow[]) {
  const count = (kind: string) => (run.events ?? []).filter((e) => e.kind === kind).length;
  return {
    scheduled: items.filter((i) => i.state === "scheduled").length,
    held: items.filter((i) => i.state === "held").length,
    namesAdded: count("name_added"), namesSkipped: count("name_skipped"),
    remade: count("card_remade"), removed: count("card_removed"),
    costUsd: runCost(run),
  };
}
```

- [ ] **Step 4: `lib/autopilot/engine.ts`**

```ts
// One Autopilot tick (spec "A tick"): bounded, under a lock, safe to repeat. 1) check the cards the PC finished,
// 2) finish posts whose cards all passed (look-alike, then schedule or hold), 3) plan the next post when there is room,
// 4) finish the run. Errors that need the owner (Claude credits or key, Facebook key) pause the run.
import type { ActionResult } from "@/lib/actions/result";
import type { AutopilotEvent, AutopilotEventKind, AutopilotItemRow, AutopilotRunRow, AutopilotRunStatus, CardRow } from "@/lib/db/types";
import type { CreatePostInput } from "@/lib/posts/create";
import type { PublishResult } from "@/lib/facebook/publish";
import { manilaLabel } from "@/lib/facebook/schedule";
import type { JudgeResult, Usage } from "./claude-judge";
import type { NamesOutcome } from "./names-step";
import type { AutopilotRepo } from "./repo";
import { PROBLEM_LABEL, type PhotoVerdict } from "./photo-problems";
import { MIN_GOOD_NAMES, dayLabel, labelText } from "./plan";
import { parseNameThemes } from "./name-themes";

export interface EngineDeps {
  repo: AutopilotRepo;
  pickNames: (item: AutopilotItemRow, hint: string | null) => Promise<NamesOutcome>;
  createPost: (input: CreatePostInput) => Promise<ActionResult<{ postId: string }>>;
  schedule: (postId: string, at: string) => Promise<PublishResult>;
  remake: (card: CardRow, extra: Partial<CardRow>) => Promise<boolean>;
  judgeCard: (card: CardRow, url: string) => Promise<JudgeResult<PhotoVerdict>>;
  judgeLookAlike: (cards: { card: CardRow; url: string }[]) => Promise<JudgeResult<number[]>>;
  now: () => number;
}

export const TICK_LOCK_MS = 5 * 60_000;
/** Work stops starting new steps after this (the route may run up to 300 s). */
export const TICK_BUDGET_MS = 240_000;
/** Picking names (Claude + AI suggestions) needs about this much time left. */
export const NAMING_NEEDS_MS = 150_000;
export const MAX_REMAKES = 2;
export const TOO_LATE_MS = 20 * 60_000;
/** A post not started this long before its time is held (it would not be ready in time). */
export const PLAN_TOO_LATE_MS = 45 * 60_000;
export const CHECKS_AT_ONCE = 6;
export const MAX_NAMING_ATTEMPTS = 3;
export const MAX_EVENTS = 300;
export const LOOKALIKE_MAX = 3;
export const WAIT_PC = "Waiting for your PC: turn it on. Autopilot carries on when it's back.";
export const WAIT_COMFY = "Waiting for ComfyUI: open ComfyUI Desktop on your PC.";
const COULD_NOT_CHECK = "Could not check";

export type TickOutcome = { ran: false; why: "no-run" | "busy" | "paused" } | { ran: true; status: AutopilotRunStatus };

/** A reason to pause the run (the owner must fix something). */
class Pause extends Error {}

const itemLabel = (i: AutopilotItemRow) => `${dayLabel(i.day)} · ${labelText(i)} · ${i.gender}`;
const cardName = (c: CardRow) => (c.kind === "cta" ? "the closing card" : c.name);

export async function tick(d: EngineDeps): Promise<TickOutcome> {
  const start = d.now();
  const run = await d.repo.activeRun();
  if (!run) return { ran: false, why: "no-run" };
  if (run.status === "paused") return { ran: false, why: "paused" };
  if (!(await d.repo.lockRun(run.id, new Date(start + TICK_LOCK_MS).toISOString(), new Date(start).toISOString()))) return { ran: false, why: "busy" };
  const t = new Tick(d, run, start);
  try {
    await t.run();
  } catch (e) {
    if (e instanceof Pause) {
      t.status = "paused";
      t.message = e.message;
    } else {
      console.error("autopilot tick", e);
      t.event("run", `Something went wrong: ${(e as Error)?.message ?? "unknown error"}. Autopilot tries again in a moment.`);
    }
  } finally {
    await t.save();
  }
  return { ran: true, status: t.status };
}

class Tick {
  status: AutopilotRunStatus;
  message: string | null;
  private events: AutopilotEvent[];
  private usage: Usage = { input: 0, output: 0 };
  private items: AutopilotItemRow[] = [];
  private cards: CardRow[] = [];
  private finished: string | null = null;

  constructor(private d: EngineDeps, private runRow: AutopilotRunRow, private start: number) {
    this.status = runRow.status;
    this.message = runRow.message;
    this.events = [...(runRow.events ?? [])];
  }

  event(kind: AutopilotEventKind, text: string) { this.events.push({ at: new Date(this.d.now()).toISOString(), kind, text }); }
  private addUsage(u: Usage) { this.usage.input += u.input; this.usage.output += u.output; }
  private left() { return TICK_BUDGET_MS - (this.d.now() - this.start); }
  private async setItem(item: AutopilotItemRow, patch: Partial<AutopilotItemRow>) { Object.assign(item, patch); await this.d.repo.updateItem(item.id, patch); }
  private async setCard(c: CardRow, patch: Partial<CardRow>) { Object.assign(c, patch); await this.d.repo.updateCard(c.id, patch); }
  private async hold(item: AutopilotItemRow, why: string) {
    await this.setItem(item, { state: "held", note: why.slice(0, 500) });
    this.event("post_held", `${itemLabel(item)}: held. ${why}`);
  }
  private itemOf(c: CardRow) { return this.items.find((i) => i.post_id === c.post_id)!; }
  private active() { return this.items.filter((i) => i.post_id && (i.state === "making" || i.state === "checking")); }
  private async stopped() {
    if ((await this.d.repo.runStatus(this.runRow.id)) !== "stopped") return false;
    this.status = "stopped";
    return true;
  }

  async run() {
    this.items = await this.d.repo.items(this.runRow.id);
    const health = await this.d.repo.pcHealth(this.start);
    this.status = health === "ready" ? "running" : "waiting";
    this.message = health === "ready" ? null : health === "comfy-off" ? WAIT_COMFY : WAIT_PC;
    await this.checkCards();
    await this.finishPosts();
    if (this.status === "running") await this.planNext();
    if (this.status !== "stopped" && this.items.length && this.items.every((i) => i.state === "scheduled" || i.state === "held")) {
      this.status = "done";
      this.message = null;
      this.finished = new Date(this.d.now()).toISOString();
      this.event("run", `Finished: ${this.items.filter((i) => i.state === "scheduled").length} of ${this.items.length} posts scheduled.`);
    }
  }

  async save() {
    await this.d.repo.finishTick(this.runRow.id, {
      status: this.status, message: this.message, events: this.events.slice(-MAX_EVENTS),
      input_tokens: this.runRow.input_tokens + this.usage.input, output_tokens: this.runRow.output_tokens + this.usage.output,
      ...(this.finished ? { finished_at: this.finished } : {}),
    });
  }

  // 1. Cards
  private async checkCards() {
    const items = this.active();
    if (!items.length) return;
    this.cards = await this.d.repo.cards(items.map((i) => i.post_id!));
    for (const c of this.cards.filter((x) => x.check_state === "pending" && x.status === "failed")) await this.failCard(c, "the PC could not make it");
    const ready = this.cards.filter((c) => c.check_state === "pending" && c.status === "done" && c.card_path);
    for (let i = 0; i < ready.length && this.left() > 60_000; i += CHECKS_AT_ONCE) {
      const batch = ready.slice(i, i + CHECKS_AT_ONCE);
      const urls = await this.d.repo.signedUrls(batch.map((c) => c.card_path!));
      const results = await Promise.all(batch.map((c, k) => this.d.judgeCard(c, urls[k])));
      for (const [k, r] of results.entries()) {
        const c = batch[k];
        this.addUsage(r.usage);
        if (!r.ok) {
          if (r.stop) throw new Pause(`${r.error} Fix it, then press Resume.`);
          await this.couldNotCheck(c, r.error);
        } else if (r.data.pass) {
          const note = (c.remakes ?? 0) && c.check_note?.startsWith("Remade:") ? c.check_note : "Checked";
          await this.setCard(c, { check_state: "passed", check_note: note });
        } else {
          await this.failCard(c, r.data.problems.map((p) => PROBLEM_LABEL[p]).join(", "));
        }
      }
    }
  }

  private async failCard(c: CardRow, why: string) {
    const item = this.itemOf(c);
    const remakes = c.remakes ?? 0;
    if (remakes < MAX_REMAKES) {
      const extra = { check_state: "pending" as const, check_note: `Remade: ${why}`.slice(0, 300), remakes: remakes + 1 };
      if (await this.d.remake(c, extra)) {
        Object.assign(c, extra, { status: "queued" });
        this.event("card_remade", `${itemLabel(item)}: ${cardName(c)} remade (${why}).`);
      }
      return;
    }
    await this.setCard(c, { check_state: "removed", check_note: `Removed: ${why}`.slice(0, 300), selected: false });
    this.event("card_removed", `${itemLabel(item)}: ${cardName(c)} removed after ${MAX_REMAKES} remakes (${why}).`);
  }

  private async couldNotCheck(c: CardRow, error: string) {
    if (c.check_note?.startsWith(COULD_NOT_CHECK)) {
      await this.setCard(c, { check_state: "failed", check_note: `${COULD_NOT_CHECK} twice: ${error}`.slice(0, 300) });
      return;
    }
    const extra = { check_state: "pending" as const, check_note: `${COULD_NOT_CHECK}: ${error}`.slice(0, 300), remakes: (c.remakes ?? 0) + 1 };
    if (await this.d.remake(c, extra)) Object.assign(c, extra, { status: "queued" });
  }

  // 2. Posts
  private async finishPosts() {
    for (const item of this.active()) {
      const cs = this.cards.filter((c) => c.post_id === item.post_id);
      if (!cs.length) continue;
      const open = cs.filter((c) => c.check_state === "pending");
      if (open.length) {
        const state = open.every((c) => c.status === "done") ? "checking" : "making";
        if (item.state !== state) await this.setItem(item, { state });
        continue;
      }
      if (cs.some((c) => c.check_state === "failed")) {
        await this.hold(item, "A card could not be checked. Look at the post, then schedule it yourself.");
        continue;
      }
      const passed = cs.filter((c) => c.check_state === "passed");
      const names = passed.filter((c) => c.kind === "post").length;
      if (names < MIN_GOOD_NAMES) {
        await this.hold(item, `Only ${names} name cards passed the checks (${MIN_GOOD_NAMES} needed). Remake or add cards, then schedule it yourself.`);
        continue;
      }
      if (!item.lookalike_done) {
        if (this.left() < 60_000) continue;
        const remade = await this.lookAlike(item, passed);
        await this.setItem(item, { lookalike_done: true, ...(remade ? { state: "making" as const } : {}) });
        if (remade) continue;
      }
      if (Date.parse(item.scheduled_for) - this.d.now() < TOO_LATE_MS) {
        await this.hold(item, `It was ready too late for ${manilaLabel(item.scheduled_for)}. Schedule or post it yourself.`);
        continue;
      }
      if (await this.stopped()) return;
      const r = await this.d.schedule(item.post_id!, item.scheduled_for);
      if (r.ok) {
        await this.setItem(item, { state: "scheduled", note: null });
        this.event("post_scheduled", `${itemLabel(item)}: scheduled for ${manilaLabel(item.scheduled_for)}.`);
      } else if (r.errorKind === "auth" || r.errorKind === "not_connected") {
        throw new Pause(`${r.error} Then press Resume.`);
      } else {
        await this.hold(item, r.error);
      }
    }
  }

  private async lookAlike(item: AutopilotItemRow, passed: CardRow[]): Promise<boolean> {
    const urls = await this.d.repo.signedUrls(passed.map((c) => c.card_path!));
    const r = await this.d.judgeLookAlike(passed.map((card, k) => ({ card, url: urls[k] })));
    this.addUsage(r.usage);
    if (!r.ok) {
      if (r.stop) throw new Pause(`${r.error} Fix it, then press Resume.`);
      this.event("run", `${itemLabel(item)}: the look-alike check was skipped (${r.error}).`);
      return false;
    }
    let remade = false;
    for (const n of r.data.slice(0, LOOKALIKE_MAX)) {
      const c = passed[n - 1];
      if (!c) continue;
      const extra = { check_state: "pending" as const, check_note: "Remade: looked like another card", remakes: (c.remakes ?? 0) + 1 };
      if (await this.d.remake(c, extra)) {
        Object.assign(c, extra, { status: "queued" });
        remade = true;
        this.event("card_remade", `${itemLabel(item)}: ${cardName(c)} remade (looked like another card).`);
      }
    }
    return remade;
  }

  // 3. The next post
  private async planNext() {
    if (this.left() < NAMING_NEEDS_MS) return;
    if (this.items.filter((i) => i.state === "making" || i.state === "checking").length > 1) return;
    const next = this.items.filter((i) => i.state === "planned" || i.state === "naming").sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))[0];
    if (!next) return;
    if (Date.parse(next.scheduled_for) - this.d.now() < PLAN_TOO_LATE_MS) {
      await this.hold(next, `There was not enough time to make it before ${manilaLabel(next.scheduled_for)}. Make it on Today if you still want it.`);
      return;
    }
    if (await this.stopped()) return;
    if ((await this.d.repo.themesLeft(next.gender)) < 1) {
      await this.hold(next, `No ${next.gender} photoshoot theme is left. Add ${next.gender} themes on the Themes page, then make this post on Today.`);
      return;
    }
    await this.setItem(next, { state: "naming", attempts: next.attempts + 1 });
    const settings = await this.d.repo.settings();
    const hint = next.name_theme
      ? parseNameThemes(settings.autopilot_name_themes).find((t) => t.title.toLowerCase() === next.name_theme!.toLowerCase())?.hint ?? null
      : null;
    const names = await this.d.pickNames(next, hint);
    this.addUsage(names.usage);
    for (const n of names.added) this.event("name_added", `${n} added (${itemLabel(next)}).`);
    for (const s of names.skipped) this.event("name_skipped", `${s.name} skipped: ${s.why}.`);
    if (names.kind === "stop") throw new Pause(`${names.error} Fix it, then press Resume.`);
    if (names.kind === "hold") { await this.hold(next, names.why); return; }
    if (names.kind === "retry") {
      if (next.attempts >= MAX_NAMING_ATTEMPTS) await this.hold(next, `Couldn't pick names: ${names.error}`);
      else await this.setItem(next, { state: "planned", note: `Trying again: ${names.error}` });
      return;
    }
    const created = await this.d.createPost({
      gender: next.gender, style: "single", count: null, postDate: next.day, requestId: next.id, subjectAge: "random",
      ...(next.letter ? { letter: next.letter } : {}), nameIds: names.nameIds,
      nameTheme: next.name_theme ? { title: next.name_theme, hint } : null,
    });
    if (!created.ok) {
      if (next.attempts >= MAX_NAMING_ATTEMPTS) await this.hold(next, `Couldn't make the post: ${created.error}`);
      else await this.setItem(next, { state: "planned", note: `Trying again: ${created.error}` });
      return;
    }
    await this.d.repo.markCardsPending(created.postId);
    await this.setItem(next, { state: "making", post_id: created.postId, note: null });
  }
}
```

Note on the request id: `create_post` returns the existing post for a request id it has seen, so a tick that died after creating the post finds the same post next time (the item id is a UUID, which `validateCreatePost` requires).

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/autopilot-engine.test.ts`
Expected: PASS. If a test fails, fix the engine, not the test, unless the test contradicts the spec.

- [ ] **Step 6: Commit**

```bash
git add lib/autopilot/engine.ts lib/autopilot/summary.ts tests/autopilot-engine.test.ts
git commit -m "feat(autopilot): the tick engine - check cards, remake, look-alike, schedule, hold, plan the next post" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The tick route

**Files:**
- Create: `lib/autopilot/key.ts`, `lib/autopilot/wiring.ts`, `app/api/autopilot/tick/route.ts`
- Modify: `lib/supabase/proxy.ts` (`PUBLIC_EXACT`)
- Test: `tests/autopilot-route.test.ts`

**Interfaces:**
- Consumes: `tick`, `EngineDeps` (Task 7), `supabaseRepo` (Task 6), `pickNames` (Task 6), `judgeNames`, `judgeCard`, `judgeLookAlike` (Task 5), `createPostCore` (Task 4), `publishPost` (Task 4), `remakeCard` (Task 4), `createAdminClient` (Task 4), `suggestForLetter`, `suggestNames` (`lib/ai/suggest.ts`), `filterNameSuggestions`, `NAME_COUNT`, `VIBE_MAX` (`lib/ai/suggest-filter.ts`).
- Produces: `AUTOPILOT_SECRET_MIN = 32`, `keyOk(given: string | null | undefined, secret: string | undefined): boolean`, `autopilotDeps(sb: SupabaseClient): EngineDeps`, `POST /api/autopilot/tick` → `{ ok: true, ran, why?, status? }` | 401 / 503 `{ ok: false, error }`.

- [ ] **Step 1: Write the failing test** — `tests/autopilot-route.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const tick = vi.hoisted(() => vi.fn(async () => ({ ran: true, status: "running" })));
const admin = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock("@/lib/autopilot/engine", () => ({ tick }));
vi.mock("@/lib/autopilot/wiring", () => ({ autopilotDeps: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
const { POST } = await import("@/app/api/autopilot/tick/route");
const { keyOk } = await import("@/lib/autopilot/key");
const { isPublicPath } = await import("@/lib/supabase/proxy");

const SECRET = "s".repeat(40);
const req = (key?: string) => new Request("https://site/api/autopilot/tick", { method: "POST", headers: key ? { "x-autopilot-key": key } : {} });

beforeEach(() => { tick.mockClear(); process.env.AUTOPILOT_SECRET = SECRET; admin.client = {}; });

describe("the tick route", () => {
  it("is reachable without a login (it checks its own key)", () => {
    expect(isPublicPath("/api/autopilot/tick")).toBe(true);
  });
  it("needs the secret, at least 32 characters, compared in constant time", () => {
    expect(keyOk(SECRET, SECRET)).toBe(true);
    expect(keyOk("wrong", SECRET)).toBe(false);
    expect(keyOk(null, SECRET)).toBe(false);
    expect(keyOk("short", "short")).toBe(false);
  });
  it("401 with a wrong key, 503 when the keys are not set, else one tick", async () => {
    expect((await POST(req("nope"))).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
    delete process.env.AUTOPILOT_SECRET;
    expect((await POST(req(SECRET))).status).toBe(503);
    process.env.AUTOPILOT_SECRET = SECRET;
    admin.client = null;
    expect((await POST(req(SECRET))).status).toBe(503);
    admin.client = {};
    const ok = await POST(req(SECRET));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ran: true, status: "running" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-route.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: `lib/autopilot/key.ts`**

```ts
import { timingSafeEqual } from "node:crypto";

export const AUTOPILOT_SECRET_MIN = 32;

/** The worker's key matches AUTOPILOT_SECRET (32+ characters), compared in constant time. */
export function keyOk(given: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < AUTOPILOT_SECRET_MIN || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: `lib/autopilot/wiring.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostCore } from "@/lib/posts/create";
import { publishPost } from "@/lib/facebook/publish";
import { remakeCard } from "@/lib/cards/remake";
import { suggestForLetter, suggestNames } from "@/lib/ai/suggest";
import { NAME_COUNT, VIBE_MAX, filterNameSuggestions } from "@/lib/ai/suggest-filter";
import type { EngineDeps } from "./engine";
import { judgeNames } from "./judge-names";
import { judgeCard, judgeLookAlike } from "./judge-photos";
import { pickNames, type NamesDeps } from "./names-step";
import { supabaseRepo } from "./repo";

/** AI name ideas for a post: the By letter suggestions, or the name suggestions with the theme as the wish. */
const suggest: NamesDeps["suggest"] = async (i) => {
  if (i.target.kind === "letter") {
    const r = await suggestForLetter({ gender: i.gender, style: "single", letter: i.target.letter, count: i.want, existing: i.existing, allNames: i.allNames });
    return r.ok ? { ok: true, names: r.result.fresh.map((n) => ({ name: n.name, meaning: n.meaning })) } : { ok: false, error: r.error };
  }
  const vibe = `${i.target.title} baby names${i.target.hint ? ` (${i.target.hint})` : ""}`.slice(0, VIBE_MAX);
  const r = await suggestNames({ gender: i.gender, style: "single", count: Math.min(Math.max(i.want, NAME_COUNT.min), NAME_COUNT.max), vibe, existing: i.existing });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, names: filterNameSuggestions(r.data, i.allNames, "single").fresh.map((n) => ({ name: n.name, meaning: n.meaning })) };
};

/** The engine's real dependencies, on the service-role client. */
export function autopilotDeps(sb: SupabaseClient): EngineDeps {
  const repo = supabaseRepo(sb);
  return {
    repo,
    pickNames: (item, hint) => pickNames({ repo, judge: judgeNames, suggest, rng: Math.random }, item, hint),
    createPost: (input) => createPostCore(sb, input),
    schedule: async (postId, at) => {
      const { data } = await sb.from("posts").select("caption").eq("id", postId).maybeSingle();
      return publishPost(sb, postId, { caption: (data as { caption?: string } | null)?.caption ?? "", scheduledAt: at });
    },
    remake: (card, extra) => remakeCard(sb, card, extra),
    judgeCard: (card, url) => judgeCard(card, url),
    judgeLookAlike: (cards) => judgeLookAlike(cards),
    now: Date.now,
  };
}
```

- [ ] **Step 5: `app/api/autopilot/tick/route.ts`**

Check `node_modules/next/dist/docs/` for the route-handler page of this Next.js version before writing (exports allowed in a route file, `maxDuration`). Only HTTP methods and route config may be exported from this file.

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autopilotDeps } from "@/lib/autopilot/wiring";
import { tick } from "@/lib/autopilot/engine";
import { AUTOPILOT_SECRET_MIN, keyOk } from "@/lib/autopilot/key";

// The PC worker knocks here about every 30 s while an Autopilot run is active (worker 2.9.0). One bounded step.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.AUTOPILOT_SECRET?.trim();
  if (!secret || secret.length < AUTOPILOT_SECRET_MIN) {
    return NextResponse.json({ ok: false, error: `Set AUTOPILOT_SECRET (${AUTOPILOT_SECRET_MIN}+ characters) in Vercel.` }, { status: 503 });
  }
  if (!keyOk(req.headers.get("x-autopilot-key"), secret)) return NextResponse.json({ ok: false, error: "Wrong key." }, { status: 401 });
  const sb = createAdminClient();
  if (!sb) return NextResponse.json({ ok: false, error: "Set SUPABASE_SERVICE_ROLE_KEY in Vercel." }, { status: 503 });
  return NextResponse.json({ ok: true, ...(await tick(autopilotDeps(sb))) });
}
```

- [ ] **Step 6: The route is public** — `lib/supabase/proxy.ts`

Add `"/api/autopilot/tick"` to `PUBLIC_EXACT`, and to the comment above it: "the Autopilot tick (the PC worker; the route checks AUTOPILOT_SECRET)".

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/autopilot-route.test.ts tests/proxy*.test.ts`
Expected: PASS. (If a proxy test lists the public paths exactly, add the new one there.)

- [ ] **Step 8: Commit**

```bash
git add lib/autopilot/key.ts lib/autopilot/wiring.ts app/api/autopilot/tick/route.ts lib/supabase/proxy.ts tests/autopilot-route.test.ts
git commit -m "feat(autopilot): the tick route, guarded by AUTOPILOT_SECRET" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Owner actions and page data

**Files:**
- Create: `lib/autopilot/prepare.ts`, `lib/actions/autopilot.ts`, `lib/data/autopilot.ts`
- Test: `tests/autopilot-actions.test.ts`

**Interfaces:**
- Consumes: `firstDay`, `lastFacebook`, `planRun`, `planProblems`, `dayLabel`, `labelText`, `MAX_DAYS`, `PlannedItem` (Task 3), `parseNameThemes`, `nameThemesProblem` (Task 2), `facebookConfig` (`lib/facebook/graph.ts`), `AUTOPILOT_SECRET_MIN` (Task 8).
- Produces:
  - `interface RunPreview { range: string; posts: number; days: { day: string; dayLabel: string; label: string }[]; problems: string[] }`
  - `preparePlan(sb: SupabaseClient, days: number, rng: () => number, now: number): Promise<{ ok: true; first: string; items: PlannedItem[]; preview: RunPreview } | { ok: false; error: string }>`
  - `NEEDS_022` message
  - actions: `previewAutopilotAction(days: number): Promise<ActionResult<{ preview: RunPreview }>>`, `startAutopilotAction(days: number): Promise<ActionResult<{ runId: string }>>`, `stopAutopilotAction(runId: string): Promise<ActionResult>`, `resumeAutopilotAction(runId: string): Promise<ActionResult>`, `saveNameThemesAction(text: string): Promise<ActionResult>`
  - `interface CardStats { total: number; passed: number; remade: number; removed: number }`, `getAutopilotData(): Promise<{ needs022: boolean; run: AutopilotRunRow | null; items: AutopilotItemRow[]; stats: Record<string, CardStats>; nameThemes: string }>`

- [ ] **Step 1: Write the failing test** — `tests/autopilot-actions.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { previewAutopilotAction, startAutopilotAction, stopAutopilotAction, resumeAutopilotAction, saveNameThemesAction } = await import("@/lib/actions/autopilot");

const RUN = "55555555-5555-4555-8555-555555555555";
const settings = { id: 1, min_images: 6, max_images: 26, autopilot_name_themes: "Biblical\nSoft and cool" };
const posts = [{ fb_state: "scheduled", fb_scheduled_for: "2026-11-19T05:29:00Z", posted_at: "2026-11-19T05:29:00Z", letter: "R", name_theme: null }];
const themes = [...Array(7).fill({ gender: "boy" }), ...Array(3).fill({ gender: "girl" })];
let insertErr: { message: string; code?: string } | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-20T03:00:00Z"), toFake: ["Date"] });
  Object.assign(process.env, { FACEBOOK_PAGE_ID: "1", FACEBOOK_PAGE_TOKEN: "t", FACEBOOK_APP_SECRET: "s", ANTHROPIC_API_KEY: "k", AUTOPILOT_SECRET: "x".repeat(40), SUPABASE_SERVICE_ROLE_KEY: "srk" });
  insertErr = null;
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return { data: [{ id: 1 }] };
    if (q.table === "settings") return { data: settings };
    if (q.table === "posts") return { data: posts };
    if (q.table === "themes") return { data: themes };
    if (q.table === "autopilot_runs" && op(q, "insert")) return insertErr ? { error: insertErr } : { data: { id: RUN } };
    if (q.table === "autopilot_runs" && isUpdate(q)) return { data: [{ id: RUN }] };
    if (q.table === "autopilot_items" && op(q, "insert")) return { data: null };
    return undefined;
  };
});

describe("Autopilot actions", () => {
  it("previews the next days from the last Facebook post, and warns about themes", async () => {
    const r = await previewAutopilotAction(7);
    expect(r.ok && r.preview).toMatchObject({ range: "Sat, Nov 21 – Fri, Nov 27", posts: 14 });
    expect(r.ok && r.preview.days.map((d) => d.label)).toEqual(["Letter S", "Letter T", "Letter U", "Letter V", "Letter W", "Letter X", "Letter Y"]);
    expect(r.ok && r.preview.problems).toEqual(["Only 3 girl photoshoot themes are left: the girl posts from Tue, Nov 24 will be held. Add girl themes first."]);
    expect(await previewAutopilotAction(8)).toEqual({ ok: false, error: "Pick 1 to 7 days." });
  });

  it("starts a run with its planned posts", async () => {
    expect(await startAutopilotAction(2)).toEqual({ ok: true, runId: RUN });
    const run = op(fake.queries.find((q) => q.table === "autopilot_runs" && op(q, "insert"))!, "insert")![1] as Record<string, unknown>;
    expect(run).toMatchObject({ days: 2, first_day: "2026-11-21" });
    const items = op(fake.queries.find((q) => q.table === "autopilot_items" && op(q, "insert"))!, "insert")![1] as Record<string, unknown>[];
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ run_id: RUN, day: "2026-11-21", slot: "morning", letter: "S", name_theme: null });
  });

  it("explains what is missing before starting", async () => {
    delete process.env.FACEBOOK_PAGE_TOKEN;
    expect(await startAutopilotAction(7)).toMatchObject({ ok: false, error: expect.stringMatching(/Connect Facebook first/) });
    process.env.FACEBOOK_PAGE_TOKEN = "t";
    delete process.env.AUTOPILOT_SECRET;
    expect(await startAutopilotAction(7)).toMatchObject({ ok: false, error: expect.stringMatching(/AUTOPILOT_SECRET/) });
    process.env.AUTOPILOT_SECRET = "x".repeat(40);
    insertErr = { message: "duplicate key value violates unique constraint \"autopilot_runs_one_active\"", code: "23505" };
    expect(await startAutopilotAction(7)).toEqual({ ok: false, error: "Autopilot is already running. Stop it first." });
  });

  it("stop, resume and the name-theme list", async () => {
    expect(await stopAutopilotAction(RUN)).toEqual({ ok: true });
    expect(op(fake.queries.filter((q) => q.table === "autopilot_runs" && isUpdate(q)).at(-1)!, "update")![1]).toMatchObject({ status: "stopped", message: null });
    expect(await resumeAutopilotAction(RUN)).toEqual({ ok: true });
    expect(await saveNameThemesAction("")).toEqual({ ok: false, error: "Add at least one name theme." });
    expect(await saveNameThemesAction("  Biblical \n\n Soft and cool ")).toEqual({ ok: true });
    expect(op(fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).at(-1)!, "update")![1]).toEqual({ autopilot_name_themes: "Biblical\nSoft and cool" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: `lib/autopilot/prepare.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gender, PostRow, SettingsRow } from "@/lib/db/types";
import { dayLabel, firstDay, labelText, lastFacebook, planProblems, planRun, type PlannedItem } from "./plan";
import { parseNameThemes } from "./name-themes";

export const NEEDS_022 = "Autopilot needs a database update first: run supabase/migrations/022_autopilot.sql in Supabase.";
const missing022 = (e: { message: string; code?: string }) => e.code === "PGRST204" || e.code === "42703" || e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message);

export interface RunPreview { range: string; posts: number; days: { day: string; dayLabel: string; label: string }[]; problems: string[] }

/** The plan for a run of `days` from today's database (preview and start use the same reading). */
export async function preparePlan(sb: SupabaseClient, days: number, rng: () => number, now: number):
  Promise<{ ok: true; first: string; items: PlannedItem[]; preview: RunPreview } | { ok: false; error: string }> {
  const [posts, settings, themes] = await Promise.all([
    sb.from("posts").select("fb_state, fb_scheduled_for, posted_at, letter, name_theme").in("fb_state", ["scheduled", "published"])
      .order("posted_at", { ascending: false }).limit(60),
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("themes").select("gender").eq("status", "available"),
  ]);
  const err = posts.error ?? settings.error ?? themes.error;
  if (err) return { ok: false, error: missing022(err) ? NEEDS_022 : err.message };
  const s = settings.data as SettingsRow;
  if (s.autopilot_name_themes === undefined) return { ok: false, error: NEEDS_022 };
  const last = lastFacebook((posts.data ?? []) as Pick<PostRow, "fb_state" | "fb_scheduled_for" | "posted_at" | "letter" | "name_theme">[]);
  const first = firstDay(last.at, now);
  const items = planRun({ firstDay: first, days, last: last.label, themes: parseNameThemes(s.autopilot_name_themes).map((t) => t.title),
    minImages: s.min_images, maxImages: s.max_images, rng });
  const left: Record<Gender, number> = { boy: 0, girl: 0 };
  for (const t of (themes.data ?? []) as { gender: Gender }[]) left[t.gender]++;
  const dayList = [...new Set(items.map((i) => i.day))].map((day) => ({ day, dayLabel: dayLabel(day), label: labelText(items.find((i) => i.day === day)!) }));
  const preview: RunPreview = {
    range: dayList.length > 1 ? `${dayList[0].dayLabel} – ${dayList.at(-1)!.dayLabel}` : dayList[0]?.dayLabel ?? "",
    posts: items.length, days: dayList, problems: planProblems(items, left),
  };
  return { ok: true, first, items, preview };
}
```

- [ ] **Step 4: `lib/actions/autopilot.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { facebookConfig } from "@/lib/facebook/graph";
import { MAX_DAYS } from "@/lib/autopilot/plan";
import { nameThemesProblem } from "@/lib/autopilot/name-themes";
import { AUTOPILOT_SECRET_MIN } from "@/lib/autopilot/key";
import { NEEDS_022, preparePlan, type RunPreview } from "@/lib/autopilot/prepare";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

export type { RunPreview } from "@/lib/autopilot/prepare";

const badDays = (days: number) => !Number.isInteger(days) || days < 1 || days > MAX_DAYS;
const DAYS = `Pick 1 to ${MAX_DAYS} days.`;

/** What a run would make (no writes). */
export async function previewAutopilotAction(days: number): Promise<ActionResult<{ preview: RunPreview }>> {
  await requireOwner();
  if (badDays(days)) return fail(DAYS);
  const plan = await preparePlan(await createClient(), days, Math.random, Date.now());
  return plan.ok ? { ok: true, preview: plan.preview } : fail(plan.error);
}

/** What Autopilot needs before it can run, in plain words; null when all set. */
function missingSetup(): string | null {
  if (!facebookConfig()) return "Connect Facebook first: add FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN and FACEBOOK_APP_SECRET in Vercel (see docs/SETUP.md).";
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return "Autopilot's checks need ANTHROPIC_API_KEY in Vercel (see docs/SETUP.md, Autopilot).";
  if ((process.env.AUTOPILOT_SECRET?.trim().length ?? 0) < AUTOPILOT_SECRET_MIN || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return "Autopilot needs AUTOPILOT_SECRET and SUPABASE_SERVICE_ROLE_KEY in Vercel, and the same secret on your PC (see docs/SETUP.md, Autopilot).";
  }
  return null;
}

export async function startAutopilotAction(days: number): Promise<ActionResult<{ runId: string }>> {
  await requireOwner();
  if (badDays(days)) return fail(DAYS);
  const setup = missingSetup();
  if (setup) return fail(setup);
  const sb = await createClient();
  const plan = await preparePlan(sb, days, Math.random, Date.now());
  if (!plan.ok) return fail(plan.error);
  const { data: run, error } = await sb.from("autopilot_runs").insert({
    days, first_day: plan.first,
    events: [{ at: new Date().toISOString(), kind: "run", text: `Started: ${plan.preview.posts} posts, ${plan.preview.range}.` }],
  }).select("id").single();
  if (error) return fail(error.code === "23505" ? "Autopilot is already running. Stop it first." : /autopilot_runs/.test(error.message) ? NEEDS_022 : error.message);
  const runId = (run as { id: string }).id;
  const { error: itemsErr } = await sb.from("autopilot_items").insert(plan.items.map((i) => ({
    run_id: runId, day: i.day, slot: i.slot, gender: i.gender, scheduled_for: i.scheduledFor, letter: i.letter, name_theme: i.nameTheme, name_count: i.nameCount,
  })));
  if (itemsErr) {
    await sb.from("autopilot_runs").delete().eq("id", runId);
    return fail(`Could not save the plan: ${itemsErr.message}`);
  }
  revalidatePath("/autopilot");
  return { ok: true, runId };
}

/** Stop at once: nothing new is made or scheduled; scheduled posts stay. */
export async function stopAutopilotAction(runId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(runId ?? "")) return fail("Run not found.");
  const sb = await createClient();
  const { error } = await sb.from("autopilot_runs").update({ status: "stopped", message: null, finished_at: new Date().toISOString() })
    .eq("id", runId).in("status", ["running", "waiting", "paused"]).select("id");
  if (error) return fail(error.message);
  revalidatePath("/autopilot");
  return { ok: true };
}

/** After the owner fixed what paused the run (credits, a key). */
export async function resumeAutopilotAction(runId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(runId ?? "")) return fail("Run not found.");
  const sb = await createClient();
  const { error } = await sb.from("autopilot_runs").update({ status: "running", message: null }).eq("id", runId).eq("status", "paused").select("id");
  if (error) return fail(error.message);
  revalidatePath("/autopilot");
  return { ok: true };
}

export async function saveNameThemesAction(text: string): Promise<ActionResult> {
  await requireOwner();
  const raw = String(text ?? "");
  const problem = nameThemesProblem(raw);
  if (problem) return fail(problem);
  const clean = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const sb = await createClient();
  const { error } = await sb.from("settings").update({ autopilot_name_themes: clean }).eq("id", 1).select("id");
  if (error) return fail(/autopilot_name_themes/.test(error.message) ? NEEDS_022 : error.message);
  revalidatePath("/autopilot");
  return { ok: true };
}
```

- [ ] **Step 5: `lib/data/autopilot.ts`**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AutopilotItemRow, AutopilotRunRow, CardCheckState, SettingsRow } from "@/lib/db/types";
import { DEFAULT_NAME_THEMES } from "@/lib/autopilot/name-themes";

export interface CardStats { total: number; passed: number; remade: number; removed: number }

/** The Autopilot page: the latest run, its planned posts, card counts per post, the name-theme list. */
export async function getAutopilotData(): Promise<{ needs022: boolean; run: AutopilotRunRow | null; items: AutopilotItemRow[]; stats: Record<string, CardStats>; nameThemes: string }> {
  const sb = await createClient();
  const [{ data: runs, error }, { data: settings }] = await Promise.all([
    sb.from("autopilot_runs").select("*").order("created_at", { ascending: false }).limit(1),
    sb.from("settings").select("*").eq("id", 1).single(),
  ]);
  const nameThemes = (settings as SettingsRow | null)?.autopilot_name_themes ?? DEFAULT_NAME_THEMES.join("\n");
  if (error) return { needs022: true, run: null, items: [], stats: {}, nameThemes };
  const run = ((runs ?? []) as AutopilotRunRow[])[0] ?? null;
  if (!run) return { needs022: false, run, items: [], stats: {}, nameThemes };
  const { data: itemRows } = await sb.from("autopilot_items").select("*").eq("run_id", run.id).order("scheduled_for");
  const items = (itemRows ?? []) as AutopilotItemRow[];
  const postIds = items.flatMap((i) => (i.post_id ? [i.post_id] : []));
  const stats: Record<string, CardStats> = {};
  if (postIds.length) {
    const { data: cards } = await sb.from("cards").select("post_id, check_state, remakes").in("post_id", postIds);
    for (const c of (cards ?? []) as { post_id: string; check_state: CardCheckState | null; remakes: number }[]) {
      const s = (stats[c.post_id] ??= { total: 0, passed: 0, remade: 0, removed: 0 });
      s.total++;
      if (c.check_state === "passed") s.passed++;
      if (c.check_state === "removed") s.removed++;
      if (c.remakes > 0) s.remade++;
    }
  }
  return { needs022: false, run, items, stats, nameThemes };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/autopilot-actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/autopilot/prepare.ts lib/actions/autopilot.ts lib/data/autopilot.ts tests/autopilot-actions.test.ts
git commit -m "feat(autopilot): preview, start, stop, resume and the name-theme list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The Autopilot page, the link and the card chip

**Files:**
- Create: `app/(app)/autopilot/page.tsx`, `components/autopilot/autopilot-panel.tsx`, `components/autopilot/name-themes-editor.tsx`, `lib/status/card-check.ts`
- Modify: `components/shell/nav.tsx`, `app/(app)/settings/page.tsx` (~line 42), `components/cards/card-tile.tsx`
- Test: `tests/autopilot-page.test.tsx`

**Interfaces:**
- Consumes: Task 9 actions and `CardStats`, `summarize`/`runCost` (Task 7), `dayLabel`, `labelText` (Task 3), `nameThemesProblem` (Task 2), UI: `Button` (`variant`, `size`, `loading`), `Dialog` (`open`, `onOpenChange`, `title`, `description`), `Panel` (`title`, `action`), `Badge` (`tone`: ok/warn/bad/muted/accent), `PageHeader`, `callAction` (`lib/actions/call.ts`), `toast` (`sonner`).
- Produces: `AutopilotPanel({ run, items, stats })`, `NameThemesEditor({ text })`, `checkChip(card: Pick<CardRow, "check_state" | "check_note">): { text: string; tone: "ok" | "bad" } | null`.

- [ ] **Step 1: Write the failing test** — `tests/autopilot-page.test.tsx`

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AutopilotItemRow, AutopilotRunRow } from "@/lib/db/types";

const { toast, actions, refresh } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  actions: {
    previewAutopilotAction: vi.fn(async () => ({ ok: true, preview: { range: "Sat, Nov 21 – Fri, Nov 27", posts: 14, days: [{ day: "2026-11-21", dayLabel: "Sat, Nov 21", label: "Letter S" }], problems: ["Only 3 girl photoshoot themes are left."] } })),
    startAutopilotAction: vi.fn(async () => ({ ok: true, runId: "r" })),
    stopAutopilotAction: vi.fn(async () => ({ ok: true })),
    resumeAutopilotAction: vi.fn(async () => ({ ok: true })),
    saveNameThemesAction: vi.fn(async () => ({ ok: true })),
  },
  refresh: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/actions/autopilot", () => actions);
const { AutopilotPanel } = await import("@/components/autopilot/autopilot-panel");
const { NameThemesEditor } = await import("@/components/autopilot/name-themes-editor");
const { checkChip } = await import("@/lib/status/card-check");

const run = (o: Partial<AutopilotRunRow> = {}): AutopilotRunRow => ({ id: "r", status: "running", days: 1, first_day: "2026-11-21", message: null, events: [],
  input_tokens: 0, output_tokens: 0, tick_until: null, created_at: "", finished_at: null, updated_at: "", ...o });
const item = (o: Partial<AutopilotItemRow>): AutopilotItemRow => ({ id: "i", run_id: "r", day: "2026-11-21", slot: "morning", gender: "girl", scheduled_for: "2026-11-21T00:47:00Z",
  letter: "S", name_theme: null, name_count: 10, post_id: null, state: "planned", lookalike_done: false, attempts: 0, note: null, created_at: "", updated_at: "", ...o });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Autopilot page", () => {
  it("without a run: shows the plan and its warnings, and starts", async () => {
    await act(async () => { render(<AutopilotPanel run={null} items={[]} stats={{}} />); });
    expect(screen.getByText(/Sat, Nov 21 – Fri, Nov 27/)).toBeTruthy();
    expect(screen.getByText(/Only 3 girl photoshoot themes/)).toBeTruthy();
    expect(actions.previewAutopilotAction).toHaveBeenCalledWith(7);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start/ })); });
    expect(actions.startAutopilotAction).toHaveBeenCalledWith(7);
    expect(refresh).toHaveBeenCalled();
  });

  it("with a run: each planned post with its time, state and link; held posts under Needs you; Stop asks first", async () => {
    render(<AutopilotPanel run={run()} items={[
      item({ id: "a", state: "scheduled", post_id: "p1" }),
      item({ id: "b", slot: "afternoon", gender: "boy", scheduled_for: "2026-11-21T05:12:00Z", state: "held", post_id: "p2", note: "Only 5 good boy names" }),
    ]} stats={{ p1: { total: 11, passed: 11, remade: 2, removed: 0 } }} />);
    expect(screen.getByText("8:47 AM")).toBeTruthy();
    expect(screen.getByText("1:12 PM")).toBeTruthy();
    expect(screen.getAllByText(/Sat, Nov 21 · Letter S/).length).toBeGreaterThan(0);
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText(/Only 5 good boy names/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Stop Autopilot/ })); });
    expect(actions.stopAutopilotAction).toHaveBeenCalledWith("r");
  });

  it("a paused run shows why and offers Resume", async () => {
    render(<AutopilotPanel run={run({ status: "paused", message: "Your Claude credits have run out. Fix it, then press Resume." })} items={[item({})]} stats={{}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/credits have run out/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resume/ })); });
    expect(actions.resumeAutopilotAction).toHaveBeenCalledWith("r");
  });

  it("name themes editor validates and saves", async () => {
    render(<NameThemesEditor text={"Biblical"} />);
    const box = screen.getByLabelText("Name themes");
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("Add at least one name theme.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Biblical\nSoft and cool" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save name themes/ })); });
    expect(actions.saveNameThemesAction).toHaveBeenCalledWith("Biblical\nSoft and cool");
  });

  it("card chip text", () => {
    expect(checkChip({ check_state: "passed", check_note: "Checked" })).toEqual({ text: "Checked", tone: "ok" });
    expect(checkChip({ check_state: "passed", check_note: "Remade: odd hands or fingers" })).toEqual({ text: "Remade: odd hands or fingers", tone: "ok" });
    expect(checkChip({ check_state: "removed", check_note: "Removed: too much skin" })).toEqual({ text: "Removed: too much skin", tone: "bad" });
    expect(checkChip({ check_state: "failed", check_note: "Could not check twice: x" })).toEqual({ text: "Not checked", tone: "bad" });
    expect(checkChip({ check_state: "pending", check_note: null })).toBeNull();
    expect(checkChip({ check_state: null, check_note: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/autopilot-page.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: `lib/status/card-check.ts`**

```ts
import type { CardRow } from "@/lib/db/types";

/** The small mark on a card of an Autopilot post: what the photo check did (null while checking or on hand-made posts). */
export function checkChip(card: Pick<CardRow, "check_state" | "check_note">): { text: string; tone: "ok" | "bad" } | null {
  switch (card.check_state) {
    case "passed": return { text: card.check_note?.startsWith("Remade:") ? card.check_note : "Checked", tone: "ok" };
    case "removed": return { text: card.check_note ?? "Removed", tone: "bad" };
    case "failed": return { text: "Not checked", tone: "bad" };
    default: return null;
  }
}
```

- [ ] **Step 4: `components/autopilot/autopilot-panel.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, RotateCw, Square } from "lucide-react";
import type { AutopilotItemRow, AutopilotItemState, AutopilotRunRow } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { callAction } from "@/lib/actions/call";
import { previewAutopilotAction, resumeAutopilotAction, startAutopilotAction, stopAutopilotAction, type RunPreview } from "@/lib/actions/autopilot";
import type { CardStats } from "@/lib/data/autopilot";
import { MAX_DAYS, dayLabel, labelText } from "@/lib/autopilot/plan";
import { summarize } from "@/lib/autopilot/summary";

const ACTIVE = new Set(["running", "waiting", "paused"]);
const STATE_TEXT: Record<AutopilotItemState, string> = { planned: "Waiting", naming: "Picking names", making: "Making cards", checking: "Checking", scheduled: "Scheduled", held: "Held" };
const STATE_TONE: Record<AutopilotItemState, "ok" | "warn" | "muted" | "accent"> = { planned: "muted", naming: "accent", making: "accent", checking: "accent", scheduled: "ok", held: "warn" };
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

export function AutopilotPanel({ run, items, stats }: { run: AutopilotRunRow | null; items: AutopilotItemRow[]; stats: Record<string, CardStats> }) {
  const router = useRouter();
  const active = !!run && ACTIVE.has(run.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [active, router]);
  return active ? <RunView run={run!} items={items} stats={stats} /> : <StartView last={run} items={items} />;
}

function StartView({ last, items }: { last: AutopilotRunRow | null; items: AutopilotItemRow[] }) {
  const router = useRouter();
  const [days, setDays] = useState(MAX_DAYS);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    void callAction(() => previewAutopilotAction(days)).then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r.preview); else setError(r.error);
    });
    return () => { live = false; };
  }, [days]);
  const start = async () => {
    setStarting(true);
    const r = await callAction(() => startAutopilotAction(days));
    setStarting(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Autopilot started. Your PC picks it up within a minute.");
    router.refresh();
  };
  return (
    <div className="space-y-4">
      <Panel title="Make the next days">
        <div className="space-y-3">
          <label htmlFor="ap-days" className="block text-sm font-semibold text-ink">How many days</label>
          <select id="ap-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink">
            {Array.from({ length: MAX_DAYS }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} day{n > 1 ? "s" : ""} ({n * 2} posts)</option>)}
          </select>
          {error ? <p className="text-sm text-bad" role="status">{error}</p> : !preview ? <p className="text-sm text-muted">Planning…</p> : (
            <div className="space-y-2 text-sm text-ink">
              <p><span className="font-semibold">{preview.range}</span> · {preview.posts} posts · one boy and one girl a day, between 8 and 10 AM and between 1 and 2 PM</p>
              <ul className="flex flex-wrap gap-1.5">{preview.days.map((d) => <li key={d.day}><Badge>{d.dayLabel}: {d.label}</Badge></li>)}</ul>
              {preview.problems.map((p) => <p key={p} className="text-xs text-warn-text">{p}</p>)}
            </div>
          )}
          <Button onClick={() => void start()} loading={starting} disabled={!preview}><Play className="size-4" /> Start</Button>
          <p className="text-xs text-muted">Keep your PC on with ComfyUI open until it finishes (about 10 minutes a post). Facebook posts them at their times, even with your PC off.</p>
        </div>
      </Panel>
      {last && <LastRun run={last} items={items} />}
    </div>
  );
}

function LastRun({ run, items }: { run: AutopilotRunRow; items: AutopilotItemRow[] }) {
  const s = summarize(run, items);
  return (
    <Panel title={run.status === "done" ? "Last run: finished" : "Last run: stopped"}>
      <p className="text-sm text-ink">{s.scheduled} scheduled · {s.held} held · {s.namesAdded} names added · {s.namesSkipped} names skipped · {s.remade} cards remade · {s.removed} removed · checks cost about ${s.costUsd.toFixed(2)}</p>
      <Activity run={run} />
    </Panel>
  );
}

function RunView({ run, items, stats }: { run: AutopilotRunRow; items: AutopilotItemRow[]; stats: Record<string, CardStats> }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState<"stop" | "resume" | null>(null);
  const act = async (kind: "stop" | "resume") => {
    setBusy(kind);
    const r = await callAction(() => (kind === "stop" ? stopAutopilotAction(run.id) : resumeAutopilotAction(run.id)));
    setBusy(null);
    setAsk(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(kind === "stop" ? "Autopilot stopped." : "Autopilot carries on.");
    router.refresh();
  };
  const scheduled = items.filter((i) => i.state === "scheduled").length;
  const held = items.filter((i) => i.state === "held");
  const days = [...new Set(items.map((i) => i.day))];
  return (
    <div className="space-y-4">
      <Panel title="Autopilot" action={<Button variant="ghost" size="sm" onClick={() => setAsk(true)} disabled={busy !== null}><Square className="size-4" /> Stop</Button>}>
        {run.status === "paused" ? (
          <div className="mb-3 space-y-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad" role="alert">
            <p>{run.message}</p>
            <Button size="sm" onClick={() => void act("resume")} loading={busy === "resume"}><RotateCw className="size-4" /> Resume</Button>
          </div>
        ) : run.status === "waiting" ? (
          <p className="mb-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text" role="status">{run.message}</p>
        ) : (
          <p className="mb-3 text-sm text-ink" role="status">Working: {scheduled} of {items.length} posts scheduled.</p>
        )}
        <ol className="space-y-3">
          {days.map((day) => {
            const its = items.filter((i) => i.day === day).sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
            return (
              <li key={day} className="rounded-xl border border-line p-3">
                <div className="text-sm font-bold text-ink">{dayLabel(day)} · {labelText(its[0])}</div>
                <ul className="mt-2 space-y-1.5">
                  {its.map((i) => {
                    const st = i.post_id ? stats[i.post_id] : undefined;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-20 shrink-0 tabular-nums text-muted">{TIME.format(new Date(i.scheduled_for))}</span>
                        <span className="font-semibold capitalize text-ink">{i.gender}</span>
                        <Badge tone={STATE_TONE[i.state]}>{STATE_TEXT[i.state]}{(i.state === "making" || i.state === "checking") && st ? ` · ${st.passed}/${st.total} checked` : ""}</Badge>
                        {st && st.remade > 0 && <span className="text-xs text-muted">{st.remade} remade</span>}
                        {i.post_id && <Link href={`/posts/${i.post_id}`} className="text-xs font-semibold text-accent underline-offset-2 hover:underline">Open post</Link>}
                        {i.note && i.state !== "scheduled" && i.state !== "held" && <p className="w-full text-xs text-muted">{i.note}</p>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </Panel>
      {held.length > 0 && (
        <section aria-label="Needs you">
          <Panel title="Needs you">
            <ul className="space-y-2 text-sm">
              {held.map((i) => (
                <li key={i.id}>
                  <span className="font-semibold text-ink">{dayLabel(i.day)} · {labelText(i)} · <span className="capitalize">{i.gender}</span>:</span> <span className="text-muted">{i.note}</span>
                  {i.post_id && <> <Link href={`/posts/${i.post_id}`} className="font-semibold text-accent hover:underline">Open post</Link></>}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}
      <Panel title="Activity"><Activity run={run} /></Panel>
      <Dialog open={ask} onOpenChange={(o) => !o && setAsk(false)} title="Stop Autopilot?"
        description="Nothing new is made or scheduled. Posts already scheduled stay on Facebook (cancel one on its post page if you want). Posts being made stay on Posts, not scheduled.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsk(false)}>Keep going</Button>
          <Button variant="danger" onClick={() => void act("stop")} loading={busy === "stop"}>Stop Autopilot</Button>
        </div>
      </Dialog>
    </div>
  );
}

function Activity({ run }: { run: AutopilotRunRow }) {
  const events = [...(run.events ?? [])].reverse().slice(0, 40);
  if (!events.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-xs text-muted">
      {events.map((e, k) => <li key={`${e.at}-${k}`}>{e.text}</li>)}
    </ul>
  );
}
```

Note: the test expects a `region` named "Needs you": the `<section aria-label="Needs you">` provides it.

- [ ] **Step 5: `components/autopilot/name-themes-editor.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { callAction } from "@/lib/actions/call";
import { saveNameThemesAction } from "@/lib/actions/autopilot";
import { nameThemesProblem } from "@/lib/autopilot/name-themes";

export function NameThemesEditor({ text }: { text: string }) {
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);
  const problem = nameThemesProblem(value);
  const save = async () => {
    setSaving(true);
    const r = await callAction(() => saveNameThemesAction(value));
    setSaving(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Name themes saved.");
    router.refresh();
  };
  return (
    <Panel title="Name themes">
      <p className="text-sm text-muted">After Z, Autopilot goes through these, one per day, then back to A. One per line, in order. A hint in brackets helps the AI: Heavenly (stars, sky, light).</p>
      <label htmlFor="ap-themes" className="sr-only">Name themes</label>
      <textarea id="ap-themes" value={value} onChange={(e) => setValue(e.target.value)} rows={10}
        className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
      {problem && <p className="text-xs text-bad" role="status">{problem}</p>}
      <Button className="mt-2" onClick={() => void save()} loading={saving} disabled={!!problem || value === text}>Save name themes</Button>
    </Panel>
  );
}
```

- [ ] **Step 6: `app/(app)/autopilot/page.tsx`**

```tsx
import { getAutopilotData } from "@/lib/data/autopilot";
import { PageHeader } from "@/components/ui/page-header";
import { AutopilotPanel } from "@/components/autopilot/autopilot-panel";
import { NameThemesEditor } from "@/components/autopilot/name-themes-editor";

export const dynamic = "force-dynamic";

export default async function AutopilotPage() {
  const d = await getAutopilotData();
  return (
    <>
      <PageHeader title="Autopilot" subtitle="Makes, checks and schedules the next days of posts while you're busy." />
      {d.needs022 ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text">
          Autopilot needs a database update first: run supabase/migrations/022_autopilot.sql in Supabase, then reload.
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <AutopilotPanel run={d.run} items={d.items} stats={d.stats} />
          <NameThemesEditor text={d.nameThemes} />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 7: The links**

`components/shell/nav.tsx`: import `Bot` from `lucide-react`; add after Posts:
```ts
  { href: "/autopilot", label: "Autopilot", short: "Auto", icon: Bot, phone: false },
```
and extend `isPhoneActive` so "More" also lights up on `/autopilot`:
```ts
  isActive(path, href) || (href === "/settings" && (isActive(path, "/themes") || isActive(path, "/orders") || isActive(path, "/autopilot")));
```
Update the comment above `NAV` to say Autopilot is reached from "More" on phones too.
`app/(app)/settings/page.tsx` (~line 42): add `{ href: "/autopilot", label: "Autopilot", Icon: Bot }` first in the list of phone links (import `Bot`).

- [ ] **Step 8: The card chip** — `components/cards/card-tile.tsx`

Import `import { checkChip } from "@/lib/status/card-check";`. Inside the component, after `const label = ...`: `const chip = v === "done" ? checkChip(card) : null;`. Right after the `{v === "restamp" && ...}` block add:
```tsx
      {chip && (
        <span title={card.check_note ?? undefined}
          className={cn("pointer-events-none absolute bottom-2 left-2 z-[2] max-w-[80%] truncate rounded-full bg-surface/95 px-2 py-0.5 text-[11px] font-bold shadow-soft",
            chip.tone === "ok" ? "text-ok" : "text-bad")}>
          {chip.text}
        </span>
      )}
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/autopilot-page.test.tsx tests/facebook-panel.test.tsx` and any existing nav / card-tile / settings tests (`npx vitest run tests --reporter=dot` is fine).
Expected: PASS. Then `npx tsc --noEmit` and `npm run lint`: clean.

- [ ] **Step 10: Commit**

```bash
git add app/(app)/autopilot components/autopilot lib/status/card-check.ts components/shell/nav.tsx app/(app)/settings/page.tsx components/cards/card-tile.tsx tests/autopilot-page.test.tsx
git commit -m "feat(autopilot): the Autopilot page, its link and the check mark on cards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The worker knocks (2.9.0)

**Files:**
- Create: `worker/autopilot.py`, `worker/test_autopilot.py`
- Modify: `worker/jobs.py` (`VERSION`, `Runner.__init__`, `_tick`, `_run_claimed`, `run_forever`, new `start_autopilot`), `worker/pages.py` (`Page`, `_page`, `build_runner`, `MultiRunner.start_heartbeats`), `worker/worker.env.example`

**Interfaces:**
- Produces: `autopilot.PING_SECONDS = 30.0`, `autopilot.TIMEOUT_SECONDS = 320`, `class AutopilotPinger(url, secret, log=print, clock=time.time, post=None)` with `note(active)`, `active()`, `due(now=None)`, `ping_once()`, `loop(wait=None)`, `start()`, `stop_event`; `autopilot.from_env(cfg, log=print) -> AutopilotPinger | None`; `Runner(..., autopilot=None)`, `Runner.start_autopilot()`.

- [ ] **Step 1: Write the failing test** — `worker/test_autopilot.py`

```python
# Autopilot (2.9.0): claim_next_job says when a run is active; a pinger knocks on the website's tick route every 30 s
# from its own thread. No network: the post function and the clock are fakes.
import unittest

import autopilot
import jobs
from test_one_claim import Base


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


class PingerTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.calls = []
        self.logs = []
        self.p = autopilot.AutopilotPinger("https://site.example/", "s" * 40, log=self.logs.append, clock=self.clock,
                                           post=lambda url, secret: self.calls.append((url, secret)) or {"ok": True, "ran": True, "status": "running"})

    def test_knocks_only_while_a_run_is_active_and_every_30_s(self):
        self.assertFalse(self.p.due())
        self.p.note(True)
        self.assertTrue(self.p.due())
        self.p.ping_once()
        self.assertEqual(self.calls, [("https://site.example/api/autopilot/tick", "s" * 40)])
        self.assertFalse(self.p.due())
        self.clock.t += 29
        self.assertFalse(self.p.due())
        self.clock.t += 1
        self.assertTrue(self.p.due())
        self.p.note(False)
        self.assertFalse(self.p.due())

    def test_a_failed_knock_is_logged_and_tried_again_later(self):
        def boom(url, secret):
            raise RuntimeError("HTTP 500")
        self.p.post = boom
        self.p.note(True)
        self.assertIsNone(self.p.ping_once())
        self.assertIn("Autopilot knock failed: HTTP 500", self.logs[-1])
        self.assertFalse(self.p.due())
        self.clock.t += 30
        self.assertTrue(self.p.due())

    def test_from_env_needs_both_keys(self):
        self.assertIsNone(autopilot.from_env({"AUTOPILOT_URL": "https://x"}))
        self.assertIsNone(autopilot.from_env({"AUTOPILOT_SECRET": "s"}))
        self.assertIsInstance(autopilot.from_env({"AUTOPILOT_URL": "https://x", "AUTOPILOT_SECRET": "s" * 40}), autopilot.AutopilotPinger)


class RunnerFlagTest(Base):
    def setUp(self):
        super().setUp()
        self.notes = []
        self.run_.autopilot = type("P", (), {"note": lambda _s, a: self.notes.append(a), "start": lambda _s: None})()

    def test_an_idle_answer_with_the_flag_is_no_job(self):
        self.supa.claims.append({"kind": "none", "autopilot": True})
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.notes, [True])
        self.assertFalse(any("unknown job kind" in m for m in self.logs))

    def test_a_card_answer_carries_the_flag_and_null_means_no_run(self):
        from test_jobs import job
        self.supa.claims.append({"kind": "card", "job": job(), "autopilot": True})
        self.assertTrue(self.run_.tick())
        self.assertFalse(self.run_.tick())   # null answer
        self.assertEqual(self.notes, [True, False])

    def test_version(self):
        self.assertEqual(jobs.VERSION, "2.9.0")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd worker && python -m unittest test_autopilot -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'autopilot'`).

- [ ] **Step 3: `worker/autopilot.py`**

```python
# Autopilot (worker 2.9.0, migration 022): while the website has an Autopilot run going, claim_next_job's answer says so
# ({"autopilot": true}) and this pinger knocks on the website's tick route about every 30 seconds from its own thread,
# so the run moves on even while a card is being made. The website does all the work; this only knocks.
import json
import threading
import time
import urllib.error
import urllib.request

PING_SECONDS = 30.0
TIMEOUT_SECONDS = 320   # the tick route may take up to 300 s
LOOP_SECONDS = 2.0


class AutopilotPinger:
    def __init__(self, url, secret, log=print, clock=time.time, post=None):
        self.url = url.rstrip("/") + "/api/autopilot/tick"
        self.secret = secret
        self.log = log
        self.clock = clock
        self.post = post or _post
        self.on = False          # the last claim answer said a run is active
        self.next_at = 0.0
        self.busy = False
        self.last_status = None
        self.stop_event = threading.Event()

    def note(self, active):
        """After every claim_next_job answer: is an Autopilot run active?"""
        active = bool(active)
        if active and not self.on:
            self.log("Autopilot run found: knocking on the website every %ds" % PING_SECONDS)
            self.next_at = 0.0
        self.on = active

    def active(self):
        return self.on

    def due(self, now=None):
        now = self.clock() if now is None else now
        return self.on and not self.busy and now >= self.next_at

    def ping_once(self):
        """One knock (blocking). The website's answer, or None after a failure (logged)."""
        self.busy = True
        try:
            answer = self.post(self.url, self.secret)
            status = (answer or {}).get("status")
            if status and status != self.last_status:
                self.log("Autopilot: %s" % status)
                self.last_status = status
            return answer
        except Exception as e:
            self.log("Autopilot knock failed: %s" % str(e)[:200])
            return None
        finally:
            self.next_at = self.clock() + PING_SECONDS
            self.busy = False

    def loop(self, wait=None):
        wait = wait or self.stop_event.wait
        while not self.stop_event.is_set():
            if self.due():
                self.ping_once()
            wait(LOOP_SECONDS)

    def start(self):
        threading.Thread(target=self.loop, name="autopilot", daemon=True).start()


def _post(url, secret):
    req = urllib.request.Request(url, data=b"{}", method="POST",
                                 headers={"content-type": "application/json", "x-autopilot-key": secret})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %d %s" % (e.code, e.read().decode("utf-8", "replace")[:200]))


def from_env(cfg, log=print):
    """A pinger when the page's env has AUTOPILOT_URL and AUTOPILOT_SECRET; None = Autopilot off for that page."""
    url = (cfg.get("AUTOPILOT_URL") or "").strip()
    secret = (cfg.get("AUTOPILOT_SECRET") or "").strip()
    if not url or not secret:
        return None
    return AutopilotPinger(url, secret, log=log)
```

- [ ] **Step 4: `worker/jobs.py`**

1. `VERSION = "2.9.0"`; add to the header comment: `# 2.9.0: Autopilot (022): claim_next_job's answer says when a run is active; autopilot.py knocks on the website.`
2. `Runner.__init__(..., look=None, autopilot=None)`: `self.autopilot = autopilot        # autopilot.AutopilotPinger, or None (Autopilot off for this page)`
3. In `_tick`, in the 020 branch, right after the `else:` of the try (before `self._one_claim_on()`):
```python
                if self.autopilot:
                    self.autopilot.note(bool(got and got.get("autopilot")))
```
4. In `_run_claimed`, after `kind, job = ...`:
```python
        if kind == "none":   # 022: nothing to do, but an Autopilot run is active (the flag was read in _tick)
            return False
```
5. New method:
```python
    def start_autopilot(self):
        """The Autopilot knock thread (once per page)."""
        if self.autopilot:
            self.autopilot.start()
```
6. In `run_forever`, after the heartbeat thread starts: `self.start_autopilot()`.

- [ ] **Step 5: `worker/pages.py`**

1. `import autopilot` at the top.
2. `Page.__init__(..., look_cfg=None, autopilot_cfg=None)`: `self.autopilot_cfg = autopilot_cfg or {}  # AUTOPILOT_URL / AUTOPILOT_SECRET (2.9.0; unset = Autopilot off)`
3. In `_page`, pass `{k: cfg[k] for k in ("AUTOPILOT_URL", "AUTOPILOT_SECRET") if (cfg.get(k) or "").strip()}` as `autopilot_cfg` (keyword argument).
4. In `build_runner`, pass `autopilot=autopilot.from_env(page.autopilot_cfg, log=plog)` to `Runner(...)`.
5. In `MultiRunner.start_heartbeats`, after starting each heartbeat thread: `slot.runner.start_autopilot()`.

- [ ] **Step 6: `worker/worker.env.example`**

Append:
```
# Autopilot (2.9.0): the website's address and the same AUTOPILOT_SECRET as in Vercel. Empty = Autopilot off on this PC.
AUTOPILOT_URL=https://uniquenames-posting.vercel.app
AUTOPILOT_SECRET=
```

- [ ] **Step 7: Run all worker tests**

Run: `cd worker && python -m unittest -v`
Expected: all pass (including `test_autopilot`). If an existing test asserts `VERSION == "2.8.0"`, update it to `"2.9.0"`.

- [ ] **Step 8: Commit**

```bash
git add worker/autopilot.py worker/test_autopilot.py worker/jobs.py worker/pages.py worker/worker.env.example
git commit -m "feat(worker): 2.9.0 - knock on the Autopilot tick route while a run is active" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, full verification, first real run

**Files:**
- Modify: `docs/SETUP.md` (new section after "Posting to Facebook"), `README.md` (feature list)

- [ ] **Step 1: `docs/SETUP.md` — add "Autopilot (Make 7 days)"**

```markdown
## Autopilot (Make 7 days)
The Autopilot page makes, checks and schedules the next days of posts by itself: one boy and one girl post a day, the
morning one between 8 and 10 AM and the afternoon one between 1 and 2 PM (random minutes), following your name flow
(A to Z, then your name themes, then A again). Claude Opus checks every name like a parent would and every card photo
(hands, feet, faces, too much skin, split frames, look-alikes); bad cards are remade. Nothing is scheduled unchecked.
Spec: `docs/superpowers/specs/2026-11-20-autopilot-design.md`.

1. Facebook posting must already work (the section above).
2. Supabase **SQL Editor**: run `supabase/migrations/022_autopilot.sql` (safe to run again).
3. Make a secret: in PowerShell, `[Convert]::ToBase64String((1..36 | ForEach-Object { Get-Random -Max 256 }))`. Copy it.
4. **Vercel** > Settings > Environment Variables (tick **Sensitive**, Production): `AUTOPILOT_SECRET` (the secret),
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings > API keys > service_role / secret key), and
   `ANTHROPIC_API_KEY` if it is not there yet. Redeploy.
5. **Your PC**: in `worker/worker.env` add `AUTOPILOT_URL=https://<your site>.vercel.app` and
   `AUTOPILOT_SECRET=<the same secret>`. Restart the worker (Task Scheduler: end and run "Unique Names card worker").
   `worker/worker.log` says "worker 2.9.0".
6. Open **Autopilot** (sidebar; on a phone: More > Autopilot), pick **1 day** for the first try, press **Start**, and
   watch it: names, cards, checks, then both posts scheduled. Open each post and look at it before trusting 7 days.

Cost: the checks use Claude Opus 5.5, about $5 for a 7-day run (the page shows the real cost after each run).
If a run pauses (Claude credits, a key), fix it and press **Resume**. **Stop** ends a run at once; scheduled posts stay.
```

- [ ] **Step 2: `README.md`** — one bullet in the feature list: "Autopilot: Make 7 days makes, checks (Claude Opus) and schedules the next week of posts by itself (docs/SETUP.md, Autopilot)."

- [ ] **Step 3: Full verification**

Run, one after another, and read each result:
```
npm test
npx tsc --noEmit
npm run lint
npm run build
cd worker && python -m unittest -v
```
Expected: all green; the build lists `/autopilot` and `/api/autopilot/tick`. Fix anything red before going on.

- [ ] **Step 4: Commit**

```bash
git add docs/SETUP.md README.md
git commit -m "docs(autopilot): setup and first run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: First real run (with the owner, after merge and deploy)**

This step needs the owner (keys in Vercel, migration 022, worker restart). Checklist:
1. Owner runs 022 in Supabase; a read-only REST check confirms `autopilot_runs` exists.
2. Owner adds the Vercel keys and redeploys; the worker env gets `AUTOPILOT_URL` and `AUTOPILOT_SECRET`; restart the worker only when its queue is empty (`Stop-ScheduledTask` / `Start-ScheduledTask` "Unique Names card worker").
3. Start a **1-day** run. Watch `worker/worker.log` ("Autopilot run found", then "Autopilot: running") and the page.
4. When both posts show **Scheduled**: open each post (cards, check marks, caption, order) and Meta Business Suite (both scheduled at the planned times).
5. Report to the owner: what passed, what was remade and why, the real cost of the run.
```
