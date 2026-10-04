# Unique Names Posting: design

Date: 2026-10-04 · Owner: Robert · Status: approved in brainstorming, pending spec review

## 1. Goal

A private website the owner uses every day to make the "Unique Names" Facebook album post (9–13 baby-name cards from one studio photoshoot theme, plus a caption) and get it onto the phone for manual upload. It replaces the n8n form + Google Sheet flow built on 2026-10-04 (`NKNnmkI8tORQQnIt`), keeping everything that already works: ComfyUI on the owner's PC makes text-free photos, and code stamps the exact name, meaning and `@unique_names`.

Success: from the phone or desktop, the owner starts a post, always sees what is happening (queued, generating, waiting for PC, failed), fixes or regenerates single cards, picks and orders the cards, and saves them to the phone with the caption in under a minute of hands-on time.

## 2. Decisions made with the owner

| Topic | Decision |
|---|---|
| Hub | Supabase (Postgres + Storage + Realtime + Auth, free tier). The PC worker **pulls** jobs; nothing on the PC is exposed. n8n and Tailscale are not used by this system. |
| Images | A cloud copy of every card (Supabase Storage, private) **and** a backup copy in `OneDrive\Pictures\Unique Names\<date> <Boy\|Girl>\` on the PC. The website is the source of truth; the PC folder is a backup and is not synced on delete. |
| Devices | Both, phone matters: mobile-first, bottom tab bar on the phone, side menu on desktop. |
| Look | Light = "Warm Studio" (cream `#FBF6EF`, white cards, brown accent `#8A5A3B`). Dark = warm-tinted "Dark Pro" (`#0F0E0D` bg, `#191715` cards, caramel accent `#E8A87C`). Follows the device setting, with a toggle. |
| Features in | Edit card text (re-stamp, no new photo), Mark as posted (status in the post list), Theme preview (1 sample image). |
| Features out (later) | AI name/theme suggestions, a calendar view, Facebook auto-posting, multiple users. |
| Post rules (unchanged) | One post = one gender (boy/girl separate) + one name style (two-word or single) + 9–13 cards (Auto picks a number, capped by names left), 1080×1080, one name per card, one theme per post, each theme used once, about 1 in 6 shots props-only, first card always a baby. |
| Feedback rule | The owner must always be able to tell whether something is working, waiting or stuck (section 6). |

## 3. Architecture

```
Website (Next.js on Vercel)  ⇄  Supabase  ⇄  PC worker (Python, polls every 3 s)  →  ComfyUI (127.0.0.1:8188)
   plans + queues cards          DB, Storage,      claims a card, generates, stamps,       Z-Image Turbo
   shows live state              Realtime, Auth    uploads, heartbeats every 15 s
```

Repository layout (`Documents\uniquenames-posting`, pushed to GitHub, deployed to Vercel from the root):

```
app/ components/ lib/        Next.js website (TypeScript)
lib/planner/                 post planning rules (ported from n8n-control/builds/unique-names-cards/lib/planner.js)
supabase/schema.sql          one script: tables, functions, RLS, storage bucket, realtime
supabase/seed/               starter names + themes (ported from seed-data.js)
scripts/import.ts            one-time import: seed rows, today's post + its 9 local cards, used names/theme
worker/                      Python worker (from n8n-control/builds/unique-names-cards/worker) + job loop
docs/                        this spec, setup guide
```

Vercel ignores `worker/` (it only builds the Next.js app). `worker/worker.env` and `.env.local` are git-ignored.

## 4. Data model

All tables have `id uuid pk`, `created_at`, `updated_at`.

