# Unique Names Posting v2: owner feedback round

Date: 2026-10-05 · Builds on `2026-10-04-uniquenames-posting-design.md` (still the source of truth for everything not changed here).

## Decisions (owner, 2026-10-05)

| # | Item | Decision |
|---|---|---|
| 1 | Native controls | Install **shadcn/ui** themed with the existing warm light/dark tokens; replace every browser-native control (select, date input, checkbox, number input, details/summary, raw inputs/textareas) and rebuild the kit (Button, Dialog, Segmented, Badge…) on shadcn primitives. |
| 2 | Slow clicks | Root cause: Vercel functions run in **iad1** (US East) while Supabase is in Asia (sin edge); every request crosses the Pacific several times. Pin functions to **sin1**. Plus: instant optimistic feedback on every action, pending states on every button, route skeletons (`loading.tsx` per page) and image skeletons (tile, dialog, previews). |
| 3 | Edit + New picture | "New picture" with edited name/meaning saves the text first, then regenerates. The dialog shows the live state (in line / waiting for PC / making… / updating text) while open. |
| 4 | Captions | **Gemini 2.5 Flash** writes each post's caption from its theme + gender at creation (1–2 warm sentences, max 1 emoji) + the owner's hashtags. Falls back to the settings template on any AI error (never blocks a post). "Rewrite caption" on the post page. |
| 5 | Depth | Baby frames: portrait lens look (85mm, f/1.8, creamy background blur); macro 100mm f/2.8; wide/overhead 35–50mm still with shallow depth of field. |
| 6 | Generate lock | Generate disabled when the PC is **offline or ComfyUI is closed**, with the reason on the button. Re-stamps (text edits) still allowed when only ComfyUI is closed. |
| 7 | AI suggestions | Names page and Themes page get **Suggest with AI** (Gemini). Results are inserted as `pending` and need approval (one by one or all). Uniqueness: names — full name unique (case/space-insensitive); a two-word combination may reuse a first name with a different second name and vice versa. Themes — title unique and props set unique (colors/concepts may repeat). Pending rows are never used by the planner. |
| 8 | Text settings | Per-element font family (title / meaning / watermark) from a curated Google Fonts catalog, size sliders (title, meaning, watermark), and position **Auto (calmest band)** or one of **9 fixed spots** (top/middle/bottom × left/center/right) with safe padding (≥ 6% of the width from edges). Live preview in Settings. "Re-stamp this post" re-applies text settings to a post's cards without new photos. |

## Data changes (migration `supabase/migrations/002_v2.sql`, idempotent; also folded into `schema.sql`)

- `names.status` and `themes.status` allow `pending`.
- `settings`: `title_font text default 'poppins'`, `meaning_font text default 'poppins'`, `mark_font text default 'poppins'`, `title_size int default 95` (px at 1080), `meaning_size int default 37`, `mark_size int default 21`, `text_position text default 'auto'` (`auto | top-left | top-center | top-right | middle-left | middle-center | middle-right | bottom-left | bottom-center | bottom-right`), `caption_ai boolean default true`.
- Font catalog (ids → Google Fonts files, verified to render in Pillow 2026-10-05): poppins, montserrat, playfair, fraunces, dmserif, quicksand, nunito, lora, cormorant, josefin, comfortaa, greatvibes, dancing, pacifico, parisienne. Variable fonts set weight by axis/name (title ≈ SemiBold, meaning/watermark ≈ Regular).

## Secrets

`GEMINI_API_KEY` — server only (Vercel secret + `.env.local`); never sent to the browser.

## Testing

Every item ships with unit tests where logic exists (planner prompts, uniqueness, Gemini client with mocked fetch, worker layout/fonts/positions, SQL via PGlite) and a real-browser check (desktop 1440 + phone 390, light + dark) for UI items. Each task passes a review before the next starts.
