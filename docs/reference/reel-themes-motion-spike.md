# Reels themes + motion PC spike (Task 1): PARTIAL, stopped on an AMD GPU fault

Run on 2026-10-06 on the owner's PC (Windows 11, AMD Radeon RX 9060 XT 16 GB, ComfyUI Desktop 0.38.2 on :8188,
`torch 2.12.0+rocm7.14.0`). Before the GPU job the spike checked (read-only, service key) that no card was
`queued|generating|restamp`, no reel was `queued|voicing|imaging|rendering|music`, no `reel_voices.sample_status`
was `queued|making`, and ComfyUI's `/queue` was empty (`busy.py` printed `IDLE`). Nothing was restarted.

## Verdict

| Step | Result |
|---|---|
| 1. LTX-Video image→video | **BLOCKED on this GPU.** Sampling works and is fast (544x960, 97 frames, 8 steps in **21 s**). But the LTX video-VAE decode crashed with `hipErrorLaunchFailure` ("CUDA error: unspecified launch failure"). That error is sticky: it **broke the live ComfyUI's GPU context**. `GET /system_stats` now returns 500 with the same error, and every GPU job on :8188 fails until ComfyUI is restarted. |
| 2. 8 theme previews | **Not rendered** (needs the GPU). The 8 positive-only style blocks are written (section 5). |
| 3. Emotion contrast | **Not rendered** (needs the GPU). The prompts are ready (`themes.py emotion`). |
| 4. Camera moves + caption pop | **Done.** 7 zoompan presets and the ASS pop work in ffmpeg 7.1. The 10 s test MP4 was checked frame by frame. |

**Owner action (blocking):** restart ComfyUI Desktop (instance "ZImage": Restart ComfyUI, or close and reopen the
app) while no card is generating. Until then, cards, reel images, voices and music on this PC will fail. After the
restart, steps 2–3 can be re-run: `python themes.py preview r1` and `python themes.py emotion r1`, about 1 minute per image.

## 1. LTX-Video (native ComfyUI nodes)

### Model files (official repos, 176 GB free on C: afterwards)

Destination = `C:\Users\rober\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\`. ComfyUI saw both files with no restart.

| File | Folder | Bytes | Source |
|---|---|---|---|
| `ltxv-2b-0.9.8-distilled.safetensors` | `checkpoints\` | 6,340,744,492 (6.34 GB, bf16, includes the video VAE) | `https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltxv-2b-0.9.8-distilled.safetensors` |
| `t5xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders\` | 5,157,348,688 (5.16 GB) | `https://huggingface.co/Comfy-Org/mochi_preview_repackaged/resolve/main/split_files/text_encoders/t5xxl_fp8_e4m3fn_scaled.safetensors` |

Why this model: it is the smallest official LTX model that does image→video. The other options in the ComfyUI
templates are far bigger:
- LTX-2 19B, which also needs the Gemma 3 12B encoder.
- LTX-2.3 22B fp8 (15+ GB).
- LTX-2.5 22B int8.
- LTXV 13B 0.9.8 distilled fp8 (15.7 GB, which leaves no room on 16 GB).

The 2B 0.9.8 distilled model runs 8 steps at cfg 1. The bundled template `ltxv_image_to_video.json` uses
`ltx-video-2b-v0.9.5` with `t5xxl_fp16` from `comfyanonymous/...`. The T5 here comes from Comfy-Org instead: same
file family, fp8 scaled, half the size. Native LTX nodes present in `/object_info`: `LTXVImgToVideo`,
`LTXVConditioning`, `LTXVScheduler`, `LTXVPreprocess`, `ModelSamplingLTXV`, `LTXVAddGuide`, and others.

### Graph used (API format)

The `LoadImage` input is the spike image, uploaded with `POST /upload/image` (subfolder `themes-spike`). The
sigmas are the distilled schedule from Lightricks' 0.9.8 distilled config. cfg is 1, so the negative is a
`ConditioningZeroOut`.

