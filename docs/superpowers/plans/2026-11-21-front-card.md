# Front Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new Unique Names post opens with a **front card** (a photo from the post's own photoshoot with the post's title stamped big, "'S' Names / for baby boy") followed by the post's **3 best names**, so the 4 pictures a phone shows are the strongest hook; Autopilot posts get 8 to 14 names and go out with 7 or more passed name cards.

**Architecture:** The front card is a new card kind `cover` (migration 023), planned by the planner like the closing card (`planCoverCard` mirrors `planCtaCard`, pose pool and title wording in the Unique Names pack) and queued by `addCoverCard` (mirrors `addClosingCard`) when a post is created; `cardOrder` puts it first, and the PC worker 2.10.0 stamps its title at the stored place. The 3 best names come from Claude's existing Autopilot name check (a new `appeal` score, no extra call) or, on Today, from one small `rankNames` AI call that runs alongside the caption; both only reorder the names over the already-planned card positions.

**Tech Stack:** Next.js 16 (App Router, server actions; no new route handlers), Supabase (Postgres + PostgREST), Gemini / Claude through `lib/ai/provider.ts` `aiJson`, Claude Opus 5.5 for the Autopilot checks, vitest + PGlite (+ jsdom for components), Python 3 worker with Pillow (unittest).

**Spec:** `docs/superpowers/specs/2026-11-21-front-card-design.md` (approved; it governs). Branch: `feature/front-card` (already checked out).

## Global Constraints

- The spec governs. Album order: **1. front card, 2. the 3 best names, 3. the other names, 4. the closing card last**. The front card stays first and the closing card stays last when the owner drags cards; Facebook (Post now, Schedule), Download and the upload numbers follow `cardOrder`. A top-3 card unselected or removed: the next card simply moves up.
- Front card row: `kind = 'cover'`, `position = 0`, `order_index = 0`, `name` = the title's main line, `meaning` = the second line (`""` when none), `title_pos` = `'top'` or `'bottom'`, `name_id = null`.
- Title wording (exact): by letter → `'S' Names` / `for baby boy`; Autopilot name theme → `Biblical Names` (the theme title + " Names", unless it already ends in "names") / `for baby girl`; by initials → `A & R Names` / `for baby girl`; old A–Z series part → `A to Z Names` / `part 1 · for baby girl`; any other → `Baby Boy Names` / no second line.
- Cover poses: a pool of **10** in the Unique Names pack, each with a version for every session (`newborn`, `sitter`, `toddler`, `kid`; a newborn sleeps, never crawls). The pose is the **least recently used among recent front cards, never the previous post's**. The title place **alternates top/bottom** from the previous front card; the photo leaves the title's third calm and open; the place is stored on the card so a re-stamp keeps it. Photo text-free (NO_TEXT), title stamped by code. No "camera"/"lamp"/"studio" words in pose texts (the model draws them).
- Settings: `settings.cover_enabled boolean not null default true` (Settings > **Front card** switch, next to the closing card's). Today posts keep the owner's name count; the front card is one more card. Posts already made or scheduled do not change (no backfill, no "Add front card" button).
- A pack without front-card wording and cover poses (Name Nest: `packs/name-nest/*` stay **unchanged**) never gets a front card and never ranks.
- Migration **023**, file `supabase/migrations/023_front_card.sql`: `cards.kind` also allows `cover`; one front card per post (`cards_one_cover`); `cards.title_pos text` null, check `top`/`bottom`; `settings.cover_enabled`. **Safe to run twice**; `supabase/schema.sql` gives a fresh project the same result.
- Before 023 runs (live site deploys first): **no front card and no Today ranking**, posts exactly as today; a missing column/constraint means "no front card", **never a failed post** (mirror `lib/cta/card.ts` "needs010"). The front card **never blocks or fails a post** (creation errors are logged only; Autopilot leaves a failing one out).
- Today ranking (`lib/ai/rank-names.ts`): **one** `aiJson` call, `task: "small"` (the app's AI setting, the same AI as the captions), **alongside the caption** (Promise.all, never in turn), limit `RANK_TIMEOUT_MS = 8000` (~8 s), top `RANK_TOP = 3`; the answer is checked in code: only the post's own names, each once, at least min(3, names); anything else, an AI failure or a late answer → today's order. Runs for Today single-name and initials posts only (not Autopilot's chosen names), and only once 023 has run on a pack with front-card wording (`bestFirstOn`).
- Reordering names never changes the photo plan: each card position keeps its `shot`, `prompt` and `seed` (`withNameOrder`), only the name (and its `name_id`, `meaning`, `source`) moves.
- Autopilot: Claude's names check returns **`appeal` 1–10 for every name (required, a whole number, checked)**; the post's names = a random sample as today, ordered **top 3 by appeal first, then the rest in random order**; **no extra AI call**. `NAMES_PER_POST = { min: 8, max: 14 }` (10 to 16 cards with the front and closing cards). `MIN_GOOD_NAMES` **stays 8** (names step). New `MIN_PASSED_NAME_CARDS = 7` (a post goes out with 7 passed name cards; 6 holds it).
- Autopilot front card: photo-checked and remade like every card (up to `MAX_REMAKES = 2`); the judge is told its stamped text is the post's title; it is in the look-alike check (sent **last** so it can be the one flagged) and remade once when flagged. Still failing after its 2 remakes (or not checkable twice) → **unselected, the post goes out**, activity event `"<item>: Front card left out: <reason>."`.
- Worker **2.10.0** (`worker/jobs.py` `VERSION`): `compose_cover` stamps main line (title font, bigger than a name), second line (meaning font, smaller), handle (as on every card) at the stored place; claimed `cover` cards are made like the others; the PC backup file is **`00-front.jpg`**. The owner restarts the worker when its queue is empty.
- Not included: a collage front card, front cards on existing posts, front cards on reels, ranking by photo quality.
- AGENTS.md: this Next.js has breaking changes; this plan adds no new Next.js API usage (only edits to existing `"use server"` files and one server component). If you add anything Next-specific, read `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` first. Never export plain helpers from a `"use server"` file (every export there becomes a callable server action); shared logic goes in `server-only` modules.
- Owner-facing words: plain English, short sentences, no jargon (match the existing closing-card messages).
- On this Windows PC vitest only starts under **PowerShell**: run `npx vitest run <files>`, `npm test`, `npx tsc --noEmit`, `npm run lint` from PowerShell (not Git Bash). Worker tests: `cd worker; python -m unittest discover` (any shell).
- The owner has unrelated uncommitted edits (`.gitignore`, `eslint.config.mjs`, `tsconfig.json`, `reels3d/`, other untracked files). **`git add` only the explicit paths a task lists**; never `git add -A`, `git add .` or `git commit -a`. Never commit `AGENTS.md`/`CLAUDE.md` changes made by `next dev`.
- Commit after every task; the message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/023_front_card.sql` (new) | kind `cover`, `cards_one_cover`, `cards.title_pos`, `settings.cover_enabled` |
| `supabase/schema.sql` | the same for a fresh project |
| `lib/db/types.ts` | `CardKind` + `"cover"`, `TitlePlace`, `CardRow.title_pos`, `SettingsRow.cover_enabled` |
| `lib/files/save.ts` | `kindRank`, `cardOrder` (cover first, cta last), `isPinned` (Task 8) |
| `packs/types.ts` | `CoverPose`, `CoverTitleInput`, `CoverTitle`, `PackCover`, `PackCards.cover?` |
| `packs/unique-names/cards.ts` | the 10 cover poses and the title wording |
| `lib/planner/prompt.ts` | `COVER_SHOT_PREFIX`, `isCoverShot`, `coverShot`, `coverPoseId`, `buildCoverPrompt` |
| `lib/planner/plan.ts` | `planCoverCard`, `pickCoverPose`, `nextTitlePlace`, `withNameOrder`; `planPost` keeps chosen names' order |
| `lib/cover/card.ts` (new) | `has023`, `addCoverCard` (mirrors `lib/cta/card.ts`) |
| `lib/ai/rank-names.ts` (new) | `rankNames`, `parseRanking`, `bestFirstOrder`, `rankPrompt`, `bestFirstOn`, `RANK_*` |
| `lib/posts/create.ts` | front card + ranking in `createPostCore` |
| `lib/actions/initials.ts` | front card + ranking in `createInitialsPostAction` |
| `lib/actions/validate.ts`, `lib/actions/settings.ts` | `cover_enabled` validated and saved (023 missing → saved except it) |
| `components/settings/settings-form.tsx`, `app/(app)/settings/page.tsx` | the Front card switch; the text preview never uses a front card |
| `lib/autopilot/judge-names.ts` | `appeal` in the schema, prompt and checks |
| `lib/autopilot/names-step.ts` | `TOP_BY_APPEAL`, `bestFirst`, names returned best-first |
| `lib/autopilot/plan.ts` | `NAMES_PER_POST` 8–14, `MIN_PASSED_NAME_CARDS = 7` |
| `lib/autopilot/judge-photos.ts` | the judge told about the front card's title; look-alike label |
| `lib/autopilot/engine.ts` | front card left out, look-alike order, the 7-card floor |
| `worker/render.py` | `cover_place`, `fit_cover_title`, `layout_cover`, `compose_cover`, `ComfyRenderer.compose_cover` |
| `worker/jobs.py` | `VERSION = "2.10.0"`, `COVER_FILENAME = "00-front.jpg"`, cover in `_compose` / `_backup` |
| `components/posts/post-detail.tsx`, `components/cards/card-tile.tsx`, `components/cards/card-dialog.tsx`, `components/today/active-post.tsx` | front card pinned first, "Front card" label, no name edit / swap |
| `lib/actions/cards.ts`, `lib/actions/suggest.ts` | the name paths refuse the front card |
| `docs/SETUP.md`, `README.md` | migration 023, the switch, worker restart |
| tests (new): `tests/sql/migration-023.test.ts`, `tests/cover-order.test.ts`, `tests/cover-planner.test.ts`, `tests/cover-actions.test.ts`, `tests/rank-names.test.ts`, `tests/cover-ui.test.tsx`, `tests/cover-edits.test.ts`, `worker/test_cover.py` | |
| tests (modified): the `tests/sql/*` equivalence tests, `tests/initials-actions.test.ts`, `tests/settings-form.test.tsx`, `tests/autopilot-{judges,names-step,plan,cores,engine}.test.ts`, `worker/test_jobs.py`, `worker/test_card_layout.py`, 4 worker VERSION tests | |

Task order matters: 1 → 2 → 3 → 4; 5 and 6 need only Task 1; 7 is independent; 8 needs Task 1.

---
### Task 1: Database (migration 023, schema, types) and the album order

**Files:**
- Create: `supabase/migrations/023_front_card.sql`
- Modify: `supabase/schema.sql` (settings ~line 139; cards ~lines 310-336)
- Modify: `lib/db/types.ts` (lines 20-21 `CardKind`; `CardRow` ~lines 59-66; `SettingsRow` ~line 95)
- Modify: `lib/files/save.ts` (lines 1-6)
- Create: `tests/sql/migration-023.test.ts`, `tests/cover-order.test.ts`
- Modify (equivalence tests: apply 023 after 022): `tests/sql/migration-003.test.ts`, `-005`, `-006`, `-007`, `-008`, `-009`, `-010`, `-011`, `-012`, `-013`, `-014`, `-015`, `-017`, `-018`, `-019`, `tests/sql/migration-v2.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (SQL): `cards.kind in ('post','preview','cta','cover')` (constraint `cards_kind_check`), unique index `cards_one_cover on cards (post_id) where kind = 'cover'`, `cards.title_pos text` with `cards_title_pos_check (title_pos is null or title_pos in ('top','bottom'))`, `settings.cover_enabled boolean not null default true`.
- Produces (TS, `lib/db/types.ts`): `type CardKind = "post" | "preview" | "cta" | "cover"`, `type TitlePlace = "top" | "bottom"`, `CardRow.title_pos?: TitlePlace | null`, `SettingsRow.cover_enabled?: boolean`.
- Produces (TS, `lib/files/save.ts`): `kindRank(c: Partial<Pick<CardRow, "kind">>): number` (cover 0, name cards 1, cta 2) and `cardOrder` using it.

- [ ] **Step 1: Write the failing tests**

Create `tests/sql/migration-023.test.ts`:

```ts
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
```

Create `tests/cover-order.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cardOrder, kindRank, orderedSelection, uploadNumbers } from "@/lib/files/save";

type Kind = "post" | "cta" | "cover";
const c = (id: string, order_index: number, kind: Kind = "post", selected = true, position = order_index) => ({ id, order_index, position, kind, selected });

describe("the front card is always first, the closing card always last", () => {
  it("cardOrder: the front card, the name cards in the owner's order, then the closing card", () => {
    const cards = [c("cta", 1, "cta"), c("b", 3), c("cover", 9, "cover"), c("a", 2)];
    expect([...cards].sort(cardOrder).map((x) => x.id)).toEqual(["cover", "a", "b", "cta"]);
    expect([kindRank({ kind: "cover" }), kindRank({ kind: "post" }), kindRank({}), kindRank({ kind: "cta" })]).toEqual([0, 1, 1, 2]);
  });

  it("save / zip order and the upload numbers start at the front card; unselected, the next card moves up", () => {
    const cards = [c("a", 1), c("cover", 0, "cover"), c("b", 2), c("cta", 3, "cta")];
    expect(orderedSelection(cards).map((x) => x.id)).toEqual(["cover", "a", "b", "cta"]);
    expect(uploadNumbers(cards).get("cover")).toBe(1);
    expect(uploadNumbers(cards).get("a")).toBe(2);
    const off = cards.map((x) => (x.id === "cover" ? { ...x, selected: false } : x));
    expect(uploadNumbers(off).has("cover")).toBe(false);
    expect(uploadNumbers(off).get("a")).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `npx vitest run tests/sql/migration-023.test.ts tests/cover-order.test.ts`
Expected: FAIL (`023_front_card.sql` does not exist; `kindRank` is not exported and the front card does not sort first).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/023_front_card.sql`:

```sql
-- Unique Names posting: the front card (spec docs/superpowers/specs/2026-11-21-front-card-design.md). Every new post
-- opens with a picture from its own photoshoot with the post's title stamped big ("'S' Names" / "for baby boy"). Paste
-- the whole file into the Supabase SQL editor and run it. Safe to run more than once. Run it after 022_autopilot.sql. A
-- fresh project gets all of this from supabase/schema.sql already. No function changes: claim_next_card already hands
-- out every kind of card with all its columns. Restart the PC worker first, once its queue is empty (worker 2.10.0
-- stamps the title; an older worker would stamp it like a name). Until this runs the app makes no front cards.

-- cards: kind 'cover' = the front card, the post's first picture (name = the title's main line, meaning = its second
-- line or ''). It always belongs to a post (the existing check: kind = 'preview' or post_id is not null).
alter table public.cards drop constraint if exists cards_kind_check;
alter table public.cards add constraint cards_kind_check check (kind in ('post', 'preview', 'cta', 'cover'));
-- At most one front card per post (a retried Generate or a double tap never adds a second one).
create unique index if not exists cards_one_cover on public.cards (post_id) where kind = 'cover';
-- Where the front card's title is stamped (null on every other card); stored so a re-stamp keeps it.
alter table public.cards add column if not exists title_pos text;
alter table public.cards drop constraint if exists cards_title_pos_check;
alter table public.cards add constraint cards_title_pos_check check (title_pos is null or title_pos in ('top', 'bottom'));

-- settings: Settings > Front card, on by default.
alter table public.settings add column if not exists cover_enabled boolean not null default true;
```

- [ ] **Step 4: Give a fresh project the same (`supabase/schema.sql`)**

In the settings table, replace:

```sql
  -- reels (014): draw the on-screen step labels
```

with:

```sql
  -- front card (023): the first picture of every new post (a photo + the post's title), on/off
  cover_enabled boolean not null default true,
  -- reels (014): draw the on-screen step labels
```

In the cards table, replace:

```sql
  -- 'cta' (010) = the closing "follow" card of a post: name = the message ("/" = a line break), meaning = ''
  kind text not null default 'post' constraint cards_kind_check check (kind in ('post', 'preview', 'cta')),
```

with:

```sql
  -- 'cta' (010) = the closing "follow" card of a post: name = the message ("/" = a line break), meaning = ''
  -- 'cover' (023) = the front card, the post's first picture: name = the title's main line, meaning = its second line or ''
  kind text not null default 'post' constraint cards_kind_check check (kind in ('post', 'preview', 'cta', 'cover')),
```

replace (the only occurrence, in the cards table):

```sql
  remakes int not null default 0,
```

with:

```sql
  remakes int not null default 0,
  -- the front card (023): where its title is stamped (null on every other card); a re-stamp keeps it
  title_pos text constraint cards_title_pos_check check (title_pos is null or title_pos in ('top', 'bottom')),
```

and replace:

```sql
create unique index if not exists cards_one_cta on public.cards (post_id) where kind = 'cta';
```

with:

```sql
create unique index if not exists cards_one_cta on public.cards (post_id) where kind = 'cta';
-- 023: at most one front card per post
create unique index if not exists cards_one_cover on public.cards (post_id) where kind = 'cover';
```

- [ ] **Step 5: The types (`lib/db/types.ts`)**

Replace:

```ts
/** "cta" (migration 010) = the closing "follow" card of a post: name = the message ("/" = a line break), meaning = "". */
export type CardKind = "post" | "preview" | "cta";
```

with:

```ts
/**
 * "cta" (migration 010) = the closing "follow" card of a post: name = the message ("/" = a line break), meaning = "".
 * "cover" (migration 023) = the front card, the post's first picture: name = the title's main line ("'S' Names"),
 * meaning = its second line ("for baby boy", or ""), title_pos = where the title is stamped.
 */
export type CardKind = "post" | "preview" | "cta" | "cover";
/** Where the front card's title is stamped (cards.title_pos, migration 023). */
export type TitlePlace = "top" | "bottom";
```

In `CardRow`, replace:

```ts
  /** Autopilot (migration 022): the photo check; null on cards of posts made by hand. */
  check_state?: CardCheckState | null; check_note?: string | null; remakes?: number;
}
```

with:

```ts
  /** Autopilot (migration 022): the photo check; null on cards of posts made by hand. */
  check_state?: CardCheckState | null; check_note?: string | null; remakes?: number;
  /** The front card (migration 023; absent before it runs): where its title is stamped; null on every other card. */
  title_pos?: TitlePlace | null;
}
```

In `SettingsRow`, replace:

```ts
  /** Autopilot (migration 022): the name themes, one per line ("Title" or "Title (hint)"). */
  autopilot_name_themes?: string;
}
```

with:

```ts
  /** Autopilot (migration 022): the name themes, one per line ("Title" or "Title (hint)"). */
  autopilot_name_themes?: string;
  /** Front card (migration 023; absent before it runs): a front card on every new post (default on). */
  cover_enabled?: boolean;
}
```

- [ ] **Step 6: The order (`lib/files/save.ts`)**

Replace lines 1-6:

```ts
import type { CardRow } from "@/lib/db/types";

type Ordered = Pick<CardRow, "order_index" | "position"> & Partial<Pick<CardRow, "kind">>;
const isCta = (c: Ordered) => (c.kind === "cta" ? 1 : 0);

/** The post's upload order: the owner's order, and the closing card (migration 010) always last. */
export const cardOrder = (a: Ordered, b: Ordered) => isCta(a) - isCta(b) || a.order_index - b.order_index || a.position - b.position;
```

with:

```ts
import type { CardRow } from "@/lib/db/types";

type Ordered = Pick<CardRow, "order_index" | "position"> & Partial<Pick<CardRow, "kind">>;
/** A card's place by kind: the front card (migration 023) first, the name cards, the closing card (010) last. */
export const kindRank = (c: Partial<Pick<CardRow, "kind">>) => (c.kind === "cover" ? 0 : c.kind === "cta" ? 2 : 1);

/** The post's upload order: the front card first, then the owner's order, and the closing card always last. */
export const cardOrder = (a: Ordered, b: Ordered) => kindRank(a) - kindRank(b) || a.order_index - b.order_index || a.position - b.position;
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run tests/sql/migration-023.test.ts tests/cover-order.test.ts tests/cta-order.test.ts`
Expected: PASS.

- [ ] **Step 8: Apply 023 in the existing equivalence tests**

`schema.sql` now has the 023 columns, so every test that compares a migrated live database with `schema.sql` must apply 023 too. Right after each line below add the same line for `023_front_card.sql` (same indentation, same `migrated` / `db` variable), with the comment `// 023: the front card (settings, cards)`:

| File (approx. line) | Line to follow (exact text) |
|---|---|
| `tests/sql/migration-003.test.ts` (133), `-005` (339), `-006` (336), `-007` (305), `-008` (120), `-009` (117), `-010` (145), `-017` (133) | `    await migrated.exec(stripSupabase(read("supabase", "migrations", "022_autopilot.sql"))); // 022: Autopilot (settings, posts, names, cards)` |
| `tests/sql/migration-014.test.ts` (93), `-015` (80) | `    await migrated.exec(stripSupabase(read("supabase", "migrations", "022_autopilot.sql"))); // 022: Autopilot (settings)` |
| `tests/sql/migration-011.test.ts` (204), `-013` (65) | `    await db.exec(stripSupabase(read("supabase", "migrations", "022_autopilot.sql"))); // 022: Autopilot (settings, posts, names, cards)` |
| `tests/sql/migration-018.test.ts` (30), `-019` (34) | `  await db.exec(stripSupabase(read("supabase", "migrations", "022_autopilot.sql"))); // 022: Autopilot (settings, posts, names, cards)` |

For example, in `tests/sql/migration-010.test.ts` the result is:

```ts
    await migrated.exec(stripSupabase(read("supabase", "migrations", "022_autopilot.sql"))); // 022: Autopilot (settings, posts, names, cards)
    await migrated.exec(stripSupabase(read("supabase", "migrations", "023_front_card.sql"))); // 023: the front card (settings, cards)
```

In `tests/sql/migration-012.test.ts` (line ~29) and `tests/sql/migration-v2.test.ts` (line ~12) append `"023_front_card.sql"` to the end of the `later` list, right after `"022_autopilot.sql"`. Leave `tests/sql/migration-020.test.ts` (it compares only `claim_next_job`, which 023 does not touch) and `tests/sql/migration-022.test.ts` as they are.

- [ ] **Step 9: Run the database tests and the type check**

