# Unique Names Posting

A private website for the Unique Names Facebook page: one tap makes the day's album post, 9 to 13
baby-name cards from one studio photoshoot theme, made for free on the owner's own GPU, then picked,
ordered and saved to the phone with the caption.

- **Website** (Next.js 16, Vercel): Today, Posts, Names, Themes, Settings. Live progress for every card.
- **Supabase**: database, private image storage, live updates, owner-only login (`ADMIN_EMAIL`).
- **Card worker** (`worker/`, Python, runs on the PC): ComfyUI makes a text-free photo; Pillow stamps the exact
  name, meaning and @unique_names, so spelling is always right. Files: `main.py`, `render.py`, `jobs.py`, `supa.py`;
  config in `worker/worker.env`; log in `worker/worker.log`.

Setup: `docs/SETUP.md`. Design: `docs/superpowers/specs/2026-10-04-uniquenames-posting-design.md`.

## Commands
- `npm run dev` · `npm run build` · `npm test` · `npm run typecheck` · `npm run lint`
- `npm run import` (once) · `cd worker && python -m unittest -v`
