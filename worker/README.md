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
Until 005 is run the worker logs "reels are off …" once and checks again every 10 minutes. The worker asks for the
music step (`p_music: true`, migration 006); on a database without 006 it logs "reel music and voices are off …" once,
claims without music (and makes no voice samples) and checks again every 10 minutes.

Steps, in order: voice → timing → music → images → render.

- **Voice** (`voice.py`): the scene lines are grouped into chunks of whole lines (<= 100 words, ~25 s; Chatterbox
  stops at ~40 s), each voiced by the `FL_ChatterboxTTS` node in ComfyUI (custom node `ComfyUI_Fill-ChatterBox`,
  see `docs/reference/reel-pc-spike.md`) with the calm settings (exaggeration 0.35, temperature 0.7, cfg_weight 0.5),
  tightened (007: silence before the first and after the last word trimmed, 70 ms kept; pauses over 0.35 s cut to
  0.25 s; 4 ms fade at every cut; judged on 10 ms RMS frames: silent below 2 % of the chunk's loud speech,
  clamped to -60…-45 dBFS, so a -40 dBFS word tail is speech), joined with a 0.10 s gap, sped up with ffmpeg `atempo=settings.reel_speed` (1.00–1.25, pitch kept; skipped at 1.00)
  and uploaded as `reels/<id>/voice-v<version>.wav` (Whisper then times the sped-up track).
  Narrator: `reels.voice_id` → `settings.reel_voice_id` → `builtin` (Chatterbox's own voice). A voice's reference clip
  (`reel_voices.ref_path`, `voices/<id>/ref.wav`) is downloaded once and sent to ComfyUI's input folder
  (`unique-names/voices-<id>-ref-v<version>.wav`, cached per path + version, sent again if ComfyUI lost it) for
  `LoadAudio` → `audio_prompt`. A voice without a reference clip yet falls back to `builtin`. Without 006, 005's
  `settings.reel_voice_path` is still cloned when set. If ComfyUI has not loaded the node the reel fails with
  "Restart ComfyUI so it loads the Chatterbox voice node."
- **Music** (`music.py`, 006, while `settings.reel_music` is on): ACE-Step 1.5 through ComfyUI's native nodes (models
  in `docs/reference/reel-voices-music-spike.md`) makes one instrumental bed, voice length + 8 s (ACE-Step songs decay to silence near their end, so the render keeps only voice + 2 s), random seed, FLAC →
  `reels/<id>/music-v<version>.flac` → `reels.music_path` (~20 s for a 60 s bed). It runs under status `voicing`. Any
  failure sets `music_path = ''` (the reel goes on with the voice only, not retried); ComfyUI closed just hands the
  step back (like images).
- **Voice samples** (006): only when no reel step can run and ComfyUI is up, `claim_next_voice_sample()` hands out one
  voice; Chatterbox reads the sample sentence with it (calm + current speed) →
  `reels/voices/<id>/sample-v<version>.wav`, `sample_status 'ready'`, `sample_key` (e.g. `e0.35-t0.7-c0.5-s1.12-g1`; `-g1` = tightened), saved
  only if the row's version still matches; older samples are removed. Failure → `'failed'` + `error`; ComfyUI closed
  → back to `'queued'`.
