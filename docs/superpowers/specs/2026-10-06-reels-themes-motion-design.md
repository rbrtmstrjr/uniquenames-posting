# Reels: themes with previews, emotion, ad-style hook + pacing, mixed motion

Date: 2026-10-06 · Builds on `2026-10-05-reels-design.md` and `2026-10-06-reels-voices-music-design.md`.

Owner feedback: images all share one emotion and feel boring; reels must feel like an unskippable ad — strong hook, no delays or dead space, proper motion — and the owner wants to pick a visual theme per reel, with a one-image preview per theme.

## Decisions (owner, 2026-10-06)

| # | Topic | Decision |
|---|---|---|
| 1 | Themes | 8 themes: 🧶 Knitted Doll (current), 🎬 3D Animated, 🎨 Storybook Watercolor, 🏺 Clay Stop-motion, ✂️ Paper Craft, 🌸 Soft Anime, ✏️ Pencil Sketch (B&W), 📷 Cinematic Real. Each has a fixed positive-only style block. Default in Settings; per-reel picker on the review page (only while `script`, like voices). |
| 2 | Previews | One preview image per theme made by the PC (same mom-and-baby moment for every theme, so they compare fairly), shown in a Settings grid and as thumbnails in the picker; "Make preview again" per theme. |
| 3 | Emotion | Every line gets `emotion` (e.g. laughing, teary, surprised, exhausted, proud, cuddly, worried, relieved, curious, determined), `action` (body language + what the hands do) and `shot` (wide / medium / over-the-shoulder / low angle / hands detail / eye level), never the same shot twice in a row. The image prompt states the emotion and body language explicitly. Knitted Doll conveys emotion through pose only. |
| 4 | Hook + pacing | Script: line 1 is a scroll-stopper ≤ 2 s (bold claim, "stop doing X", or open question; never a greeting); a mini-hook every 4–6 lines ("but here's the part nobody tells you…"); last line loops back to the opening. Voice: trim leading/trailing silence, inter-chunk gap 0.10 s (was 0.35), squeeze internal pauses > 0.35 s down to 0.25 s. Video: first frame instant (no fade-in), music from 0, cuts on line boundaries, captions pop in word by word with a small scale bounce. |
| 5 | Motion (Mixed) | Real AI motion (LTX-Video image→video in ComfyUI, 3–4 s clips) for the hook (first 2–3 lines) + up to 3 lines Gemini marks `key: true`; all other lines get a varied camera move matched to emotion (push-in, pull-back, pan left/right, tilt up/down, quick zoom punch on hook words), never the same move twice in a row. A failed AI clip falls back to a camera move; motion never fails a reel. |

## Data (migration `007_reel_themes.sql`, idempotent, folded into schema.sql)

- `reel_themes`: `id text pk` (`knitted`, `animated3d`, `watercolor`, `clay`, `papercraft`, `anime`, `sketch`, `cinematic`), `label`, `emoji`, `blurb`, `style text` (the positive-only style block), `faces boolean` (expressive faces), `sort int`, `preview_path text null` (`themes/<id>/preview-v<n>.jpg` in bucket `reels`), `preview_status text` (`missing|queued|making|ready|failed`), `error`, `version`, `claimed_at`, timestamps. Seed 8 rows (style blocks from the Task 1 spike).
- `settings.reel_theme_id text not null default 'knitted' references reel_themes`.
- `reels.theme_id text null references reel_themes on delete set null` (null = settings default).
- `reel_scenes`: `emotion text null`, `action text null`, `shot text null`, `key_moment boolean default false`, `motion text null` (`ai|push_in|pull_out|pan_left|pan_right|tilt_up|tilt_down|punch`), `clip_path text null` (`<reelId>/clips/<pos>-v<n>.mp4`; `''` = AI clip failed → camera move).
- `claim_next_reel_step(p_no_comfy, p_music, p_clips boolean default false)`: new step `clip` after `image` for scenes with `motion='ai'` and `clip_path is null` (needs ComfyUI; only for workers passing `p_clips`); render requires every `ai` scene to have `clip_path` set ('' counts).
- `claim_next_theme_preview()` (service role): like voice samples (only when no card and no runnable reel step).

## Script (lib/ai/reel-script.ts)

New per-scene fields `emotion`, `action`, `shot`, `key`; hook/mini-hook/loop rules; `idea` stays the visual moment. Server assigns `motion` with a pure function: lines 0..min(2, n-1) → `ai` when their line is a hook beat, plus up to 3 `key` lines → `ai`; the rest cycle through camera moves chosen by emotion with no repeats in a row. `scenePrompt(theme, cast, scene, index)` composes theme style + cast + idea + emotion + action + shot + composition + NO_TEXT (positive-only, never "camera").

## Worker

- Theme preview job → Z-Image with the theme style + a fixed moment ("a mother gently lifting her laughing baby up toward the sunlight") → `themes/<id>/preview-v<n>.jpg`.
- Voice tightening (silence trims, 0.10 s gaps) before atempo.
- Clip step: LTX-Video image→video at a size the AMD GPU handles (from the spike), 3–4 s, then scaled to 1080×1920; upload `<reelId>/clips/<pos>-v<n>.mp4`; failure → `''`.
- Render: per-scene motion presets (zoompan expressions per move), AI clips used as video segments (looped/trimmed to the line's span), instant first frame, caption pop (ASS `\t` scale animation), music from 0.

## Testing

Unit tests for every pure piece (motion assignment, emotion/shot rotation, prompt composition per theme, voice tightening filter, zoompan expressions per move, caption pop ASS, claim order incl. clip + previews); PGlite for 007; jsdom for the theme grid + picker; real PC spike (LTX timing on AMD, 8 theme previews, emotion contrast in 3D Animated) and a 10-image test reel judged by the owner.