```json
{
 "1": {
  "class_type": "CheckpointLoaderSimple",
  "inputs": {
   "ckpt_name": "ltxv-2b-0.9.8-distilled.safetensors"
  }
 },
 "2": {
  "class_type": "CLIPLoader",
  "inputs": {
   "clip_name": "t5xxl_fp8_e4m3fn_scaled.safetensors",
   "type": "ltxv",
   "device": "default"
  }
 },
 "3": {
  "class_type": "CLIPTextEncode",
  "inputs": {
   "clip": [
    "2",
    0
   ],
   "text": "A handmade crocheted mother doll sits in a plump felt armchair holding her small crocheted baby doll in her arms. She slowly blinks, gently tilts her head toward the baby and smiles softly; the baby doll moves its tiny hand and turns its head a little toward her. Subtle, calm, natural motion, the cozy felt living room stays still around them, soft warm daylight from the window, gentle and tender, smooth stop-motion toy animation with fine wool fibres."
  }
 },
 "4": {
  "class_type": "ConditioningZeroOut",
  "inputs": {
   "conditioning": [
    "3",
    0
   ]
  }
 },
 "5": {
  "class_type": "LoadImage",
  "inputs": {
   "image": "themes-spike/ltx-in.png"
  }
 },
 "6": {
  "class_type": "LTXVPreprocess",
  "inputs": {
   "image": [
    "5",
    0
   ],
   "img_compression": 35
  }
 },
 "7": {
  "class_type": "LTXVImgToVideo",
  "inputs": {
   "positive": [
    "3",
    0
   ],
   "negative": [
    "4",
    0
   ],
   "vae": [
    "1",
    2
   ],
   "image": [
    "6",
    0
   ],
   "width": 544,
   "height": 960,
   "length": 97,
   "batch_size": 1,
   "strength": 1.0
  }
 },
 "8": {
  "class_type": "LTXVConditioning",
  "inputs": {
   "positive": [
    "7",
    0
   ],
   "negative": [
    "7",
    1
   ],
   "frame_rate": 24.0
  }
 },
 "9": {
  "class_type": "ManualSigmas",
  "inputs": {
   "sigmas": "1.0, 0.9937, 0.9875, 0.9812, 0.975, 0.9094, 0.725, 0.4219, 0.0"
  }
 },
 "10": {
  "class_type": "KSamplerSelect",
  "inputs": {
   "sampler_name": "euler"
  }
 },
 "11": {
  "class_type": "SamplerCustom",
  "inputs": {
   "model": [
    "1",
    0
   ],
   "add_noise": true,
   "noise_seed": 42,
   "cfg": 1.0,
   "positive": [
    "8",
    0
   ],
   "negative": [
    "8",
    1
   ],
   "sampler": [
    "10",
    0
   ],
   "sigmas": [
    "9",
    0
   ],
   "latent_image": [
    "7",
    2
   ]
  }
 },
 "12": {
  "class_type": "VAEDecode",
  "inputs": {
   "samples": [
    "11",
    0
   ],
   "vae": [
    "1",
    2
   ]
  }
 },
 "13": {
  "class_type": "CreateVideo",
  "inputs": {
   "images": [
    "12",
    0
   ],
   "fps": 24.0
  }
 },
 "14": {
  "class_type": "SaveVideo",
  "inputs": {
   "video": [
    "13",
    0
   ],
   "filename_prefix": "themes-spike/ltx",
   "format": "auto",
   "codec": "auto"
  }
 }
}
```

### Run and failure (544x960, 97 frames = 4.0 s at 24 fps; source `.superpowers/reel-spike/r3-scene1-wide-two-shot.png`)

| Phase | Time |
|---|---|
| Submit → sampler start: load T5 fp8 (4.7 GB staged), video VAE (2.4 GB) and LTXV (3.7 GB); encode; image→latent | ~120 s (first load from disk) |
| Sampling, 8 steps | **21 s** (≈2.7 s/step) |
| `VAEDecode` (LTX video VAE, 97 frames at 544x960) | **crashed**: `torch.AcceleratorError: CUDA error: unspecified launch failure` (`hipErrorLaunchFailure`) |
| Total until the error | 170 s |

