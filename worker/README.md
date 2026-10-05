# Card worker (runs on the owner's PC)

Takes queued cards from Supabase one at a time, makes the text-free photo in ComfyUI Desktop
(Z-Image Turbo), stamps the exact name, meaning and handle with Pillow, uploads both to the
private `cards` bucket, and keeps a backup copy in `OneDrive\Pictures\Unique Names\<date> <Boy|Girl>\`.
Sends a heartbeat every 15 s so the website can show "PC ready / ComfyUI closed / PC offline".

- Setup: copy `worker.env.example` to `worker.env`, fill in the Supabase URL and service-role key.
- Run once by hand: `python main.py`. Autostart at login: `powershell -ExecutionPolicy Bypass -File install-autostart.ps1`.
- Tests: `python -m unittest -v` (no ComfyUI needed; the first run downloads the catalog fonts once into `worker/fonts/`).
- Runs from the repo checkout: the fonts catalog (`../lib/fonts/catalog.json`) and layout constants (`../lib/text/layout.json`) are read from the repo at import, so the worker must run from the checkout; copy the whole repo (not just `worker/`) if it ever moves.
- After upgrading, restart the worker (Task Scheduler: end + run "Unique Names card worker", or reboot) so it loads the new text settings and downloads fonts into `worker/fonts/` (git-ignored). Fonts are cached there and fall back to Poppins.
- At startup it fetches Poppins (required) and prefetches the other catalog fonts (best effort, 15 s timeout each); a font that failed is not retried for 10 minutes.
- Text settings (fonts, sizes, position) come from the `settings` row. The rules and the font list live in `../lib/text/layout.json` and `../lib/fonts/catalog.json`, shared with the website's Settings preview. Fonts download on first use from github.com/google/fonts; if one can't be fetched the card is stamped in Poppins.
- Needs: Python 3.12 + Pillow, ComfyUI Desktop with `z_image_turbo_bf16`, `qwen_3_4b`, `ae`.
