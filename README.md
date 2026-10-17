# Unique Names Posting

A private website for the Unique Names Facebook page: one tap makes the day's album post, 9 to 13
baby-name cards from one studio photoshoot theme, made for free on the owner's own GPU, then picked,
ordered and saved to the phone with the caption.

- **Website** (Next.js 16, Vercel): Today, Posts, Names, Themes, Settings. Live progress for every card.
- **Supabase**: database, private image storage, live updates, owner-only login (`ADMIN_EMAIL`).
- **Card worker** (`worker/`, Python, runs on the PC): ComfyUI makes a text-free photo; Pillow stamps the exact
  name, meaning and @unique_names, so spelling is always right. Files: `main.py`, `render.py`, `jobs.py`, `supa.py`;
  config in `worker/worker.env`; log in `worker/worker.log`.

## v2 (2026-10-05)
- **shadcn/ui** controls everywhere, themed with the warm light/dark tokens.
- **Faster**: Vercel functions pinned to `syd1` (same city as the Supabase project, ap-southeast-2 Sydney), route and image skeletons, optimistic actions.
- **Edit name + New picture** saves the text first, then regenerates; the dialog shows the live state.
- **Generate lock**: disabled (with the reason) when the PC is offline or ComfyUI is closed. Text re-stamps still work with ComfyUI closed.
- **AI captions** (Gemini 2.5 Flash, from theme + gender, falls back to the settings template on any error); **Rewrite caption** on the post page.
- **Suggest with AI** on Names and Themes: results arrive as `pending` and need approval (one by one or all); the planner never uses pending rows.
- **Text settings**: sizes, position Auto (calmest band) or 9 fixed spots, live preview, and **Re-stamp** a post without new photos (its fonts can be changed there).
- **Fonts per post**: name / meaning / watermark fonts are picked on Today before generating (defaults = the last post's fonts; migration `003_post_fonts.sql`).
- **Child age per post**: Today's "Child age" picks Random (default: a different child on every card, ages newborn–7 dealt so a post shows a spread) or one child at a fixed age (newborn, 1–7 years), with age-fitting shots (baby, toddler, kid) and child-sized outfits from 3 years (migration `004_subject_age.sql`).
- **Deeper lens look**: portrait 85mm f/1.8 for baby frames, macro 100mm f/2.8, shallow depth of field on wide shots.
- New server-only secret `GEMINI_API_KEY` (see `docs/SETUP.md`). Existing install: follow "Upgrading to v2" there.

## Reels (2026-10-05)
- **Reels** page: Gemini 3.1 Pro writes a 90–120 s knitted-doll reel script (title, cast, one narration line + picture idea per image); the owner edits and approves it.
- The PC then makes it for free, one step at a time between cards (cards always go first): **voice** (Chatterbox in ComfyUI) → **word timing** (faster-whisper) → **images** (Z-Image, 1080×1920) → **video** (ffmpeg: gentle zoom, voice, word-by-word captions at the bottom).
- Live progress; tap an image for **New picture**, **Skip image** after 3 failures, **Try again**, **Make video again**.
- Full video → `OneDrive\Pictures\Unique Names\Reels\<date> <title>.mp4` on the PC; a 720p preview in the private `reels` bucket (removed after 14 days).
- **Settings > Reels > Images per reel** (10–40, default 40).
- Needs migration `005_reels.sql` and the PC steps in `docs/SETUP.md` ("Adding Reels").

Setup: `docs/SETUP.md`. Design: `docs/superpowers/specs/2026-10-04-uniquenames-posting-design.md`, v2 changes: `docs/superpowers/specs/2026-10-05-v2-feedback-design.md`.

## Fewer log lines (worker 2.8.0, 2026-10-17)
The Supabase project went over the Free plan's 1 GB of logs: every request is a log line, and the idle PC worker sent
about 2 a second (~5 million a month). Now:
- **One request per poll**: `claim_next_job` (migration `020_one_claim.sql`) hands out the next card, reel step, voice
  sample or theme preview in exactly the old order; the stuck-claim recovery rides on one poll a minute. Without 020 the
  worker keeps the old calls (checked again every 10 minutes).
- **Idle poll**: every 3 s while there is work, every 15 s after a minute with nothing to do (a new job starts within
  ~15 s, then it is back to 3 s at once).
- **Heartbeat** once a minute, plus within seconds when ComfyUI opens or closes or the PC starts or stops working.
  The website calls the PC offline after 3 minutes without one (was 45 s).
- **Login check** with `getClaims()` (the token is verified on the server with the project's public key) instead of
  `getUser()`, which asked Supabase Auth on every page view.
- Measured with a fake Supabase (`worker/test_request_budget.py`, `python test_request_budget.py report`): an idle day
  178,561 → 7,201 requests (-96 %, ~5.36 M → ~0.22 M a month); a busy hour of non-stop cards 1,105 → 781 (-29 %).
Setup: `docs/SETUP.md` ("Fewer log lines").

## Commands
- `npm run dev` · `npm run build` · `npm test` · `npm run typecheck` · `npm run lint`
- `npm run import` (once) · `cd worker && python -m unittest -v`