- The crash happened in ComfyUI's ROCm path during the video-VAE decode. The traceback ends in
  `model_management.reset_cast_buffers → offload_stream.synchronize()` and `torch.cuda._set_stream_by_id`. That
  points to a GPU kernel fault, not an out-of-memory error. On ROCm a kernel fault is sticky for the process:
  afterwards even `torch.cuda.current_device()` raises, so the **whole live ComfyUI is unusable until it is restarted**.
- Not tried, because each one risks the same fault in the live process: `VAEDecodeTiled` (temporal tiling), a
  smaller size (384x672) or fewer frames (65), `AMD_SERIALIZE_KERNEL=3`, and ComfyUI VRAM / dynamic-loading flags.
- **Recommendation:** never run LTX inside the live ComfyUI. If AI motion is still wanted, retry it only on a
  **separate side instance**: same venv, another port, as in the Chatterbox spike (`reel-pc-spike.md` §2), with
  `VAEDecodeTiled` and a smaller size. That way a GPU fault can never take down the card worker's ComfyUI.
  Otherwise, ship the camera-move path only; the spec already says motion never fails a reel and a failed AI clip
  falls back to a camera move. Until a side-instance retry passes, treat `ai` motion as **BLOCKED on this PC**
  and keep `p_clips` off.

## 2. Camera moves (zoompan): done

