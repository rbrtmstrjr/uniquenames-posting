# Niche packs

One codebase runs several Facebook pages. Everything one page does differently lives in a **niche pack**
(`packs/<id>/`). The engine (`lib/`, `app/`, `components/`) reads the active pack and holds no page-specific text.
Spec: `docs/superpowers/specs/2026-10-10-niche-packs-name-nest-design.md`.

## How NICHE picks the pack

- Env `NICHE` = the pack id. Unset or empty means `unique-names`. An unknown id throws (`packs/niche.ts`), so a
  misconfigured deployment fails loudly and never posts as another page.
- `next.config.ts` inlines `NICHE` at build time, so browser code reads the same pack as the server. Set it in the
  Vercel project **before** building. Changing it needs a redeploy.
- Server code calls `activePack()` from `@/packs`. Client components (`"use client"`) call `sharedPack()` / `brand()`
  from `@/packs/shared`, never `@/packs`. That keeps the prompts and topic banks out of the browser bundle;
  `tests/packs.test.ts` checks it, transitively.

## What a pack contains (`packs/types.ts`)

| Part | Client-safe? | What | Read by |
|---|---|---|---|
| `brand` | yes | name, description, mark, watermark handle, login texts, "post ready" text, zip prefix, PC folder name, posting-time hint, icon + login photos, colour tokens | layout, login, shell, Settings, Today, save, chime |
| `captionTemplate`, `hashtags`, `ctaMessages`, `voices` | yes | a new project's settings and the fallbacks for empty ones; the house voices + default | `lib/captions/hashtags`, `lib/cta/messages`, `lib/reels/voices`, `packs/seed` |
| `cards` | no | children's looks, shot lists per session, props-only shots, the closing card's moment | `lib/planner/prompt`, `lib/planner/shots` |
| `captions` | no | post caption system prompt + style guide, reel caption system prompt | `lib/ai/caption`, `lib/ai/reel-caption` |
| `suggest` | no | name / theme / by-letter suggestion prompts and default wishes | `lib/ai/suggest` |
| `reels` | no | script system prompt (audience, language, ages), auto-topic line, vetted claims, cast rules, style stories, greeting name, topic-ideas prompt + format hints, topic bank, voice reference line | `lib/ai/reel-script`, `lib/ai/reel-ideas`, `lib/reels/topics`, `lib/ai/tts` |

These stay in the engine and are the same for every pack: the Crayon / Red Thread guide text (`lib/reels/guide-text.ts`),
the reel formats and their beats, the health rules, the Filipino / Tagalog and jargon ban lists (`lib/ai/plain-words.ts`),
the common-names filter, the age range and the card / reel layout rules.

## Settings and the database

`supabase/schema.sql` keeps the Unique Names column defaults (caption template, handle, hashtags, closing-card
messages, voice). The live project keeps its rows. A new project gets its pack's values from `settingsSeed(pack)`
(`packs/seed.ts`) in a seed step. Until then, the app uses the pack's value wherever a setting is missing or empty:
always-tags and the pool (null), closing-card messages (empty), and the watermark preview (empty handle).

The PC worker reads its own page settings (`worker/pages/<id>.env`); its pack id must match `NICHE`.

## Adding a pack

1. Copy `packs/unique-names/` to `packs/<id>/`. Rename the exports and rewrite every value for the new page. Keep the
   shapes: shot texts stay unique within the pack, and every `topics` id stays unique.
2. Register it: add the id to `PACK_IDS` in `packs/niche.ts`, the shared part in `packs/shared.ts`, and the full pack
   in `packs/index.ts`.
3. Put its assets under `public/packs/<id>/` (icon, four login photos) and point `brand.assets` at them.
4. `npx vitest run`. The unique-names snapshots (`tests/pack-snapshots.test.ts`) must stay green, and `tests/packs`
   checks every registered pack's shape. Add tests for the new pack's own outputs.
5. Deploy a Vercel project with `NICHE=<id>` and its own Supabase keys. Then seed the new project's settings from
   `settingsSeed`.

**Never** edit the unique-names snapshots to make a change pass. A diff there means the live Unique Names page
would change.
