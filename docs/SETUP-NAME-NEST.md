# Name Nest setup (the US page, about 30 minutes)

**Name Nest – Baby Names & Parenting** (@namenest) runs from the same code as Unique Names, with its own Supabase project,
its own Vercel project and the same PC worker. The page's texts, looks, themes, colours and logo live in
`packs/name-nest/` (see `docs/PACKS.md`). Unique Names is never touched by any step below.

Before you start: Supabase's Free plan allows **2 active projects** (Unique Names + Name Nest fit; a third page needs
Pro). Vercel Hobby is for non-commercial use; check whether the pages need Pro.

## 1. A new Supabase project
1. https://supabase.com > **New project**. Organization: yours. Name: `name-nest`. Region: **Southeast Asia
   (Singapore)** (you and the PC worker are in the Philippines; the US audience never talks to Supabase). Save the
   database password somewhere safe. Wait until the project is ready.
2. Left menu **SQL Editor** > **New query**. Open `supabase/schema.sql` from this repo, copy **everything**, paste, click
   **Run**. It must say "Success. No rows returned".
3. **SQL Editor** > **New query** again. Open `supabase/seed/name-nest.sql`, copy everything, paste, click **Run**
   ("Success"). It sets the Name Nest settings (handle @namenest, caption template, #namenest + 12 pool tags, the 8
   closing-card lines, narrator Sulafat, fonts DM Serif Display + Nunito, the Name Nest card layout), adds 40 US
   photoshoot themes and 945 US names (SSA 2025 top 500 girls + top 500 boys, with meaning, origin, US rank and
   year). Both files are safe to run again.
4. **Authentication > Sign In / Providers > Email**: keep Email on, turn **off** "Allow new users to sign up", **Save**.
5. **Authentication > Users > Add user > Create new user**: your email + a strong password, tick **Auto confirm user**,
   **Create user**. This is your Name Nest login (it can be the same email as Unique Names).
6. **Project Settings > API Keys** (or **Data API**): copy the **Project URL**, the **anon / publishable** key and the
   **service_role / secret** key. Keep the secret key only on your PC (step 3).

## 2. A new Vercel project (same GitHub repo)
1. Push the branch first (after you approve the merge). Then vercel.com > **Add New… > Project** > import the same
   GitHub repo again. Project name: `namenest-posting`. Framework: Next.js. Root: the repo root.
2. **Environment Variables** (before the first deploy; `NICHE` is read at build time):
   - `NICHE` = `name-nest`  ← this is what makes the site Name Nest
   - `NEXT_PUBLIC_SUPABASE_URL` = the new project's URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the new project's anon / publishable key
   - `ADMIN_EMAIL` = the login email from step 1.5
   - `GEMINI_API_KEY` (Sensitive; Production + Preview) — the same key as Unique Names is fine
   - optional, as on Unique Names: `ANTHROPIC_API_KEY` (Sensitive), `AI_PROVIDER=claude`, `AI_SCRIPT_MODEL`
3. **Deploy**. Open the site: the login shows the Name Nest logo on a strawberry gingham backdrop. Sign in.
4. On your phone: open the site > Share > **Add to Home Screen** (the icon is the nest with a strawberry).
5. Changing `NICHE` later needs a **Redeploy**. Never set `NICHE` on the Unique Names project.