- **Theme previews** (007): after voice samples (same conditions), `claim_next_theme_preview()` hands out one theme;
  Z-Image (seed 1234, 1088x1920 → 1080x1920) draws the fixed moment ("a mother gently lifting her laughing baby up
  toward the warm window light") in the theme's `style` with a simple cast (crocheted dolls for `knitted`), turned grey
  when `grayscale` (sketch) → `reels/themes/<id>/preview-v<version>.jpg`, `preview_status 'ready'` + `preview_path`,
  saved only if the version still matches; older previews are removed. Failure → `'failed'` + `error`; ComfyUI closed
  → back to `'queued'`. Before 007 the claim function is missing: previews are off (logged once, re-checked every
  10 minutes). A theme id that isn't a-z/0-9 → `'failed'` with a message.
- **Timing** (`timing.py`): faster-whisper `small.en` on the CPU gives word times (`reels.words`); each scene gets
  `start_s`/`end_s` by matching its line letter by letter (first line from 0, last to the end of the audio).
- **Images**: each scene's `image_prompt` + `seed` in Z-Image at 1088x1920, fitted to 1080x1920, JPEG q92, uploaded as
  `reels/<id>/scenes/<pos>-v<scene version>.jpg`. If the reel's theme (`reels.theme_id` →
  `settings.reel_theme_id` → `knitted`) has `grayscale` (sketch), the picture is turned grey first (before 007 it stays as made; if
  the settings or the theme can't be read, the image goes back in line without using an attempt). The 3rd failure of an image sets the reel `needs_attention`.
- **Render** (`reel_render.py`): ffmpeg (from `imageio-ffmpeg`) gives each image a camera move for its line's spoken
  time (`reel_scenes.motion`, 007: push_in, pull_out, pan_left/right, tilt_up/down at zoom 1.15, punch = 0.3 s snap
  to +18 %, settle, creep; zoompan on a 2x pre-scaled picture; no motion (before 007) → `punch` for a key moment,
  else a rotation; never the same move twice in a row). The first frame is the picture, no fade; the voice starts at
  once. Word-by-word captions (bottom, white, the spoken word yellow and popping 80 % → 110 % → 100 % in 120 ms), H.264 1080x1920, then a 720p preview
  (<= ~15 MB, 45 MB cap). Time limits 120 / 900 / 300 s per ffmpeg run. With `settings.reel_music` on and a
  non-empty `music_path`, the bed is loudness-normalised, set to `reel_music_volume` % (5–40, default 18), there from t=0
  (a 50 ms de-click fade in), out 2 s, ducked under the voice (`sidechaincompress`, voice as key) and mixed in, cut to the video's length
  (the voice is padded so the music never stops early; the fades are on the bed only, so the last words never fade).
  With music the last picture is held 2 s longer (its move goes on), so the reel is voice + 2 s and the music fades
  out after the last word. Music off, failed (`''`) or missing from storage → the voice only, as long as the voice.
  A redone voice clears `music_path` too (a new bed is made for the new length); no internet during the music step
  hands the step back instead of skipping the music. Older versions of a voice's reference clip are deleted from
  ComfyUI's input folder (found via `--input-directory` in `/system_stats`).
- **Versioned storage paths** (bucket `reels`), so a late result never overwrites a newer one:
  `<id>/voice-v<reel version>.wav`, `<id>/music-v<reel version>.flac`, `<id>/scenes/<NN>-v<scene version>.jpg`,
  `<id>/preview-v<reel version>.mp4`, `voices/<id>/sample-v<voice version>.wav`, `themes/<id>/preview-v<theme version>.jpg`.
  The superseded file is removed after a successful save. Previews older than 14 days are swept (the site shows
  "preview expired"; the PC copy stays).
- **PC output folder**: `OneDrive\Pictures\Unique Names\Reels\<YYYY-MM-DD> <title>.mp4`, written as `.part` then
  renamed (OneDrive never syncs half a file); making the video again replaces that reel's file.
- Every result is saved version-guarded (an edit/redo meanwhile drops it and deletes the upload) and clears the claim;
  long steps re-touch `reels.claimed_at` (between voice chunks, every 20 s of ACE-Step, every 60 s of ffmpeg). A step claimed for 10 minutes
  is put back in line by `requeue_stuck_reels()`.
- Extra needs for reels (worker's Python): `python -m pip install faster-whisper imageio-ffmpeg` (imported only when a
  reel step runs; the Whisper model downloads once, ~460 MB). ffmpeg comes from `imageio-ffmpeg`.
