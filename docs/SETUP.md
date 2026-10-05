# Setup (about 15 minutes)

You only do this once. Follow the numbers in order.

## 1. Supabase (database, images, login)
1. Go to https://supabase.com and click **New project**. Name: `unique-names`. Region: Southeast Asia (Singapore). Save the database password somewhere safe. Then set `regions` in `vercel.json` to the Vercel region in the same city (Singapore = `sin1`, Sydney = `syd1`) so server pages sit next to the database.
2. Left menu, **SQL Editor**, **New query**. Paste everything from `supabase/schema.sql` and click **Run**. It should say "Success".
   - It is safe to run this file again later (for example after an update).
3. **Authentication > Sign In / Providers > Email**: keep Email on and turn **off** "Allow new users to sign up". Save.
4. **Authentication > Users > Add user > Create new user**: type your email and a strong password, and tick "Auto confirm". This is your login.
5. **Project Settings > API Keys**: copy three things: the **Project URL**, the **anon / publishable** key, and the **service_role / secret** key.

## 2. Keys on your PC
Create these files (copy the matching `.example` file where there is one):
- `.env.local` (the website, for testing on your PC):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `ADMIN_EMAIL` (your login email; the site rejects any other account)
  - `GEMINI_API_KEY` (from https://aistudio.google.com/apikey; writes captions and name/theme suggestions)
- `.env.import` (one-time import): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `worker/worker.env` (the card worker): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

The service_role key goes only in the last two files. Both are git-ignored. **Never put it in Vercel.**
`GEMINI_API_KEY` is a server-only secret: never name it `NEXT_PUBLIC_...`, or it would be sent to the browser. Without it the site still works; captions just use your settings template and the AI suggest buttons are unavailable.

## 3. Import and start the worker
1. Run `npm run import`. It loads 212 names, 60 themes and the 2026-10-04 post.
2. Run `cd worker` then `powershell -ExecutionPolicy Bypass -File install-autostart.ps1`. The worker starts now and at every login.
3. Open ComfyUI Desktop when you want cards made. If it is closed, new cards simply wait in line (amber "ComfyUI closed" dot) and start by themselves as soon as you open it. Editing a card's text still works without ComfyUI.

Your pictures are also backed up on the PC in `OneDrive\Pictures\Unique Names`, in folders named like `2026-10-04 Girl Two-word` (date, Boy or Girl, Two-word or Single).

## 4. Vercel (so you can use it on your phone)
1. Push this folder to a new private GitHub repo.
2. vercel.com > Add New > Project > import the repo (Framework: Next.js, root: the repo root).
3. Environment Variables, add exactly these four, then **Deploy**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ADMIN_EMAIL` (your login email)
   - `GEMINI_API_KEY`: tick **Sensitive**, environments **Production** and **Preview**
4. Open the site on your phone, then Share > **Add to Home Screen** for an app-like icon.

## Daily use
1. Today: choose Boy or Girl and a style, then **Generate post**. Watch the cards appear.
2. Posts: open the post, pick the cards and put them in order.
3. **Save to phone**. On phones this saves at most 10 pictures per tap (an Android limit), so a 13-card post is "Save 1-10" then "Save 11-13". The cards are prepared first ("Preparing n/N...").
4. **Copy caption**, post on Facebook, then **Mark posted**.

## Upgrading to v2 (existing install)
Do these in order:
1. Supabase **SQL Editor**: paste and run `supabase/migrations/002_v2.sql` (safe to run again).
2. Vercel > Settings > Environment Variables: add `GEMINI_API_KEY` (Sensitive, Production and Preview).
3. Push to GitHub so Vercel redeploys (or press Redeploy, so the new variable is picked up).
4. Restart the worker: Task Scheduler, end then run **Unique Names card worker** (or reboot the PC). It loads the new text settings and downloads the fonts into `worker/fonts/` (git-ignored).
5. Fonts per post: in the SQL Editor run `supabase/migrations/003_post_fonts.sql` (safe to run again), then restart the worker once more. Until then posts use the last-used fonts from settings, and changing a post's fonts in Re-stamp asks you to run it.
6. Child age per post: in the SQL Editor run `supabase/migrations/004_subject_age.sql` (safe to run again; no worker restart needed). Until then Today's age choice still shapes the photos (it is baked into each card's prompt), but it is not saved on the post, so **Add a card** on such a post shows the original one-baby look instead of following the post's age.

## Adding Reels (existing install)
Do these in order (this order never leaves a reel failed):
1. Supabase **SQL Editor**: paste and run `supabase/migrations/005_reels.sql` (safe to run again).
2. In the worker's Python: `python -m pip install faster-whisper imageio-ffmpeg` (already done on this PC). The Whisper model (~460 MB) downloads on the first reel.
3. Install the Chatterbox voice node in ComfyUI Desktop as in `docs/reference/reel-pc-spike.md` (section 2: clone `ComfyUI_Fill-ChatterBox` into `custom_nodes`, pip-install its requirements with ComfyUI's own Python), then **restart ComfyUI Desktop** so it loads the node.
4. Restart the worker: Task Scheduler, **End** then **Run** "Unique Names card worker". `worker/worker.log` must not say "reels are off".
5. Push to GitHub so Vercel redeploys the website with the Reels page.

Optional: **Settings > Reels > Images per reel** (10–40, default 40); fewer images make a reel faster.
Full videos land in `OneDrive\Pictures\Unique Names\Reels\`.

## When something is wrong
- Header dot red, "PC offline": turn on the PC. The worker starts at login. **Generate** is disabled (the button says why) until the PC is back.
- Amber dot, "ComfyUI closed": open ComfyUI Desktop. **Generate** stays disabled until then; text edits and Re-stamp still work.
- A card failed: open it and press Retry. The reason is shown on the card.
- Worker log: `worker/worker.log` (it starts fresh each time the worker starts).