## 3. The PC worker serves both pages
1. Copy `worker/pages/example.env.example` to `worker/pages/name-nest.env` and fill it in:
   - `PAGE_ID=name-nest`, `PAGE_LABEL=Name Nest`
   - `SUPABASE_URL=` the new project's URL, `SUPABASE_SERVICE_ROLE_KEY=` its secret key
   - `OUTPUT_ROOT=` empty (cards go to `OneDrive\Pictures\Name Nest`)
   - the US theme-preview family (uncomment the three `PREVIEW_*` lines of the example's Name Nest block).
2. Restart the worker: Task Scheduler > **Unique Names card worker** > **End**, then **Run** (or reboot). The worker must
   be 2.7.1 or newer: the top of `worker/worker.log` lists both pages (`[name-nest] Name Nest -> https://…`).
3. The Name Nest site's PC dot turns green within 15 s. While the PC is making a Unique Names job, the Name Nest site
   says **PC busy with your other page** (and the other way round); your job waits its turn.

## 4. First run in the app
1. **Names > Pending**: the 945 seeded names wait for your OK (they are never used before). Each row shows the
   meaning and "#38 in the US (2025) · Greek". Check them (the meanings and origins were written by AI and checked
   for form, not for truth), fix any with the pencil, then **Approve all**. 55 newer names (Paisley, Wrenley, Kayden…)
   had no clear accepted meaning and were left out; add them yourself if you want them.
2. **Settings > Narrator & music > Set up voices** (Gemini records the reference clips once, ~$0.30), then **Make
   samples**. Pick Sulafat or another warm voice.
3. **Settings > Theme > Make all previews** (Crayon and Red Thread).
4. **Today**: Boy or Girl, **Single** names, a child age, a theme > **Generate post**. The cards show the name in DM
   Serif Display, the meaning in Nunito, a red "#38 in the US · Greek" chip and a red @namenest pill.
5. Today shows the posting times: **9–10 pm, 12–2 am and 7–9 am PH time** (US daylight time); from **Nov 1, 2026**
   post **one hour later** (10–11 pm, 1–3 am, 8–10 am).

## 5. Facebook page rules (from the US page launch plan)
- A normal **Page** named "Name Nest – Baby Names & Parenting", username **@namenest** (fallbacks @namenestbaby,
  @thenamenest). Profile picture: `public/packs/name-nest/logo.svg` (or the icon); cover: a gingham login backdrop.
- Run it openly from the Philippines: **no VPN**, no location hiding.
- **Never** invite Filipino friends, share the page from a PH account, or cross-promote with Unique Names (both ways).
  The first viewers decide who Facebook shows the page to next.
- Seed with **US-only ads**: a Page-likes campaign at **≥ $10/day**, United States only, Audience Network off, left
  alone for 7 days; plus US boosts on the best Reels. Expect $0.50–2 per follower, ~$150–300 in month 1.
- Leave **"Show only in: United States"** OFF at launch (it permanently drops non-US followers; untested for a PH admin).
- Never post the same card, album, caption or reel on both pages. Label realistic AI voice / video with **AI info**.
- Cadence: a few Reels a week at first, building to 2–3 posts a day. Reels stay 60–90 s.
- Goal by day 60: ≥ 85 % US and < 5 % PH followers. Check Business Suite > Audience (location) weekly; if the PH share
  climbs, stop PH-reaching promotion first, then restrict single posts to the US.
- Monetization is invite-only in 2026; plan for 3–6 months with no Meta payout. File a W-8BEN when invited.

## Database updates after setup
A project set up from `supabase/schema.sql` before 2026-10-11: in the **SQL Editor** run
`supabase/migrations/016_swap_card_name.sql` once (safe to run again). It lets the card dialog's **My names** tab put a
name from the Names page on a card in one safe step. A project set up later already has it.
Then run `supabase/migrations/017_initials_posts.sql` once (safe to run again) for **Today > Initials** (two-word names
with two chosen initials, like A·R): it stores the post's **A·R** label and picks unused names first, then new AI names
(US English), then names used before, in one safe step. Before it runs, initials posts are made without names used before
and without the label. A project set up from `supabase/schema.sql` after 2026-10-11 already has it.

## Updating the names later
When SSA publishes a new year (each May): `npx tsx scripts/import-ssa.ts`, then
`npx tsx --conditions=react-server scripts/name-meanings.ts` (needs `ANTHROPIC_API_KEY` in `.env.local`; ~1-2 US cents
with Haiku; `--model sonnet` for stronger meanings), then `npx tsx scripts/seed-name-nest.ts` and run
`supabase/seed/name-nest.sql` again (existing names and themes are kept; settings are set back to the pack's values,
so re-check Settings afterwards).
