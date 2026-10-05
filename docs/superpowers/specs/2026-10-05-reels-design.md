# Reels in the web app (Knitted Doll, made free on the PC)

Date: 2026-10-05 · Builds on `2026-10-04-uniquenames-posting-design.md` and `2026-10-05-v2-feedback-design.md`.

Ports the n8n workflow **Reel · Heart-Tug (Knitted Doll)** (`5RCvIIU6RKC0H8lW`) into Unique Names Posting. Same story engine; the paid parts (Gemini images, Gemini TTS) move to the owner's PC, and Slack is replaced by a review page. The n8n prompts are copied verbatim in `docs/reference/reel-knitted-doll-n8n.md` and are the starting point for the port.

## Decisions (owner, 2026-10-05)

| # | Topic | Decision |
|---|---|---|
| 1 | Script | Gemini **3.1 Pro preview** (`gemini-3.1-pro-preview`, billed key, about $0.15 per reel) writes title + cast + narration lines + one image idea per line, ported from the n8n Storyboard prompt. |
| 2 | Topic | Optional topic box; blank = Gemini picks a fresh early-years topic. Never repeats a title already made (all reels in the database are sent as "already made"; a duplicate title is rewritten automatically up to 2 times). |
| 3 | Review | Review page before anything runs on the PC: edit the title and any narration line, **New script** to re-roll, **Approve and make reel**. |
| 4 | Pace | Same as n8n: one image per short line (6–10 words), about 25–40 images, 2–4 s each. Settings: max images per reel (default 40, range 10–40). |
| 5 | Voice | **Chatterbox** (Resemble AI, MIT, commercial use OK) running in ComfyUI on the PC. Default built-in voice first; Settings later takes a 5–10 s reference clip. |
| 6 | Images | ComfyUI **Z-Image Turbo** (same graph as name cards), 9:16 at 1080×1920 (render at 1088×1920, multiple of 16, then fit). Knitted-doll art direction ported from n8n `Split Scenes`. |
| 7 | Captions + timing | **faster-whisper** on the PC gives word times; each image stays on screen for its own line's spoken time; word-by-word yellow captions (same look as the n8n reel). |
| 8 | Video | **ffmpeg** on the PC (installed via Python, `imageio-ffmpeg`): gentle Ken Burns zoom per image, voice track, burned-in captions, H.264 1080×1920. |
| 9 | Storage | Full MP4 → `Pictures\Unique Names\Reels\<YYYY-MM-DD> <title>.mp4` (OneDrive, syncs to phone). Web app gets a **720p preview** (target ≤ 15 MB, hard cap 45 MB) in a private `reels` bucket; previews older than 14 days are deleted. |
| 10 | Lock | **Approve and make reel** obeys the generate lock (PC offline or ComfyUI closed). |
| 11 | Later (not this round) | Auto-post to Facebook, other graphics styles, music, voice changes. |

## Prompt port rules (important)

- Z-Image runs at cfg 1: there is **no negative prompt**, and naming an unwanted thing makes it appear. The n8n `AVOID ENTIRELY:` clause and every "no X / NOT a drawing" phrase must be rewritten as **positive-only** wording (describe only what should be in frame). The single allowed exception is the existing `NO_TEXT` line from `lib/planner/prompt.ts`.
- Never the word "camera"; lens + aperture wording like the photoshoot planner.
- The cast (two dolls) is written once by the script and injected into every image prompt, exactly as n8n does.
- The storyboard prompt's n8n expressions (`{{ $('Config')... }}`, the "already made" list) become plain template values filled by the server.

## Data (migration `supabase/migrations/005_reels.sql`, idempotent; folded into `schema.sql`)

- `reels`: `id uuid pk`, `title text`, `topic text null`, `cast jsonb` (`{adult, child}`), `status text` (`script` | `queued` | `voicing` | `imaging` | `rendering` | `ready` | `needs_attention` | `failed`), `error text null`, `voice_path text null`, `words jsonb null` (Whisper word times), `preview_path text null`, `pc_path text null`, `duration_s numeric null`, `version int` (version-guarded updates like cards), `claimed_at`, `started_at`, `finished_at`, `created_at`, `updated_at`.
- `reel_scenes`: `id uuid pk`, `reel_id fk on delete cascade`, `position int`, `beat text`, `narration text`, `image_prompt text`, `seed bigint`, `status text` (`pending` | `queued` | `generating` | `done` | `failed` | `skipped`), `photo_path text null`, `attempts int`, `error text null`, `start_s numeric null`, `end_s numeric null`, `version int`, timestamps. Unique `(reel_id, position)`.
- `settings`: `reel_max_images int default 40 check 10..40`, `reel_voice_path text null`.
- RLS owner-only like the other tables; realtime on both new tables; private storage bucket `reels` (preview MP4s, voice WAVs, scene images).
- SQL functions: `claim_next_reel_step()` (service role) returns the next unit of reel work (see Worker), version-guarded; reel work is claimed only when no card is queued/generating, so cards and reels never compete for the GPU; `requeue_stuck_reels()`.