This uses the same pipeline as `worker/reel_render.py`. Each picture goes through `scale` and `crop` to
2160x3840 (2x, so zoompan's whole-pixel crop stays smooth), then `zoompan ... :d=N:s=1080x1920:fps=30`.

Variables used in the table:
- `N` = the scene's frame count; `last = max(1, N-1)`
- `p = on/last` (runs 0→1); `ease = p*p*(3-2*p)` (smoothstep)
- centre: `cx = iw/2-(iw/zoom/2)`, `cy = ih/2-(ih/zoom/2)`

| Move | z | x | y |
|---|---|---|---|
| `push_in` | `1+0.10*p` | cx | cy |
| `pull_out` | `1.10-0.10*p` | cx | cy |
| `pan_left` (view travels left) | `1.15` | `(iw-iw/zoom)*(1-ease)` | cy |
| `pan_right` | `1.15` | `(iw-iw/zoom)*ease` | cy |
| `tilt_up` (view travels up) | `1.15` | cx | `(ih-ih/zoom)*(1-ease)` |
| `tilt_down` | `1.15` | cx | `(ih-ih/zoom)*ease` |
| `punch` (0.3 s snap, 0.3 s settle, slow creep) | `if(lt(on,9),1+0.18*(on/9)*(2-(on/9)),if(lt(on,18),1.18-0.06*((on-9)/9),1.12+0.02*(on-18)/(last-18)))` | cx | cy |

Example filter (one scene, 43 frames, pan_left):

```
[0:v]scale=2160:3840:force_original_aspect_ratio=increase:flags=lanczos,crop=2160:3840,setsar=1,zoompan=z='1.150':x='(iw-iw/zoom)*(1-((on/42)*(on/42)*(3-2*(on/42))))':y='ih/2-(ih/zoom/2)':d=43:s=1080x1920:fps=30,setsar=1,format=yuv420p[v0]
```

Notes:
- Commas inside `if(...)` are fine inside the single-quoted option value.
- Pans and tilts hold zoom 1.15, which leaves 13 % of the frame to travel (≈140 px across, ≈250 px vertically
  at 1080x1920). That is clearly visible in 1.4 s; on long lines (> 4 s) the same travel is just slower.
- `punch` uses `PUNCH_F = round(0.3*fps) = 9` frames.
- Checked in extracted frames: push-in and pull-out change the scale, pan-right shifts the subject across the
  frame, the tilts move vertically, and punch jumps to +18 % then settles. No jitter at the 2x pre-scale.

## 3. Caption pop (ASS): done

The spoken word, already yellow in `ass_captions`, gets an inline pop block. The rest of the group is unchanged:

```
{\1c&H0000E6FF&}{\fscx80\fscy80\t(0,70,\fscx110\fscy110)\t(70,120,\fscx100\fscy100)}WORD{\1c&H00FFFFFF&\fscx100\fscy100}
```

The `\t` times are relative to the event start, which is the word's start, so each word pops as it is spoken:
80 % → 110 % in 70 ms → 100 % at 120 ms. libass applies the `\t` in an inline block to that word only. Verified in
frames: the word is small at frame 0, overshoots at frame 2 and has settled by frame 4. The neighbouring words
shift a few px while the line re-centres, which reads as part of the bounce. Prototype: `ass_pop()` in
`.superpowers/themes-spike/motion.py`.

## 4. Test MP4

`.superpowers/themes-spike/motion-test.mp4`: 10.0 s, 1080x1920, 30 fps, H.264, 3.3 MB, encoded in 3.3 s.
It cycles push_in, pull_out, pan_left, pan_right, tilt_up, tilt_down and punch (43/43/43/42/43/43/43 frames) over
the three round-3 knitted spike images. Pop captions name each move. Frame sheets:
`.superpowers/themes-spike/frames/motion-sheet.jpg` and `.superpowers/themes-spike/frames/pop-sheet.jpg`.

## 5. Theme style blocks (positive-only, never "camera"; previews NOT yet rendered)

Rules held, checked by the asserts in `mkstyles.py`:
- no "camera"
- no "avoid", "no X" or "not a"
- no studio or brand names

`knitted` is `KNIT_STYLE` from `lib/reels/prompt.ts`, verbatim. The other seven are untested drafts. They still
need the preview pass (up to 2 rounds each) once ComfyUI is restarted.

### `knitted`

```text
Handmade amigurumi doll scene: every character is a soft crocheted wool doll, captured as premium handcrafted toy photography. A tight, clearly visible crochet stitch grid covers the whole face and body, with fine fuzzy wool fibres on every surface; a slightly oversized round head and soft chubby rounded limbs. Large glossy round black bead eyes with a small bright catchlight, a tiny stitched nose bump, a simple curved embroidered smile, thin embroidered eyebrows, and hair made of loose chunky yarn strands, each strand individually visible and softly fuzzy. The whole world is sewn and knitted by hand: every setting is built from felt and linen — felt walls or felt sky, felt ground and floors, felt furniture and shelves, knitted blankets, stitched felt props and yarn details, with small charming irregularities in the stitching. Soft diffused warm daylight from the front and a little to the side, gentle low contrast, soft contact shadows, gentle highlights on the wool fibres and the bead eyes. Palette: warm beige, cream, oatmeal and natural linen with mustard yellow, warm orange, rust and sage accents. Soft rounded edges everywhere, cozy and tender.
```

### `animated3d`

```text
Stylized 3D animated feature-film still: characters with appealing rounded proportions, slightly oversized heads and large expressive eyes with bright catchlights, soft smooth skin with a subtle warm glow, rich and clearly readable facial expressions with expressive brows and mouths, softly sculpted hair. Polished family-movie rendering with global illumination, soft volumetric window light, a warm rim light, gentle bounce light and soft ambient shadows. A cozy, richly detailed home set with rounded furniture and tactile fabrics. Palette: warm cream, honey gold, soft peach and terracotta with teal accents. Shallow depth of field, heartwarming and full of life.
```

### `watercolor`

```text
Storybook watercolor illustration painted by hand on textured cold-press paper: soft transparent washes, gentle wet-in-wet blooms and pigment granulation, visible paper grain, delicate fine ink and pencil linework around the figures, soft painted edges. Characters drawn with simple, gentle rounded features, rosy cheeks and warm expressive faces. Warm light painted as luminous washes of pale yellow and peach. Palette: soft peach, warm ochre, rose, sage green and sky blue on warm ivory paper. Airy and tender, a classic children's picture-book page.
```

### `clay`

```text
Handmade clay stop-motion animation still: every character and object is sculpted from smooth matte modelling clay with subtle fingerprints and tool marks, soft rounded chunky forms, slightly oversized heads, small glossy bead eyes and sculpted expressive mouths and brows. A miniature handcrafted set built from clay, painted card and fabric, with tiny clay props. Soft warm light from the window, gentle soft shadows, miniature tabletop scale with a shallow depth of field. Palette: warm cream, terracotta, mustard, soft teal and dusty pink. Charming, tactile and playful.
```

### `papercraft`

```text
Handmade layered paper-craft diorama, photographed up close as a real tabletop paper model: every character, object and wall is cut from thick coloured cardstock and textured craft paper, built in many stacked layers that stand apart with real depth and soft shadows between them, crisp hand-cut edges with tiny white paper cores showing, visible paper fibre texture, gentle folds and curls. Characters are cut-paper figures made of simple layered paper shapes, with cut-paper hair, small dot eyes and curved paper smiles, posed with clear expressive gestures. A cozy paper room with a layered paper window, paper curtains and paper sunbeams. Soft warm light from the side casting gentle depth shadows between the layers. Palette: warm cream, coral, mustard, teal and soft pink paper. Handmade, whimsical and tactile.
```

### `anime`

```text
Soft anime illustration in a gentle slice-of-life film style: clean confident line art, smooth cel shading with soft gradient shadows, large expressive eyes with layered highlights, a delicate blush on the cheeks, softly flowing hair drawn in clean shapes. A painterly, detailed background of a cozy sunlit home, warm afternoon light streaming in with a soft bloom and glowing dust motes. Palette: warm cream, soft peach, butter yellow, sky blue and leafy green. Tender, heartfelt and luminous.
```

### `sketch`

```text
Black-and-white grayscale pencil drawing, a colourless graphite study made by hand on white sketchbook paper: the whole picture is pure greyscale, drawn entirely in shades of pencil grey, so every garment, skin tone, hair colour and object reads only as a lighter or darker graphite grey, from soft silver to deep charcoal black, on white paper. Confident graphite line work, expressive loose strokes, soft cross-hatching and smudged tonal shading, visible paper texture, the brightest highlights left as bare white paper, the drawing filling the whole page. Faces drawn with care and clear, readable expressions. Gentle light from the window rendered with soft shading. Intimate, artistic and timeless, a classic monochrome pencil study.
```

### `cinematic`

```text
Cinematic real-life photograph, a still from a modern drama film: real people with natural skin texture, fine hair detail and genuine, readable emotion. 35mm film look with soft natural grain, shallow depth of field and creamy background bokeh. Warm golden-hour sunlight streaming through the window, a soft haze in the light, a gentle rim light on the hair, rich natural colour grading with warm highlights and soft teal shadows. A lived-in, cozy home with real textures. Intimate, emotional and true to life.
```


### Preview prompt assembly (`themes.py`)

```
A single full-bleed vertical 9:16 picture of one tender moment. Moment: a mother gently lifting her laughing baby up toward the warm window light. Lens: 35mm lens at f/4, a warm medium-wide view, the characters sharp.
<STYLE> Characters (the same two people in every picture): <CAST>.
Composition: the scene fills the whole frame edge to edge; the characters and their action sit in the upper and middle part of the frame, and the band just below the middle is calm and uncluttered, a soft, simple, evenly lit stretch of the scene's own floor, blanket or background.
No text, no letters, no words, no logo, no watermark anywhere.
```

Cast for every theme except knitted: `the mother: a young mother in her early thirties with warm tan skin and
dark-brown hair gathered in a low bun, wearing a mustard-yellow cardigan over a cream dress; the baby: a chubby
six-month-old baby with warm tan skin and a few soft tufts of dark-brown hair, wearing a rust-orange romper with a
round cream collar`.

Knitted uses the doll cast from `reel-pc-spike.md` and "the same two dolls". The emotion prompts (3D Animated) add
`Emotion: <face>. Body language: <pose + hands>.` after the moment (laughing / teary / surprised; see `themes.py`).
Preview seed 1234, emotion seed 777, rendered with `worker/render.py comfy_graph` (Z-Image Turbo, 8 steps, cfg 1).

## 6. Scratch files (`.superpowers/themes-spike/`, git-ignored)

- `busy.py`: idle check, including `reel_voices.sample_status`
- `comfy.py`: waits for idle, then submit, poll and download
- `ltx.py` + `ltx.graph.json`
- `styles.src.json` → `mkstyles.py` → `styles.json`
- `themes.py`, `motion.py`
- `motion-test.mp4`, `frames/`