- **names**: `name text` (unique on `lower(name)`), `meaning text`, `gender` (`boy|girl`), `style` (`two-word|single`), `status` (`available|reserved|used|skip`), `post_id` (nullable), `position` (card number in that post).
- **themes**: `title` (unique), `gender`, `backdrop`, `outfit`, `props`, `lighting`, `palette`, `status` (`available|used|archived`), `sort_order int` (lowest available is next), `used_on date`, `preview_card_id` (nullable).
- **posts**: `post_date date`, `gender`, `style`, `theme_id`, `caption text` (editable), `status` (`generating|ready|posted`), `posted_at`. A post is `ready` when every card is `done`; it shows "Has failures" while any card is `failed`.
- **cards**: `post_id` (nullable for theme previews), `theme_id`, `kind` (`post|preview`), `position int`, `name`, `meaning`, `shot`, `prompt`, `seed bigint`, `status` (`queued|generating|restamp|done|failed`), `error text`, `photo_path` (clean photo), `card_path` (finished card), `version int` (bumps on regenerate/re-stamp, used in storage paths so caches never show a stale image), `selected bool default true`, `order_index int` (upload order), `queued_at`, `started_at`, `finished_at`, `attempts int`.
- **settings** (one row): `caption_template`, `hashtags`, `handle`, `min_images 9`, `max_images 13`, `width 1080`, `height 1080`, `sound_on bool`.
- **worker_status** (one row): `last_seen`, `comfyui_ok bool`, `gpu text`, `current_card_id`, `worker_version`, `message`.

Card status transitions:

```
queued ──claim──► generating ──ok──► done ──edit text──► restamp ──ok──► done
   ▲                  │ fail/timeout                          │ fail
   └── retry/regen ── failed ◄────────────────────────────────┘
   (stuck > 5 min in generating → back to queued, attempts+1; after 3 attempts → failed)
```

Database functions (SQL, `security definer` where needed):
- `create_post(plan jsonb, request_id uuid)`: the Next.js server action reads the available names and themes, and `lib/planner` makes the whole plan: theme (given, or the lowest `sort_order` available for that gender), names, shots, prompts, seeds, caption. `create_post` then, in one transaction, locks those name and theme rows, checks they are all still `available`, reserves them and inserts the post and its queued cards. If any was taken in the meantime it returns `conflict` and the server action re-plans once. It is idempotent per click: the same `request_id` returns the existing post.
- `claim_next_card()`: worker only. `FOR UPDATE SKIP LOCKED`, oldest `queued` or `restamp` first (`restamp` before `queued`, because it takes about 1 second). Sets `generating` + `started_at`.
- `requeue_stuck_cards()`: called by the worker each loop.
- `delete_post(id)`: returns the post's names to `available`, the theme to `available`, and deletes its storage files.

## 5. Planner rules (ported, behaviour unchanged)

From `planner.js`, with its existing test cases ported to Vitest: theme order, name filtering (gender, style, available, de-duplicated by lowercase name), count (Auto = seeded random 9–13, capped by stock, at least `min_images`), the shot list (first card a baby, 1 props-only shot for 9–10 cards and 2 for 11–13, never two props-only shots in a row), prompts (props-only shots use the "empty set, no person" wording), caption (`{gender}` template + hashtags), seeds. "Add a card" to a post picks one more available name, same theme, next position, a baby shot.

## 6. UI and states

Pages:
- **Today**: New post panel (Boy/Girl, style, count chips, theme with Change/Preview, Generate), the active post's progress bar + live grid, stock left with low-stock warnings.
- **Posts**: list with a status chip and a thumbnail strip. **Post detail**:
  - editable caption + Copy
  - select and set upload order (numbers), Select all
  - **Save to phone** (Web Share API with files; fallback zip) and **Download zip** on desktop
  - Mark posted
  - per card: open large, edit name/meaning (re-stamp), regenerate, delete with 5 s Undo
  - Add a card
- **Names**: search, filters (gender, style, status), add one, bulk paste `Name - meaning` lines with a preview of duplicates and invalid rows before saving, skip/unskip, edit, delete (only if never used).
- **Themes**: cards with a preview image, add/edit, archive, drag to set the next theme, Make preview.
- **Settings**: caption template, hashtags, handle, default count, sound, theme (light/dark/auto), worker details, sign out.

Card tile states (one component used everywhere):

