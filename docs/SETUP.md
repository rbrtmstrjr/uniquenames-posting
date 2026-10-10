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

## Adding narrator voices and music (existing install)
Any order is safe; this one is the smoothest:
1. Restart the worker (Task Scheduler: **End** then **Run** "Unique Names card worker"). The new worker runs fine before step 2.
2. Supabase **SQL Editor**: paste and run `supabase/migrations/006_reel_voices.sql` (safe to run again).
3. Push to GitHub so Vercel redeploys the website.
4. **Settings > Narrator & music > Set up voices**: Gemini records a ~10 s clip of each of the 30 voices once (about $0.30 in total; voices already set up are skipped). Your PC then records a sample of each voice with Chatterbox; they appear one by one with a ▶ button.
5. Pick the default narrator, speed (default 1.12×) and music volume (default 18 %). Each reel can use a different voice on its review page.

Music: ACE-Step 1.5 in ComfyUI makes a new instrumental bed for every reel. Its model files (~10 GB, in ComfyUI's models folders: `diffusion_models/acestep_v1.5_turbo`, `text_encoders/qwen_0.6b_ace15` + `qwen_1.7b_ace15`, `vae/ace_1.5_vae`) are already installed on this PC; see `docs/reference/reel-voices-music-spike.md` to set up another PC. If music fails, the reel is still made with the voice only.

## Adding themes, feelings and camera moves (existing install)
Any order is safe; this one is the smoothest:
1. Restart the worker (Task Scheduler: **End** then **Run**). It runs fine before step 2.
2. Supabase **SQL Editor**: paste and run `supabase/migrations/007_reel_themes.sql` (safe to run again; it also sets older reels to Knitted Doll).
3. Push to GitHub so Vercel redeploys the website.
4. **Settings > Theme > Make all previews**: your PC makes one preview picture per theme (~1 min each).
5. **Settings > Narrator & music > Make samples**: re-records the voice samples with the tighter delivery (the old ones show as out of date).
6. Pick a default theme. Each reel can use another theme on its review page (before you approve it).

## Unique captions and rotating hashtags (existing install)
1. Supabase **SQL Editor**: paste and run `supabase/migrations/009_captions.sql` (safe to run again; no worker restart needed). It moves your old Hashtags field into the new pool, minus #fyp / #follower / #highlights.
2. Push to GitHub so Vercel redeploys the website. Until step 1 runs, posts still get varied captions and rotating tags (from your old field), but nothing is remembered on the post, and reels get no caption.
3. **Settings > Caption**: check the **Always** tags (on every post and reel, up to 2) and the **Pool** (one rotated into each post). Each post gets at most 4 hashtags and never the exact set of the last 10 posts; each reel gets a caption + topic tags on its page (Copy / Rewrite caption).

## Closing card (existing install)
Every new post ends with one extra picture from the same photoshoot that says "Follow for more / baby name ideas." (or another message from your list) instead of a name. It is not one of the 9–13 name cards and the caption never mentions it.
1. Supabase **SQL Editor**: paste and run `supabase/migrations/010_cta_card.sql` (safe to run again). Until it runs, posts are made exactly as before, without a closing card.
2. Restart the worker (Task Scheduler: **End** then **Run** "Unique Names card worker"). The new worker (2.3.0) stamps the message on its own lines; an older one would stamp it like a name with an empty meaning.
3. Push to GitHub so Vercel redeploys the website.
4. **Settings > Closing card**: switch it on or off and edit the messages, one per line (`/` = a line break, up to 3 lines; `{gender}` becomes boy or girl). Each post gets the message used longest ago, never the same as the post before.
5. On a post the closing card has a **Closing card** badge and is always saved last (you can still unselect it). Open it to change its message (Save text re-stamps the photo) or make a new picture. Posts without one show **Add closing card**.

## Two reel styles: Crayon and Red Thread (existing install)
Reels now come in exactly two styles, built word for word from your guides (`docs/reference/crayon-parenting-prompt.md`
and `docs/reference/red-thread-parenting-prompt.md`): **Crayon** (the default) and **Red Thread** (black-and-white line
art where a red thread on the wrist is the only colour). The 8 old themes stay in the database so old reels can still be
made again, but they are no longer offered.
1. Supabase **SQL Editor**: paste and run `supabase/migrations/012_two_styles.sql` (safe to run again). It adds the two
   styles, hides the old ones and moves your default to Crayon if it was an old theme.
2. Restart the worker (Task Scheduler: **End** then **Run** "Unique Names card worker"). The new worker (2.4.0) keeps
   only the red thread in colour on Red Thread pictures and makes each style's preview from its guide's example scene.
3. Push to GitHub so Vercel redeploys the website.
4. **Settings > Theme > Make all previews**: your PC makes one preview per style (Crayon: "Mother and newborn", Red
   Thread: "2. Newborn"). Pick the default; each reel can switch style on its review page before you approve it.

## Posts by letter (existing install)
A normal post (same 9–13 cards, theme, child age, fonts, caption, closing card) where every name starts with one letter you pick, like 12 girl names starting with K. For two-word names the first name starts with the letter.
1. Supabase **SQL Editor**: paste and run `supabase/migrations/013_letter_posts.sql` (safe to run again; no worker restart needed). It only stores the post's letter for its **Letter K** label: before it runs, posts by letter are still made, just without the label.
2. Push to GitHub so Vercel redeploys the website.
3. **Today > Post type > By letter**: pick Boy or Girl, the name style, child age, theme, fonts and number of cards as usual, then tap a letter. Each letter shows how many available names of that gender and style start with it: green = enough for the cards you chose, amber = too few.
4. Amber letter: **Need N more K names** > **Suggest with AI**. Gemini suggests a few more real, uncommon names than you need (with their meanings). Tick the ones you like and press **Add**: they become available names straight away (check each name and meaning first; rare letters like Q, U, X, Y are where AI ideas are weakest).
5. Press **Generate K post**. The names are picked the usual way among that letter's names. The caption says the names start with K and carries `#namesstartingwithk` among its tags; **Rewrite caption** keeps that. **Add card** on the post picks another K name (when none is left, add more with Suggest with AI). Posts and Today show **Letter K** on the post.
6. The old **A–Z series** (two posts, one name per letter) is no longer made from Today. Series posts you already made keep their **A–Z Part 1 / Part 2** label; `011_az_series.sql` can stay in the database.

## Reel story formats and step labels (existing install)
Reels are now useful lessons of 60–90 s (since 2026-10-10; they were 30–45 s) instead of slow stories. The script re-hooks the viewer every 10–15 s and gets its extra length from more steps, swaps and "if it doesn't work" lines, never from filler. Each new reel uses one of 5 formats in turn: Named Method, Say This Not That, Grandma Said Science Says, Scene to Lesson, Problem to Fix. Leave the topic empty and the AI picks a fresh one from 57 proven topics. Since 2026-10-10 scripts and captions are written in simple English anyone understands (most viewers are in the Philippines, others in the US, Africa, Australia and beyond): no Tagalog / Filipino words, no expert jargon, plain everyday lessons. A script or caption that slips one in is rewritten automatically. Health topics only repeat checked facts and always end with a "call your doctor" line. Crayon and Red Thread pictures are unchanged.
1. Supabase **SQL Editor**: paste and run `supabase/migrations/014_reel_formats.sql` (safe to run again). It stores each reel's format and each line's label, and moves the narrator speed from 1.12× to a calmer 1.05× (a speed you picked yourself is kept). Before it runs, scripts still use the new formats, just without saved labels.
2. Restart the worker (Task Scheduler: **End** then **Run**) so it draws the labels (worker 2.5.0).
3. Push to GitHub so Vercel redeploys the website.
4. Review page: each reel shows its format; the key lines carry a short on-screen label (like `1/3 · "You're mad. Tower fell down."`) that you can edit or clear. **Settings > Reels > On-screen step labels** turns them off for every reel.
5. Voice samples were recorded at the old speed, so **Settings > Narrator & music** may show them as out of date: press **Make samples** to record them again.

## House voices and the natural narration (existing install)
Since worker 2.6.0 (2026-10-10, the voice listening test) the narration is made **line by line**, the way the "retuned Gacrux" test sounded: one Chatterbox call per script line with a livelier delivery (exaggeration 0.6, cfg 0.3, temperature 0.8), the silence at each line's start and end trimmed, a short natural pause between lines (0.4 s, 0.7 s after the hook line) filled with very quiet room tone instead of dead silence, and no pause squeezing. It speaks about 155–160 words a minute, so scripts are now **160–240 words** for 60–90 s (they aim for 175–210 words, about 65–80 s), with the same formats and 4 steps or swaps, said in tighter words. A full 194-word script took about 2 minutes to voice on this PC (the voice model stays loaded for the whole reel and is unloaded before the pictures start).
Only 4 **house voices** are offered now: **Gacrux** (default), **Sulafat** (Warm), **Vindemiatrix** (Gentle) and **Achernar** (Soft). The other voices stay in the database but are hidden everywhere (Settings, the review page picker, Set up voices and Make samples). No database update is needed.
1. Restart the worker (Task Scheduler: **End** then **Run**) so it voices line by line (worker 2.6.0). ComfyUI needs no restart.
2. Push to GitHub so Vercel redeploys the website.
3. **Settings > Narrator & music**: check that **Gacrux** is the default narrator and press **Save settings** (a default outside the 4 house voices already counts as Gacrux for new reels; saving makes it stick). Speed **1.00×** is the natural pace the owner picked.
4. Press **Make samples**: the 4 samples were recorded in the old style and show as **Old sample** until they are re-made.
5. Reels made before this keep working; voicing one again (a new voice or Retry) uses the new line-by-line style.

## Use Claude instead of Gemini (optional)
Reel scripts, captions and the name/theme/letter suggestions can be written by Anthropic Claude instead of Gemini. Voices (TTS) and pictures stay as they are, so `GEMINI_API_KEY` is still needed for **Set up voices** and narration.
1. Create a key at https://platform.claude.com (Settings > API keys) and add prepaid credits (Billing).
2. `.env.local` on your PC: add `ANTHROPIC_API_KEY=...` and `AI_PROVIDER=claude`. Recommended: `AI_SCRIPT_MODEL=sonnet` for reel scripts on Claude Sonnet 5.5 (in the 2026-10-10 test: 5 of 5 scripts passed first time, about 35 s and $0.06 each); without it scripts use Claude Haiku 5.5 (about $0.01 each, but slower with more rewrites and more fact slips). `AI_SCRIPT_EFFORT` (`low`, `medium` or `high`, default `medium`) sets how hard Claude thinks about scripts; `low` fails the script checks too often on Haiku. For the best writing use `AI_SCRIPT_MODEL=opus` (Claude Opus 5.5; in the same test 5 of 5 first time, about 75 s and $0.16 each, with the sharpest lines). Captions and suggestions always use Haiku.
3. Vercel > Settings > Environment Variables: add `ANTHROPIC_API_KEY` (tick **Sensitive**, Production and Preview), `AI_PROVIDER` = `claude` and, if you want it, `AI_SCRIPT_MODEL` = `sonnet` or `opus`. Redeploy.

`ANTHROPIC_API_KEY` is a server-only secret like the Gemini key: never name it `NEXT_PUBLIC_...`. To go back to Gemini, remove `AI_PROVIDER` (or set it to `gemini`) and redeploy. When the Claude balance is empty, the AI buttons say "Your Claude credits have run out".

## When something is wrong
- Header dot red, "PC offline": turn on the PC. The worker starts at login. **Generate** is disabled (the button says why) until the PC is back.
- Amber dot, "ComfyUI closed": open ComfyUI Desktop. **Generate** stays disabled until then; text edits and Re-stamp still work.
- A card failed: open it and press Retry. The reason is shown on the card.
- Worker log: `worker/worker.log` (it starts fresh each time the worker starts).
