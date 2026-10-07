# Reels playbook v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply the research playbook (`C:\Users\rober\OneDrive\Documents\automation\reports\Unskippable parenting reels playbook.md`, section "The encodable playbook") so reels are unskippable: hard hook, varied shot list (no more 9/10 "mom holding baby"), front-loaded image prompts, smooth jitter-free push/pull motion + punch-ins (no pans/tilts), hook card, bigger safe-zone captions, SFX, broadcast-style audio levels.

**Owner feedback driving this:** images are all the same scene (no story); up/down/side moves look shaky and out of place (zoom in/out is fine); make it like a real unskippable reel; research first and apply everything.

**Spec = the playbook tables** (read them in full) + this plan's contract. Evidence tags ([P]/[S]/[V]/[I]) mean every number is a tunable default.

## Global Constraints

- Positive-only image wording (cfg 1); NO_TEXT the only negative; never "camera". Keep `positiveOnly()` and the knitted no-lift rule.
- Length: 45–75 s default (word budget from pace: speed × 3.8 words/s × seconds); never < 15 s.
- Motion values used from now on: `push_in`, `pull_out`, `hold`. Old values (pan/tilt/punch) in old rows are rendered as push_in/pull_out (never pan/tilt).
- Punch-ins are instant +12–18 % scale jumps on stressed words (from the script's `punch` words), 2–4 per reel, held to the end of the shot.
- Transitions: hard cuts; a 0.4 s dissolve only before scenes marked `time_jump`.
- Captions: Montserrat ExtraBold (download into worker/fonts like the other fonts; fallback Poppins Bold), 68 px, 1–3 words per chunk, ≤18 chars/line, white + 4 px black outline + soft shadow, active word #FFD60A with a 110 % pop over 120 ms, baseline y ≈ 1180 (safe box x 65–850 → centred within x 65–1015 is acceptable since captions are centred and short; keep ≤ 870 px wide), never in the bottom 35 %.
- Hook card: reel-level `hook_text` (≤ 10 words, complements line 1), frame 0 (no fade), 0–3.5 s, 92 px, y 350–650, pop-in ≤ 200 ms; captions keep running below it.
- Audio: SFX = generated in-house with ffmpeg (no licensing): soft rising whoosh at 0.0 s, soft pop at hook-card appear, gentle impact on the first punch-in after 70 % (the turn); peaks 6–10 dB under voice. Music bed ≈ 18 dB under voice, sidechain duck 8–10 dB (attack 50 ms, release 400 ms). Master `loudnorm=I=-14:TP=-1.5:LRA=11` (two-pass or single-pass acceptable).
- Anti-jitter: render frames with sub-pixel transforms (Pillow BICUBIC/LANCZOS affine per frame from a ≥ 2160-wide source, piped to ffmpeg) OR supersample ≥ 4× before zoompan with absolute smoothstep zoom from the frame index — pick the one that measures smoother (no stair-stepping) and finishes a 60 s reel in ≤ 3 min on the PC.
- Zoom: total 1.04–1.10 per shot (eased smoothstep), up to 1.15 on the payoff; alternate push/pull; every ~5th shot `hold`.
- DB: migration `008_reel_playbook.sql` (idempotent, folded into schema.sql): `reels.hook_text text null`; `reel_scenes.shot_size text null` check (wide|medium|close|detail|pov|broll), `subject text null` check (mom|baby|both|object|none), `punch text null` (one stressed word or short phrase from the narration), `time_jump boolean not null default false`; widen the motion check to include `hold`. Old app/worker keep working (all nullable/defaulted).
- Live safety: never stop/restart the live worker; the owner runs 008 and restarts the worker (the controller may ask the owner). Merge/push only with the owner's fresh approval.
- Conventions as before. Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Contract between server (script) and worker

Per reel: `hook_text`. Per scene (one per narration line, in order): `narration`, `idea`, `emotion`, `action`, `shot_size`, `subject`, `punch` (a word/phrase that appears verbatim in `narration`, or null), `time_jump`, `motion` (push_in|pull_out|hold), `image_prompt` (built server-side, front-loaded). Worker uses `motion`, `punch`, `time_jump`, `hook_text`, word timings.

---

### Task 1: Script + shot list + prompts (server, TS) + DB 008
- Script prompt rules (playbook "Script-prompt rules"): line 1 ≤ 12 words with tension/time-jump/"you"/specific detail; banned openers list; stakes within ~5 s; a "but/then" re-hook every 10–15 s; sentences 4–12 words (max 15); one core idea; concrete nouns; ≥ 1 identity line ("For the mom who…"); emotional turn at 70–80 % → last 20 % warmth/awe/resolve; last line ≤ 10 words loops to line 1; no spoken follow/comment/tag/share; `hook_text` ≤ 10 words complementing line 1; per line `shot_size`, `subject`, `punch` (≤ 4 non-null per reel, verbatim from the line), `time_jump`.
- Shot-list validator + repair (pure, tested): line 1 subject has a face (mom/baby/both) and shot close/medium; ≥ 1 face-free (object/none or detail/broll) per 4; never same shot_size + same subject consecutively; ≤ 2 consecutive face shots; establishing wide at position 2 or 3 (not 1); mix per 10 ≈ 2 wide / 3 medium / 2 close / 2 detail / 1 pov-or-broll (repair by reassigning shot_size where Gemini drifts); last scene mirrors scene 1 (same subject + setting cue in idea).
- `assignMotion` v2: push_in/pull_out alternating, `hold` every ~5th and on the payoff line; never the same twice in a row.
- `scenePrompt` v2 token order: `[shot size + angle + lens] , [action/moment] , [character tag ≤ 15 words] , [setting + time of day] , [lighting] , [style tag ≤ 12 words]`, then NO_TEXT. Short style tags per theme (new field in lib/reels/themes.ts static map; derived from the long blocks; the long block stays for theme previews). Lens rotation by shot size (wide 24–35 mm, medium 50 mm, close 85 mm, detail 100 mm macro, pov 24 mm first-person, broll 50 mm); never the same lens+angle twice in a row. Detail/broll/object/none shots omit face description (keep wardrobe/skin-tone only when hands appear).
- 008 migration + types + actions store new fields (pre-008 fallback like 007). Review page shows hook_text (editable) and a shot-size chip per line.
- Tests for every rule; one real smoke script (topic blank, animated3d, max 30) — paste shot list.

### Task 2: Worker render v2 (Python)
- Implement every Motion/Caption/Audio constraint above; drop pan/tilt; punch-ins at the punch word's Whisper start time (match by normalized word); dissolve only before `time_jump` scenes; hook card; SFX generation; loudness.
- Measure jitter: render a 3 s push-in on a detailed image and compute per-frame centre-of-mass motion smoothness (or frame-difference variance); report numbers for the chosen method vs the old 2× zoompan.
- Tests for pure pieces (easing, punch timing, caption chunking ≤ 18 chars, safe-zone coordinates, SFX timeline, loudness args); real check render (no DB writes) ≥ 30 s from spike assets, frames + loudness measurement (ebur128) reported.

### Task 3: End-to-end judged by the controller
- Owner runs 008 + restarts worker. Controller creates 2 real test reels (animated3d and watercolor, max images 30) via the web app (logged-in browser), approves, waits, then judges against the playbook: shot-size variety (contact sheet), first-frame face + hook card, no consecutive repeats, motion smoothness (frame sampling), caption position/size, loudness (ebur128 on the MP4), length 45–75 s. Fix and repeat until it passes; only then hand to the owner.
