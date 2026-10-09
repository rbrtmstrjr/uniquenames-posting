# Reels: value-first storylines (5 rotating formats)

Date: 2026-10-09 · Builds on `2026-10-07-reels-playbook` and the two guide styles (Crayon / Red Thread, migration 012).
Research: `C:\Users\rober\OneDrive\Documents\automation\reports\Parenting reels storyline research.md` (63 sources; sections 2.3 formats, 3 hooks, 4 length, 5 engagement, 6 topics + safety, 7 voice, 10 encodable rules).

## Why
The owner posted 2 Red Thread reels on the 140K page: ~500 views each (normal for the page size) and **zero** likes or comments. Both scripts were slow first-person emotional vignettes ("He threw the blue shoe across the room…", "Why does three in the morning always feel so lonely?") — nothing to use, save or share; AI-labelled emotional content is penalised far more than AI informational content. The owner proposed Problem → Solution → closing suggestion; research confirms the direction and adds: a specific problem in 0–3 s, a one-line why with a soft credible anchor, the fix as exact words to say, a warm reframe instead of a CTA, 30–45 s.

## Decisions (owner, 2026-10-09)
| # | Topic | Decision |
|---|---|---|
| 1 | Approach | **A: rotating proven formats** (no weekly name-bridge format). |
| 2 | Topics | AI picks from a researched topic bank when the topic is blank; the owner can still type a topic. |
| 3 | Graphics | **Unchanged.** Crayon / Red Thread guide prompts, thread logic, colour rule and generation settings are not touched. Only the story content of each line changes. |
| 4 | Tagline | **None.** Reels end on the warm closing line. |

## Formats (research §2.3; timings at the pipeline's real pace)
Each reel has a `format`; rotation: never the same as the previous reel, least-recently-used among the 5.
1. `named_method` — Named-Method Reveal: hook with the method's name or "stop X, try Y" → why the usual way fails → soft anchor + "here's how" → 3 steps, each with exact words in quotes → the "wait, that works?" reason → close restating the method name + warm reframe.
2. `say_this` — Say This, Not That: hook "N things we all say that make [problem] worse — and what to say instead" → why words matter → 3 swaps "Instead of '…', say '…'" + micro-why → small bonus → warm close.
3. `lola_science` — Lola Said, Science Says: myth hook → honour lola's intent → the plain fact with a soft source → 2–3 do-this-instead actions → generic safety line → verdict ("let go, gently" / "keep the sweet part") + warm close. Never ridicule lola.
4. `scene_lesson` — Scene → Pivot → Lesson: second-person in-medias-res hook → ≤ 2 sentences of scene (present tense, one local detail) → pivot by ~11 s ("Here's what's really happening.") → child's-eye why → a named script to say → warm reframe. Story ≤ 25 % of runtime.
5. `problem_fix` — Problem → Why → Fix → Close (the owner's structure): named specific problem → empathy line → child's-eye why → one named fix + exact words → closing suggestion ("Tonight, try it once.").

## Script rules (all formats; research §10)
- Length **30–45 s** (word budget from the narration speed, as now); the line count follows (≈ 10–14 lines/images).
- Hook ≤ 12 words in 0–3 s states a specific problem / method / myth; hook card = the method or problem in ≤ 8 words.
- Second person ("you", "your toddler"); no first-person stories (I / we / my son).
- The fix is always exact words in quotes the mom can say tonight.
- One soft credible anchor per reel ("pediatricians say", "psychologists call it…"); no invented studies, numbers or quotes.
- Health/medical topics: soft wording + a generic safety line ("If the fever lasts more than two days, call your doctor."); no diagnosis, no symptom checklists.
- Banned: greetings ("Hello, mama"), outros ("see you next video"), engagement asks (like / comment / share / tag / follow / save / vote), "watch till the end", taglines.
- Warm, simple English for Filipino moms that also works globally; at most one local detail (lola, sala, jeep, merienda).
- Every line still carries the existing per-line fields (scene, shot size, subject, feeling, thread state, punch) so the image builder works unchanged; the scene shows what the line says (e.g. "get low" → the mother kneeling to her crying toddler).
- Self-check before output (research §10.7): hook in 0–3 s, exact words present, no banned phrases, within the word budget.

## Topic bank
`lib/reels/topics.ts`: the 52 researched ideas (research §6.3), each with a topic, a suggested format and a sensitivity flag (health → needs the safety line). Blank topic → pick one not used in the last 15 reels (compare by topic id stored on the reel) and preferably suited to the rotated format.

## On-screen labels
- New per-line `on_screen` text (≤ 8 words, optional): Gemini fills it on step / swap / verdict lines (e.g. "1/3 · “You're mad. Tower fell down.”", "Instead: “Walking feet, please.”").
- The worker draws it in the same top band as the hook card (same font family / outline style), only while that line is spoken, never over the first 3.5 s hook card; captions keep running below. Text only — the picture underneath is unchanged.
- Settings → Reels → "On-screen step labels" switch (default on). Review page: each line's label is editable (empty = none).

## Captions
The reel caption (009 flow) gets the format and the key phrase: repeat the exact phrase / method name so the post is worth saving, one honest question, no bait, ≤ 4 hashtags (unchanged rules).

## Narrator speed
Default narration speed changes from 1.12× to **1.05×** (calmer). Existing settings rows that still hold the old default 1.12 are moved to 1.05 by migration 014; any other value the owner chose is kept.

## Data (migration `014_reel_formats.sql`, idempotent, folded into schema.sql, PGlite parity tests)
- `reels.format text null` check (named_method|say_this|lola_science|scene_lesson|problem_fix); `reels.topic_id text null`.
- `reel_scenes.on_screen text null` (≤ 80 chars).
- `settings.reel_labels boolean not null default true`.
- settings narration speed 1.12 → 1.05 (only when equal to 1.12).
- Pre-014 fallback: scripts still write (format/labels dropped on insert), the worker ignores missing fields.

## Worker
Render: draw `on_screen` labels when present and the setting is on (worker reads the setting like other reel settings). Bump VERSION; owner restarts. No change to image generation, colour rules or prompts.

## Testing
- Unit (TS): format rotation, topic pick (recent exclusion), banned-phrase check, word budget at 1.05×, exact-quote presence per format, safety line on health topics, on_screen length, migration 014.
- Unit (Python): label drawing position (top band, never during the hook card, never in the bottom 35 %), chunking/fit, setting off → no label.
- Real: one Gemini script per format (5) — paste and judge against the research rules. Then, with the owner's go-ahead (ComfyUI busy ~20 min), one full reel per style rendered and judged (hook in 3 s, labels readable, 30–45 s, pictures in the unchanged style).