Run: `npx vitest run tests/sql`
Expected: PASS (every file). If one still fails with a settings/cards column, constraint or index difference, it applies 022 in a place not listed above: add the 023 line right after it the same way.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run tests/cta-order.test.ts tests/facebook-actions.test.ts tests/autopilot-engine.test.ts`
Expected: PASS (every existing order is unchanged).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/023_front_card.sql supabase/schema.sql lib/db/types.ts lib/files/save.ts tests/sql/migration-023.test.ts tests/cover-order.test.ts tests/sql/migration-003.test.ts tests/sql/migration-005.test.ts tests/sql/migration-006.test.ts tests/sql/migration-007.test.ts tests/sql/migration-008.test.ts tests/sql/migration-009.test.ts tests/sql/migration-010.test.ts tests/sql/migration-011.test.ts tests/sql/migration-012.test.ts tests/sql/migration-013.test.ts tests/sql/migration-014.test.ts tests/sql/migration-015.test.ts tests/sql/migration-017.test.ts tests/sql/migration-018.test.ts tests/sql/migration-019.test.ts tests/sql/migration-v2.test.ts
git commit -m "feat(front-card): migration 023 (kind cover, title_pos, cover_enabled) and the front card first in the album order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The front card in the pack and the planner (poses, title, prompt, rotation)

**Files:**
- Modify: `packs/types.ts` (the `PackCards` interface, ~lines 71-84)
- Modify: `packs/unique-names/cards.ts` (imports line 2; new block before `UNIQUE_NAMES_CARDS`; `UNIQUE_NAMES_CARDS` lines 198-205)
- Modify: `lib/planner/prompt.ts` (imports lines 1-7; new section at the end of the file)
- Modify: `lib/planner/plan.ts` (imports lines 1-3; new functions at the end of the file)
- Create: `tests/cover-planner.test.ts`
- Unchanged on purpose: `packs/name-nest/*` (no `cover`: Name Nest never gets a front card)

**Interfaces:**
- Consumes (Task 1): `TitlePlace` from `@/lib/db/types`.
- Produces (`packs/types.ts`, re-exported by `@/packs`):
  - `interface CoverPose { id: string; moment: Readonly<Record<Session, string>>; optics: string }`
  - `interface CoverTitleInput { gender: Gender; letter?: string | null; nameTheme?: string | null; initials?: string | null; seriesPart?: 1 | 2 | null }`
  - `interface CoverTitle { main: string; second: string }`
  - `interface PackCover { poses: readonly CoverPose[]; title: (p: CoverTitleInput) => CoverTitle }`
  - `PackCards.cover?: PackCover` (set for Unique Names only)
- Produces (`lib/planner`, exported through `@/lib/planner`):
  - `COVER_SHOT_PREFIX = "front card"`, `isCoverShot(shot: string): boolean`, `coverShot(pose: CoverPose, session?: Session): string` (`"front card: <pose id>: <moment>"`), `coverPoseId(shot: string | null | undefined): string | null`
  - `buildCoverPrompt(theme: ThemePromptFields, gender: Gender, subject: Subject | undefined, pose: CoverPose, place: TitlePlace): string`
  - `interface CoverCardInput { theme: ThemeRow; gender: Gender; subjectKey: string; age?: AgeChoice | null; salt: string; pose: CoverPose; place: TitlePlace; title: CoverTitle }`
  - `interface PlannedCoverCard { kind: "cover"; position: 0; name: string; meaning: string; shot: string; prompt: string; seed: number; title_pos: TitlePlace }`
  - `planCoverCard(i: CoverCardInput): PlannedCoverCard`
  - `pickCoverPose(poses: readonly CoverPose[], recent: readonly (string | null)[]): CoverPose` (recent = pose ids of the latest front cards, newest first)
  - `nextTitlePlace(previous: unknown): TitlePlace`
  - `withNameOrder<T extends { position: number; shot: string; prompt: string; seed: number }>(cards: T[], order: number[]): T[]`

- [ ] **Step 1: Write the failing test**

Create `tests/cover-planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Gender, ThemeRow } from "@/lib/db/types";
import { packById } from "@/packs";
import {
  COVER_SHOT_PREFIX, NO_TEXT, buildCoverPrompt, coverPoseId, coverShot, isCoverShot, nextTitlePlace, pickCoverPose, pickSubject,
  planCoverCard, planCtaCard, subjectKey, withNameOrder, type Session,
} from "@/lib/planner";

// The front card (spec 2026-11-21): the pose pool and title wording of the Unique Names pack, the prompt, the pose
// rotation (least recently used, never the previous post's) and the title place (alternating top / bottom).
const cover = packById("unique-names").cards.cover!;
const poses = cover.poses;
const SESSIONS: Session[] = ["newborn", "sitter", "toddler", "kid"];
const theme: ThemeRow = {
  id: "t1", title: "Boho Pampas", gender: "boy", backdrop: "smooth seamless chocolate brown studio backdrop with a soft darker vignette",
  outfit: "a tiny cream knitted romper with a little collar", props: "wicker basket, pampas grass, felt bunny",
  lighting: "soft warm light from the left, gentle shadows, cozy", palette: "brown, cream, oat and soft gold",
  status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};

describe("front card pack data", () => {
  it("10 poses with unique ids, each written for every session, with no words the model would draw", () => {
    expect(poses).toHaveLength(10);
    expect(new Set(poses.map((p) => p.id)).size).toBe(10);
    for (const p of poses) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.optics.trim()).not.toBe("");
      expect(p.optics).not.toMatch(/camera/i);
      for (const s of SESSIONS) {
        expect(p.moment[s]?.trim(), `${p.id} / ${s}`).toBeTruthy();
        expect(p.moment[s]).not.toMatch(/camera|\{prop\}|\blamp\b|\bstudio\b/i);
      }
      // a newborn sleeps: never asked to crawl, stand or walk
      expect(p.moment.newborn).toMatch(/newborn/);
      expect(p.moment.newborn).not.toMatch(/crawl|stand|walk/i);
    }
  });

  it("the title wording for letter, name theme, initials, series and plain posts", () => {
    expect(cover.title({ gender: "boy", letter: "S" })).toEqual({ main: "'S' Names", second: "for baby boy" });
    expect(cover.title({ gender: "girl", nameTheme: "Biblical" })).toEqual({ main: "Biblical Names", second: "for baby girl" });
    expect(cover.title({ gender: "girl", nameTheme: "Royal names" })).toEqual({ main: "Royal names", second: "for baby girl" });
    expect(cover.title({ gender: "girl", initials: "AR" })).toEqual({ main: "A & R Names", second: "for baby girl" });
    expect(cover.title({ gender: "girl", seriesPart: 1 })).toEqual({ main: "A to Z Names", second: "part 1 · for baby girl" });
    expect(cover.title({ gender: "boy" })).toEqual({ main: "Baby Boy Names", second: "" });
    expect(cover.title({ gender: "girl", letter: null, nameTheme: null, initials: null, seriesPart: null })).toEqual({ main: "Baby Girl Names", second: "" });
  });

  it("Name Nest has no front card", () => {
    expect(packById("name-nest").cards.cover).toBeUndefined();
  });
});

describe("the pose and the title place change from post to post", () => {
  const ids = poses.map((p) => p.id);

  it("never-used poses first in list order, never the previous post's, else the one used longest ago", () => {
    expect(pickCoverPose(poses, []).id).toBe(ids[0]);
    expect(pickCoverPose(poses, [ids[0]]).id).toBe(ids[1]);
    const allUsed = [ids[3], ids[0], ids[1], ids[2], ids[4], ids[5], ids[6], ids[7], ids[8], ids[9]];
    expect(pickCoverPose(poses, allUsed).id).toBe(ids[9]);
    // unreadable or unknown shots are ignored
    expect(pickCoverPose(poses, [null, "gone", ids[0]]).id).toBe(ids[1]);
    expect(pickCoverPose(poses.slice(0, 2), [ids[1], ids[0]]).id).toBe(ids[0]);
    expect(pickCoverPose(poses.slice(0, 1), [ids[0]]).id).toBe(ids[0]);
  });

  it("over a long run the pose never matches the previous post's and every pose comes round", () => {
    const recent: string[] = [];
    for (let k = 0; k < 40; k++) {
      const p = pickCoverPose(poses, recent);
      expect(p.id).not.toBe(recent[0]);
      recent.unshift(p.id);
    }
    expect(new Set(recent.slice(0, 10)).size).toBe(10);
  });

  it("the title place alternates (top when there is no previous front card)", () => {
    expect(nextTitlePlace("top")).toBe("bottom");
    expect(nextTitlePlace("bottom")).toBe("top");
    expect(nextTitlePlace(null)).toBe("top");
    expect(nextTitlePlace(undefined)).toBe("top");
    expect(nextTitlePlace("middle")).toBe("top");
  });
});

describe("planCoverCard", () => {
  const key = subjectKey("2026-11-22", "boy", "single");
  const base = { theme, gender: "boy" as Gender, subjectKey: key, age: "2" as const, salt: "post-1", pose: poses[0], place: "top" as const,
    title: { main: "'S' Names", second: "for baby boy" } };

  it("the post's set and child in the pose, the title as its text, first (position 0), the place stored", () => {
    const c = planCoverCard(base);
    expect(c).toMatchObject({ kind: "cover", position: 0, name: "'S' Names", meaning: "for baby boy", title_pos: "top" });
    const child = pickSubject(key, "2");
    expect(isCoverShot(c.shot)).toBe(true);
    expect(c.shot).toBe(coverShot(poses[0], child.session));
    expect(coverPoseId(c.shot)).toBe(poses[0].id);
    expect(c.prompt).toContain(child.look);
    expect(c.prompt).toContain(theme.backdrop);
    expect(c.prompt).toContain(poses[0].moment.toddler);
    // the same child as the closing card of this fixed-age post, but a seed of its own
    const cta = planCtaCard({ theme, gender: "boy", subjectKey: key, age: "2", salt: "post-1", position: 10, text: "Follow" });
    expect(cta.prompt).toContain(child.look);
    expect(c.seed).not.toBe(cta.seed);
  });

  it("keeps the title's third calm: the upper third for a top title, the lower third for a bottom one; text-free", () => {
    const top = planCoverCard(base).prompt;
    const bottom = planCoverCard({ ...base, place: "bottom" }).prompt;
    expect(top).toMatch(/upper third of the frame is calm, open backdrop/);
    expect(bottom).toMatch(/lower third of the frame is calm, open space/);
    for (const p of [top, bottom]) {
      expect(p.split("\n").at(-1)).toBe(NO_TEXT);
      expect(p).not.toMatch(/camera/i);
    }
  });

  it("Random age: a child of its own, the same every time for the post", () => {
    const a = planCoverCard({ ...base, age: "random" });
    expect(planCoverCard({ ...base, age: "random" })).toEqual(a);
    expect(a.prompt).toMatch(/^Professional studio/);
  });

  it("every pose builds a prompt for every session", () => {
    for (const pose of poses) {
      for (const s of SESSIONS) {
        expect(buildCoverPrompt(theme, "girl", { session: s, look: "soft dark hair, warm tan skin" }, pose, "top")).toContain(pose.moment[s]);
      }
    }
  });

  it("a front card shot is told apart from the other cards' shots", () => {
    expect(COVER_SHOT_PREFIX).toBe("front card");
    expect(coverPoseId("closing card: wide eye-level shot")).toBeNull();
    expect(coverPoseId(null)).toBeNull();
    expect(isCoverShot("close-up portrait of the baby")).toBe(false);
  });
});

describe("withNameOrder", () => {
  it("the names move with what belongs to them; each position keeps its shot, prompt and seed", () => {
    const cards = ["A", "B", "C", "D"].map((n, k) => ({ position: k + 1, name_id: `id${n}`, name: n, meaning: `m${n}`, source: `src${n}`, shot: `s${k}`, prompt: `p${k}`, seed: k }));
    const out = withNameOrder(cards, [2, 0, 3, 1]);
    expect(out.map((c) => [c.position, c.name, c.name_id, c.meaning, c.source, c.shot, c.prompt, c.seed])).toEqual([
      [1, "C", "idC", "mC", "srcC", "s0", "p0", 0], [2, "A", "idA", "mA", "srcA", "s1", "p1", 1],
      [3, "D", "idD", "mD", "srcD", "s2", "p2", 2], [4, "B", "idB", "mB", "srcB", "s3", "p3", 3],
    ]);
    expect(withNameOrder(cards, [0, 1, 2, 3])).toEqual(cards);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run (PowerShell): `npx vitest run tests/cover-planner.test.ts`
Expected: FAIL (`cards.cover` is undefined; `planCoverCard`, `pickCoverPose`, … are not exported).

- [ ] **Step 3: The pack types (`packs/types.ts`)**

Replace the `PackCards` interface:

```ts
/** Name cards: the children's looks, the photoshoot shot lists and the closing card's moment. */
export interface PackCards {
  /** Babies (newborn, 1 year); one per child, repeated word for word. */
  looks: string[];
  /** The same looks for children of 2 and up (same index = same family look). */
  childLooks: string[];
  /** Share of newborn sessions for posts made before ages existed. */
  newbornShare: number;
  /** Shot lists per session (index 0 = the album cover) and the props-only frames (index 0 = the empty set). */
  shots: Readonly<Record<Session, ShotSpec[]>>;
  propsShots: ShotSpec[];
  /** The closing card's moment per session (the child low in the frame, open backdrop above). */
  ctaMoment: Readonly<Record<Session, string>>;
}
```

with:

```ts
/** Name cards: the children's looks, the photoshoot shot lists and the closing card's moment. */
export interface PackCards {
  /** Babies (newborn, 1 year); one per child, repeated word for word. */
  looks: string[];
  /** The same looks for children of 2 and up (same index = same family look). */
  childLooks: string[];
  /** Share of newborn sessions for posts made before ages existed. */
  newbornShare: number;
  /** Shot lists per session (index 0 = the album cover) and the props-only frames (index 0 = the empty set). */
  shots: Readonly<Record<Session, ShotSpec[]>>;
  propsShots: ShotSpec[];
  /** The closing card's moment per session (the child low in the frame, open backdrop above). */
  ctaMoment: Readonly<Record<Session, string>>;
  /** The front card (migration 023): its poses and title wording. None = this pack never makes one (Name Nest). */
  cover?: PackCover;
}

/** A front-card pose: `id` is stored in the card's shot (for the rotation); `moment` per session (a newborn sleeps). */
export interface CoverPose { id: string; moment: Readonly<Record<Session, string>>; optics: string }
/** What the front card's title is made from: the post's gender and kind (letter, name theme, initials, A–Z part). */
export interface CoverTitleInput { gender: Gender; letter?: string | null; nameTheme?: string | null; initials?: string | null; seriesPart?: 1 | 2 | null }
/** The stamped title: the big main line and the smaller second line ("" = none). */
export interface CoverTitle { main: string; second: string }
/** The front card: the pose pool (each pose written for every session) and the title wording. */
export interface PackCover { poses: readonly CoverPose[]; title: (p: CoverTitleInput) => CoverTitle }
```

(`Gender` and `Session` are already imported at the top of `packs/types.ts`.)

- [ ] **Step 4: The poses and the title wording (`packs/unique-names/cards.ts`)**

Replace line 2:

```ts
import type { PackCards } from "../types";
```

with:

```ts
import type { CoverPose, CoverTitle, CoverTitleInput, PackCards } from "../types";
```

Insert right before `export const UNIQUE_NAMES_CARDS: PackCards = {`:

```ts
// The front card (migration 023): the album's first picture, the post's title stamped big by the PC. Ten poses, each
// written for every session (a newborn sleeps; a toddler may stand); the planner takes the least recently used one,
// never the previous post's. The prompt adds where the child and props sit, so the title's third stays calm. Optics
// words only, never the device or the room ("camera", "studio" and "lamp" make the model draw them); tummy poses keep
// the legs out of view (soles toward the viewer read as lifeless).
const COVER_POSES: CoverPose[] = [
  { id: "wide", optics: "eye level, wide shot, 35mm lens, f/2.0, soft background falloff", moment: {
    newborn: "the newborn sleeping peacefully in the middle of the whole scene, curled up on the blanket beside the main prop, every prop in view",
    sitter: "the baby sitting in the middle of the whole scene beside the main prop, smiling at the viewer, every prop in view",
    toddler: "the toddler sitting in the middle of the whole scene beside the main prop, smiling at the viewer, every prop in view",
    kid: "the child sitting cross-legged in the middle of the whole scene beside the main prop, smiling at the viewer, every prop in view",
  } },
  { id: "face", optics: "eye level, 85mm portrait lens, f/1.8, shallow depth of field, creamy bokeh", moment: {
    newborn: "a soft close-up of the sleeping newborn's face turned toward the viewer, resting on the folded hands",
    sitter: "a close-up of the baby's face looking straight at the viewer with big curious eyes and a little smile",
    toddler: "a close-up of the toddler's face looking straight at the viewer with a cheeky grin",
    kid: "a close-up of the child's face looking straight at the viewer with a warm smile",
  } },
  { id: "top-down", optics: "top-down viewpoint, 50mm lens, f/2.8, soft focus falloff at the edges", moment: {
    newborn: "the newborn sleeping curled up on the soft blanket, seen straight from above, the props arranged around",
    sitter: "the baby lying on the back on the soft blanket, seen straight from above, smiling up at the viewer, the props arranged around",
    toddler: "the toddler lying on the back on the soft blanket, seen straight from above, giggling up at the viewer, the props arranged around",
    kid: "the child lying on the back on the soft blanket, seen straight from above, smiling up at the viewer, the props arranged around",
  } },
  { id: "peek", optics: "eye level, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "the sleeping newborn tucked in behind the main prop, the tiny face resting just over its edge",
    sitter: "the baby peeking out from behind the main prop with big curious eyes",
    toddler: "the toddler peeking around the side of the main prop with a playful grin",
    kid: "the child peeking over the top of the main prop with a playful look",
  } },
  { id: "profile-up", optics: "eye level, side profile, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "a side profile of the sleeping newborn, the chin tilted slightly up, the tiny nose and lips in soft profile",
    sitter: "a side profile of the baby sitting and looking up with wonder",
    toddler: "a side profile of the toddler standing and looking up with wonder",
    kid: "a side profile of the child sitting and looking up with a dreamy smile",
  } },
  { id: "among-props", optics: "slightly above eye level, three-quarter angle, 50mm lens, f/2.2, soft background falloff", moment: {
    newborn: "the newborn curled up asleep among the props, seen from a three-quarter angle",
    sitter: "the baby sitting among the props, seen from a three-quarter angle, looking at the viewer",
    toddler: "the toddler sitting among the props, seen from a three-quarter angle, looking at the viewer",
    kid: "the child sitting among the props, seen from a three-quarter angle, looking at the viewer with a soft smile",
  } },
  { id: "hug", optics: "eye level, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "the sleeping newborn snuggled against the softest prop, one tiny hand resting on it",
    sitter: "the baby hugging the softest prop close with both arms, smiling",
    toddler: "the toddler hugging the softest prop close with both arms, the eyes closed in a happy squeeze",
    kid: "the child hugging the softest prop close with both arms, smiling at the viewer",
  } },
  { id: "tummy", optics: "floor-level viewpoint, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "the newborn asleep on the tummy, the chin resting on the stacked hands, the legs tucked under the body",
    sitter: "the baby lying on the tummy with the chin resting on both hands, smiling at the viewer, the legs out of view behind",
    toddler: "the toddler lying on the tummy with the chin propped on both hands, smiling at the viewer, the legs out of view behind",
    kid: "the child lying on the tummy with the chin propped on both hands, smiling at the viewer, the legs out of view behind",
  } },
  { id: "over-shoulder", optics: "viewpoint just behind the shoulder at eye level, 50mm lens, f/2.0, soft background falloff", moment: {
    newborn: "a view from just above the sleeping newborn's shoulder, the tiny cheek soft in the near foreground and the props spread out beyond",
    sitter: "a view from just behind the baby's shoulder as the baby looks out at the props, the face in soft three-quarter profile",
    toddler: "a view from just behind the toddler's shoulder as the toddler looks out at the props, the face in soft three-quarter profile",
    kid: "a view from just behind the child's shoulder as the child looks out at the props, the face in soft three-quarter profile",
  } },
  { id: "low-angle", optics: "low angle from floor level, 35mm lens, f/2.2, soft background falloff", moment: {
    newborn: "the newborn sleeping on the blanket, seen from blanket level, the backdrop rising tall behind",
    sitter: "the baby sitting on the blanket, seen from floor level, the backdrop rising tall behind",
    toddler: "the toddler standing proudly on the blanket, seen from a low angle, the backdrop rising tall behind",
    kid: "the child standing on the blanket with a confident smile, seen from a low angle, the backdrop rising tall behind",
  } },
];

/** The front card's title (spec 2026-11-21): "'S' Names", "Biblical Names", "A & R Names", "A to Z Names", "Baby Boy Names". */
function coverTitle(p: CoverTitleInput): CoverTitle {
  const forWho = `for baby ${p.gender}`;
  const letter = p.letter?.trim().toUpperCase();
  if (letter) return { main: `'${letter}' Names`, second: forWho };
  const theme = p.nameTheme?.replace(/\s+/g, " ").trim();
  if (theme) return { main: /names$/i.test(theme) ? theme : `${theme} Names`, second: forWho };
  if (p.initials && /^[A-Z]{2}$/.test(p.initials)) return { main: `${p.initials[0]} & ${p.initials[1]} Names`, second: forWho };
  if (p.seriesPart === 1 || p.seriesPart === 2) return { main: "A to Z Names", second: `part ${p.seriesPart} · ${forWho}` };
  return { main: `Baby ${p.gender === "girl" ? "Girl" : "Boy"} Names`, second: "" };
}
```

Then replace:

```ts
export const UNIQUE_NAMES_CARDS: PackCards = {
  looks: LOOKS,
  childLooks: CHILD_LOOKS,
  newbornShare: 0.35,
  shots: { newborn: NEWBORN_SHOTS, sitter: SITTER_SHOTS, toddler: TODDLER_SHOTS, kid: KID_SHOTS },
  propsShots: PROPS_SPECS,
  ctaMoment: CTA_MOMENT,
};
```

with:

```ts
export const UNIQUE_NAMES_CARDS: PackCards = {
  looks: LOOKS,
  childLooks: CHILD_LOOKS,
  newbornShare: 0.35,
  shots: { newborn: NEWBORN_SHOTS, sitter: SITTER_SHOTS, toddler: TODDLER_SHOTS, kid: KID_SHOTS },
  propsShots: PROPS_SPECS,
  ctaMoment: CTA_MOMENT,
  cover: { poses: COVER_POSES, title: coverTitle },
};
```

(`packs/name-nest/cards.ts` lists its fields one by one, so it stays without `cover`. Do not edit it.)

- [ ] **Step 5: The prompt (`lib/planner/prompt.ts`)**

Replace the imports at the top:

```ts
import type { Gender, ThemeRow } from "@/lib/db/types";
import { hashSeed, seededRandom } from "./random";
import { frameOf, isPropsOnly, sessionFor, shotSpec, type Session, type ShotSpec, type TextSpace } from "./shots";
import { splitProps, theProp } from "./props";
import type { SubjectAge } from "./age";
import { activePack } from "@/packs";
import { NO_TEXT } from "./no-text";
```

with:

```ts
import type { Gender, ThemeRow, TitlePlace } from "@/lib/db/types";
import { hashSeed, seededRandom } from "./random";
import { frameOf, isPropsOnly, sessionFor, shotSpec, type Session, type ShotSpec, type TextSpace } from "./shots";
import { splitProps, theProp } from "./props";
import type { SubjectAge } from "./age";
import { activePack, type CoverPose } from "@/packs";
import { NO_TEXT } from "./no-text";
```

Append at the end of the file:

```ts

