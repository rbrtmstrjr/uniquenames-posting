# Setup (about 15 minutes)

You only do this once. Follow the numbers in order.

## 1. Supabase (database, images, login)
1. Go to https://supabase.com and click **New project**. Name: `unique-names`. Region: Southeast Asia (Singapore). Save the database password somewhere safe.
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
- `.env.import` (one-time import): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `worker/worker.env` (the card worker): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

The service_role key goes only in the last two files. Both are git-ignored. **Never put it in Vercel.**

## 3. Import and start the worker
1. Run `npm run import`. It loads 212 names, 60 themes and the 2026-10-04 post.
2. Run `cd worker` then `powershell -ExecutionPolicy Bypass -File install-autostart.ps1`. The worker starts now and at every login.
3. Open ComfyUI Desktop when you want cards made. If it is closed, new cards simply wait in line (amber "ComfyUI closed" dot) and start by themselves as soon as you open it. Editing a card's text still works without ComfyUI.

Your pictures are also backed up on the PC in `OneDrive\Pictures\Unique Names`, in folders named like `2026-10-04 Girl Two-word` (date, Boy or Girl, Two-word or Single).

## 4. Vercel (so you can use it on your phone)
1. Push this folder to a new private GitHub repo.
2. vercel.com > Add New > Project > import the repo (Framework: Next.js, root: the repo root).
3. Environment Variables, add exactly these three, then **Deploy**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ADMIN_EMAIL` (your login email)
4. Open the site on your phone, then Share > **Add to Home Screen** for an app-like icon.

## Daily use
1. Today: choose Boy or Girl and a style, then **Generate post**. Watch the cards appear.
2. Posts: open the post, pick the cards and put them in order.
3. **Save to phone**. On phones this saves at most 10 pictures per tap (an Android limit), so a 13-card post is "Save 1-10" then "Save 11-13". The cards are prepared first ("Preparing n/N...").
4. **Copy caption**, post on Facebook, then **Mark posted**.

## When something is wrong
- Header dot red, "PC offline": turn on the PC. The worker starts at login.
- Amber dot, "ComfyUI closed": open ComfyUI Desktop. Waiting cards start by themselves.
- A card failed: open it and press Retry. The reason is shown on the card.
- Worker log: `worker/worker.log` (it starts fresh each time the worker starts).
