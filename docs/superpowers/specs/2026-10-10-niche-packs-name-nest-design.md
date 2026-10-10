# Niche packs + Name Nest (US parenting page)

Date: 2026-10-10 · Owner decisions in `C:\Users\rober\OneDrive\Documents\automation\reports\US page launch plan.md` (read it — every US-audience rule there is a requirement) · Research: `automation/reports/US Facebook page and niche strategy.md`.

## Goal
Run a second Facebook page, **Name Nest – Baby Names & Parenting** (@namenest), targeting **US audiences only**, from the **same codebase** as Unique Names. One code, two deployments, one PC worker.

## Decisions (owner, 2026-10-10)
| # | Topic | Decision |
|---|---|---|
| 1 | Architecture | One repo; a **niche pack** chosen by env `NICHE` (`unique-names` default, `name-nest`). Two Vercel projects + two Supabase projects. Not a fork, not multi-tenant. |
| 2 | Working copy | Name Nest is built in `C:\Users\rober\OneDrive\Documents\namenest-posting` (a clone of the same GitHub repo, branch `feature/niche-packs`). The live Unique Names checkout (`uniquenames-posting`, which the PC worker runs from) is never touched until the owner approves the merge. |
| 3 | Page | US **parenting** page: baby names (albums) + parenting tips & info (narrated Reels + tip albums) + mom-life encouragement. Not names-only. |
| 4 | Audience | **US only.** American English (US spelling), American everyday life (US holidays, $, °F, miles, daycare, car seats, school year), **varied American babies and families**, American nursery styles. No Philippine/Filipino references, no Tagalog, no "global audience" framing. Health tips = only vetted AAP/CDC/HealthyChildren facts + "call your pediatrician". |
| 5 | Branding | **Strawberry red & cream** (from the Unique Names "Strawberry Patch" theme the owner loves): berry red `#A8323A`, deep red `#8E272F`, cream `#F6EEE4`, blush `#E8D6D0`, leaf green `#4F7A4A` (small accent), ink `#2B1E1E`; gingham as a pattern accent. Logo: a small woven nest holding a strawberry (or heart-shaped strawberry) + "Name Nest" wordmark. Watermark `@namenest`. Brand red appears in the logo, watermark, card text accents/chips, closing card, reel hook card and website — **photoshoot themes still vary** (each includes a red accent prop) so posts never look mass-produced. |
| 6 | Distinctness from Unique Names | Never reuse Unique Names images, captions, themes or reels; different fonts, card layout, watermark, palette, hashtag pools, closing-card texts, caption style. Don't cross-promote. |

## Niche pack (what becomes configuration)
A pack = a folder `packs/<id>/` (TS/JSON) + optional seed data. Everything niche-specific moves into it; the engine reads the active pack.
- **Brand:** app name/title, logo, colours (website theme tokens), login backdrop, handle/watermark, closing-card messages, default fonts + card layout preset, reel hook-card/caption colours.
- **Audience & language:** audience description for every AI prompt (scripts, captions, suggestions), banned-word lists (Tagalog list for both; US pack adds non-US spellings? keep simple: US spelling instruction), locale (en-US), units/currency.
- **Names:** item schema stays name + meaning (+ US pack: origin, US rank & year from SSA data); seed/import source; AI name-idea prompt (US-focused, uses SSA popularity); letter posts unchanged.
- **Photo looks:** child/family looks (US: varied ethnicities/skin tones/hair, rotated per post), photoshoot theme generator prompt (US nursery styles + one red accent prop), shot list wording, closing-card photo prompt.
- **Captions & hashtags:** caption prompt + styles, always/pool hashtags (US pool: e.g. #babynames #babynameideas #momlife #momsofinstagram? → keep FB-relevant US tags), CTA lines.
- **Reels:** audience line, topic bank (US-relevant topics; keep vetted health facts), format labels (Grandma Said Science Says ok), cast looks, voices (house voices — US: pick warm American-sounding voices; default can stay Gacrux if it sounds American), styles (Crayon/Red Thread available; brand colours on hook card/labels).
- **Ops:** PC backup folder name (`OneDrive\Pictures\Name Nest`), worker job prefix, US posting-time hints shown in the app (PH time: 9–10 pm, 12–2 am, 7–9 am during US daylight time; +1 h after 2026-11-01).

The `unique-names` pack must reproduce today's output **byte-for-byte** (prompts, captions, hashtags, closing cards, branding) — proven by snapshot tests before anything else changes.

## Worker (one process, several pages)
One worker process serves several Supabase projects in turn (round-robin, one ComfyUI job at a time), each with its own env (`worker/pages/<id>.env`: SUPABASE_URL, key, OUTPUT_ROOT, pack id). The voice model stays loaded only within one reel's voice step. Heartbeat per project. Backward compatible: with only `worker.env` it behaves exactly as today.

## Data
Same schema for both projects (run `supabase/schema.sql` on the new project). US pack seed: names from **SSA national baby-name data** (public domain) with rank/year; meanings/origins via AI suggestions the owner approves (existing pending flow) — never invented silently. Optional migration only if a column is truly needed (e.g. names.origin, names.us_rank) — idempotent, folded into schema.sql, harmless for Unique Names.

## Out of scope (owner does)
Facebook page creation, new Supabase project, new Vercel project, ads. Claude provides step-by-step instructions when the code is ready.

## Safety
- Never touch the live `uniquenames-posting` folder, its database or worker while building.
- No pushes/merges without the owner's explicit approval (single-use).
- Unique Names keeps working identically; rollback = previous Vercel deployment.