// ---------------------------------------------------------------- front card (migration 023)
/** Every front card's stored shot starts with this, then its pose id ("front card: wide: ..."); shotSpec() is undefined for it. */
export const COVER_SHOT_PREFIX = "front card";
export const isCoverShot = (shot: string) => shot.startsWith(`${COVER_SHOT_PREFIX}:`);
/** The stored shot of a front card: the pose id (read back by the rotation) and the pose for this child's session. */
export const coverShot = (pose: CoverPose, session: Session = "sitter") => `${COVER_SHOT_PREFIX}: ${pose.id}: ${pose.moment[session]}`;
/** The pose id in a stored front card shot, or null (another card's shot, or nothing). */
export const coverPoseId = (shot: string | null | undefined): string | null => /^front card: ([a-z0-9-]+):/.exec(shot ?? "")?.[1] ?? null;

// The child and the props stay out of the title's third of the frame, which is calm open backdrop (top) or blanket (bottom).
const COVER_SPACE: Record<TitlePlace, (who: string) => string> = {
  top: (who) => `the ${who} and the props sit in the lower two thirds of the frame, and the upper third of the frame is calm, open backdrop: smooth, softly lit and empty, with generous space above the ${who}'s head`,
  bottom: (who) => `the ${who} and the props sit in the upper two thirds of the frame, and the lower third of the frame is calm, open space: smooth, softly blurred blanket with nothing on it`,
};

/**
 * The front card's photo: the post's set and child in the chosen pose, the title's third of the frame calm and empty.
 * Positive-only like every card (cfg 1); NO_TEXT is the one exception, so the photo is text-free and the title is
 * stamped by code.
 */
export function buildCoverPrompt(theme: ThemePromptFields, gender: Gender, subject: Subject | undefined, pose: CoverPose, place: TitlePlace): string {
  const babyWord = gender === "girl" ? "baby girl" : "baby boy";
  const who = subject ? noun(subject) : "baby";
  return [
    header(subject),
    subject ? subjectLine(gender, subject) : `Subject: a ${babyWord}.`,
    `Shot: the opening frame of the session, the album cover: ${pose.moment[subject?.session ?? "sitter"]}.`,
    ...SET(theme, "Outfit", false, subject?.age),
    `Photography: ${pose.optics}, high detail, natural skin.`,
    `Composition: square frame, the backdrop fills the whole frame; ${COVER_SPACE[place](who)}.`,
    NO_TEXT,
  ].join("\n");
}
```

- [ ] **Step 6: The planner (`lib/planner/plan.ts`)**

Replace the first three import lines:

```ts
import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { buildCaption } from "./caption";
import { buildCtaPrompt, buildPrompt, ctaShot, pickSubject, randomSubject, type Subject } from "./prompt";
```

with:

```ts
import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow, TitlePlace } from "@/lib/db/types";
import type { CoverPose, CoverTitle } from "@/packs";
import { buildCaption } from "./caption";
import { buildCoverPrompt, buildCtaPrompt, buildPrompt, coverShot, ctaShot, pickSubject, randomSubject, type Subject } from "./prompt";
```

Append at the end of the file (after `planCtaCard`):

```ts

export interface CoverCardInput {
  theme: ThemeRow; gender: Gender;
  /** subjectKey(post_date, gender, style) of the post, so a fixed-age post shows its own child. */
  subjectKey: string;
  /** The post's subject_age: random = a child of a random age; a fixed age = the post's child; null = the original baby. */
  age?: AgeChoice | null;
  /** The post id: one stable seed per post. */
  salt: string;
  pose: CoverPose;
  place: TitlePlace;
  title: CoverTitle;
}
export interface PlannedCoverCard { kind: "cover"; position: 0; name: string; meaning: string; shot: string; prompt: string; seed: number; title_pos: TitlePlace }

/** The front card (migration 023): the post's set and child in the pose, the title as its text (name + meaning), first. */
export function planCoverCard(i: CoverCardInput): PlannedCoverCard {
  const rng = seededRandom(hashSeed(`${i.salt}|cover`));
  const subject = i.age === "random"
    ? randomSubject(SUBJECT_AGES[Math.floor(rng() * SUBJECT_AGES.length)], rng)
    : pickSubject(i.subjectKey, i.age ?? undefined);
  return {
    kind: "cover", position: 0, name: i.title.main, meaning: i.title.second, shot: coverShot(i.pose, subject.session),
    prompt: buildCoverPrompt(i.theme, i.gender, subject, i.pose, i.place), seed: cardSeed(i.salt, "cover", 0) + 2, title_pos: i.place,
  };
}

/**
 * The next front card pose: the least recently used of `poses` against `recent` (the pose ids of the latest front
 * cards, newest first; null = a shot that is not a front card's), never-used poses first in list order, and never the
 * previous post's while another pose exists.
 */
export function pickCoverPose(poses: readonly CoverPose[], recent: readonly (string | null)[]): CoverPose {
  const lastUse = (p: CoverPose) => { const i = recent.indexOf(p.id); return i < 0 ? Infinity : i; };
  const ranked = poses.map((p) => ({ p, last: lastUse(p) }));
  const pool = ranked.length > 1 ? ranked.filter((r) => r.last !== 0) : ranked;
  return (pool.length ? pool : ranked).reduce((a, b) => (b.last > a.last ? b : a)).p;
}

/** The title's place alternates from post to post: at the bottom after a top title, else at the top. */
export const nextTitlePlace = (previous: unknown): TitlePlace => (previous === "top" ? "bottom" : "top");

/**
 * The post's cards with their names in `order` (indexes into `cards`, every index once): each position keeps its shot,
 * prompt and seed (the photo plan: the session's cover shot first, still lifes spread out), and the name moves with
 * everything that belongs to it (name_id, meaning, source).
 */
export function withNameOrder<T extends { position: number; shot: string; prompt: string; seed: number }>(cards: T[], order: number[]): T[] {
  return order.map((from, k) => ({ ...cards[from], position: cards[k].position, shot: cards[k].shot, prompt: cards[k].prompt, seed: cards[k].seed }));
}
```

(`seededRandom`, `hashSeed`, `randomSubject`, `pickSubject`, `SUBJECT_AGES`, `AgeChoice` and `cardSeed` are already in scope in `plan.ts`.)

- [ ] **Step 7: Run the test**

Run: `npx vitest run tests/cover-planner.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the related suites, the type check and lint**

Run: `npx vitest run tests/planner.test.ts tests/cta-prompt.test.ts tests/pack-snapshots.test.ts tests/packs.test.ts tests/name-nest-pack.test.ts tests/planner-props.test.ts`
Expected: PASS (the Unique Names golden snapshots do not change: no existing prompt changed).

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packs/types.ts packs/unique-names/cards.ts lib/planner/prompt.ts lib/planner/plan.ts tests/cover-planner.test.ts
git commit -m "feat(front-card): cover poses and title wording in the pack, planCoverCard, pose rotation and title place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Queue the front card when a post is made, and the Settings switch

**Files:**
- Create: `lib/cover/card.ts`
- Modify: `lib/posts/create.ts` (imports; doc line 32; the `Promise.all` after `create_post`, lines ~115-129)
- Modify: `lib/actions/initials.ts` (imports; the closing card block, lines ~219-222)
- Modify: `lib/actions/validate.ts` (`SettingsInput` line ~29; checks line ~94)
- Modify: `lib/actions/settings.ts` (lines ~23, ~58-61, ~71, ~99-100)
- Modify: `components/settings/settings-form.tsx` (helpers ~line 66; props lines 70-71; state lines 86-89; a new panel before `<Panel title="Closing card">`, line ~156)
- Modify: `app/(app)/settings/page.tsx` (imports; `previewSample` query line 20; the `SettingsForm` element)
- Create: `tests/cover-actions.test.ts`
- Modify: `tests/initials-actions.test.ts` (the `World` type and the settings answer; one new test)
- Modify: `tests/settings-form.test.tsx` (one new `describe`)

**Interfaces:**
- Consumes (Task 1): `SettingsRow.cover_enabled`, `CardRow.title_pos`, kind `cover`. (Task 2): `planCoverCard`, `pickCoverPose`, `nextTitlePlace`, `coverPoseId`, `storedAge`, `subjectKey` from `@/lib/planner`; `activePack().cards.cover` and `type CoverTitleInput` from `@/packs`.
- Produces (`lib/cover/card.ts`, `server-only`):
  - `has023(s: Partial<SettingsRow> | null | undefined): boolean` (true once `settings.cover_enabled` is a boolean)
  - `type FrontCardResult = { status: "added"; cardId: string } | { status: "exists" } | { status: "off" } | { status: "none" } | { status: "needs023" } | { status: "error"; message: string }`
  - `interface FrontCardPost { id: string; post_date: string; gender: Gender; style: NameStyle; theme_id: string; subject_age?: string | null }`
  - `addCoverCard(sb, o: { post: FrontCardPost; theme: ThemeRow; settings: Partial<SettingsRow>; title: Omit<CoverTitleInput, "gender"> }): Promise<FrontCardResult>` (never throws)
- Produces (UI): `SettingsForm` prop `frontCard?: boolean` (default false); the switch's accessible name "Add a front card to every post".

- [ ] **Step 1: Write the failing tests**

Create `tests/cover-actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";
import { packById } from "@/packs";

// The front card is queued when a post is made (Today and Autopilot), before 023 never, and never fails a post.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createPostAction } = await import("@/lib/actions/posts");
const { saveSettingsAction } = await import("@/lib/actions/settings");
const { createPostCore } = await import("@/lib/posts/create");
const { addCoverCard } = await import("@/lib/cover/card");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COVER_ID = "55555555-5555-4555-8555-555555555555";
const theme: ThemeRow = {
  id: THEME_ID, title: "Cotton Clouds", gender: "boy", backdrop: "pastel sky-blue backdrop with cotton clouds", outfit: "white knit romper",
  props: "a woven basket and cotton clouds", lighting: "soft window light", palette: "sky blue, white", status: "available", sort_order: 1,
  used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const nm = (name: string): NameRow => ({ id: `n-${name}`, name, meaning: "calm sky", gender: "boy", style: "single", status: "available",
  post_id: null, position: null, created_at: "", updated_at: "" });
const NAMES = ["Kai", "Kael", "Knox", "Kian", "Kade", "Kellan", "Kobe", "Kyler", "Kenzo", "Milo", "Noah", "Owen"].map(nm);
const base = { id: 1, caption_template: "Names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 9,
  width: 1080, height: 1080, sound_on: true, caption_ai: false, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", cta_enabled: false };
const s023 = { ...base, cover_enabled: true };
const poses = packById("unique-names").cards.cover!.poses;

type World = {
  settings?: Record<string, unknown>; recent?: { shot: string; title_pos: string | null }[]; own?: { id: string; kind: string; position: number }[];
  insertError?: { message: string; code?: string }; settingsError?: (patch: Record<string, unknown>) => { message: string; code?: string } | null;
};
function world(w: World = {}) {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return { error: w.settingsError?.(op(q, "update")![1] as Record<string, unknown>) ?? null };
    if (q.table === "settings") return { data: w.settings ?? s023 };
    if (q.table === "names") return { data: NAMES };
    if (q.table === "themes") return { data: op(q, "maybeSingle") || op(q, "single") ? theme : [theme] };
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
    if (q.table === "cards" && op(q, "insert")) return w.insertError ? { error: w.insertError } : { data: [{ id: COVER_ID }] };
    if (q.table === "cards" && q.ops.some((o) => o[0] === "eq" && o[1] === "kind" && o[2] === "cover")) return { data: w.recent ?? [] };
    if (q.table === "cards") return { data: w.own ?? [] };
    if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
    if (q.table === "posts" && op(q, "limit")) return { data: [] };
    if (q.table === "posts") return { data: null };
    return undefined;
  };
}
const covers = () => fake.queries.filter((q) => q.table === "cards" && op(q, "insert"))
  .map((q) => op(q, "insert")![1] as Record<string, unknown>).filter((c) => c.kind === "cover");
const input = { gender: "boy" as const, style: "single" as const, count: null, postDate: "2026-11-22", themeId: THEME_ID, requestId: REQ, subjectAge: "1" as const };

beforeEach(() => { generateJson.mockReset(); generateJson.mockResolvedValue({ ok: false, error: "off" }); world(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("the front card on a new post", () => {
  it("is queued first (position 0): the post's set and child, the least recently used pose, the other title place, the title", async () => {
    world({ recent: [{ shot: `front card: ${poses[0].id}: ${poses[0].moment.sitter}`, title_pos: "top" }] });
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(covers()).toHaveLength(1);
    const [c] = covers();
    expect(c).toMatchObject({ post_id: POST_ID, theme_id: THEME_ID, kind: "cover", position: 0, order_index: 0, name: "Baby Boy Names", meaning: "", title_pos: "bottom" });
    expect(String(c.shot)).toMatch(new RegExp(`^front card: ${poses[1].id}: `));
    expect(String(c.prompt)).toContain(theme.backdrop);
    expect(String(c.prompt)).toMatch(/1-year-old baby boy/);
    expect(String(c.prompt)).toMatch(/lower third of the frame is calm/);
    // it is never planned as a name card
    const planned = (fake.rpcs.find((r) => r.fn === "create_post")!.args as { p: { cards: { name: string }[] } }).p.cards;
    expect(planned).toHaveLength(9);
  });

  it("a post by letter says 'K' Names, for baby boy; the first front card ever has its title at the top", async () => {
    expect((await createPostAction({ ...input, letter: "K" })).ok).toBe(true);
    expect(covers()[0]).toMatchObject({ name: "'K' Names", meaning: "for baby boy", title_pos: "top" });
    expect(String(covers()[0].shot)).toMatch(new RegExp(`^front card: ${poses[0].id}: `));
  });

  it("an Autopilot name-theme post (chosen names) says Biblical Names", async () => {
    const r = await createPostCore(fake.client as never, { gender: "boy", style: "single", count: null, postDate: "2026-11-22", requestId: REQ,
      subjectAge: "random", nameIds: NAMES.slice(0, 9).map((n) => n.id), nameTheme: { title: "Biblical", hint: null } });
    expect(r).toEqual({ ok: true, postId: POST_ID });
    expect(covers()[0]).toMatchObject({ kind: "cover", name: "Biblical Names", meaning: "for baby boy" });
  });

  it("before 023 (no cover_enabled in settings): none, and nothing extra is read", async () => {
    world({ settings: base });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(covers()).toHaveLength(0);
    expect(fake.queries.some((q) => q.table === "cards")).toBe(false);
  });

  it("switched off in Settings: none", async () => {
    world({ settings: { ...s023, cover_enabled: false } });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(covers()).toHaveLength(0);
    expect(fake.queries.some((q) => q.table === "cards")).toBe(false);
  });

  it("a refused insert (old kind check) never fails the post; any other error is logged, the post is still made", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    world({ insertError: { message: 'new row for relation "cards" violates check constraint "cards_kind_check"', code: "23514" } });
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(err).not.toHaveBeenCalled();
    world({ insertError: { message: "boom" } });
    expect(await createPostAction(input)).toEqual({ ok: true, postId: POST_ID });
    expect(err).toHaveBeenCalledWith("createPostCore: could not add the front card", "boom");
  });

  it("a retried Generate (the post already has its front card) adds no second one", async () => {
    world({ own: [{ id: "a", kind: "post", position: 1 }, { id: "f", kind: "cover", position: 0 }] });
    expect((await createPostAction(input)).ok).toBe(true);
    expect(covers()).toHaveLength(0);
  });

  it("a pack without front-card wording (Name Nest) never gets one", async () => {
    const saved = process.env.NICHE;
    process.env.NICHE = "name-nest";
    try {
      const r = await addCoverCard(fake.client as never, { post: { id: POST_ID, post_date: "2026-11-22", gender: "boy", style: "single", theme_id: THEME_ID }, theme, settings: s023, title: {} });
      expect(r).toEqual({ status: "none" });
      expect(fake.queries).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved;
    }
  });
});

describe("Settings: front card", () => {
  const form = { caption_template: "x {gender}", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, caption_ai: true,
    title_font: "poppins", meaning_font: "poppins", mark_font: "poppins", title_size: 95, meaning_size: 37, mark_size: 21, text_position: "auto" as const };
  const saved = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);

  it("saves the switch", async () => {
    expect(await saveSettingsAction({ ...form, cover_enabled: false })).toEqual({ ok: true });
    expect(saved()[0]).toMatchObject({ cover_enabled: false });
  });

  it("rejects anything but on or off", async () => {
    expect(await saveSettingsAction({ ...form, cover_enabled: "yes" as unknown as boolean })).toEqual({ ok: false, error: "Turn the front card on or off." });
    expect(saved()).toHaveLength(0);
  });

  it("before 023 the rest is saved and the owner is told", async () => {
    world({ settingsError: (p) => ("cover_enabled" in p ? { message: "Could not find the 'cover_enabled' column of 'settings' in the schema cache", code: "PGRST204" } : null) });
    const r = await saveSettingsAction({ ...form, cover_enabled: true });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/023_front_card\.sql/) });
    expect(saved()).toHaveLength(2);
    expect(saved()[1]).not.toHaveProperty("cover_enabled");
  });
});
```

In `tests/initials-actions.test.ts`:

1. In `type World = { ... }` add a field (keep the rest): replace

```ts
  rpc?: Record<string, { data?: unknown; error?: { message: string; code?: string } }[]>; reusedCards?: { name: string; created_at: string }[];
};
```

with

```ts
  rpc?: Record<string, { data?: unknown; error?: { message: string; code?: string } }[]>; reusedCards?: { name: string; created_at: string }[];
  settings?: Record<string, unknown>;
};
```

2. In `world()`, replace

```ts
    if (q.table === "settings") return { data: settings };
```

with

```ts
    if (q.table === "settings") return { data: w.settings ?? settings };
```

3. Inside `describe("createInitialsPostAction (Generate)", () => {`, after the test `"nothing at all with those initials: a clear failure, no write"`, add:

```ts
  it("with migration 023: a front card titled with the initials is queued first", async () => {
    world({ settings: { ...settings, cover_enabled: true } });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    expect((await createInitialsPostAction(input)).ok).toBe(true);
    const cover = fake.queries.filter((q) => q.table === "cards" && op(q, "insert"))
      .map((q) => op(q, "insert")![1] as Record<string, unknown>).find((c) => c.kind === "cover");
    expect(cover).toMatchObject({ post_id: POST_ID, kind: "cover", position: 0, order_index: 0, name: "A & R Names", meaning: "for baby boy", title_pos: "top" });
  });
```

In `tests/settings-form.test.tsx`, append at the end of the file:

```tsx
describe("SettingsForm: front card", () => {
  it("only on a pack that makes front cards", () => {
    render(<SettingsForm initial={{ ...initial, cover_enabled: true }} />);
    expect(screen.queryByRole("switch", { name: /Add a front card to every post/ })).toBeNull();
  });

  it("before 023: shown on, disabled, with the migration to run; never sent", async () => {
    render(<SettingsForm initial={initial} frontCard />);
    const sw = screen.getByRole("switch", { name: /Add a front card to every post/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/023_front_card\.sql/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).not.toHaveProperty("cover_enabled");
  });

  it("after 023: the switch is sent", async () => {
    render(<SettingsForm initial={{ ...initial, cover_enabled: true }} frontCard />);
    fireEvent.click(screen.getByRole("switch", { name: /Add a front card to every post/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).toMatchObject({ cover_enabled: false });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `npx vitest run tests/cover-actions.test.ts tests/initials-actions.test.ts tests/settings-form.test.tsx`
Expected: FAIL (`@/lib/cover/card` does not exist; no front card is inserted; the switch is not rendered; `cover_enabled` is not validated).

- [ ] **Step 3: `lib/cover/card.ts`**

```ts
import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { coverPoseId, nextTitlePlace, pickCoverPose, planCoverCard, storedAge, subjectKey } from "@/lib/planner";
import { activePack, type CoverTitleInput } from "@/packs";

type SB = Awaited<ReturnType<typeof createClient>>;

/** How many recent front cards the pose rotation looks at (more than the pool is long). */
const RECENT = 40;

export type FrontCardResult =
  | { status: "added"; cardId: string }
  | { status: "exists" }
  | { status: "off" }
  | { status: "none" }
  | { status: "needs023" }
  | { status: "error"; message: string };

export interface FrontCardPost { id: string; post_date: string; gender: Gender; style: NameStyle; theme_id: string; subject_age?: string | null }

/** settings.cover_enabled is absent until migration 023 runs. */
export const has023 = (s: Partial<SettingsRow> | null | undefined) => typeof s?.cover_enabled === "boolean";

const isMissing023 = (e: { message: string; code?: string }) =>
  e.code === "PGRST204" || e.code === "23514" || /schema cache|cards_kind_check|title_pos/i.test(e.message);

/**
 * Queue the post's front card (migration 023), placed first (position 0): the same set and child as the post, the
 * least recently used pose (never the previous post's), the title's place alternating from the previous front card, and
 * the title from the post's kind (letter, name theme, initials). Never throws and never fails a post. Nothing is added
 * on a pack without front-card wording ("none"), before 023 ("needs023": no settings column, or the database refuses
 * kind 'cover'), with the switch off ("off"), or when the post already has one ("exists").
 */