## Web app

- **Reels** tab (sidebar + phone nav).
- **List** (`/reels`): cards with title, status badge, first-image thumbnail, date; **New reel** button.
- **New reel**: topic box (optional) + **Write script** (server action → Gemini; loading state; on success creates the `reels` row in `script` status with its scenes in `pending` and opens the review page).
- **Reel page** (`/reels/[id]`):
  - `script`: editable title + each line (narration editable; image idea shown small, editable in a disclosure), **New script** (re-roll, keeps the topic), **Approve and make reel** (lock-aware), **Delete**.
  - after approval: live progress (realtime) — "Voice ✓ · Images 12/35 · Making video…", a grid of finished images (tap → redo that image), 720p preview player when ready, **Download preview**, the PC path, **Make video again** (after redoing images), **Retry image** / **Skip image** when `needs_attention`.
- Server actions: `writeReelScriptAction`, `rewriteReelScriptAction`, `saveReelScriptAction`, `approveReelAction`, `redoReelSceneAction`, `skipReelSceneAction`, `rerenderReelAction`, `deleteReelAction` — all `requireOwner`, UUID-validated, version-guarded, lock-checked where they queue PC work.
- `lib/ai/reel-script.ts` (server-only): builds the ported prompt, calls `generateJson` with a response schema, validates (2..max scenes, non-empty narration, line length), and returns a typed script; never throws.

## Worker (PC)

One job loop shared with cards. Reel steps, in order, each resumable:

1. **voice**: Chatterbox via the ComfyUI API (custom node installed in ComfyUI Desktop) reads the full narration → WAV → uploaded to `reels/<id>/voice.wav`.
2. **timing**: faster-whisper (`small.en`, CPU int8) on the WAV → word list with times → `reels.words`; map words back to each line → `reel_scenes.start_s/end_s`.
3. **images**: each scene: Z-Image (existing `comfy_graph`, 1088×1920) → fit to 1080×1920 → `reels/<id>/scenes/<pos>.jpg`; up to 3 attempts, then `needs_attention`.
4. **render**: ffmpeg (from `imageio-ffmpeg`) — per-scene zoompan for its `end_s - start_s`, concat, voice track, ASS captions (word-by-word yellow active word, white + black outline, upper-middle safe area), H.264 1080×1920 → PC folder; then a 720p preview (CRF tuned to stay ≤ 15 MB) → `reels/<id>/preview.mp4`; `ready`.

PC switched off mid-reel: finished steps stay done; `requeue_stuck_reels` releases claims older than 10 minutes and the worker resumes at the first unfinished step.

## Errors

- Script: Gemini failure/timeout → nothing saved, inline error + Try again. Duplicate title → automatic rewrite (max 2), then a clear message.
- Voice failure → `failed` with the message (no images are made before the voice exists, so nothing is wasted).
- Image failure after 3 attempts → `needs_attention` with Retry / Skip; a broken image is never rendered.
- Render failure → `failed` with the ffmpeg error tail; **Make video again** retries the render only.
- ComfyUI closed → reel work waits (same rule as cards).

## Testing

- Unit (vitest): prompt build (topic, already-made list, max images, positive-only image wording, no "camera"), script validation, review-page actions with the fake Supabase, lock rule.
- SQL (PGlite): 005 migration twice on v1+002+003+004, claim order (cards before reels), version guards, requeue.
- Worker (python unittest): word→line timing, ASS caption build, ffmpeg command build, preview size targeting, step resume logic; ComfyUI and Whisper mocked.
- Browser: Reels list, new reel, review, progress, preview — 390 + 1440, light + dark.
- Real end-to-end on the owner's PC: install Chatterbox node + faster-whisper + imageio-ffmpeg; confirm Chatterbox runs on the AMD GPU (or report before going further); a short 10-image test reel (the minimum setting), then one full reel for the owner to judge.
