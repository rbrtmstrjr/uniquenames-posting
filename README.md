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

## Post now / Schedule to Facebook (2026-11-04)
The post page sends the selected cards straight to the Facebook Page as ONE multi-photo post (upload order, closing card
last, the caption as it is in the box), now or at a picked time (15 minutes to 29 days ahead, Manila; Facebook holds a
scheduled post, so the PC and the app can be off). Posting only, through the official Graph API v26.0, every call signed
with `appsecret_proof`. The one safeguard is never posting the same album twice: `posts.fb_state` is taken with one
conditional update before anything is sent, and a post whose creation got no answer is "unsure" until the owner checks
the Page. Needs migration `021_facebook_posting.sql` and three Vercel variables (`docs/SETUP.md`, "Posting to Facebook").
Design: `docs/superpowers/specs/2026-11-04-facebook-posting-design.md`; research: `reports/Facebook auto posting monetization risk.md`.

## Story shots (2026-10-18)
Each post is now shot the way a photographer works through a session: one set, and the camera moves in. About 80% of
frames are close-ups or macros, each with ONE hero: the child's face, a detail (hands, feet), or one prop from the
theme. Props rotate so every prop gets its own frames; focus pulls put a prop tack sharp with the child a soft blur
behind; 2 props-only still lifes land in different spots each post. No wide shots.
- Prompts lead with the frame and its placement ("in the bottom half of the frame, the upper half empty backdrop"),
  so the stamped name stays clear; hands and detail frames leave the face and hats out so macros stay macros.
- AI theme suggestions ask for 3-5 props that can each carry a close-up; existing themes work as they are.
- The name is stamped extra-bold (800; fonts that stop at 700 use 700). Poppins ExtraBold downloads on the worker's
  next start.
Design: `docs/superpowers/specs/2026-10-18-story-shots-design.md`.

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