export async function addCoverCard(sb: SB, o: {
  post: FrontCardPost; theme: ThemeRow; settings: Partial<SettingsRow>; title: Omit<CoverTitleInput, "gender">;
}): Promise<FrontCardResult> {
  try {
    const cover = activePack().cards.cover;
    if (!cover) return { status: "none" };
    if (!has023(o.settings)) return { status: "needs023" };
    if (!o.settings.cover_enabled) return { status: "off" };
    const [{ data: own, error: ownErr }, { data: recent, error: recentErr }] = await Promise.all([
      sb.from("cards").select("id, kind").eq("post_id", o.post.id),
      sb.from("cards").select("shot, title_pos").eq("kind", "cover").order("created_at", { ascending: false }).limit(RECENT),
    ]);
    if (ownErr) return { status: "error", message: ownErr.message };
    if (recentErr) console.error("addCoverCard: could not read the recent front cards", recentErr.message);
    if (((own ?? []) as { kind: string }[]).some((c) => c.kind === "cover")) return { status: "exists" };
    const rows = (recent ?? []) as { shot: string | null; title_pos: string | null }[];
    const plan = planCoverCard({
      theme: o.theme, gender: o.post.gender, subjectKey: subjectKey(o.post.post_date, o.post.gender, o.post.style),
      age: storedAge(o.post.subject_age), salt: o.post.id,
      pose: pickCoverPose(cover.poses, rows.map((r) => coverPoseId(r.shot))),
      place: nextTitlePlace(rows[0]?.title_pos),
      title: cover.title({ ...o.title, gender: o.post.gender }),
    });
    const { data, error } = await sb.from("cards").insert({
      post_id: o.post.id, theme_id: o.post.theme_id, kind: "cover", position: plan.position, name: plan.name, meaning: plan.meaning,
      shot: plan.shot, prompt: plan.prompt, seed: plan.seed, order_index: 0, title_pos: plan.title_pos,
    }).select("id");
    if (error) {
      if (error.code === "23505") return { status: "exists" };
      if (isMissing023(error)) return { status: "needs023" };
      return { status: "error", message: error.message };
    }
    const id = (data as { id: string }[] | null)?.[0]?.id;
    return id ? { status: "added", cardId: id } : { status: "error", message: "The front card was not saved." };
  } catch (e) {
    return { status: "error", message: (e as Error).message || "unknown error" };
  }
}
```

- [ ] **Step 4: Queue it in `createPostCore` (`lib/posts/create.ts`)**

Add the import after `import { addClosingCard } from "@/lib/cta/card";`:

```ts
import { addCoverCard } from "@/lib/cover/card";
```

Replace the doc line:

```ts
/** The post itself (the owner's Generate and Autopilot): plan, caption, create_post, closing card, labels. */
```

with:

```ts
/** The post itself (the owner's Generate and Autopilot): plan, caption, create_post, front and closing cards, labels. */
```

Replace:

```ts
      const [{ error: metaErr }, closing, letterSaved, themeSaved] = await Promise.all([
        sb.from("posts").update({ caption_style, hashtag_set }).eq("id", r.post_id),
        theme ? addClosingCard(sb, { post: { id: r.post_id, post_date: input.postDate, gender: input.gender, style: input.style, theme_id: plan.theme_id, subject_age: age }, theme, settings: s })
          : Promise.resolve(null),
```

with:

```ts
      // The front card (023) is queued the same way, best effort: before 023, switched off, or on an error, the post
      // simply has none (a post is never failed for it).
      const newPost = { id: r.post_id, post_date: input.postDate, gender: input.gender, style: input.style, theme_id: plan.theme_id, subject_age: age };
      const [{ error: metaErr }, closing, front, letterSaved, themeSaved] = await Promise.all([
        sb.from("posts").update({ caption_style, hashtag_set }).eq("id", r.post_id),
        theme ? addClosingCard(sb, { post: newPost, theme, settings: s }) : Promise.resolve(null),
        theme ? addCoverCard(sb, { post: newPost, theme, settings: s, title: { letter, nameTheme: nameTheme?.title ?? null } }) : Promise.resolve(null),
```

and replace:

```ts
      if (closing?.status === "error") console.error("createPostAction: could not add the closing card", closing.message);
```

with:

```ts
      if (closing?.status === "error") console.error("createPostAction: could not add the closing card", closing.message);
      if (front?.status === "error") console.error("createPostCore: could not add the front card", front.message);
```

- [ ] **Step 5: Queue it on a post by initials (`lib/actions/initials.ts`)**

Add the import after `import { addClosingCard } from "@/lib/cta/card";`:

```ts
import { addCoverCard } from "@/lib/cover/card";
```

Replace:

```ts
    const closing = theme
      ? await addClosingCard(sb, { post: { id: postId, post_date: input.postDate, gender: input.gender, style: "two-word", theme_id: gallery.theme_id, subject_age: age }, theme, settings: s })
      : null;
    if (closing?.status === "error") console.error("createInitialsPostAction: could not add the closing card", closing.message);
```

with:

```ts
    // The closing card (010) and the front card (023, titled with the initials), side by side, best effort.
    const newPost = { id: postId, post_date: input.postDate, gender: input.gender, style: "two-word" as const, theme_id: gallery.theme_id, subject_age: age };
    const [closing, front] = theme
      ? await Promise.all([
        addClosingCard(sb, { post: newPost, theme, settings: s }),
        addCoverCard(sb, { post: newPost, theme, settings: s, title: { initials } }),
      ])
      : [null, null];
    if (closing?.status === "error") console.error("createInitialsPostAction: could not add the closing card", closing.message);
    if (front?.status === "error") console.error("createInitialsPostAction: could not add the front card", front.message);
```

(Do not export anything new from this `"use server"` file.)

- [ ] **Step 6: Validate and save the switch**

In `lib/actions/validate.ts` replace:

```ts
  /** Reels on-screen step labels (migration 014). Optional: only sent once the database has it. */
  reel_labels?: boolean }
```

with:

```ts
  /** Reels on-screen step labels (migration 014). Optional: only sent once the database has it. */
  reel_labels?: boolean;
  /** Front card (migration 023): on/off. Optional: only sent once the database has it. */
  cover_enabled?: boolean }
```

and replace:

```ts
  if (s.reel_labels !== undefined && typeof s.reel_labels !== "boolean") return "Turn the on-screen labels on or off.";
```

with:

```ts
  if (s.reel_labels !== undefined && typeof s.reel_labels !== "boolean") return "Turn the on-screen labels on or off.";
  if (s.cover_enabled !== undefined && typeof s.cover_enabled !== "boolean") return "Turn the front card on or off.";
```

In `lib/actions/settings.ts` replace:

```ts
const V14_COLUMN = "reel_labels";
```

with:

```ts
const V14_COLUMN = "reel_labels";
/** The front card switch (migration 023). */
const V23_COLUMN = "cover_enabled";
```

replace:

```ts
  const v14: Record<string, unknown> = s.reel_labels === undefined ? {} : { [V14_COLUMN]: s.reel_labels };
  let v2Missing = false, reelMissing = false, v6Missing = false, v7Missing = false, v9Missing = false, v10Missing = false, v14Missing = false;
  for (;;) {
    const { error } = await sb.from("settings").update({ ...base, ...(v2Missing ? {} : v2), ...(reelMissing ? {} : reel), ...(v6Missing ? {} : v6), ...(v7Missing ? {} : v7), ...(v9Missing ? {} : v9), ...(v10Missing ? {} : v10), ...(v14Missing ? {} : v14) }).eq("id", 1);
```

with:

```ts
  const v14: Record<string, unknown> = s.reel_labels === undefined ? {} : { [V14_COLUMN]: s.reel_labels };
  // Front card (migration 023): only when the form has it.
  const v23: Record<string, unknown> = s.cover_enabled === undefined ? {} : { [V23_COLUMN]: s.cover_enabled };
  let v2Missing = false, reelMissing = false, v6Missing = false, v7Missing = false, v9Missing = false, v10Missing = false, v14Missing = false, v23Missing = false;
  for (;;) {
    const { error } = await sb.from("settings").update({ ...base, ...(v2Missing ? {} : v2), ...(reelMissing ? {} : reel), ...(v6Missing ? {} : v6), ...(v7Missing ? {} : v7), ...(v9Missing ? {} : v9), ...(v10Missing ? {} : v10), ...(v14Missing ? {} : v14), ...(v23Missing ? {} : v23) }).eq("id", 1);
```

replace:

```ts
    if (missing && !v14Missing && V14_COLUMN in v14 && error.message.includes(V14_COLUMN)) { v14Missing = true; continue; }
```

with:

```ts
    if (missing && !v23Missing && V23_COLUMN in v23 && error.message.includes(V23_COLUMN)) { v23Missing = true; continue; }
    if (missing && !v14Missing && V14_COLUMN in v14 && error.message.includes(V14_COLUMN)) { v14Missing = true; continue; }
```

and replace:

```ts
  if (v14Missing)
    notes.push("Saved, except the on-screen labels switch: the database needs the reel formats update first (run supabase/migrations/014_reel_formats.sql).");
```

with:

```ts
  if (v14Missing)
    notes.push("Saved, except the on-screen labels switch: the database needs the reel formats update first (run supabase/migrations/014_reel_formats.sql).");
  if (v23Missing)
    notes.push("Saved, except the front card switch: the database needs the front card update first (run supabase/migrations/023_front_card.sql).");
```

- [ ] **Step 7: The switch on the Settings page**

In `components/settings/settings-form.tsx`, after the `labelsOf` helper (the line `  row.reel_labels === undefined ? {} : { reel_labels: row.reel_labels !== false };`) add:

```tsx

/** The front card switch; absent until migration 023 runs (the form then shows it on, disabled, and never sends it). */
const coverOf = (row: Partial<SettingsRow>): { cover_enabled?: boolean } =>
  row.cover_enabled === undefined ? {} : { cover_enabled: row.cover_enabled };
```

Replace:

```tsx
export function SettingsForm({ initial, sample = DEFAULT_SAMPLE, voices = null, themes = null }: {
  initial: SettingsRow; sample?: PreviewSample; voices?: ReelVoiceRow[] | null; themes?: ReelThemeRow[] | null;
}) {
```

with:

```tsx
export function SettingsForm({ initial, sample = DEFAULT_SAMPLE, voices = null, themes = null, frontCard = false }: {
  initial: SettingsRow; sample?: PreviewSample; voices?: ReelVoiceRow[] | null; themes?: ReelThemeRow[] | null;
  /** The page's pack makes front cards (Unique Names; Name Nest does not). */
  frontCard?: boolean;
}) {
```

Replace:

```tsx
    // undefined until migration 014 runs: hidden and not sent then.
    ...labelsOf(initial) });
  const has010 = s.cta_enabled !== undefined;
```

with:

```tsx
    // undefined until migration 014 runs: hidden and not sent then.
    ...labelsOf(initial),
    // undefined until migration 023 runs: not sent then.
    ...coverOf(initial) });
  const has010 = s.cta_enabled !== undefined;
  const has023 = s.cover_enabled !== undefined;
```

Replace:

```tsx
      <Panel title="Closing card">
```

with:

```tsx
      {frontCard && (
        <Panel title="Front card">
          <div>
            <label htmlFor="cover-on" className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
              <Switch id="cover-on" checked={s.cover_enabled ?? true} disabled={!has023} onCheckedChange={(v) => setS({ ...s, cover_enabled: v })} /> Add a front card to every post
            </label>
            <p className="text-xs text-muted">{has023
              ? "The first picture of each new post: the same photoshoot with the post's title stamped big ('S' Names, for baby boy). Its pose and the title's place change from post to post, and the post's 3 best names come right after it. Posts already made don't change."
              : "The front card needs the database update first (run supabase/migrations/023_front_card.sql)."}</p>
          </div>
        </Panel>
      )}
      <Panel title="Closing card">
```

In `app/(app)/settings/page.tsx`, add the import after `import { getReelThemes } from "@/lib/data/reel-themes";`:

```tsx
import { activePack } from "@/packs";
```

replace:

```tsx
  // Never the closing card (010): its message is not a name.
  const { data } = await sb.from("cards").select("photo_path, name, meaning").eq("status", "done").neq("kind", "cta").not("photo_path", "is", null)
```

with:

```tsx
  // Never the closing card (010) or the front card (023): their text is not a name.
  const { data } = await sb.from("cards").select("photo_path, name, meaning").eq("status", "done").in("kind", ["post", "preview"]).not("photo_path", "is", null)
```

and replace:

```tsx
        <SettingsForm initial={data as SettingsRow} sample={sample} voices={voices} themes={themes} />
```

with:

```tsx
        <SettingsForm initial={data as SettingsRow} sample={sample} voices={voices} themes={themes} frontCard={!!activePack().cards.cover} />
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/cover-actions.test.ts tests/initials-actions.test.ts tests/settings-form.test.tsx`
Expected: PASS.

- [ ] **Step 9: Run the related suites, the type check and lint**

Run: `npx vitest run tests/cta-actions.test.ts tests/autopilot-cores.test.ts tests/caption-actions.test.ts tests/letter-actions.test.ts tests/initials-name-nest.test.ts tests/post-fonts.test.ts tests/subject-age-actions.test.ts`
Expected: PASS (their settings have no `cover_enabled`, so nothing changes for them).

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add lib/cover/card.ts lib/posts/create.ts lib/actions/initials.ts lib/actions/validate.ts lib/actions/settings.ts components/settings/settings-form.tsx "app/(app)/settings/page.tsx" tests/cover-actions.test.ts tests/initials-actions.test.ts tests/settings-form.test.tsx
git commit -m "feat(front-card): queue the front card on new posts (Today, initials, Autopilot) and the Settings switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Today's 3 best names first (one ranking call alongside the caption)

**Files:**
- Create: `lib/ai/rank-names.ts`
- Modify: `lib/posts/create.ts` (import line 4; new block before `let fontsSaved = false;`; the line `const ai = theme && aiOn ? await lineFor(...)`; `cards: plan.cards` in the `create_post` call)
- Modify: `lib/actions/initials.ts` (import line 5; after `const historyRead = loadPostHistory(sb);`; the caption block lines ~157-167; the three `gallery.cards` / `plan.picks[k]` uses below it)
- Create: `tests/rank-names.test.ts`
- Modify: `tests/initials-actions.test.ts` (one import, one new test)

**Interfaces:**
- Consumes (Task 2): `withNameOrder(cards, order)` from `@/lib/planner`. (Task 3): `has023(s)` from `@/lib/cover/card`; `activePack().cards.cover` from `@/packs`.
- Produces (`lib/ai/rank-names.ts`, `server-only`):
  - `RANK_TIMEOUT_MS = 8000`, `RANK_TOP = 3`, `RANK_SYSTEM: string`
  - `rankPrompt(i: { gender: Gender; names: readonly { name: string; meaning: string }[] }): string`
  - `parseRanking(raw: unknown, names: readonly { name: string }[]): number[] | null` (indexes into `names`, best first, at most `RANK_TOP`)
  - `bestFirstOrder(top: readonly number[], count: number): number[]` (a full order: `top`, then the others in their order)
  - `bestFirstOn(s: Partial<SettingsRow> | null | undefined): boolean` (023 has run and the pack has front-card wording)
  - `rankNames(i: { gender: Gender; names: readonly { name: string; meaning: string }[] }, timeoutMs?: number): Promise<number[] | null>` (never throws; null = keep today's order)

- [ ] **Step 1: Write the failing tests**

Create `tests/rank-names.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, type Query, type Respond } from "./helpers/fake-supabase";

// Today's 3 best names first (spec 2026-11-21): one call to the app's AI, alongside the caption, checked in code, with
// today's order kept on any failure. The AI is mocked at the Gemini boundary (AI_PROVIDER unset).
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { RANK_SYSTEM, RANK_TIMEOUT_MS, bestFirstOn, bestFirstOrder, parseRanking, rankNames, rankPrompt } = await import("@/lib/ai/rank-names");
const { createPostCore } = await import("@/lib/posts/create");

type Call = { system: string; prompt: string; timeoutMs?: number };
const calls = () => generateJson.mock.calls.map((c) => c[0] as Call);
const rankCalls = () => calls().filter((c) => c.system === RANK_SYSTEM);

const names = [{ name: "Ruth", meaning: "friend" }, { name: "Naomi", meaning: "pleasant" }, { name: "Leah", meaning: "weary" }, { name: "Eden", meaning: "delight" }];

beforeEach(() => { generateJson.mockReset(); delete process.env.AI_PROVIDER; });

describe("checking the AI's answer", () => {
  it("only the post's own names, each once, at least 3 (or all of a shorter list); the first 3 are kept", () => {
    expect(parseRanking({ best: ["Eden", " ruth ", "Naomi"] }, names)).toEqual([3, 0, 1]);
    expect(parseRanking({ best: ["Eden", "Ruth", "Naomi", "Leah"] }, names)).toEqual([3, 0, 1]);
    expect(parseRanking({ best: ["Eden", "Zara", "Naomi"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Eden", "Eden", "Naomi"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Eden", "Ruth"] }, names)).toBeNull();
    expect(parseRanking({ best: ["Leah", "Ruth"] }, names.slice(0, 2))).toBeNull();
    expect(parseRanking({ best: ["Naomi", "Ruth"] }, names.slice(0, 2))).toEqual([1, 0]);
    expect(parseRanking({ best: [3, "Ruth", "Naomi"] }, names)).toBeNull();
    expect(parseRanking({ best: "Ruth" }, names)).toBeNull();
    expect(parseRanking(null, names)).toBeNull();
  });

  it("the full order: the top names first, then the others in today's order", () => {
    expect(bestFirstOrder([3, 0, 1], 4)).toEqual([3, 0, 1, 2]);
    expect(bestFirstOrder([2, 5], 6)).toEqual([2, 5, 0, 1, 3, 4]);
    expect(bestFirstOrder([], 3)).toEqual([0, 1, 2]);
  });

  it("the prompt lists the post's names with their meanings", () => {
    expect(rankPrompt({ gender: "girl", names })).toBe("Baby girl names for one post (name: meaning):\n- Ruth: friend\n- Naomi: pleasant\n- Leah: weary\n- Eden: delight\nPick the 3 best.");
    expect(RANK_SYSTEM).toMatch(/pretty, meaningful, easy to say and special/);
  });

  it("comes with the front card: once 023 has run (switch on or off), on a pack with front-card wording", () => {
    expect(bestFirstOn({ cover_enabled: true })).toBe(true);
    expect(bestFirstOn({ cover_enabled: false })).toBe(true);
    expect(bestFirstOn({})).toBe(false);
    expect(bestFirstOn(null)).toBe(false);
    const saved = process.env.NICHE;
    process.env.NICHE = "name-nest";
    try { expect(bestFirstOn({ cover_enabled: true })).toBe(false); } finally {
      if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved;
    }
  });
});

describe("rankNames", () => {
  it("asks the app's AI once and returns the post's top 3 as indexes, best first", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: { best: ["Eden", "ruth", "Naomi"] } });
    expect(await rankNames({ gender: "girl", names })).toEqual([3, 0, 1]);
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(calls()[0]).toMatchObject({ system: RANK_SYSTEM, prompt: rankPrompt({ gender: "girl", names }), timeoutMs: RANK_TIMEOUT_MS });
  });

  it("an AI failure, a bad answer, a thrown error or a late answer is null (never throws)", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    generateJson.mockResolvedValueOnce({ ok: true, data: { best: ["Ruth", "Zara", "Eden"] } });
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    generateJson.mockRejectedValueOnce(new Error("boom"));
    expect(await rankNames({ gender: "girl", names })).toBeNull();
    generateJson.mockImplementationOnce(() => new Promise((res) => setTimeout(() => res({ ok: true, data: { best: ["Ruth", "Naomi", "Eden"] } }), 300)));
    expect(await rankNames({ gender: "girl", names }, 50)).toBeNull();
  });

  it("one name: nothing to rank, no call", async () => {
    expect(await rankNames({ gender: "girl", names: names.slice(0, 1) })).toBeNull();
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("createPostCore on Today", () => {
  const THEME_ID = "22222222-2222-4222-8222-222222222222";
  const POST_ID = "33333333-3333-4333-8333-333333333333";
  const REQ = "44444444-4444-4444-8444-444444444444";
  const theme: ThemeRow = {
    id: THEME_ID, title: "Olive Grove", gender: "girl", backdrop: "olive trees", outfit: "linen dress", props: "olive branch and a clay jar",
    lighting: "soft light", palette: "olive, cream", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
  };
  const nm = (name: string): NameRow => ({ id: `n-${name}`, name, meaning: `${name.toLowerCase()} meaning`, gender: "girl", style: "single", status: "available",
    post_id: null, position: null, created_at: "", updated_at: "" });
  const NAMES = ["Abigail", "Hannah", "Naomi", "Ruth", "Esther", "Miriam", "Leah", "Rachel", "Sarah", "Deborah", "Eden", "Lydia"].map(nm);
  // 023 has run (cover_enabled is there), the front card is off and AI captions are off: only the ranking asks the AI.
  const settings = { id: 1, caption_template: "Lovely names.", hashtags: "", handle: "@unique_names", min_images: 9, max_images: 9, width: 1080, height: 1080,
    sound_on: true, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #momlife", caption_ai: false, cta_enabled: false, cover_enabled: false };
  let settingsRow: Record<string, unknown> = settings;
  type Planned = { position: number; name: string; name_id: string; shot: string; prompt: string; seed: number };
  const planned = () => (fake.rpcs.filter((r) => r.fn === "create_post").at(-1)!.args as { p: { cards: Planned[] } }).p.cards;
  const make = (o: Record<string, unknown> = {}) => createPostCore(fake.client as never,
    { gender: "girl", style: "single", count: null, postDate: "2026-11-22", requestId: REQ, subjectAge: "random", ...o });
  const rankWith = (best: unknown) => generateJson.mockImplementation(async (i: Call) => (i.system === RANK_SYSTEM ? { ok: true, data: { best } } : { ok: false, error: "off" }));
  const fresh = () => {
    fake = fakeSupabase((q) => respond(q));
    respond = (q: Query) => {
      if (q.table === "settings") return { data: settingsRow };
      if (q.table === "names") return { data: NAMES };
      if (q.table === "themes") return { data: [theme] };
      if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
      if (q.table === "rpc:create_post") return { data: { status: "ok", post_id: POST_ID } };
      if (q.table === "posts" && isUpdate(q)) return { data: [{ id: POST_ID }] };
      if (q.table === "posts") return { data: [] };
      return undefined;
    };
  };
  const todaysOrder = async () => {
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    fresh();
    await make();
    generateJson.mockReset();
    return planned();
  };
  beforeEach(() => { settingsRow = settings; fresh(); });

  it("the AI's top 3 come first, the rest keep today's order; every position keeps its photo plan", async () => {
    const today = await todaysOrder();
    expect(today).toHaveLength(9);
    fresh();
    rankWith([today[5].name, today[2].name.toUpperCase(), ` ${today[7].name} `]);
    expect(await make()).toEqual({ ok: true, postId: POST_ID });
    const ranked = planned();
    const rest = today.filter((_, k) => ![5, 2, 7].includes(k));
    expect(ranked.map((c) => c.name)).toEqual([today[5], today[2], today[7], ...rest].map((c) => c.name));
    expect(ranked.map((c) => c.name_id)).toEqual([today[5], today[2], today[7], ...rest].map((c) => c.name_id));
    expect(ranked.map((c) => [c.position, c.shot, c.prompt, c.seed])).toEqual(today.map((c) => [c.position, c.shot, c.prompt, c.seed]));
    expect(rankCalls()).toHaveLength(1);
    expect(rankCalls()[0].prompt).toContain(`- ${today[0].name}: ${today[0].name.toLowerCase()} meaning`);
    expect(rankCalls()[0].timeoutMs).toBeLessThanOrEqual(RANK_TIMEOUT_MS);
  });

  it("keeps today's order on an AI failure or a bad answer (unknown or repeated names, too few)", async () => {
    const today = (await todaysOrder()).map((c) => c.name);
    for (const bad of [["Nobody", today[1], today[2]], [today[1], today[1], today[2]], [today[1]], "Hannah"]) {
      fresh();
      rankWith(bad);
      expect((await make()).ok).toBe(true);
      expect(planned().map((c) => c.name)).toEqual(today);
    }
  });

  it("no ranking call for Autopilot's chosen names (already ranked) or before migration 023", async () => {
    rankWith(["Ruth", "Naomi", "Leah"]);
    expect((await make({ nameIds: NAMES.slice(0, 9).map((n) => n.id) })).ok).toBe(true);
    expect(rankCalls()).toHaveLength(0);
    const { cover_enabled: _c, ...before023 } = settings;
    void _c;
    settingsRow = before023;
    fresh();
    expect((await make()).ok).toBe(true);
    expect(rankCalls()).toHaveLength(0);
  });

  it("runs alongside the caption: both calls are out before either answers", async () => {
    settingsRow = { ...settings, caption_ai: true };
    fresh();
    const pending: (() => void)[] = [];
    let hold = true;
    generateJson.mockImplementation((i: Call) => {
      const answer = i.system === RANK_SYSTEM ? { ok: true, data: { best: ["Ruth", "Naomi", "Leah"] } } : { ok: false, error: "down" };
      return hold ? new Promise((res) => pending.push(() => res(answer))) : Promise.resolve(answer);
    });
    const made = make();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    hold = false;
    for (const go of pending) go();
    expect((await made).ok).toBe(true);
    expect(rankCalls()).toHaveLength(1);
  });
});
```

In `tests/initials-actions.test.ts`, add after the line `const { cardNameIdeasAction } = await import("@/lib/actions/suggest");`:

```ts
const { RANK_SYSTEM } = await import("@/lib/ai/rank-names");
```

and inside `describe("createInitialsPostAction (Generate)", () => {`, after the test added in Task 3 (`"with migration 023: a front card titled with the initials is queued first"`), add:

```ts
  it("with migration 023: the AI's top 3 names come first, each card keeping its photo plan and its source", async () => {
    type Card = Planned & { shot: string; prompt: string; seed: number };
    world({ settings: { ...settings, cover_enabled: false } });
    generateJson.mockResolvedValue({ ok: false, error: "down" });
    await createInitialsPostAction(input);
    const today = (rpc("create_initials_post")[0].p as { cards: Card[] }).cards;
    expect(today.map((c) => c.name)).toEqual(["Ansel Roan", "Arlo Reed", "Alaric Rhys", "Ambrose Rafe", "Amos Rhett", "Abel Ross"]);
    world({ settings: { ...settings, cover_enabled: false } });
    generateJson.mockReset();
    generateJson.mockImplementation(async (i: { system: string }) => (i.system === RANK_SYSTEM
      ? { ok: true, data: { best: ["Abel Ross", "Alaric Rhys", "Arlo Reed"] } } : { ok: false, error: "down" }));
    expect((await createInitialsPostAction(input)).ok).toBe(true);
    const ranked = (rpc("create_initials_post")[0].p as { cards: Card[] }).cards;
    expect(ranked.map((c) => [c.position, c.name, c.source])).toEqual([
      [1, "Abel Ross", "used"], [2, "Alaric Rhys", "new"], [3, "Arlo Reed", "available"],
      [4, "Ansel Roan", "available"], [5, "Ambrose Rafe", "new"], [6, "Amos Rhett", "used"],
    ]);
    expect(ranked.map((c) => [c.shot, c.prompt, c.seed])).toEqual(today.map((c) => [c.shot, c.prompt, c.seed]));
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `npx vitest run tests/rank-names.test.ts tests/initials-actions.test.ts`
Expected: FAIL (`@/lib/ai/rank-names` does not exist; the cards keep today's order).

- [ ] **Step 3: `lib/ai/rank-names.ts`**

```ts
import "server-only";
import type { Gender, SettingsRow } from "@/lib/db/types";
import type { GeminiSchema } from "./gemini";
import { aiJson } from "./provider";
import { has023 } from "@/lib/cover/card";
import { activePack } from "@/packs";

// The 3 best names first (spec 2026-11-21). When a Today post (single names or initials) is made, ONE call to the app's
// AI (Gemini, or Claude Haiku with AI_PROVIDER=claude, the same AI as the captions) picks the 3 names a parent would
// most love. It runs alongside the caption with its own ~8 s limit, and its answer is checked in code (the post's own
// names, each once); on a failure, a late answer or any other answer the post keeps today's order. Never throws, never
// blocks or fails a post. Autopilot's names come ranked by its own name check (appeal), so it never calls this.

export const RANK_TIMEOUT_MS = 8000;
/** How many names lead the post (the 3 a phone shows after the front card). */
export const RANK_TOP = 3;

export const RANK_SYSTEM = [
  "You are a mom choosing a name for your own baby, and you know what other parents love.",
  "From the list of baby names for one Facebook post, pick the names parents would most love to choose: pretty, meaningful, easy to say and special.",
  "Answer with names from the list only, written exactly as in the list, best first, each name once.",
].join("\n");

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: { best: { type: "ARRAY", items: { type: "STRING" }, description: "The best names from the list, best first" } },
  required: ["best"],
};

type Named = { name: string; meaning: string };
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => squash(s).toLowerCase();

export function rankPrompt(i: { gender: Gender; names: readonly Named[] }): string {
  const want = Math.min(RANK_TOP, i.names.length);
  return [`Baby ${i.gender} names for one post (name: meaning):`, ...i.names.map((n) => `- ${squash(n.name)}: ${squash(n.meaning)}`), `Pick the ${want} best.`].join("\n");
}

/**
 * The AI's answer as indexes into `names`, best first, at most RANK_TOP. Null for anything else: not a list of
 * strings, a name that is not the post's, a name twice, or fewer than RANK_TOP (all of them on a shorter post).
 */
export function parseRanking(raw: unknown, names: readonly { name: string }[]): number[] | null {
  const list = raw && typeof raw === "object" ? (raw as { best?: unknown }).best : null;
  if (!Array.isArray(list)) return null;
  const index = new Map(names.map((n, i) => [key(n.name), i]));
  const out: number[] = [];
  for (const v of list) {
    if (typeof v !== "string") return null;
    const i = index.get(key(v));
    if (i === undefined || out.includes(i)) return null;
    out.push(i);
  }
  const want = Math.min(RANK_TOP, names.length);
  return out.length >= want ? out.slice(0, want) : null;
}

/** The full order of a post's cards: the top indexes first, then every other card in its current order. */
export function bestFirstOrder(top: readonly number[], count: number): number[] {
  return [...top, ...Array.from({ length: count }, (_, i) => i).filter((i) => !top.includes(i))];
}

/** Today's ranking comes with the front card: once migration 023 has run (switch on or off), on a pack with front-card wording. */
export const bestFirstOn = (s: Partial<SettingsRow> | null | undefined) => has023(s) && !!activePack().cards.cover;

/** One ranking call: the post's best names as indexes, best first; null = keep today's order. */
export async function rankNames(i: { gender: Gender; names: readonly Named[] }, timeoutMs = RANK_TIMEOUT_MS): Promise<number[] | null> {
  if (i.names.length < 2) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    const call = aiJson<unknown>({ task: "small", system: RANK_SYSTEM, prompt: rankPrompt(i), schema: SCHEMA, temperature: 0.3, timeoutMs })
      .then((r) => (r.ok ? parseRanking(r.data, i.names) : null))
      .catch(() => null);
    return await Promise.race([call, late]);
  } finally {
    clearTimeout(timer);
  }
}
```

(The answer is checked after the call, not through `aiJson`'s `parse`, so it is checked the same way whatever the AI layer returns.)

- [ ] **Step 4: Rank alongside the caption in `createPostCore` (`lib/posts/create.ts`)**

Replace:

```ts
import { planPost, type AgeChoice } from "@/lib/planner";
```

with:

```ts
import { planPost, withNameOrder, type AgeChoice } from "@/lib/planner";
import { RANK_TIMEOUT_MS, bestFirstOn, bestFirstOrder, rankNames } from "@/lib/ai/rank-names";
```

Replace:

```ts
  let fontsSaved = false;
```

with:

```ts
  // The 3 best names first (Today, from 023): ONE ranking call per set of names, alongside the caption, under its own
  // deadline (RANK_TIMEOUT_MS) for the whole action; past it, or on any failure, today's order. Autopilot's chosen names
  // come ranked already, so it never asks.
  const rankDeadline = Date.now() + RANK_TIMEOUT_MS;
  const ranks = new Map<string, Promise<number[] | null>>();
  const rankFor = (names: { name: string; meaning: string }[]) => {
    const key = names.map((n) => n.name).join(",");
    if (!ranks.has(key)) {
      const left = rankDeadline - Date.now();
      if (left < 500) return Promise.resolve(null);
      ranks.set(key, rankNames({ gender: input.gender, names }, left));
    }
    return ranks.get(key)!;
  };
  let fontsSaved = false;
```

Replace:

```ts
    const ai = theme && aiOn ? await lineFor(theme, postNames, captionStyle, h) : null;
```

with:

```ts
    // The caption and the ranking run side by side: Generate waits for the slower one, never for both in turn.
    const [ai, top] = await Promise.all([
      theme && aiOn ? lineFor(theme, postNames, captionStyle, h) : Promise.resolve(null),
      !input.nameIds && bestFirstOn(s) ? rankFor(plan.cards) : Promise.resolve(null),
    ]);
    // The AI's top names lead; every position keeps its photo plan (the session's cover shot first, still lifes spread).
    const ordered = top ? withNameOrder(plan.cards, bestFirstOrder(top, plan.cards.length)) : plan.cards;
```

Replace:

```ts
      theme_id: plan.theme_id, caption, cards: plan.cards, ...fonts, subject_age: age,
```

with:

```ts
      theme_id: plan.theme_id, caption, cards: ordered, ...fonts, subject_age: age,
```

- [ ] **Step 5: Rank alongside the caption on a post by initials (`lib/actions/initials.ts`)**

Replace:

```ts
import { planInitialsPost, type AgeChoice } from "@/lib/planner";
```

with:

```ts
import { planInitialsPost, withNameOrder, type AgeChoice } from "@/lib/planner";
import { RANK_TIMEOUT_MS, bestFirstOn, bestFirstOrder, rankNames } from "@/lib/ai/rank-names";
```

Replace:

```ts
  const historyRead = loadPostHistory(sb);
```

with:

```ts
  const historyRead = loadPostHistory(sb);
  // The 3 best names first (from 023): one ranking call per set of names, alongside the caption, under its own deadline.
  const rankDeadline = Date.now() + RANK_TIMEOUT_MS;
  const ranks = new Map<string, Promise<number[] | null>>();
```

Replace:

```ts
    const captionStyle = pickStyle(h.styles, postNames);
    const aiOn = captionAiOn(s);
    let ai: AiCaption | null = null;
    if (theme && aiOn) {
      const key = `${theme.id}|${plan.picks.map((p) => p.name).join(",")}`;
      const left = aiDeadline - Date.now();
      if (!lines.has(key) && left >= 500) {
        lines.set(key, aiCaptionLine({ theme, gender: input.gender, style: "two-word", captionStyle, names: postNames, recent: h.texts, recentTags: recentTags(h), initials }, left));
      }
      ai = (await lines.get(key)) ?? null;
    }
```

with:

```ts
    const captionStyle = pickStyle(h.styles, postNames);
    const aiOn = captionAiOn(s);
    let captionLine: Promise<AiCaption | null> = Promise.resolve(null);
    if (theme && aiOn) {
      const key = `${theme.id}|${plan.picks.map((p) => p.name).join(",")}`;
      const left = aiDeadline - Date.now();
      if (!lines.has(key) && left >= 500) {
        lines.set(key, aiCaptionLine({ theme, gender: input.gender, style: "two-word", captionStyle, names: postNames, recent: h.texts, recentTags: recentTags(h), initials }, left));
      }
      captionLine = lines.get(key) ?? Promise.resolve(null);
    }
    let rankLine: Promise<number[] | null> = Promise.resolve(null);
    if (bestFirstOn(s)) {
      const key = plan.picks.map((p) => p.name).join(",");
      const left = rankDeadline - Date.now();
      if (!ranks.has(key) && left >= 500) ranks.set(key, rankNames({ gender: input.gender, names: plan.picks.map((p) => ({ name: p.name, meaning: p.meaning })) }, left));
      rankLine = ranks.get(key) ?? Promise.resolve(null);
    }
    // The caption and the ranking run side by side: Generate waits for the slower one, never for both in turn.
    const [line, top] = await Promise.all([captionLine, rankLine]);
    const ai: AiCaption | null = line ?? null;
    // The AI's top names lead; every position keeps its photo plan, and each pick (source, origin) follows its name.
    const order = top ? bestFirstOrder(top, gallery.cards.length) : null;
    const ordered = order ? withNameOrder(gallery.cards, order) : gallery.cards;
    const orderedPicks = order ? order.map((k) => plan.picks[k]) : plan.picks;
```

Replace:

```ts
        cards: gallery.cards.map((c, k) => ({ position: c.position, source: c.source, name_id: c.name_id, name: c.name, meaning: c.meaning, shot: c.shot, prompt: c.prompt, seed: c.seed,
          ...(plan.picks[k].origin ? { origin: plan.picks[k].origin } : {}) })),
```

with:

```ts
        cards: ordered.map((c, k) => ({ position: c.position, source: c.source, name_id: c.name_id, name: c.name, meaning: c.meaning, shot: c.shot, prompt: c.prompt, seed: c.seed,
          ...(orderedPicks[k].origin ? { origin: orderedPicks[k].origin } : {}) })),
```

Replace:

```ts
      const fresh = gallery.cards.filter((c) => c.source === "new");
```

with:

```ts
      const fresh = ordered.filter((c) => c.source === "new");
```

Replace:

```ts
      const cards = gallery.cards.filter((c) => c.source !== "used").map((c) => ({
```

with:

```ts
      const cards = ordered.filter((c) => c.source !== "used").map((c) => ({
```

(`const made = reuse ? gallery.cards.length : gallery.cards.filter(...)` below only counts cards, so it stays as it is.)

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/rank-names.test.ts tests/initials-actions.test.ts tests/cover-actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the related suites, the type check and lint**

Run: `npx vitest run tests/caption-actions.test.ts tests/letter-actions.test.ts tests/cta-actions.test.ts tests/autopilot-cores.test.ts tests/initials-name-nest.test.ts tests/post-fonts.test.ts tests/subject-age-actions.test.ts tests/ai-provider.test.ts`
Expected: PASS (before 023 nothing ranks, so their AI call counts are unchanged).

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/rank-names.ts lib/posts/create.ts lib/actions/initials.ts tests/rank-names.test.ts tests/initials-actions.test.ts
git commit -m "feat(front-card): Today ranks the post's 3 best names alongside the caption (8 s, checked, today's order on failure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Autopilot names: appeal from the name check, best first, 8 to 14 names

**Files:**
- Modify: `lib/autopilot/judge-names.ts` (`NameVerdict` line 13; `NAMES_JUDGE_SYSTEM` lines 15-28; `SCHEMA` lines 30-46; `parseVerdicts` lines 60-67; `judgeNames` loop lines 82-89)
- Modify: `lib/autopilot/names-step.ts` (new constants/function after `LEFT_ALONE_LISTED`; `good` line ~48; stock push line ~77; AI round lines ~107-112; final return line ~122)
- Modify: `lib/autopilot/plan.ts` (lines 11-13)
- Modify: `lib/planner/plan.ts` (`planPost`, lines ~63-64 comment and line ~89 `const chosen = ...`)
- Modify: `tests/autopilot-judges.test.ts`, `tests/autopilot-names-step.test.ts`, `tests/autopilot-plan.test.ts`, `tests/autopilot-cores.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 2-4 (independent of the front card code).
- Produces:
  - `NameVerdict.appeal: number` (1-10 from the judge; 0 when the name was not judged or has no meaning)
  - `TOP_BY_APPEAL = 3` and `bestFirst<T extends { appeal: number }>(list: readonly T[]): T[]` in `lib/autopilot/names-step.ts`
  - `pickNames` returns `nameIds` best-first (top 3 by appeal, then the rest in random order)
  - `NAMES_PER_POST = { min: 8, max: 14 }` (`MIN_GOOD_NAMES` stays 8)
  - `planPost` keeps the order of `request.nameIds` (card position 1 = the first id)

- [ ] **Step 1: Update the existing tests and write the new ones**

In `tests/autopilot-judges.test.ts`:

1. In the test `"sends the post's target and every name; verdicts come back in the input order, a skipped name fails"`, replace its answer and expectation:

```ts
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "Woman From Sabine " },
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "" },
    ] }));
```

with

```ts
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "Woman From Sabine ", appeal: 8 },
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "", appeal: 1 },
    ] }));
