# Reel storylines (5 rotating formats) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow emotional-vignette reel scripts with value-first scripts in 5 rotating formats (30–45 s), with optional on-screen step labels, leaving the Crayon / Red Thread graphics untouched.

**Architecture:** Server (TS): a pure format/topic module (`lib/reels/formats.ts`, `lib/reels/topics.ts`) feeds the existing Gemini script writer (`lib/ai/reel-script.ts`), which gains a `format` and per-line `on_screen`; actions store them (migration 014). Worker (Python): the frame renderer draws `on_screen` labels in the hook band. Image prompting (`lib/reels/guide*.ts`, `image-prompt.ts`, `prompt.ts`) is NOT modified.

**Tech Stack:** Next.js 16 server actions, Supabase (PGlite tests), Gemini 3.1 Pro (`generateJson`), vitest + jsdom; Python 3.12 worker (Pillow), unittest.

**Spec:** `docs/superpowers/specs/2026-10-09-reel-storylines-design.md` (read it fully). **Research:** `C:\Users\rober\OneDrive\Documents\automation\reports\Parenting reels storyline research.md` — §2.3 format templates, §3.2 hook templates, §6.2 health safety, §6.3 topic bank (52 ideas), §10 encodable rules.

## Global Constraints

- Graphics unchanged: do not modify `lib/reels/guide.ts`, `lib/reels/guide-text.ts`, `lib/reels/image-prompt.ts`, `lib/reels/prompt.ts`, `worker/themes.py`, or any image-generation code. Every script line keeps the existing per-line fields (scene/idea, shot_size, subject, feeling, thread, punch, emotion, action) so prompts build exactly as today.
- Formats: `named_method | say_this | lola_science | scene_lesson | problem_fix`. Rotation: never the same as the previous reel; otherwise least-recently-used among the last 5 reels.
- Length 30–45 s (`REEL_SECONDS` lo 30, hi 45, floor 15); word budget from narration speed as today.
- No tagline. Banned in narration: greetings, outros ("see you", "thanks for watching", "next video"), engagement asks (like/comment/share/tag/follow/save/subscribe/vote), "watch till the end", first-person stories (I / me / my / we / us / our as the narrator's experience).
- Exact words to say appear in quotes in every format (≥ 1 quoted phrase; named_method/say_this ≥ 3).
- Health/medical topics: soft wording + one generic safety line; no invented studies/numbers/quotes.
- Default narration speed 1.05 (settings.reel_speed default; migrate rows equal to 1.12 → 1.05).
- `on_screen` ≤ 8 words / ≤ 80 chars, optional per line; never on line 1 (the hook card owns 0–3.5 s).
- Conventions: owner-only actions (`requireOwner` first), migrations idempotent + folded into `supabase/schema.sql` + PGlite parity tests + pre-migration fallback (PGRST204 / 42703 → insert without the new fields), server pages never import functions from `"use client"` files, GEMINI_API_KEY server-only and never printed, mobile-first shadcn UI, TDD, commit trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`, never push, never stop/restart the live worker or ComfyUI.

---

### Task 1: Formats, topic bank, migration 014

**Files:**
- Create: `lib/reels/formats.ts`, `lib/reels/topics.ts`, `supabase/migrations/014_reel_formats.sql`
- Modify: `supabase/schema.sql` (reels, reel_scenes, settings), `lib/db/types.ts` (ReelRow.format/topic_id, ReelSceneRow.on_screen, SettingsRow.reel_labels)
- Test: `tests/reel-formats.test.ts`, `tests/sql/*` (follow the 012/013 PGlite test pattern)

**Interfaces (Produces):**
```ts
// lib/reels/formats.ts
export const REEL_FORMATS = ["named_method", "say_this", "lola_science", "scene_lesson", "problem_fix"] as const;
export type ReelFormat = (typeof REEL_FORMATS)[number];
export interface FormatSpec { id: ReelFormat; label: string; beats: string[]; minQuotes: number }
export const FORMAT_SPECS: Record<ReelFormat, FormatSpec>;
/** recent = formats of the latest reels, newest first (nulls ignored). Never recent[0]; else least-recently-used of the 5; ties → REEL_FORMATS order. */
export function nextFormat(recent: (string | null | undefined)[]): ReelFormat;
// lib/reels/topics.ts
export interface ReelTopic { id: string; topic: string; format: ReelFormat; health: boolean; stage?: "newborn" | "baby" | "toddler" | "preschooler" }
export const REEL_TOPICS: ReelTopic[];   // the 52 ideas from research §6.3, ids kebab-case, unique
/** Pick a topic not among recentIds (last 15), preferring ones whose format === format; deterministic with rng. */
export function pickTopic(format: ReelFormat, recentIds: string[], rng?: () => number): ReelTopic;
```
`beats` = the research §2.3 beat list for that format (short strings used verbatim in the prompt).

- [ ] Step 1: Write failing tests: `nextFormat([])` → "named_method"; never returns recent[0]; LRU over 5; ignores unknown/null values. `REEL_TOPICS` has ≥ 50 entries, unique ids, every format represented, health flags on fever/sleep-safety/feeding-medical items. `pickTopic` excludes recent ids, prefers the format, falls back to any non-recent topic, then to any topic when all are recent.
- [ ] Step 2: Run `npx vitest run tests/reel-formats.test.ts` → FAIL.
- [ ] Step 3: Implement both modules (topics copied from research §6.3; map each idea to its tagged structure).
- [ ] Step 4: Migration 014 (idempotent):
```sql
alter table public.reels add column if not exists format text;
alter table public.reels add column if not exists topic_id text;
do $$ begin
  alter table public.reels add constraint reels_format_check
    check (format is null or format in ('named_method','say_this','lola_science','scene_lesson','problem_fix'));
exception when duplicate_object then null; end $$;
alter table public.reel_scenes add column if not exists on_screen text;
do $$ begin
  alter table public.reel_scenes add constraint reel_scenes_on_screen_len check (on_screen is null or char_length(on_screen) <= 80);
exception when duplicate_object then null; end $$;
alter table public.settings add column if not exists reel_labels boolean not null default true;
alter table public.settings alter column reel_speed set default 1.05;
update public.settings set reel_speed = 1.05 where reel_speed = 1.12;
```
Fold the same into `schema.sql` (fresh installs default 1.05). PGlite tests: runs twice cleanly; parity with schema.sql; 1.12 → 1.05 but 1.20 stays.
- [ ] Step 5: Run vitest + `npx tsc --noEmit` → PASS. Commit `feat(reels): five story formats, topic bank, migration 014`.

### Task 2: Script writer + actions + caption

**Files:**
- Modify: `lib/ai/reel-script.ts` (prompt, schema, validator, REEL_SECONDS), `lib/actions/reels.ts` (draftScript, sceneRows, insert fallbacks), `lib/ai/reel-caption.ts` (format + key phrase)
- Test: `tests/reel-script.test.ts`, `tests/reel-actions*.test.ts` (existing files), new cases

**Interfaces:**
- Consumes: `REEL_FORMATS`, `FORMAT_SPECS`, `nextFormat`, `REEL_TOPICS`, `pickTopic` (Task 1).
- Produces: `ReelScriptInput` gains `format: ReelFormat` and `topicHealth?: boolean`; `ReelScript` gains `format: ReelFormat`; `ReelScriptScene` gains `on_screen: string | null`. `draftScript` returns the script with `format` and the chosen `topic_id` (null when the owner typed a topic). Rows: `reels.format`, `reels.topic_id`, `reel_scenes.on_screen`.

- [ ] Step 1: Failing tests (pure, no network): the prompt for each format contains its beats verbatim and the shared rules (second person, exact words in quotes, banned list, no tagline, health safety line when `topicHealth`); `REEL_SECONDS` is {lo:30, hi:45, floor:15}; validator rejects: greeting/outro anywhere (extend GREETING_RE use to every line + new OUTRO_RE `/\b(see you (?:next|in the next|tomorrow)|thanks for watching|next video|until next time)\b/i`), CTA_RE anywhere, first-person narration (`/\b(I|I'm|I've|me|my|we|we're|us|our)\b/` — case-sensitive "I"), fewer quoted phrases than `FORMAT_SPECS[f].minQuotes`, `on_screen` on line 1 or > 8 words/80 chars (trimmed to null, not rejected), word count outside the 30–45 s budget at the given speed; accepts a valid sample per format (write 5 small valid fixtures). Schema includes `format` (enum) and per-scene `on_screen` (nullable string).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement. Replace the vignette/story instructions in `REEL_SCRIPT_SYSTEM`/`reelScriptPrompt` with the format-driven rules (research §10); keep every per-line image field and the theme-aware scene rules for crayon/redthread exactly as they are (the scene must depict what the line says). The previous "identity line", "emotional turn at 70–80 %", "loop back to line 1" and "story" rules are removed; keep hook ≤ 12 words, hook_text ≤ 10 words, punch words, shot-list validator/repair.
- [ ] Step 4: `draftScript`: format = `nextFormat(recent formats of the latest 5 reels)`; topic blank → `pickTopic(format, last 15 reels' topic_id)` and pass its `topic` + `health`; typed topic → topic_id null, health detected by a small keyword check (fever, cough, vomit, rash, sleep safety, choking, allergy, medicine). Store format/topic_id/on_screen; on 42703/PGRST204 retry without them (pattern of 012/013).
- [ ] Step 5: Reel caption: pass format + the first quoted phrase; prompt asks to repeat that phrase or the method name, one honest question, no bait (existing validators keep running).
- [ ] Step 6: Run vitest, tsc, lint → PASS. Commit `feat(reels): value-first scripts in five rotating formats`.

### Task 3: Review page + Settings

**Files:**
- Modify: `components/reels/*` (review page line editor, header), `components/settings/*` (Reels section), `lib/actions/reels.ts` (save scene edits incl. on_screen), `lib/actions/settings.ts` (reel_labels)
- Test: jsdom tests next to existing reel review/settings tests

**Interfaces:**
- Consumes: Task 1 types, Task 2 stored fields.
- Produces: `saveReelScriptAction` accepts `on_screen` per line (≤ 80 chars, empty → null); settings action accepts `reel_labels: boolean`.

- [ ] Step 1: Failing jsdom tests: review page shows a format chip (FORMAT_SPECS label) and an editable "On-screen label" input per line except line 1; saving sends on_screen; Settings → Reels shows an "On-screen step labels" switch bound to reel_labels; pre-014 (fields absent) hides both without errors.
- [ ] Step 2: Run → FAIL. Step 3: Implement (shadcn, mobile-first, aria labels). Step 4: Run vitest, tsc, lint, `npm run build` → PASS. Commit `feat(reels): format chip, on-screen labels and the labels switch`.

### Task 4: Worker draws on-screen labels

**Files:**
- Modify: `worker/reel_frames.py` (label card), `worker/reel_render.py` / `worker/reels.py` (pass scene on_screen + setting), `worker/jobs.py` (VERSION 2.5.0)
- Test: `worker/test_reel_labels.py`

**Interfaces:**
- Consumes: `reel_scenes.on_screen`, `settings.reel_labels` (missing → treat as true; missing column → no labels).
- Produces: `label_card(text, font_path=None, band=HOOK_BANDS[0]) -> Image` (RGBA, same style family as `hook_card` but smaller: 60–72 px, ≤ 2 lines, ≤ 870 px wide) and label timing = the scene's word-timing span.

- [ ] Step 1: Failing tests: a label is drawn only during its scene's time span; never before the hook card ends (3.5 s) — if the scene starts earlier, it starts at 3.5 s; it sits in the top band (y within the hook band) and never in the bottom 35 %; long text wraps to ≤ 2 lines and shrinks to fit 870 px; setting off or empty text → no label; quotes render (curly quotes and "·" are in the font).
- [ ] Step 2: Run `python -m unittest test_reel_labels` (worker's Python312) → FAIL. Step 3: Implement with a short pop-in like the hook card (≤ 200 ms) and no fade-out jank (cut on scene change). Step 4: Run all worker tests → PASS. Real check: render 3 s of frames with a label from a local sample image (no DB) and save a PNG to `.superpowers/sdd/2026-10-09-storylines/label-sample.png`. Commit `feat(worker): on-screen step labels (2.5.0)`.

### Task 5: Proof (controller)

- [ ] Gemini: one real script per format (5) through `writeReelScript` (no DB) — paste; judge against research §10.7 (hook in 0–3 s, exact words, no banned phrases, 30–45 s, scenes depict the lines).
- [ ] Ask the owner before using ComfyUI (~20 min). Then one full reel per style through the live app (owner runs 014 + restarts the worker first), judge: hook in 3 s, labels readable, length, unchanged picture style (compare with the 2026-10-09 samples).
- [ ] docs/SETUP.md: "Reel formats" section (run 014, restart the worker, labels switch, speed 1.05).
