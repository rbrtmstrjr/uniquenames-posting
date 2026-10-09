# Reels themes + emotion + motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Selectable visual themes with previews, emotional varied images, an ad-style hook with no dead space, and mixed motion (LTX-Video clips for hook/key lines, varied camera moves elsewhere).

**Architecture:** Same pull model. Script engine adds emotion/action/shot/key; server assigns motion; DB 007 adds themes, scene fields and a clip step + theme preview job; worker makes previews, tightens voice, makes AI clips and renders with per-scene moves and caption pop.

**Tech Stack:** existing + LTX-Video (native ComfyUI nodes).

**Spec:** `docs/superpowers/specs/2026-10-06-reels-themes-motion-design.md`

## Global Constraints

- Positive-only image wording (cfg 1); NO_TEXT the only negative; never "camera".
- Themes ids: knitted, animated3d, watercolor, clay, papercraft, anime, sketch, cinematic. Default knitted.
- Motion: `ai` for hook lines (first ≤ 3) + up to 3 `key` lines; others cycle push_in, pull_out, pan_left, pan_right, tilt_up, tilt_down, punch — never the same twice in a row; AI clip failure → camera move; motion never fails a reel.
- Voice gaps 0.10 s, leading/trailing silence trimmed, internal pauses > 0.35 s → 0.25 s; first frame instant; captions pop.
- Opt-in per worker for new claim steps (`p_clips`), like `p_music`: every deploy order safe.
- Storage: `themes/<id>/preview-v<n>.jpg`, `<reelId>/clips/<pos>-v<n>.mp4`, versioned.
- Cards > reel steps > voice samples / theme previews.
- Live safety: never stop/restart the live worker; real data read-only in browser checks; the owner runs 007 and restarts the worker. No merge/push without the owner's fresh approval.
- Conventions as before (Write/Edit, Read before edit, TDD, 44px, light/dark, shadcn guard). Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: PC spike — LTX-Video on AMD, 8 theme styles + previews, emotion contrast, camera moves
- [ ] LTX-Video image→video via native ComfyUI nodes (inspect /object_info; official Comfy-Org model files; disk check): find the largest size/length that runs reliably on the RX 9060 XT; time a 3–4 s clip from a spike image; record graph JSON.
- [ ] Write 8 positive-only style blocks; render one preview per theme (fixed moment) at 1088×1920; iterate up to 2 rounds each; look at every image.
- [ ] Emotion contrast check in 3D Animated: same cast, "laughing" vs "teary" vs "surprised" → 3 images; verify faces differ.
- [ ] Prototype zoompan expressions for each camera move + the caption pop ASS; render a 10 s test MP4.
- [ ] Doc `docs/reference/reel-themes-motion-spike.md`; commit.

### Task 2: Database 007
- [ ] Per spec "Data"; seed 8 themes with the spike style blocks; `p_clips` opt-in; theme preview claim + requeue; PGlite tests (twice on v1..006, parity, claim order, clip fallback rules).

### Task 3: Script engine + motion assignment
- [ ] New fields + hook/mini-hook/loop rules; `assignMotion(scenes)` pure; `scenePrompt(theme, cast, scene, index)`; actions store emotion/action/shot/key/motion and theme; real smoke call (report 5 lines incl. emotions + motions).

### Task 4: Web
- [ ] Settings "Theme" grid (8 cards with preview image, emoji, blurb, faces badge, status, Make preview / Make all previews, Default selection; realtime); review page theme picker (thumbnails) + per-line emotion chip; `setReelThemeAction` (script only; rebuilds image_prompts).

### Task 5: Worker
- [ ] Theme preview job; voice tightening; clip step (LTX) with fallback; render: per-scene moves, AI clip segments, instant first frame, caption pop; tests; real check render.

### Task 6: End-to-end + review
- [ ] Docs, whole-branch review + fixes; owner runs 007 + restarts worker; Make all previews; owner picks a theme; 10-image test reel judged by the owner. Merge/push only with fresh approval.
