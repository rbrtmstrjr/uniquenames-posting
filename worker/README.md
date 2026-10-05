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
- Text settings (fonts, sizes, position) come from the `settings` row; a post's own fonts (migration 003: `claim_next_card` returns them as `fonts`) win over the settings fonts, per font, when set. The rules and the font list live in `../lib/text/layout.json` and `../lib/fonts/catalog.json`, shared with the website's Settings preview. Fonts download on first use from github.com/google/fonts; if one can't be fetched the card is stamped in Poppins.
- Needs: Python 3.12 + Pillow, ComfyUI Desktop with `z_image_turbo_bf16`, `qwen_3_4b`, `ae`.

## Reels (voice, timing, images, video)

When no card is waiting, the worker takes the next reel step from `claim_next_reel_step()` (migration 005).
Cards always go first (the claim refuses while a card is in line or being made). ComfyUI is needed for
**voice and images only**: with ComfyUI closed, timing and render steps are still claimed (`p_no_comfy`).
Until 005 is run the worker logs "reels are off …" once and checks again every 10 minutes.

Steps, in order: voice → timing → images → render.

- **Voice** (`voice.py`): the scene lines are grouped into chunks of whole lines (<= 100 words, ~25 s; Chatterbox
  stops at ~40 s), each voiced by the `FL_ChatterboxTTS` node in ComfyUI (custom node `ComfyUI_Fill-ChatterBox`,
  see `docs/reference/reel-pc-spike.md`), joined with a 0.35 s pause, and uploaded as `reels/<id>/voice-v<version>.wav`.
  `settings.reel_voice_path` (a clip in the `reels` bucket) is cloned when set. If ComfyUI has not loaded the node the
  reel fails with "Restart ComfyUI so it loads the Chatterbox voice node."
- **Timing** (`timing.py`): faster-whisper `small.en` on the CPU gives word times (`reels.words`); each scene gets
  `start_s`/`end_s` by matching its line letter by letter (first line from 0, last to the end of the audio).
- **Images**: each scene's `image_prompt` + `seed` in Z-Image at 1088x1920, fitted to 1080x1920, JPEG q92, uploaded as
  `reels/<id>/scenes/<pos>-v<scene version>.jpg`. The 3rd failure of an image sets the reel `needs_attention`.
- **Render** (`reel_render.py`): ffmpeg (from `imageio-ffmpeg`) zooms each image for its line's spoken time, adds the
  voice and word-by-word captions (bottom, white, active word yellow), H.264 1080x1920, then a 720p preview
  (<= ~15 MB, 45 MB cap). Time limits 120 / 900 / 300 s per ffmpeg run.
- **Versioned storage paths** (bucket `reels`), so a late result never overwrites a newer one:
  `<id>/voice-v<reel version>.wav`, `<id>/scenes/<NN>-v<scene version>.jpg`, `<id>/preview-v<reel version>.mp4`.
  The superseded file is removed after a successful save. Previews older than 14 days are swept (the site shows
  "preview expired"; the PC copy stays).
- **PC output folder**: `OneDrive\Pictures\Unique Names\Reels\<YYYY-MM-DD> <title>.mp4`, written as `.part` then
  renamed (OneDrive never syncs half a file); making the video again replaces that reel's file.
- Every result is saved version-guarded (an edit/redo meanwhile drops it and deletes the upload) and clears the claim;
  long steps re-touch `reels.claimed_at` (between voice chunks, every 60 s of ffmpeg). A step claimed for 10 minutes
  is put back in line by `requeue_stuck_reels()`.
- Extra needs for reels (worker's Python): `python -m pip install faster-whisper imageio-ffmpeg` (imported only when a
  reel step runs; the Whisper model downloads once, ~460 MB). ffmpeg comes from `imageio-ffmpeg`.