```

and

```ts
    expect(r.ok && r.data).toEqual([
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "", meaning_wrong: false },
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "woman from sabine", meaning_wrong: false },
      { name: "Selah", good: false, fits: false, reason: "not judged", meaning: "", meaning_wrong: false },
    ]);
```

with

```ts
    expect(r.ok && r.data).toEqual([
      { name: "Sqiggle", good: false, fits: true, reason: "made up", meaning: "", meaning_wrong: false, appeal: 1 },
      { name: "Sabina", good: true, fits: true, reason: "", meaning: "woman from sabine", meaning_wrong: false, appeal: 8 },
      { name: "Selah", good: false, fits: false, reason: "not judged", meaning: "", meaning_wrong: false, appeal: 0 },
    ]);
```

2. In `"asks whether the meaning is wrong (schema and prompt), passes meaning_wrong through, and keeps commas in meanings"`, add `appeal: 9`, `appeal: 7` and `appeal: 1` to the Hannah, Ruth and Mara answers:

```ts
      { name: "Hannah", good: true, fits: true, reason: "", meaning: "Grace, Favor!", meaning_wrong: true, appeal: 9 },
      { name: "Ruth", good: true, fits: true, reason: "", meaning: "friend, companion", meaning_wrong: false, appeal: 7 },
      { name: "Mara", good: false, fits: true, reason: "sad meaning", meaning: "bitter", meaning_wrong: true, appeal: 1 },
```

3. In `"a kept name without a meaning does not pass"`, replace the answer with:

```ts
    create.mockResolvedValueOnce(answer({ names: [{ name: "Ruth", good: true, fits: true, reason: "", meaning: "", appeal: 6 }] }));
```

4. In `"61 names make two calls and the usage adds up"`, replace the `verdicts` line with:

```ts
    const verdicts = (ns: { name: string }[]) => ({ names: ns.map((n) => ({ name: n.name, good: true, fits: true, reason: "", meaning: "fine", appeal: 5 })) });
```

5. Add inside `describe("judgeNames", () => {` (after `"a kept name without a meaning does not pass"`):

```ts
  it("appeal is required and checked: 1 to 10, a whole number; any other verdict is not taken (the name fails as not judged)", async () => {
    create.mockResolvedValueOnce(answer({ names: [
      { name: "Ruth", good: true, fits: true, reason: "", meaning: "friend", meaning_wrong: false, appeal: 9 },
      { name: "Naomi", good: true, fits: true, reason: "", meaning: "pleasant", meaning_wrong: false },
      { name: "Leah", good: true, fits: true, reason: "", meaning: "weary", meaning_wrong: false, appeal: 11 },
      { name: "Eden", good: true, fits: true, reason: "", meaning: "delight", meaning_wrong: false, appeal: 7.5 },
    ] }));
    const r = await judgeNames({ gender: "girl", target: { kind: "theme", title: "Biblical", hint: null }, names: [
      { name: "Ruth", meaning: "friend" }, { name: "Naomi", meaning: "pleasant" }, { name: "Leah", meaning: "weary" }, { name: "Eden", meaning: "delight" },
    ] });
    expect(r.ok && r.data.map((v) => [v.name, v.good, v.appeal, v.reason])).toEqual([
      ["Ruth", true, 9, ""], ["Naomi", false, 0, "not judged"], ["Leah", false, 0, "not judged"], ["Eden", false, 0, "not judged"],
    ]);
    const req = create.mock.calls[0][0];
    expect(req.system).toMatch(/appeal: how much a parent would love to choose this name, from 1 to 10/);
    const item = req.output_config.format.schema.properties.names.items;
    expect(item.properties.appeal).toMatchObject({ type: "integer" });
    expect(item.required).toContain("appeal");
  });
```

In `tests/autopilot-names-step.test.ts`:

1. Replace the import line:

```ts
import { pickNames, type NamesDeps } from "@/lib/autopilot/names-step";
```

with

```ts
import { bestFirst, pickNames, type NamesDeps } from "@/lib/autopilot/names-step";
```

2. In `judgeWith`, give every verdict an appeal (a test can still override it):

```ts
  data: i.names.map((n) => ({ name: n.name, good: true, fits: true, reason: "", meaning: n.meaning.toLowerCase(), meaning_wrong: false, appeal: 5, ...bad[n.name] })),
```

3. Add at the end of `describe("pickNames", () => {`:

```ts
  it("the post's names lead with its top 3 by appeal, the rest in random order, with no extra AI call", async () => {
    const appeal: Record<string, number> = { Sabina: 2, Selah: 9, Sienna: 4, Sloane: 10, Stella: 3, Sage: 8, Sora: 1, Saoirse: 5, Sylvie: 6, Seraphina: 7 };
    const judge = judgeWith(Object.fromEntries(Object.entries(appeal).map(([n, a]) => [n, { appeal: a }])));
    const { d } = deps(S.slice(0, 10).map((n) => nm(n)), judge);
    const r = await pickNames(d, item, null);
    expect(r.kind === "ok" && r.nameIds.slice(0, 3)).toEqual(["n-Sloane", "n-Selah", "n-Sage"]);
    expect(r.kind === "ok" && [...r.nameIds].sort()).toEqual(S.slice(0, 10).map((n) => `n-${n}`).sort());
    expect(judge).toHaveBeenCalledTimes(1);
    expect(d.suggest).not.toHaveBeenCalled();
  });

  it("bestFirst: the top 3 by appeal (a tie keeps the given order), then the rest as given", () => {
    const list = [{ id: "a", appeal: 5 }, { id: "b", appeal: 7 }, { id: "c", appeal: 7 }, { id: "d", appeal: 1 }, { id: "e", appeal: 6 }];
    expect(bestFirst(list).map((x) => x.id)).toEqual(["b", "c", "e", "a", "d"]);
    expect(bestFirst(list.slice(0, 2)).map((x) => x.id)).toEqual(["b", "a"]);
  });
```

In `tests/autopilot-plan.test.ts`, replace:

```ts
    expect(items.every((i) => i.nameCount >= 9 && i.nameCount <= 15)).toBe(true);
  });
  it("9 to 15 names a post: 10 to 16 cards with the closing card (owner, 2026-11-21)", () => {
    const at = (r: number) => planRun({ firstDay: "2026-11-21", days: 1, last: null, themes: [], minImages: 6, maxImages: 26, rng: () => r });
    expect(at(0).every((i) => i.nameCount === 9)).toBe(true);
    expect(at(0.999).every((i) => i.nameCount === 15)).toBe(true);
  });
```

with

```ts
    expect(items.every((i) => i.nameCount >= 8 && i.nameCount <= 14)).toBe(true);
  });
  it("8 to 14 names a post: 10 to 16 cards with the front and closing cards (owner, 2026-11-21)", () => {
    const at = (r: number) => planRun({ firstDay: "2026-11-21", days: 1, last: null, themes: [], minImages: 6, maxImages: 26, rng: () => r });
    expect(at(0).every((i) => i.nameCount === 8)).toBe(true);
    expect(at(0.999).every((i) => i.nameCount === 14)).toBe(true);
    expect(MIN_GOOD_NAMES).toBe(8);
  });