| State | Visual |
|---|---|
| queued | dimmed tile, "#4 in line" |
| generating | shimmer, spinner, live "Making… 0:18" timer from `started_at` |
| restamp | current image stays, "Updating text…" badge |
| regenerating | old image fades, shimmer + timer, new image fades in |
| done | image, subtle pop-in |
| failed | red outline, short reason, Retry |
| waiting for PC | amber "Waiting for your PC" when the worker is offline |

Always visible:
- a header **activity pill** on every page ("● Generating 6/9 · 1 min left" → tap opens the post; green "✓ Post ready"; red on failures)
- the **PC status dot**: green Ready / amber "ComfyUI closed" / red "PC offline, last seen 14 min ago", each with a one-line fix. Offline means `last_seen` is older than 45 s.
- the browser tab title shows progress, "(6/9) Unique Names"
- an optional chime + browser notification when a post finishes

ETA = cards remaining × the average duration of the last 10 finished cards (default 33 s).

Polish rules:
- skeletons, never blank screens
- empty states that name the next step
- confirmation for permanent actions; toasts for every action
- touch targets ≥ 44 px
- keyboard shortcuts on desktop (G generate, A select all, Esc close)
- focus rings and labels (WCAG AA contrast in both themes)
- reduced-motion respected

## 7. Worker (PC)

Keeps `worker.py`'s ComfyUI graph, `fit_to_size`, `pick_band`, `compose_card` and fonts unchanged. Adds a job loop:
1. Heartbeat to `worker_status` every 15 s (ComfyUI health included).
2. `requeue_stuck_cards()`, then `claim_next_card()`. If nothing is found, sleep 3 s.
3. **generating**: ComfyUI → clean photo → stamp → upload `photos/<card>/<version>.jpg` and `cards/<card>/<version>.jpg` → save the backup copy to the PC folder → set `done`, paths and `finished_at`.
4. **restamp**: download the clean photo (local cache first), stamp with the new text, upload a new card version, set `done`.
5. On error: `failed` + a plain reason; network errors back off and retry without losing the claim.

Talks to Supabase over HTTPS with the service-role key from `worker.env`. The HTTP server (`/card`, Tailscale) is removed. Autostart is the Windows logon task (`install-autostart.ps1`, already written).

## 8. Security

- Supabase Auth: email + password, sign-ups disabled, one user.
- RLS on every table: `authenticated` only. `worker_status` and `claim_next_card` are for the service role only.
- Storage bucket `cards` is private; the site uses signed URLs (1 h, refreshed).
- Vercel env: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. The service-role key exists only in `worker/worker.env` on the PC.
- Middleware redirects to `/login` when there is no session.

## 9. Migration and retirement

`scripts/import.ts` (run once by Claude with the service-role key):
- inserts the 212 names and 60 themes
- marks Boho Pampas and the 9 names from execution 3313 as used
- creates the 2026-10-04 Boy post as `ready`
- uploads its 9 local cards as finished cards. The n8n flow never kept the clean photos, so for these 9 cards only, Edit text queues a full regenerate instead of a re-stamp.

The n8n workflow `NKNnmkI8tORQQnIt` is deactivated (kept for the portfolio). The Google Sheet is left as an archive.

## 10. Testing and verification

- Vitest: planner (ported cases), caption, bulk-paste parser, ETA, card-state mapping.
- Python unittest: job loop against a fake Supabase (claim, generate, restamp, failure, stuck requeue), plus the existing 18 worker tests.
- `next build` + `tsc --noEmit` + lint clean.
- SQL: the schema runs cleanly in a fresh project; `create_post` reserves atomically (two parallel calls never share a name).
- End to end on the owner's PC before handover:
  - a real post generated from the website with live progress
  - one card regenerated and one re-stamped
  - Save to phone checked on mobile

## 11. Owner setup (about 15 min, guided)

1. Create a Supabase project, run `supabase/schema.sql` in the SQL editor.
2. Create the login user; disable sign-ups.
3. Give Claude the URL + anon key + service-role key (service key goes only into `worker/worker.env`).
4. Claude runs the import and installs the worker autostart.
5. Push to GitHub, import in Vercel, set the 2 public env vars, deploy.
