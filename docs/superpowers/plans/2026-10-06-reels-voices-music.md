# Reels voices + music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Selectable narrator voices (30 Gemini voices cloned by Chatterbox + built-in) with real samples, calm and faster narration, and a unique ACE-Step background music bed per reel.

**Architecture:** Same pull model. Server actions create Gemini reference clips once and queue sample jobs; the PC worker makes samples, voices (calm + atempo), music (ACE-Step in ComfyUI) and mixes music under the voice in the render.

**Tech Stack:** existing (Next.js 16, Supabase, Python worker, ComfyUI, Chatterbox, ffmpeg) + ACE-Step 1.5 (native ComfyUI nodes) + Gemini TTS (server, one-time).

**Spec:** `docs/superpowers/specs/2026-10-06-reels-voices-music-design.md`

## Global Constraints

- Calm Chatterbox params: exaggeration 0.35, temperature 0.7, cfg_weight 0.5.
- Speed: `atempo` 1.00–1.25, default 1.12; Whisper runs on the sped-up track; script word target scales with speed.
- Music: ACE-Step 1.5, instrumental only, duration = voice + 2 s; default on, volume 18 % (5–40 %); ducked under the voice; fade in 1 s / out 2 s.
- Storage (bucket `reels`): `voices/<id>/ref.wav`, `voices/<id>/sample-v<n>.wav`, `<reelId>/music-v<n>.flac`; versioned like the rest.
- Gemini key server-only; reference clips made once (skip existing); ≈ $0.01 per voice.
- Cards always first; reels and voice samples never compete with cards; samples only when no reel step is runnable.
- Live safety: owner runs `006_reel_voices.sql` and restarts the worker; never stop/restart the live worker; real data read-only in browser checks except the planned one-time voice setup and test reel (controller-run, with the owner's go-ahead already given 2026-10-06).
- Existing conventions (Write/Edit, Read before edit, TDD, 44px targets, light/dark, shadcn guard test). Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. No merge/push without the owner's fresh approval.

---

### Task 1: PC spike — ACE-Step music + voice cloning quality

- [ ] Find ACE-Step 1.5 model files ComfyUI expects (check the native nodes `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio` inputs via /object_info and ComfyUI docs/templates); download into ComfyUI Desktop's models folders (official Comfy-Org repackaged files). Generate a 60 s "heartwarming, soft piano, gentle strings, warm lullaby, slow, instrumental, no vocals" bed through the API; record time + file; listen proxy: check loudness/duration with ffmpeg (no vocals can't be verified automatically — note it for the owner).
- [ ] Make one Gemini TTS reference clip (Gacrux, the reference text, server key from `.env.local`, never printed), clone it with Chatterbox (LoadAudio → audio_prompt) at calm params, speed 1.12 with atempo, and save both to `.superpowers/voice-spike/`.
- [ ] List the live Gemini prebuilt voice names (try each of the 30 in the spec with a 1-word request is too costly — instead verify via one docs fetch or the API's error message for an invalid name) and record the final list + Gemini's tone descriptor per voice.
- [ ] Write `docs/reference/reel-voices-music-spike.md` (graphs JSON, model files + paths, timings, mix filter that sounds right: test `sidechaincompress` settings on the spike voice + music, render a 20 s check MP3) and commit.

### Task 2: Database 006

- [ ] `supabase/migrations/006_reel_voices.sql` + schema.sql + types + PGlite tests per spec "Data" (incl. seed rows for the 31 voices with label/tone/gender; claim music step; `claim_next_voice_sample()`; requeue for samples; grants/RLS/realtime/bucket paths). Run 006 twice on v1..005; parity test.

### Task 3: Server + web

- [ ] `lib/ai/tts.ts` (server-only): `geminiVoiceClip(voice, text) → Buffer(WAV)` (PCM 24 kHz → WAV), never logs the key.
- [ ] Actions: `setUpVoicesAction()` (creates missing ref clips, uploads `voices/<id>/ref.wav`, queues samples; idempotent; time-budgeted ≤ 270 s, resumable), `queueVoiceSamplesAction()` (missing or stale vs current calm/speed key), `setReelVoiceAction(reelId, voiceId)`; settings save for voice/speed/music/volume (PGRST204 fallback pre-006).
- [ ] UI: Settings "Narrator & music" section (voice grid with ▶ play via signed URL, Default radio, sample status badges, Set up voices / Make samples buttons, Speed + Music controls); review page voice picker with ▶; script word target uses speed (`lib/ai/reel-script.ts` words/s × speed).
- [ ] Tests (jsdom + actions + tts with mocked fetch); browser check read-only.

### Task 4: Worker

- [ ] Voice resolution + ref clip download into ComfyUI input (cached), calm params, atempo speed; voice sample job; music step (ACE-Step graph from Task 1) with p_no_comfy rule; render mix with ducking + fades; music missing/off → voice only. Python tests for every pure piece; real check: render the spike voice + music into a 20 s reel clip.

### Task 5: End-to-end + review

- [ ] Docs (SETUP: run 006, restart worker; ACE-Step models). Whole-branch review + fixes. With the owner: run 006, restart worker → controller runs Set up voices (≈ $0.30), samples finish, owner picks a voice → 10-image test reel with music → owner judges. Merge/push only with the owner's fresh approval.
