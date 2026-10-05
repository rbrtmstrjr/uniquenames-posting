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
- **Text settings**: font for title / meaning / watermark, sizes, position Auto (calmest band) or 9 fixed spots, live preview, and **Re-stamp** a post without new photos.
- **Deeper lens look**: portrait 85mm f/1.8 for baby frames, macro 100mm f/2.8, shallow depth of field on wide shots.
- New server-only secret `GEMINI_API_KEY` (see `docs/SETUP.md`). Existing install: follow "Upgrading to v2" there.

Setup: `docs/SETUP.md`. Design: `docs/superpowers/specs/2026-10-04-uniquenames-posting-design.md`, v2 changes: `docs/superpowers/specs/2026-10-05-v2-feedback-design.md`.

## Commands
- `npm run dev` · `npm run build` · `npm test` · `npm run typecheck` · `npm run lint`
- `npm run import` (once) · `cd worker && python -m unittest -v`