```

and in that file's import replace

```ts
  AFTERNOON, MORNING, addDays, dayLabel, firstDay, labelText, lastFacebook, manilaDay, nextLabel, planProblems, planRun,
```

with

```ts
  AFTERNOON, MIN_GOOD_NAMES, MORNING, addDays, dayLabel, firstDay, labelText, lastFacebook, manilaDay, nextLabel, planProblems, planRun,
```

In `tests/autopilot-cores.test.ts`, add inside `describe("planPost with chosen names", () => {` (after `"uses exactly those names"`):

```ts
  it("keeps the chosen names in their order (Autopilot sends the best first): card 1 is the first name", () => {
    const ids = [names[5], names[0], names[9], names[2], names[7], names[1], names[3], names[4], names[6]].map((n) => n.id);
    const r = planPost({ request: { gender: "girl", style: "single", count: null, postDate: "2026-11-21", age: "random", nameIds: ids }, names, themes: [theme], settings });
    expect(r.ok && r.cards.map((c) => c.name_id)).toEqual(ids);
    expect(r.ok && r.cards.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `npx vitest run tests/autopilot-judges.test.ts tests/autopilot-names-step.test.ts tests/autopilot-plan.test.ts tests/autopilot-cores.test.ts`
Expected: FAIL (no `appeal` in the verdicts or the schema; `bestFirst` is not exported; 9 to 15 names; planPost shuffles the chosen names).

- [ ] **Step 3: `appeal` in the name check (`lib/autopilot/judge-names.ts`)**

Replace:

```ts
export interface NameVerdict { name: string; good: boolean; fits: boolean; reason: string; meaning: string; meaning_wrong: boolean }
```

with:

```ts
/** `appeal`: how much a parent would love to choose it, 1 to 10 from the judge (0 = not judged, or no meaning). */
export interface NameVerdict { name: string; good: boolean; fits: boolean; reason: string; meaning: string; meaning_wrong: boolean; appeal: number }
```

In `NAMES_JUDGE_SYSTEM`, replace:

```ts
  "reason: why it is not good or does not fit, in a few plain words ('made up', 'hard to say', 'bad meaning', 'mostly a boy name', 'too close to Aria', 'not biblical'); empty when it passes.",
```

with:

```ts
  "reason: why it is not good or does not fit, in a few plain words ('made up', 'hard to say', 'bad meaning', 'mostly a boy name', 'too close to Aria', 'not biblical'); empty when it passes.",
  "appeal: how much a parent would love to choose this name, from 1 to 10 (pretty, meaningful, easy to say, special); 1 for a name that is not good.",
```

In `SCHEMA`, replace:

```ts
          name: { type: "STRING" }, good: { type: "BOOLEAN" }, fits: { type: "BOOLEAN" },
          reason: { type: "STRING" }, meaning: { type: "STRING" }, meaning_wrong: { type: "BOOLEAN" },
        },
        required: ["name", "good", "fits", "reason", "meaning", "meaning_wrong"],
```

with:

```ts
          name: { type: "STRING" }, good: { type: "BOOLEAN" }, fits: { type: "BOOLEAN" },
          reason: { type: "STRING" }, meaning: { type: "STRING" }, meaning_wrong: { type: "BOOLEAN" },
          appeal: { type: "INTEGER", description: "1 to 10: how much a parent would love to choose it" },
        },
        required: ["name", "good", "fits", "reason", "meaning", "meaning_wrong", "appeal"],
```

In `parseVerdicts`, replace:

```ts
    && typeof (v as NameVerdict).reason === "string" && typeof (v as NameVerdict).meaning === "string");
```

with:

```ts
    && typeof (v as NameVerdict).reason === "string" && typeof (v as NameVerdict).meaning === "string"
    && Number.isInteger((v as NameVerdict).appeal) && (v as NameVerdict).appeal >= 1 && (v as NameVerdict).appeal <= 10);
```

In `judgeNames`, replace:

```ts
      if (!v) { out.push({ name: n.name, good: false, fits: false, reason: "not judged", meaning: "", meaning_wrong: false }); continue; }
      const meaning = cleanMeaning(v.meaning);
      out.push(v.good && v.fits && !meaning
        ? { name: n.name, good: false, fits: v.fits, reason: "no meaning", meaning: "", meaning_wrong: false }
        : { name: n.name, good: v.good, fits: v.fits, reason: v.reason.trim().slice(0, 80), meaning: v.good ? meaning : "", meaning_wrong: v.good && !!meaning && v.meaning_wrong === true });
```

with:

```ts
      if (!v) { out.push({ name: n.name, good: false, fits: false, reason: "not judged", meaning: "", meaning_wrong: false, appeal: 0 }); continue; }
      const meaning = cleanMeaning(v.meaning);
      out.push(v.good && v.fits && !meaning
        ? { name: n.name, good: false, fits: v.fits, reason: "no meaning", meaning: "", meaning_wrong: false, appeal: 0 }
        : { name: n.name, good: v.good, fits: v.fits, reason: v.reason.trim().slice(0, 80), meaning: v.good ? meaning : "", meaning_wrong: v.good && !!meaning && v.meaning_wrong === true, appeal: v.appeal });
```

- [ ] **Step 4: Best first in the names step (`lib/autopilot/names-step.ts`)**

Replace:

```ts
/** Names listed in the "left alone" event. */
const LEFT_ALONE_LISTED = 20;
```

with:

```ts
/** Names listed in the "left alone" event. */
const LEFT_ALONE_LISTED = 20;
/** The post's best names by the check's appeal lead it: the 3 a phone shows after the front card (spec 2026-11-21). */
export const TOP_BY_APPEAL = 3;

/** The top TOP_BY_APPEAL by appeal first (a tie keeps the given order), then the rest in the given (random) order. */
export function bestFirst<T extends { appeal: number }>(list: readonly T[]): T[] {
  const top = [...list].sort((a, b) => b.appeal - a.appeal).slice(0, TOP_BY_APPEAL);
  return [...top, ...list.filter((x) => !top.includes(x))];
}
```

Replace:

```ts
  const good: { id: string; name: string }[] = [];
```

with:

```ts
  const good: { id: string; name: string; appeal: number }[] = [];
```

Replace:

```ts
      good.push({ id: n.id, name: n.name });
```

with:

```ts
      good.push({ id: n.id, name: n.name, appeal: v.appeal });
```

Replace:

```ts
    const keep = fresh.flatMap((n, k) => (r.data[k].good && r.data[k].fits ? [{ name: n.name, meaning: r.data[k].meaning || n.meaning, gender: item.gender }] : []));
    for (const n of fresh) known.add(n.name.toLowerCase());
    for (const saved of await d.repo.addNames(keep)) {
      good.push(saved);
      base.added.push(saved.name);
    }
```

with:

```ts
    const keep = fresh.flatMap((n, k) => (r.data[k].good && r.data[k].fits ? [{ name: n.name, meaning: r.data[k].meaning || n.meaning, gender: item.gender, appeal: r.data[k].appeal }] : []));
    for (const n of fresh) known.add(n.name.toLowerCase());
    const appealOf = new Map(keep.map((k) => [k.name.toLowerCase(), k.appeal]));
    for (const saved of await d.repo.addNames(keep)) {
      good.push({ ...saved, appeal: appealOf.get(saved.name.toLowerCase()) ?? 0 });
      base.added.push(saved.name);
    }
```

Replace:

```ts
  // shuffle() already returns a new array, so `good` is not mutated.
  return { ...base, kind: "ok", nameIds: shuffle(good, d.rng).slice(0, item.name_count).map((g) => g.id) };
```

with:

```ts
  // A random sample of the good names (shuffle() returns a new array, `good` is not mutated), its best 3 by appeal first.
  return { ...base, kind: "ok", nameIds: bestFirst(shuffle(good, d.rng).slice(0, item.name_count)).map((g) => g.id) };
```

- [ ] **Step 5: 8 to 14 names (`lib/autopilot/plan.ts`)**

Replace:

```ts
export const NAMES_PER_POST = { min: 9, max: 15 } as const;
/** A post needs at least this many good names (and passed name cards), or it is held. */
export const MIN_GOOD_NAMES = 8;
```

with:

```ts
/** 8 to 14 names a post: 10 to 16 cards with the front and closing cards (owner, 2026-11-21). */
export const NAMES_PER_POST = { min: 8, max: 14 } as const;
/** The names step needs at least this many good names to make a post, or it is held. */
export const MIN_GOOD_NAMES = 8;
```

- [ ] **Step 6: planPost keeps the chosen names' order (`lib/planner/plan.ts`)**

Replace:

```ts
  const chosen = shuffle(pool, rng).slice(0, Math.min(want, pool.length));
```

with:

```ts
  // Chosen names (Autopilot) keep their order, the best first; any other post's names are a seeded random pick.
  const byId = new Map(pool.map((n) => [n.id, n]));
  const chosen = r.nameIds ? r.nameIds.flatMap((id) => byId.get(id) ?? []) : shuffle(pool, rng).slice(0, Math.min(want, pool.length));
```

(The photo plan does not depend on the names' order: `galleryCards` draws the shots, props and ages from its own seeds, so only which name lands on which card changes.)

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/autopilot-judges.test.ts tests/autopilot-names-step.test.ts tests/autopilot-plan.test.ts tests/autopilot-cores.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the related suites, the type check and lint**

Run: `npx vitest run tests/autopilot-engine.test.ts tests/autopilot-wiring.test.ts tests/autopilot-actions.test.ts tests/autopilot-page.test.tsx tests/planner.test.ts tests/letter-post.test.ts tests/pack-snapshots.test.ts`
Expected: PASS (no snapshot changes: Today's planPost is unchanged).

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/autopilot/judge-names.ts lib/autopilot/names-step.ts lib/autopilot/plan.ts lib/planner/plan.ts tests/autopilot-judges.test.ts tests/autopilot-names-step.test.ts tests/autopilot-plan.test.ts tests/autopilot-cores.test.ts
git commit -m "feat(autopilot): the name check scores appeal, the 3 most appealing names lead, 8 to 14 names a post

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Autopilot checks the front card, leaves a failing one out, and posts with 7 passed name cards

**Files:**
- Modify: `lib/autopilot/plan.ts` (after `MIN_GOOD_NAMES`)
- Modify: `lib/autopilot/judge-photos.ts` (`PHOTO_JUDGE_SYSTEM` lines 7-23; `judgeCard` lines 35-42; `LOOKALIKE_SYSTEM` lines 44-49; `judgeLookAlike` lines 53-60)
- Modify: `lib/autopilot/engine.ts` (import line 14; `cardName` line 60; new `lookAlikeOrder`; `failCard` lines 207-220; `couldNotCheck` lines 222-233; the floor lines 257-260; `lookAlike` lines 299-301)
- Modify: `tests/autopilot-engine.test.ts`, `tests/autopilot-judges.test.ts`

**Interfaces:**
- Consumes (Task 1): `CardKind` `"cover"`; `cardOrder` (front card first) from `@/lib/files/save`.
- Produces:
  - `MIN_PASSED_NAME_CARDS = 7` in `lib/autopilot/plan.ts`
  - `stampedText(card: Pick<CardRow, "kind" | "name"> & Partial<Pick<CardRow, "meaning">>): string` in `lib/autopilot/judge-photos.ts`; `judgeCard` takes the same card type
  - `lookAlikeOrder(cards: CardRow[]): CardRow[]` in `lib/autopilot/engine.ts` (posting order, front card moved to the end)
  - Run event for a front card out of remakes: kind `"card_removed"`, text `` `${dayLabel(day)} · ${label} · ${gender}: Front card left out: ${why}.` ``

- [ ] **Step 1: Write the failing tests**

In `tests/autopilot-engine.test.ts`:

1. Replace the whole test `"holds a post with fewer than 8 passed name cards, or one ready too late"`:

```ts
  it("holds a post with fewer than 8 passed name cards, or one ready too late", async () => {
    // (removed cards are unselected, as the engine leaves them)
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: tenCards({ check_state: "passed" }).map((c, i) => (i < 3 ? { ...c, check_state: "removed" as const, selected: false } : c)) });
    await tick(d);
    expect(m.db.items[0]).toMatchObject({ state: "held", note: expect.stringMatching(/^Only 7 name cards passed/) });
```

(keep its `late` part below as it is) with:

```ts
  it("7 passed name cards are enough; 6 hold the post; one ready too late is held", async () => {
    // (removed cards are unselected, as the engine leaves them)
    const removed = (n: number) => tenCards({ check_state: "passed" }).map((c, i) => (i < n ? { ...c, check_state: "removed" as const, selected: false } : c));
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: removed(4) });
    await tick(d);
    expect(m.db.items[0]).toMatchObject({ state: "held", note: "Only 6 name cards passed the checks (7 needed). Remake or add cards, then schedule it yourself." });
    const seven = setup({ items: [item("i1", { state: "checking", post_id: "p1", lookalike_done: true })], cards: removed(3) });
    await tick(seven.d);
    expect(seven.m.db.items[0].state).toBe("scheduled");
    expect(seven.d.schedule).toHaveBeenCalledWith("p1", "2026-11-21T01:12:00Z");
```

(The rest of that test, from `const late = setup(` to its closing `});`, stays.)

2. Add these tests at the end of `describe("tick", () => {` (before `it("summary and cost"` if that test sits in the same describe; anywhere inside the describe is fine):

```ts
  const front = (o: Partial<CardRow> = {}) => card("f", { kind: "cover", position: 0, order_index: 0, name: "'S' Names", meaning: "for baby girl", ...o });

  it("the front card is checked like any card and remade on a fail", async () => {
    const judgeCard = vi.fn(async (c: CardRow) => (c.kind === "cover" ? fail("hands") : pass));
    const { m, d } = setup({ items: [item("i1", { state: "making", post_id: "p1" })], cards: [front(), ...tenCards()] }, { judgeCard });
    await tick(d);
    expect(judgeCard).toHaveBeenCalledWith(expect.objectContaining({ id: "f", kind: "cover" }), "https://signed/cards/f.jpg");
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "f" }), { check_state: "pending", check_note: "Remade: odd hands or fingers", remakes: 1 });
    expect(m.db.runs[0].events.map((e) => e.text)).toContain("Sat, Nov 21 · Letter S · girl: the front card remade (odd hands or fingers).");
  });

  it("a front card that still fails after its 2 remakes is left out (unselected); the post is not held and goes out", async () => {
    const judgeCard = vi.fn(async (c: CardRow) => (c.kind === "cover" ? fail("hands") : pass));
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1" })],
      cards: [front({ remakes: MAX_REMAKES, check_note: "Remade: odd hands or fingers" }), ...tenCards({ check_state: "passed" })] }, { judgeCard });
    expect(await tick(d)).toEqual({ ran: true, status: "done" });
    expect(m.db.cards[0]).toMatchObject({ id: "f", check_state: "removed", selected: false, check_note: "Removed: odd hands or fingers" });
    expect(m.db.runs[0].events.map((e) => e.text)).toContain("Sat, Nov 21 · Letter S · girl: Front card left out: odd hands or fingers.");
    expect(d.schedule).toHaveBeenCalledWith("p1", "2026-11-21T01:12:00Z");
    expect(m.db.items[0].state).toBe("scheduled");
  });

  it("a front card that can't be checked twice is left out too, never a hold", async () => {
    const judgeCard = vi.fn(async (c: CardRow) => (c.kind === "cover" ? { ok: false as const, error: "Claude timed out.", usage, stop: false } : pass));
    const { m, d } = setup({ items: [item("i1", { state: "checking", post_id: "p1" })],
      cards: [front({ remakes: 1, check_note: "Could not check: Claude timed out." }), ...tenCards({ check_state: "passed" })] }, { judgeCard });
    await tick(d);
    expect(m.db.cards[0]).toMatchObject({ check_state: "removed", selected: false });
    expect(m.db.runs[0].events.map((e) => e.text)).toContain("Sat, Nov 21 · Letter S · girl: Front card left out: could not check it (Claude timed out).");
    expect(m.db.items[0].state).toBe("scheduled");
  });

  it("the look-alike check sees the front card last, so a front card that looks like another card is the one remade", async () => {
    const judgeLookAlike = vi.fn(async () => ({ ok: true as const, data: [11], usage }));
    const cards = [...tenCards({ check_state: "passed" }).map((c, i) => ({ ...c, order_index: i + 1 })), front({ check_state: "passed" })];
    const { d } = setup({ items: [item("i1", { state: "checking", post_id: "p1" })], cards }, { judgeLookAlike });
    await tick(d);
    const sent = (judgeLookAlike.mock.calls[0] as unknown as [{ card: CardRow; url: string }[]])[0];
    expect(sent.map((x) => x.card.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "f"]);
    expect(d.remake).toHaveBeenCalledWith(expect.objectContaining({ id: "f" }), { check_state: "pending", check_note: "Remade: looked like another card", remakes: 1 });
    expect(d.schedule).not.toHaveBeenCalled();
  });
```

In `tests/autopilot-judges.test.ts`, add inside `describe("photo checks", () => {`:

```ts
  it("the front card: the judge is told its stamped text is the post's title; the look-alike list marks it", async () => {
    create.mockResolvedValueOnce(answer({ pass: true, problems: [], note: "" }));
    await judgeCard({ kind: "cover", name: "'S' Names", meaning: "for baby girl" }, "https://signed/f.jpg");
    const req = create.mock.calls[0][0];
    expect(req.messages[0].content[0].text).toBe(`This is the album's front card: its stamped text is the post's title ("'S' Names / for baby girl"). Check this card.`);
    expect(req.system).toMatch(/the front card \(the album's first picture\) has the post's title/);
    create.mockResolvedValueOnce(answer({ remake: [] }));
    await judgeLookAlike([{ card: { kind: "post", name: "A" }, url: "u1" }, { card: { kind: "cover", name: "'S' Names" }, url: "u2" }]);
    const content = create.mock.calls[1][0].messages[0].content;
    expect(content.map((c: { type: string; text?: string }) => c.text ?? c.type)).toEqual(["Card 1:", "image", "Card 2 (the front card):", "image"]);
    expect(create.mock.calls[1][0].system).toMatch(/front card/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `npx vitest run tests/autopilot-engine.test.ts tests/autopilot-judges.test.ts`
Expected: FAIL (6 passed name cards are not held as "7 needed"; 7 are held; the front card is removed with the old event and could-not-check holds the post; the look-alike list has the front card first; the judge text is a name).

- [ ] **Step 3: The floor (`lib/autopilot/plan.ts`)**

Replace:

```ts
/** The names step needs at least this many good names to make a post, or it is held. */
export const MIN_GOOD_NAMES = 8;
```

with:

```ts
/** The names step needs at least this many good names to make a post, or it is held. */
export const MIN_GOOD_NAMES = 8;
/** A post goes out with at least this many passed name cards, else it is held (owner, 2026-11-21: it was 8). */
export const MIN_PASSED_NAME_CARDS = 7;
```

- [ ] **Step 4: The judge prompts (`lib/autopilot/judge-photos.ts`)**

Replace:

```ts
  "Each card is one square photo with a baby name and its meaning stamped on it; the closing card has a short follow message instead.",
```

with:

```ts
  "Each card is one square photo with a baby name and its meaning stamped on it; the closing card has a short follow message instead, and the front card (the album's first picture) has the post's title.",
```

replace:

```ts
  "- text: letters, words or logos inside the photo itself (the stamped name, meaning and handle are fine)",
  "- name_on_face: the stamped name or meaning covers the baby's face",
```

with:

```ts
  "- text: letters, words or logos inside the photo itself (the stamped name, meaning, title, message and handle are fine)",
  "- name_on_face: the stamped text covers the baby's face",
```

replace:

```ts
/** One card, as its stamped image (a signed URL). */
export function judgeCard(card: Pick<CardRow, "kind" | "name">, url: string): Promise<JudgeResult<PhotoVerdict>> {
  const what = card.kind === "cta" ? "This is the closing card: its stamped text is a follow message." : `The stamped name is ${card.name}.`;
  return judgeJson({
```

with:

```ts
type Stamped = Pick<CardRow, "kind" | "name"> & Partial<Pick<CardRow, "meaning">>;

/** What is stamped on a card, in the judge's words. */
export function stampedText(card: Stamped): string {
  if (card.kind === "cta") return "This is the closing card: its stamped text is a follow message.";
  if (card.kind === "cover") return `This is the album's front card: its stamped text is the post's title ("${[card.name, card.meaning].filter(Boolean).join(" / ")}").`;
  return `The stamped name is ${card.name}.`;
}

/** One card, as its stamped image (a signed URL). */
export function judgeCard(card: Stamped, url: string): Promise<JudgeResult<PhotoVerdict>> {
  const what = stampedText(card);
  return judgeJson({
```

replace:

```ts
  "Return the number of the later card of each look-alike pair (never card 1), at most 3. Return an empty list when every card looks different enough.",
].join("\n");
```

with:

```ts
  "Return the number of the later card of each look-alike pair (never card 1), at most 3. Return an empty list when every card looks different enough.",
  "The front card (marked as such) shows the post's title instead of a name; it counts like any other card.",
].join("\n");
```

and replace:

```ts
  const content = cards.flatMap(({ url }, k) => [
    { type: "text" as const, text: `Card ${k + 1}:` },
```

with:

```ts
  const content = cards.flatMap(({ card, url }, k) => [
    { type: "text" as const, text: card.kind === "cover" ? `Card ${k + 1} (the front card):` : `Card ${k + 1}:` },
```

- [ ] **Step 5: The engine (`lib/autopilot/engine.ts`)**

Replace:

```ts
import { MIN_GOOD_NAMES, dayLabel, labelText } from "./plan";
```

with:

```ts
import { MIN_PASSED_NAME_CARDS, dayLabel, labelText } from "./plan";
```

Replace:

```ts
const cardName = (c: CardRow) => (c.kind === "cta" ? "the closing card" : c.name);
```

with:

```ts
const cardName = (c: CardRow) => (c.kind === "cta" ? "the closing card" : c.kind === "cover" ? "the front card" : c.name);

/**
 * The look-alike check's cards: posting order, with the front card moved to the end. The judge names the LATER card of
 * a look-alike pair (never card 1), so a front card that looks like another card is the one remade.
 */
export function lookAlikeOrder(cards: CardRow[]): CardRow[] {
  const sorted = [...cards].sort(cardOrder);
  return [...sorted.filter((c) => c.kind !== "cover"), ...sorted.filter((c) => c.kind === "cover")];
}
```

Replace:

```ts
    await this.setCard(c, { check_state: "removed", check_note: `Removed: ${why}`.slice(0, 300), selected: false });
    this.event("card_removed", `${itemLabel(item)}: ${cardName(c)} removed after ${MAX_REMAKES} remakes (${why}).`);
  }
```

with:

```ts
    if (c.kind === "cover") return this.leaveOutFront(c, why);
    await this.setCard(c, { check_state: "removed", check_note: `Removed: ${why}`.slice(0, 300), selected: false });
    this.event("card_removed", `${itemLabel(item)}: ${cardName(c)} removed after ${MAX_REMAKES} remakes (${why}).`);
  }

  /** The front card never holds a post: one that keeps failing (or can't be checked) is unselected and the post goes on. */
  private async leaveOutFront(c: CardRow, why: string) {
    await this.setCard(c, { check_state: "removed", check_note: `Removed: ${why}`.slice(0, 300), selected: false });
    this.event("card_removed", `${itemLabel(this.itemOf(c))}: Front card left out: ${why}.`);
  }
```

Replace:

```ts
    if (c.check_note?.startsWith(COULD_NOT_CHECK) || remakes >= MAX_REMAKES) {
      await this.setCard(c, { check_state: "failed", check_note: `${COULD_NOT_CHECK} twice: ${error}`.slice(0, 300) });
      return;
    }
```

with:

```ts
    if (c.check_note?.startsWith(COULD_NOT_CHECK) || remakes >= MAX_REMAKES) {
      if (c.kind === "cover") return this.leaveOutFront(c, `could not check it (${error.replace(/\.$/, "")})`);
      await this.setCard(c, { check_state: "failed", check_note: `${COULD_NOT_CHECK} twice: ${error}`.slice(0, 300) });
      return;
    }
```

Replace:

```ts
      if (names < MIN_GOOD_NAMES) {
        await this.hold(item, `Only ${names} name cards passed the checks (${MIN_GOOD_NAMES} needed). Remake or add cards, then schedule it yourself.`);
```

with:

```ts
      if (names < MIN_PASSED_NAME_CARDS) {
        await this.hold(item, `Only ${names} name cards passed the checks (${MIN_PASSED_NAME_CARDS} needed). Remake or add cards, then schedule it yourself.`);
```

Replace:

```ts
    // In posting order, so "card 1" is the album's first card (the judge keeps the earlier of two look-alikes).
    const passed = [...cards].sort(cardOrder);
```

with:

```ts
    // In posting order, so "card 1" is the album's first name card (the judge keeps the earlier of two look-alikes), with
    // the front card last so it can be the one remade.
    const passed = lookAlikeOrder(cards);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/autopilot-engine.test.ts tests/autopilot-judges.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the related suites, the type check and lint**

Run: `npx vitest run tests/autopilot-names-step.test.ts tests/autopilot-wiring.test.ts tests/autopilot-actions.test.ts tests/autopilot-data.test.ts tests/autopilot-page.test.tsx tests/autopilot-route.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors (`MIN_GOOD_NAMES` is still used by `names-step.ts`).

- [ ] **Step 8: Commit**

```bash
git add lib/autopilot/plan.ts lib/autopilot/judge-photos.ts lib/autopilot/engine.ts tests/autopilot-engine.test.ts tests/autopilot-judges.test.ts
git commit -m "feat(autopilot): check the front card, leave a failing one out, and post with 7 passed name cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Worker 2.10.0 stamps the front card

**Files:**
- Modify: `worker/render.py` (new section after `compose_cta`, before `LIGHT_BACKDROP = ...` ~line 652; `ComfyRenderer.compose_cover` after `compose_cta` at the end of the class ~line 796)
- Modify: `worker/jobs.py` (header comment line 7; `VERSION` line 25; `CTA_FILENAME` line 37; `_compose` lines 520-532; `_backup` lines 664 and 671)
- Create: `worker/test_cover.py`
- Modify: `worker/test_jobs.py` (`FakeRenderer` ~line 80; `job()` ~line 89; new tests after `test_closing_card_with_the_real_renderer_draws_text`)
- Modify: `worker/test_card_layout.py` (`LayoutRenderer` ~line 169; one new test after `test_name_nest_closing_card`)
- Modify: `worker/test_autopilot.py` (line 77), `worker/test_line_voice.py` (line 57), `worker/test_one_claim.py` (line 355), `worker/test_pages.py` (line 596): `"2.9.0"` → `"2.10.0"`

**Interfaces:**
- Consumes (Task 1): a claimed card JSON (`claim_next_card` hands out every column) with `kind == "cover"`, `name` = main line, `meaning` = second line (`""` = none), `title_pos` `"top"`/`"bottom"` (or missing/None → top).
- Produces (`worker/render.py`): `COVER_PLACES`, `COVER_SIZE = 1.3`, `COVER_SECOND_SIZE = 1.15`, `COVER_MAX_WIDTH = 0.84`, `COVER_MAX_LINES = 2`, `COVER_LINE_GAP = 0.08`, `cover_place(value) -> "top" | "bottom"`, `fit_cover_title(font_id, text, px, max_w, log=print) -> (font, lines)`, `layout_cover(size, title, second, handle, style, place="top", log=print, pill=False) -> {title, second, mark, block, band}`, `compose_cover(photo, title, second, handle, style=None, place="top", log=print, layout="classic") -> Image`, `ComfyRenderer.compose_cover(photo, title, second, handle, style=None, place="top", layout="classic")`.
- Produces (`worker/jobs.py`): `VERSION = "2.10.0"`, `COVER_FILENAME = "00-front.jpg"`; the renderer is called as `compose_cover(photo, name, meaning, handle, style, place=title_pos or "top")` (+ `layout=` for a non-classic layout).

- [ ] **Step 1: Write the failing tests**

Create `worker/test_cover.py`:

```python
# The front card (migration 023, worker 2.10.0): the post's title stamped big at its stored place (top or bottom), a
# smaller second line under it, the handle as on every card.
#   python -m unittest test_cover -v
import unittest

from PIL import Image

import render as w

W = H = 1080
QUIET = lambda m: None  # noqa: E731


def photo(rgb=(70, 110, 170)):
    return Image.new("RGB", (W, H), rgb)


def brightest(img, box):
    return img.crop(box).convert("L").getextrema()[1]


def as_stamped(text):
    return text.upper() if w.fonts.caps(w.text_style({}).title_font) else text


class CoverLayoutTest(unittest.TestCase):
    def lay(self, title="'S' Names", second="for baby boy", place="top", style=None):
        return w.layout_cover((W, H), title, second, "@unique_names", style or w.text_style({}), place, log=QUIET)

    def test_top_and_bottom(self):
        top, bottom = self.lay(place="top"), self.lay(place="bottom")
        self.assertAlmostEqual(top["block"][1], H * w.LAYOUT["padTop"], delta=1)
        self.assertGreater(bottom["block"][1], H / 2)
        self.assertLess(bottom["block"][3], bottom["mark"]["box"][1])
        self.assertEqual((top["band"], bottom["band"]), ("top", "bottom"))
        self.assertEqual((w.cover_place("middle"), w.cover_place(None), w.cover_place("bottom")), ("top", "top", "bottom"))

    def test_the_title_is_bigger_than_a_name_and_the_second_line_sits_under_it(self):
        lay = self.lay()
        name = w.layout_text((W, H), "Sabina", "from sabine", "@unique_names", w.text_style({}), log=QUIET)
        self.assertGreater(lay["title"][0]["font"].size, name["title"][0]["font"].size)
        self.assertEqual([p["text"] for p in lay["title"]], [as_stamped("'S' Names")])
        self.assertEqual([p["text"] for p in lay["second"]], ["for baby boy"])
        self.assertGreater(lay["second"][0]["box"][1], lay["title"][-1]["box"][3])
        self.assertLess(lay["second"][0]["font"].size, lay["title"][0]["font"].size)

    def test_no_second_line(self):
        lay = self.lay(title="Baby Boy Names", second="")
        self.assertEqual(lay["second"], [])
        self.assertEqual(" ".join(p["text"] for p in lay["title"]), as_stamped("Baby Boy Names"))

    def test_long_titles_fit(self):
        long = "Heavenly stars and the softest morning sky over the quiet sea Names"
        margin = W * (1 - w.COVER_MAX_WIDTH) / 2
        for place in ("top", "bottom"):
            lay = self.lay(title=long, second="part 1 · for baby girl", place=place)
            self.assertLessEqual(len(lay["title"]), w.COVER_MAX_LINES)
            self.assertEqual(" ".join(p["text"] for p in lay["title"]), as_stamped(long))
            for p in lay["title"] + lay["second"]:
                self.assertGreaterEqual(p["box"][0], margin - 2)
                self.assertLessEqual(p["box"][2], W - margin + 2)
            self.assertGreaterEqual(lay["block"][1], H * w.LAYOUT["padTop"] - 1)
            self.assertLess(lay["block"][3], lay["mark"]["box"][1])


class ComposeCoverTest(unittest.TestCase):
    def test_a_top_title_is_drawn_at_the_top(self):
        out = w.compose_cover(photo(), "'S' Names", "for baby boy", "@unique_names", place="top", log=QUIET)
        self.assertGreater(brightest(out, (100, 100, 980, 400)), 240)
        self.assertLess(brightest(out, (100, 650, 800, 1000)), 200)

    def test_a_bottom_title_is_drawn_at_the_bottom(self):
        out = w.compose_cover(photo(), "'S' Names", "for baby boy", "@unique_names", place="bottom", log=QUIET)
        self.assertLess(brightest(out, (100, 100, 980, 400)), 200)
        self.assertGreater(brightest(out, (100, 650, 800, 1000)), 240)

    def test_name_nest_layout_stamps_too(self):
        out = w.compose_cover(photo(), "Baby Girl Names", "", "@namenest", place="top", log=QUIET, layout=w.NEST_LAYOUT)
        self.assertEqual(out.size, (W, H))

    def test_the_renderer_method(self):
        r = w.ComfyRenderer("http://127.0.0.1:1", 5, log=QUIET)
        out = r.compose_cover(photo(), "'S' Names", "for baby boy", "@unique_names", w.text_style({}), place="bottom")
        self.assertGreater(brightest(out, (100, 650, 800, 1000)), 240)


if __name__ == "__main__":
    unittest.main()
```

In `worker/test_jobs.py`:

1. In `class FakeRenderer`, after `compose_cta`, add:

```python
    def compose_cover(self, photo, title, second, handle, style=None, place="top", **kw):
        self.composed.append(("cover", title, second, handle, place))
        self.styles.append(style)
        return photo
```

2. In `def job(...)`, replace

```python
    in_post = card["kind"] in ("post", "cta")
```

with

```python
    in_post = card["kind"] in ("post", "cta", "cover")
```

3. After `test_closing_card_with_the_real_renderer_draws_text`, add:

```python
    def test_front_card_is_stamped_with_its_title_at_its_place_and_backed_up_first(self):
        self.supa.jobs.append(job(kind="cover", position=0, name="'S' Names", meaning="for baby boy", title_pos="bottom"))
        self.assertTrue(self.run_.tick())
        self.assertEqual(self.r.composed, [("cover", "'S' Names", "for baby boy", "@unique_names", "bottom")])
        self.assertEqual(self.last_card_update()[2]["status"], "done")
        folder = os.path.join(self.root, "out", "2026-10-05 Boy Two-word")
        self.assertEqual(os.listdir(folder), [jobs.COVER_FILENAME])
        self.assertEqual(jobs.COVER_FILENAME, "00-front.jpg")

    def test_front_card_restamp_keeps_its_photo_and_its_place(self):
        b = io.BytesIO()
        Image.new("RGB", (1080, 1080), (10, 10, 10)).save(b, "JPEG")
        self.supa.uploads["photos/c1/v1.jpg"] = b.getvalue()
        self.supa.jobs.append(job("restamp", kind="cover", position=0, version=2, name="Biblical Names", meaning="for baby girl",
                                  title_pos="top", photo_path="photos/c1/v1.jpg", card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(self.r.generated, 0)
        self.assertEqual(self.r.composed, [("cover", "Biblical Names", "for baby girl", "@unique_names", "top")])
        self.assertIn("cards/c1/v2.jpg", self.supa.uploads)

    def test_front_card_without_a_stored_place_or_a_second_line(self):
        self.supa.jobs.append(job(kind="cover", position=0, name="Baby Boy Names", meaning=""))
        self.run_.tick()
        self.assertEqual(self.r.composed, [("cover", "Baby Boy Names", "", "@unique_names", "top")])

    def test_front_card_with_the_real_renderer_draws_the_title_at_its_place(self):
        real = render.ComfyRenderer("http://127.0.0.1:1", 5, log=lambda m: None)
        photo = Image.new("RGB", (1080, 1080), (70, 110, 170))
        self.run_.renderer = real
        card = {"kind": "cover", "name": "'S' Names", "meaning": "for baby boy", "title_pos": "bottom"}
        out = self.run_._compose(card, photo, {"handle": "@unique_names", "style": render.text_style({})})
        self.assertGreater(out.crop((100, 650, 800, 1000)).convert("L").getextrema()[1], 240)
        self.assertLess(out.crop((100, 100, 980, 400)).convert("L").getextrema()[1], 200)
```

In `worker/test_card_layout.py`:

1. In `class LayoutRenderer`, after `compose_cta`, add:

```python
    def compose_cover(self, photo, title, second, handle, style=None, place="top", **kw):
        self.kwargs.append(kw)
        return FakeRenderer.compose_cover(self, photo, title, second, handle, style, place)
```

2. After `test_name_nest_closing_card`, add:

```python
    def test_front_card_layout(self):
        r = self.run_one(NamesSupa(NEST), job(kind="cover", position=0, name="Baby Girl Names", meaning="", title_pos="top"))
        self.assertEqual(r.kwargs, [{"layout": NEST}])
        r = self.run_one(NamesSupa(None), job(kind="cover", position=0, name="'S' Names", meaning="for baby boy", title_pos="bottom"))
        self.assertEqual(r.kwargs, [{}])
```

In `worker/test_autopilot.py` (line 77), `worker/test_line_voice.py` (line 57), `worker/test_one_claim.py` (line 355) and `worker/test_pages.py` (line 596) replace `self.assertEqual(jobs.VERSION, "2.9.0")` with `self.assertEqual(jobs.VERSION, "2.10.0")`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd worker; python -m unittest test_cover test_jobs test_card_layout test_autopilot test_line_voice test_one_claim test_pages`
Expected: FAIL / ERROR (`layout_cover`, `compose_cover`, `COVER_FILENAME` missing; the cover card is stamped as a name; VERSION is 2.9.0).

- [ ] **Step 3: `compose_cover` (`worker/render.py`)**

Insert between the end of `compose_cta` (its last line `    return _stamp(img, [(p, 255) for p in lay["lines"]], lay["block"], lay["mark"])`) and the line `LIGHT_BACKDROP = LAYOUT["lightBackdrop"]  # ...`:

```python


# ---------------------------------------------------------------- front card (migration 023, worker 2.10.0)
COVER_PLACES = ("top", "bottom")
# The title is the biggest text of the album: its main line starts at this share of the name size, the second line at
# this share of the meaning size, and every line stays inside this share of the card width (an even margin each side).
COVER_SIZE = 1.3
COVER_SECOND_SIZE = 1.15
COVER_MAX_WIDTH = 0.84
# A long main line may wrap onto this many balanced lines, set closer than meaning lines, before it shrinks further.
COVER_MAX_LINES = 2
COVER_LINE_GAP = 0.08


def cover_place(value):
    """The front card's stored title place (cards.title_pos): "top" or "bottom"; anything else is "top"."""
    return value if value in COVER_PLACES else "top"


def fit_cover_title(font_id, text, px, max_w, log=print):
    """(font, lines) for the main line at about `px` in the title weight: one line, shrinking to meaningShrinkFirst of
    the size; then COVER_MAX_LINES balanced lines in that size range; then smaller on COVER_MAX_LINES lines."""
    load = lambda s: fonts.load_safe(font_id, LAYOUT["titleWeight"], s, log)  # noqa: E731
    words = text.split() or [""]
    start = _px(px)
    floor = max(LAYOUT["minPx"], _px(px * LAYOUT["meaningShrinkFirst"]))
    most = max(1, min(COVER_MAX_LINES, len(words)))
    widest = lambda f, lns: max(_text_w(f, ln) for ln in lns)  # noqa: E731
    for n in range(1, most + 1):
        size = _largest(lambda s: widest(load(s), balanced_lines(load(s), words, n)) <= max_w, floor, start)
        if size:
            return load(size), balanced_lines(load(size), words, n)
    size = _largest(lambda s: widest(load(s), balanced_lines(load(s), words, most)) <= max_w, LAYOUT["minPx"], floor - 1)
    size = size or LAYOUT["minPx"]
    return load(size), balanced_lines(load(size), words, most)


def layout_cover(size, title, second, handle, style, place="top", log=print, pill=False):
    """Where the front card's text goes: the main line (title font, bigger than a name, up to COVER_MAX_LINES lines),
    the second line under it (meaning font, light, may wrap), both centred across; the usual watermark. The block sits
    at the top or at the bottom of the text room (the stored place), whatever the text position setting says. Pure
    geometry: {title: [part], second: [part], mark, block, band}."""
    W, H = size
    k = W / LAYOUT["baseWidth"]
    max_w = W * COVER_MAX_WIDTH
    mark, lo, bottom = _mark_and_room(W, H, handle, style, False, log, pill=pill)
    main = " ".join(str(title or "").split())
    main = main.upper() if fonts.caps(style.title_font) else main
    sub = " ".join(str(second or "").split())

    scale = 1.0
    while True:
        # A block taller than the room shrinks (title and second line together) instead of overflowing.
        tf, rows = fit_cover_title(style.title_font, main, style.title_size * k * COVER_SIZE * scale, max_w, log)
        pitch = tf.size * (1 + COVER_LINE_GAP)
        parts = [{"text": ln, "font": tf, "y": i * pitch, "bb": tf.getbbox(ln), "second": False} for i, ln in enumerate(rows)]
        if sub:
            mf, lines = fit_meaning(style.meaning_font, sub, style.meaning_size * k * COVER_SECOND_SIZE * scale, max_w, log)
            last = max(p["y"] + p["bb"][3] for p in parts)
            first = mf.getbbox(lines[0])
            mpitch = mf.size * (1 + LAYOUT["lineGap"])
            for i, ln in enumerate(lines):
                parts.append({"text": ln, "font": mf, "y": last + W * LAYOUT["gap"] * scale - first[1] + i * mpitch,
                              "bb": _tracked_bbox(mf, ln, MEANING_TRACK), "track": _track_px(mf, MEANING_TRACK), "second": True})
        top = min(p["y"] + p["bb"][1] for p in parts)
        height = max(p["y"] + p["bb"][3] for p in parts) - top
        if height <= bottom - lo or scale < 0.15:
            break
        scale *= 0.9

    band = cover_place(place)
    y = lo if band == "top" else bottom - height
    y = max(lo, min(bottom - height, y))
    dy = y - top
    out = []
    for p in parts:
        bb = p["bb"]
        x, py = W / 2 - (bb[0] + bb[2]) / 2, p["y"] + dy
        out.append({"text": p["text"], "font": p["font"], "xy": (x, py), "box": (x + bb[0], py + bb[1], x + bb[2], py + bb[3]),
                    "track": p.get("track", 0.0), "second": p["second"]})
    boxes = [p["box"] for p in out]
    block = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return {"title": [p for p in out if not p["second"]], "second": [p for p in out if p["second"]], "mark": mark, "block": block,
            "band": band}


def compose_cover(photo, title, second, handle, style=None, place="top", log=print, layout="classic"):
    """Stamp the front card: the post's title (main line + second line) at its stored place, and the watermark
    (Name Nest layout: brand ink + the pill)."""
    img = photo.convert("RGB")
    style = style or text_style({})
    if layout == NEST_LAYOUT:
        lay = layout_cover(img.size, title, second, handle, style, place, log, pill=True)
        return _stamp_nest(img, lay["title"], lay["second"], None, lay["block"], lay["mark"])
    lay = layout_cover(img.size, title, second, handle, style, place, log)
    return _stamp(img, [(p, 255) for p in lay["title"]] + [(p, 240) for p in lay["second"]], lay["block"], lay["mark"])
```

At the end of `class ComfyRenderer`, after:

```python
    def compose_cta(self, photo, message, handle, style=None, layout="classic"):
        return compose_cta(photo, message, handle, style, log=self.log, layout=layout)
```

add:

```python

    def compose_cover(self, photo, title, second, handle, style=None, place="top", layout="classic"):
        return compose_cover(photo, title, second, handle, style, place=place, log=self.log, layout=layout)
```

(`compose_card`, `compose_cta` and their golden digests in `test_card_layout.py` stay byte for byte the same.)

- [ ] **Step 4: Claimed front cards (`worker/jobs.py`)**

After the header line `# 2.9.0: Autopilot (022): claim_next_job's answer says when a run is active; autopilot.py knocks on the website.` add:

```python
# 2.10.0: the front card (023): kind 'cover' is stamped with the post's title at its stored place (cards.title_pos);
# its PC copy is 00-front.jpg, first in the post's folder.
```

Replace `VERSION = "2.9.0"` with `VERSION = "2.10.0"`.

Replace:

```python
CTA_FILENAME = "99-follow.jpg"  # the closing card's PC backup name (migration 010)
```

with:

```python
CTA_FILENAME = "99-follow.jpg"  # the closing card's PC backup name (migration 010)
COVER_FILENAME = "00-front.jpg"  # the front card's PC backup name (migration 023)
```

Replace the whole `_compose` method:

```python
    def _compose(self, card, photo, s):
        """The stamped card: the closing card (kind 'cta', migration 010) gets its message lines
        (name = the message, "/" = a line break) and no meaning; every other card its name + meaning.
        The Name Nest layout (settings.card_layout, migration 015) also gets the name's US rank / origin line."""
        layout = card_layout(s)
        if layout == "classic":  # Unique Names: exactly the calls from before 015
            if card.get("kind") == "cta":
                return self.renderer.compose_cta(photo, card["name"], s["handle"], s["style"])
            return self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"])
        if card.get("kind") == "cta":
            return self.renderer.compose_cta(photo, card["name"], s["handle"], s["style"], layout=layout)
        return self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"], layout=layout,
                                     detail=self._name_detail(card))
```

with:

```python
    def _compose(self, card, photo, s):
        """The stamped card: the front card (kind 'cover', migration 023) gets the post's title (name = the main line,
        meaning = the second line or "") at its stored place (title_pos; a re-stamp keeps it); the closing card (kind
        'cta', migration 010) gets its message lines (name = the message, "/" = a line break) and no meaning; every other
        card its name + meaning. The Name Nest layout (settings.card_layout, migration 015) also gets the name's US rank /
        origin line."""
        layout = card_layout(s)
        if card.get("kind") == "cover":
            kw = {} if layout == "classic" else {"layout": layout}
            return self.renderer.compose_cover(photo, card["name"], card.get("meaning") or "", s["handle"], s["style"],
                                               place=card.get("title_pos") or "top", **kw)
        if layout == "classic":  # Unique Names: exactly the calls from before 015
            if card.get("kind") == "cta":
                return self.renderer.compose_cta(photo, card["name"], s["handle"], s["style"])
            return self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"])
        if card.get("kind") == "cta":
            return self.renderer.compose_cta(photo, card["name"], s["handle"], s["style"], layout=layout)
        return self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"], layout=layout,
                                     detail=self._name_detail(card))
```

In `_backup`, replace:

```python
        if card.get("kind") not in ("post", "cta") or not job.get("post_date") or not job.get("gender_label"):
```

with:

```python
        if card.get("kind") not in ("post", "cta", "cover") or not job.get("post_date") or not job.get("gender_label"):
```

and replace:

```python
            # The closing card sorts last in the post's folder, whatever its position.
            fname = CTA_FILENAME if card.get("kind") == "cta" else "%02d-%s.jpg" % (int(card["position"]), slugify(card["name"]))
```

with:

```python
            # The front card sorts first and the closing card last in the post's folder, whatever their positions.
            kind = card.get("kind")
            fname = (COVER_FILENAME if kind == "cover" else CTA_FILENAME if kind == "cta"
                     else "%02d-%s.jpg" % (int(card["position"]), slugify(card["name"])))
```

- [ ] **Step 5: Run the worker tests**

Run: `cd worker; python -m unittest discover`
Expected: OK (every worker test, including the classic golden digests).

- [ ] **Step 6: Commit**

```bash
git add worker/render.py worker/jobs.py worker/test_cover.py worker/test_jobs.py worker/test_card_layout.py worker/test_autopilot.py worker/test_line_voice.py worker/test_one_claim.py worker/test_pages.py
git commit -m "feat(worker): 2.10.0 stamps the front card's title at its stored place, PC copy 00-front.jpg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The post page (front card pinned first, labelled, no name swap), the edit guards, and the docs

**Files:**
- Modify: `lib/files/save.ts` (add `isPinned` after `cardOrder`)
- Modify: `components/posts/post-detail.tsx` (import line 26; comments lines 38 and 44; `onDragEnd` lines 128-129; counts lines 186-187; header line 199; `Sortable` line 228)
- Modify: `components/cards/card-tile.tsx` (import line 3; lines 24-25; the closing-card badge ~line 102; the hover label ~line 118)
- Modify: `components/cards/card-dialog.tsx` (lines 52-54, 66, 80, 95-96, 106, 130, 136)
- Modify: `components/today/active-post.tsx` (imports; `byPosition` line 23)
- Modify: `lib/actions/cards.ts` (constants ~line 25; `regenerateCardAction` line 77; `restampCardAction` line 93)
- Modify: `lib/actions/suggest.ts` (line 78)
- Modify: `docs/SETUP.md` (new section before `## When something is wrong`, line ~249), `README.md` (new section after `## Autopilot (2026-11-20)`)
- Create: `tests/cover-ui.test.tsx`, `tests/cover-edits.test.ts`

**Interfaces:**
- Consumes (Task 1): `kindRank`, `cardOrder`, `CardRow.title_pos`, kind `"cover"`.
- Produces: `isPinned(c: Partial<Pick<CardRow, "kind">>): boolean` in `lib/files/save.ts` (true for `cover` and `cta`); tile/dialog title "Front card"; `COVER_TEXT` refusal on the name paths.

- [ ] **Step 1: Write the failing tests**

Create `tests/cover-ui.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CardRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

const regenerateCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const restampCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
const ctaTextAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
vi.mock("@/lib/actions/cards", () => ({ regenerateCardAction, restampCardAction, ctaTextAction }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { CardDialog } = await import("@/components/cards/card-dialog");
const { CardTile } = await import("@/components/cards/card-tile");

beforeAll(polyfillRadix);
beforeEach(() => { regenerateCardAction.mockClear(); restampCardAction.mockClear(); ctaTextAction.mockClear(); });
afterEach(cleanup);

const front = (over: Partial<CardRow> = {}): CardRow => ({
  id: "f1", post_id: "p1", theme_id: "t1", kind: "cover", position: 0, name_id: null, name: "'S' Names", meaning: "for baby boy",
  shot: "front card: wide: x", prompt: "the prompt", seed: 1, status: "done", error: null, photo_path: "photos/f1/v1.jpg", card_path: "cards/f1/v1.jpg",
  version: 1, selected: true, order_index: 0, queued_at: "2026-11-22T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "", updated_at: "", title_pos: "top", ...over,
});
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("front card in the UI", () => {
  it("the tile shows a Front card badge and is announced as the front card", () => {
    render(<CardTile card={front()} health="ready" queuePos={0} onOpen={() => {}} selection={{ selected: true, order: 1, onToggle: () => {} }} />);
    expect(screen.getByText("Front card")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unselect Front card \(upload number 1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open Front card: ready/ })).toBeTruthy();
  });

  it("the dialog shows the title; no name, meaning, message, name swap or Save text; New picture remakes the photo", async () => {
    render(<CardDialog card={front()} health="ready" onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Front card" })).toBeTruthy();
    expect(screen.getByText("'S' Names")).toBeTruthy();
    expect(screen.getByText("for baby boy")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Meaning")).toBeNull();
    expect(screen.queryByLabelText(/^Message/)).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Pick a different name" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save text/ })).toBeNull();
    await act(async () => { fireEvent.click(button(/^New picture$/)); });
    expect(regenerateCardAction).toHaveBeenCalledWith("f1");
    expect(restampCardAction).not.toHaveBeenCalled();
    expect(ctaTextAction).not.toHaveBeenCalled();
  });
});
```

Create `tests/cover-edits.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, type Query, type Respond } from "./helpers/fake-supabase";
import { isPinned } from "@/lib/files/save";

// Editing the front card (023): New picture and Retry work as on any card; its title comes from the post, so the name
// paths (text edit, name ideas, the closing card's message) refuse it; the drag never moves it.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson: vi.fn(async () => ({ ok: false, error: "off" })) }));
const { ctaTextAction, regenerateCardAction, restampCardAction } = await import("@/lib/actions/cards");
const { cardNameIdeasAction } = await import("@/lib/actions/suggest");

const CARD_ID = "44444444-4444-4444-8444-444444444444";
const front = { id: CARD_ID, post_id: "33333333-3333-4333-8333-333333333333", theme_id: "22222222-2222-4222-8222-222222222222", kind: "cover",
  position: 0, name_id: null, name: "'S' Names", meaning: "for baby boy", shot: "front card: wide: x", prompt: "p", seed: 5, status: "done", error: null,
  photo_path: "photos/f/v1.jpg", card_path: "cards/f/v1.jpg", version: 1, selected: true, order_index: 0, queued_at: "", claimed_at: null,
  started_at: null, finished_at: null, attempts: 1, created_at: "", updated_at: "", title_pos: "top" } as CardRow;

beforeEach(() => {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "cards" && isUpdate(q)) return { data: [{ id: CARD_ID }] };
    if (q.table === "cards") return { data: front };
    return undefined;
  };
});

describe("editing the front card", () => {
  it("New picture / Retry remake it; its title can't be edited, given name ideas or a message", async () => {
    expect(await regenerateCardAction(CARD_ID)).toEqual({ ok: true });
    const refused = "The front card's title comes from the post, so it can't be edited. Use New picture for a new photo.";
    expect(await regenerateCardAction(CARD_ID, { name: "Arlo", meaning: "strong" })).toEqual({ ok: false, error: refused });
    expect(await restampCardAction(CARD_ID, "Arlo", "strong")).toEqual({ ok: false, error: refused });
    expect(await ctaTextAction(CARD_ID, "Follow")).toEqual({ ok: false, error: "Only the closing card has a message." });
    expect(await cardNameIdeasAction(CARD_ID)).toEqual({ ok: false, error: "Name ideas are for the name cards in a post." });
  });

  it("the drag leaves the front and closing cards where they are", () => {
    expect([isPinned({ kind: "cover" }), isPinned({ kind: "cta" }), isPinned({ kind: "post" }), isPinned({})]).toEqual([true, true, false, false]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `npx vitest run tests/cover-ui.test.tsx tests/cover-edits.test.ts`
Expected: FAIL (the tile shows the card's name; the dialog shows Name / Meaning fields; the name paths accept the front card; `isPinned` is not exported).

- [ ] **Step 3: `isPinned` (`lib/files/save.ts`)**

After the `cardOrder` line add:

```ts

/** The front card stays first and the closing card last: neither is dragged; the name cards are ordered among themselves. */
export const isPinned = (c: Partial<Pick<CardRow, "kind">>) => c.kind === "cover" || c.kind === "cta";
```

- [ ] **Step 4: The post page (`components/posts/post-detail.tsx`)**

Replace `import { cardOrder, uploadNumbers } from "@/lib/files/save";` with `import { cardOrder, isPinned, uploadNumbers } from "@/lib/files/save";`.

Replace `// The owner's order, with the closing card (010) always last.` with `// The owner's order, with the front card (023) always first and the closing card (010) always last.`

Replace `` // `locked`: the closing card stays last, so it has no drag and no reorder handle. `` with `` // `locked`: the front card stays first and the closing card last, so neither has a drag or a reorder handle. ``

Replace:

```tsx
    // The closing card never moves: name cards are ordered among themselves, the closing card stays last.
    const ids = visible.filter((c) => c.kind !== "cta").map((c) => c.id);
```

with:

```tsx
    // The front and closing cards never move: name cards are ordered among themselves, between them.
    const ids = visible.filter((c) => !isPinned(c)).map((c) => c.id);
```

Replace:

```tsx
  const nameCards = visible.filter((c) => c.kind !== "cta").length;
```

with:

```tsx
  const nameCards = visible.filter((c) => !isPinned(c)).length;
  const extras = `${visible.some((c) => c.kind === "cover") ? " + front card" : ""}${visible.some((c) => c.kind === "cta") ? " + closing card" : ""}`;
```

Replace:

```tsx
            {theme.title} · {post.style} · {nameCards} cards{visible.length > nameCards ? " + closing card" : ""}
```

with:

```tsx
            {theme.title} · {post.style} · {nameCards} cards{extras}
```

Replace:

```tsx
                  <Sortable key={c.id} id={c.id} name={c.kind === "cta" ? "Closing card" : c.name} locked={c.kind === "cta"}>
```

with:

```tsx
                  <Sortable key={c.id} id={c.id} name={c.kind === "cta" ? "Closing card" : c.kind === "cover" ? "Front card" : c.name} locked={isPinned(c)}>
```

- [ ] **Step 5: The tile (`components/cards/card-tile.tsx`)**

Replace `import { AlertTriangle, Clock3, Flag, Loader2, PenLine, PlugZap, RotateCw } from "lucide-react";` with `import { AlertTriangle, Clock3, Flag, Loader2, PenLine, PlugZap, RotateCw, Star } from "lucide-react";`.

Replace:

```tsx
  const isCta = card.kind === "cta";
  const title = isCta ? "Closing card" : card.name;
```

with:

```tsx
  const isCta = card.kind === "cta";
  const isCover = card.kind === "cover";
  const title = isCta ? "Closing card" : isCover ? "Front card" : card.name;
```

Replace:

```tsx
          <Flag className="size-3 text-accent" aria-hidden /> Closing card
        </span>
      )}
```

with:

```tsx
          <Flag className="size-3 text-accent" aria-hidden /> Closing card
        </span>
      )}
      {isCover && v !== "failed" && (
        <span className="pointer-events-none absolute bottom-2 left-2 z-[2] inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-1 text-[11px] font-bold text-ink shadow-soft">
          <Star className="size-3 text-accent" aria-hidden /> Front card
        </span>
      )}
```

Replace:

```tsx
      {!selection && !isCta && v !== "failed" && (
```

with:

```tsx
      {!selection && !isCta && !isCover && v !== "failed" && (
```

- [ ] **Step 6: The dialog (`components/cards/card-dialog.tsx`)**

Replace:

```tsx
  // The closing card (010) has one Message field (kept in `name`) and no meaning.
  const isCta = card.kind === "cta";
  const changed = isCta ? ctaLines(name).join(" / ") !== ctaLines(card.name).join(" / ") : textChanged(card, name, meaning);
```

with:

```tsx
  // The closing card (010) has one Message field (kept in `name`) and no meaning.
  const isCta = card.kind === "cta";
  // The front card (023) shows the post's title (name + meaning), which comes from the post: no text edit, no name swap.
  const isCover = card.kind === "cover";
  const changed = isCover ? false : isCta ? ctaLines(name).join(" / ") !== ctaLines(card.name).join(" / ") : textChanged(card, name, meaning);
```

Replace:

```tsx
  const swapId = !isCta && picked && picked.id !== card.name_id && nameKey(picked.name) === nameKey(name) ? picked.id : null;
```

with:

```tsx
  const swapId = !isCta && !isCover && picked && picked.id !== card.name_id && nameKey(picked.name) === nameKey(name) ? picked.id : null;
```

Replace:

```tsx
    const choice = isCta ? (changed ? { kind: "edit-regenerate" as const, name, meaning: "" } : { kind: "regenerate" as const }) : newPictureAction(card, name, meaning);
```

with:

```tsx
    const choice = isCover ? { kind: "regenerate" as const }
      : isCta ? (changed ? { kind: "edit-regenerate" as const, name, meaning: "" } : { kind: "regenerate" as const }) : newPictureAction(card, name, meaning);
```

Replace:

```tsx
    <Dialog open onOpenChange={(o) => !o && onClose()} title={isCta ? "Closing card" : `${card.position}. ${card.name}`}
      description={isCta ? "The last picture of the post: a follow message instead of a name." : card.meaning} wide>
```

with:

```tsx
    <Dialog open onOpenChange={(o) => !o && onClose()} title={isCta ? "Closing card" : isCover ? "Front card" : `${card.position}. ${card.name}`}
      description={isCta ? "The last picture of the post: a follow message instead of a name."
        : isCover ? "The first picture of the post: its title on a photo from the same photoshoot." : card.meaning} wide>
```

Replace:

```tsx
          {isCta ? (
```

with:

```tsx
          {isCover ? (
            <div>
              <span className="text-xs font-semibold text-muted">Title</span>
              <p className="mt-1 font-semibold text-ink">{card.name}</p>
              {card.meaning && <p className="text-sm text-muted">{card.meaning}</p>}
              <p className="mt-1 text-xs text-muted">Stamped at the {card.title_pos === "bottom" ? "bottom" : "top"}. The title comes from the post. New picture makes a new photo; Re-stamp with current text settings keeps the title where it is.</p>
            </div>
          ) : isCta ? (
```

Replace:

```tsx
            <Button onClick={saveText} loading={busy === "text"} disabled={!changed || working || textLocked || busy !== null}><Save className="size-4" /> Save text</Button>
```

with:

```tsx
            {!isCover && <Button onClick={saveText} loading={busy === "text"} disabled={!changed || working || textLocked || busy !== null}><Save className="size-4" /> Save text</Button>}
```

Replace:

```tsx
          {!gen.ok && <GenerateLockNote reason={gen.reason} extra={textNeedsPhoto ? undefined : "Text edits still save."} />}
```

with:

```tsx
          {!gen.ok && <GenerateLockNote reason={gen.reason} extra={isCover || textNeedsPhoto ? undefined : "Text edits still save."} />}
```

- [ ] **Step 7: Today's live post (`components/today/active-post.tsx`)**

After `import { postLabel } from "@/lib/series/letter";` add `import { kindRank } from "@/lib/files/save";`, and replace:

```tsx
// Making order, with the closing card (010) always last.
const byPosition = (a: CardRow, b: CardRow) => (a.kind === "cta" ? 1 : 0) - (b.kind === "cta" ? 1 : 0) || a.position - b.position;
```

with:

```tsx
// Making order, with the front card (023) first and the closing card (010) always last.
const byPosition = (a: CardRow, b: CardRow) => kindRank(a) - kindRank(b) || a.position - b.position;
```

- [ ] **Step 8: The name paths refuse the front card**

In `lib/actions/cards.ts`, replace:

```ts
const CTA_TEXT = "The closing card has a message, not a name: edit it in its Message field.";
```

with:

```ts
const CTA_TEXT = "The closing card has a message, not a name: edit it in its Message field.";
const COVER_TEXT = "The front card's title comes from the post, so it can't be edited. Use New picture for a new photo.";
```

replace:

```ts
  if (text && card.kind === "cta") return fail(CTA_TEXT);
```

with:

```ts
  if (text && card.kind === "cta") return fail(CTA_TEXT);
  if (text && card.kind === "cover") return fail(COVER_TEXT);
```

and replace (in `restampCardAction`):

```ts
  if (card.kind === "cta") return fail(CTA_TEXT);
```

with:

```ts
  if (card.kind === "cta") return fail(CTA_TEXT);
  if (card.kind === "cover") return fail(COVER_TEXT);
```

In `lib/actions/suggest.ts`, replace:

```ts
  if (!card.post_id || card.kind === "cta") return fail("Name ideas are for the name cards in a post.");
```

with:

```ts
  // Not the closing card (010) or the front card (023): neither has a name.
  if (!card.post_id || card.kind !== "post") return fail("Name ideas are for the name cards in a post.");
```

(The name swap already refuses every card that is not a name card: `lib/actions/swap-name.ts` line 44 and `swap_card_name` in the database. `restampPostAction` re-stamps the front card like any card, and the worker keeps its stored place.)

- [ ] **Step 9: The docs**

In `docs/SETUP.md`, insert right before the line `## When something is wrong`:

```markdown
## Front card and the 3 best names first (existing install)
On a phone Facebook shows only the first 4 pictures of an album. Every new post now opens with a **front card**: a
picture from the same photoshoot with the post's title stamped big ("'S' Names" / for baby boy, "Biblical Names",
"A & R Names", "Baby Girl Names"). Its pose (10 poses, each made for the child's age) and the title's place (top or
bottom) change from post to post. The next 3 cards are the post's best names: on Today the app's AI picks them while it
writes the caption (at most about 8 s, and if it fails the post is made in the usual order); on Autopilot, Claude's name
check scores every name. Autopilot posts now get 8 to 14 names (10 to 16 cards with the front and closing cards) and go
out with 7 or more passed name cards. A front card that still fails its check after 2 remakes is left out (the
Autopilot activity says "Front card left out"); it never holds a post.
Spec: `docs/superpowers/specs/2026-11-21-front-card-design.md`.
1. Wait until the PC has no card in line, then restart the worker (Task Scheduler: **End** then **Run** "Unique Names
   card worker"). `worker/worker.log` says "worker 2.10.0". An older worker would stamp the title like a name.
2. Supabase **SQL Editor**: paste and run `supabase/migrations/023_front_card.sql` (safe to run again). Until it runs,
   posts are made exactly as before: no front card and the names in their usual order.
3. Push to GitHub so Vercel redeploys the website.
4. **Settings > Front card**: on by default; switch it off to stop adding it to new posts. Posts already made or
   scheduled do not change.
5. On a post the front card has a **Front card** badge and always stays first (the closing card stays last) when you
   drag cards; Download and Facebook use the same order. New picture, Retry and Re-stamp work on it like on any card;
   its title comes from the post, so it has no name to edit or swap. On the PC it is saved as `00-front.jpg`.
6. Check one Today post and one Autopilot day on a phone: the first 4 pictures should be the front card and the 3 best
   names.

```

In `README.md`, insert right after the `## Autopilot (2026-11-20)` section (after its bullet line and the blank line below it):

```markdown
## Front card and the 3 best names first (2026-11-21)
- Every new post opens with a front card: a photo from its own photoshoot with the post's title stamped big by the PC
  ("'S' Names" / for baby boy). Its pose (10 per age) and the title's place (top / bottom) rotate from post to post.
- The next 3 cards are the post's best names: Today asks the app's AI once, alongside the caption (8 s, checked, the
  usual order on any failure); Autopilot uses the appeal score from Claude's name check. Autopilot posts get 8 to 14
  names and go out with 7 passed name cards; a failing front card is left out, never holding a post.
- Settings > Front card switches it off. Needs migration `023_front_card.sql` and worker 2.10.0 (`docs/SETUP.md`,
  "Front card and the 3 best names first"). Design: `docs/superpowers/specs/2026-11-21-front-card-design.md`.

```

- [ ] **Step 10: Run the tests, then everything**

Run: `npx vitest run tests/cover-ui.test.tsx tests/cover-edits.test.ts tests/cover-order.test.ts tests/cta-ui.test.tsx tests/cta-actions.test.ts tests/card-actions.test.ts tests/card-dialog.test.tsx tests/card-tile-retry.test.tsx tests/today-layout.test.tsx tests/swap-name-actions.test.ts`
Expected: PASS.

Run (PowerShell): `npm test`
Expected: every test passes.

Run: `npx tsc --noEmit`, `npm run lint`, `npm run build`
Expected: no errors; the build succeeds.

Run: `cd worker; python -m unittest discover`
Expected: OK.

- [ ] **Step 11: Commit**

```bash
git add lib/files/save.ts components/posts/post-detail.tsx components/cards/card-tile.tsx components/cards/card-dialog.tsx components/today/active-post.tsx lib/actions/cards.ts lib/actions/suggest.ts docs/SETUP.md README.md tests/cover-ui.test.tsx tests/cover-edits.test.ts
git commit -m "feat(front-card): the post page keeps the front card first and labelled; its title can't be edited; setup docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the merge (the owner, not a task)

1. Restart the worker once its queue is empty (worker 2.10.0), then run `supabase/migrations/023_front_card.sql` in
   Supabase, then let Vercel deploy (`docs/SETUP.md`, "Front card and the 3 best names first").
2. Live check: make one Today post and run one Autopilot day; on a phone the first 4 pictures are the front card and
   the 3 best names.
