# Reels PC spike (Task 1): the free local stack works

Run on 2026-10-05 on the owner's PC (Windows 11, AMD Radeon RX 9060 XT 16 GB, 32 GB RAM).
Verdict: **all four pieces work on this PC**: Chatterbox voice on the AMD GPU, faster-whisper word times, ffmpeg from
`imageio-ffmpeg`, and the knitted-doll look from the existing Z-Image Turbo graph at 1088x1920 with positive-only wording.

**Owner action before the worker can use the voice:** restart ComfyUI Desktop once (in the Comfy Desktop window:
the instance's **Restart ComfyUI** / stop-then-start, or close and reopen the app) while no card is generating.
The live ComfyUI on :8188 has not been restarted, so it does not have the Chatterbox nodes loaded yet (see "Restart" below).

## 1. ComfyUI Desktop (where things live)

| Item | Value |
|---|---|
| App | `C:\Users\rober\AppData\Local\Programs\Comfy Desktop\Comfy Desktop.exe` (Comfy Desktop 2, "instances") |
| Instance ("ZImage") | `C:\Users\rober\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ZImage\` |
| ComfyUI | `...\ZImage\ComfyUI\` — ComfyUI **0.38.2**, frontend 1.53.6 |
| custom_nodes | `...\ZImage\ComfyUI\custom_nodes\` |
| ComfyUI's Python | `...\ZImage\ComfyUI\.venv\Scripts\python.exe` (uv venv on `...\ZImage\standalone-env`, Python **3.13.12**) |
| Torch | `torch 2.12.0+rocm7.14.0`, `torchaudio 2.11.0+rocm7.14.0`, `transformers 5.16.1`, `numpy 2.5.2` |
| Device | `cuda:0 AMD Radeon RX 9060 XT : native` (ROCm presents as `cuda`) |
| Launch args | `-s ComfyUI\main.py --enable-manager --extra-model-paths-config ...\instance-model-paths\inst-1790741354242.yaml --input-directory ...\ComfyUI-Shared\input --output-directory ...\ComfyUI-Shared\output` (+ feature flags) |
| Output folder | `C:\Users\rober\AppData\Local\Comfy-Desktop\ComfyUI-Shared\output` |
| ComfyUI-Manager | `comfyui-manager 4.2.2` (pip package, `--enable-manager`) |

Desktop starts ComfyUI with `PYTHONIOENCODING=utf-8` (the Chatterbox node prints a Unicode banner on import; a
ComfyUI started by hand without that env var fails the import with `UnicodeEncodeError: 'charmap'`).

## 2. Chatterbox custom node

- Chosen: **filliptm/ComfyUI_Fill-ChatterBox** — https://github.com/filliptm/ComfyUI_Fill-ChatterBox
  commit **`f7d7a16187430abcaf91a3039b9c83aa9960816a`** (2026-08-23, "Fix optional Perth imports"), version 1.0.5,
  233 stars, MIT (models: ResembleAI Chatterbox, MIT). Small, readable, bundles the Chatterbox code
  (`local_chatterbox/`), unpinned requirements, CPU fallback via a `use_cpu` input.
- Not chosen: `diodiogod/TTS-Audio-Suite` (most stars, but a multi-engine suite whose install pins `numpy<2.3`,
  pulls bitsandbytes, F5/Higgs/IndexTTS/RVC deps: too much risk for ComfyUI's ROCm env);
  `wildminder/ComfyUI-Chatterbox` (no commits since 2025-08).
- Vetted: no subprocess / shell / eval / outbound calls besides `huggingface_hub.hf_hub_download` of
  `ResembleAI/chatterbox` files.
- Installed:
  ```
  cd ...\ZImage\ComfyUI\custom_nodes
  git clone https://github.com/filliptm/ComfyUI_Fill-ChatterBox
  git -C ComfyUI_Fill-ChatterBox checkout f7d7a16187430abcaf91a3039b9c83aa9960816a
  ...\ZImage\ComfyUI\.venv\Scripts\python.exe -m pip install -r ComfyUI_Fill-ChatterBox\requirements.txt
  ```
  A `pip install --dry-run` first confirmed it would **not** touch torch / torchaudio / numpy / transformers.
  New packages only: conformer 0.3.2, diffusers 0.40.0, librosa 1.0.0, s3tokenizer 0.3.0, resampy 0.4.3,
  omegaconf 2.3.1, onnx 1.23.1, soundfile 0.14.0, soxr 1.1.0, numba 0.68.0, llvmlite 0.50.0, scikit-learn 1.9.1,
  protobuf 7.36.2 (+ small deps). Optional `resemble-perth` (watermark) and `pyloudnorm` were not installed; the node
  logs a warning and works without them.
- Models (auto-download on first run, ~3.2 GB): `...\ZImage\ComfyUI\models\chatterbox\chatterbox\`
  (`t3_cfg.safetensors` 2.1 GB, `s3gen.safetensors` 1.06 GB, `ve.safetensors`, `tokenizer.json`, `conds.pt` =
  the default voice). The node downloads through the HF cache and then copies, so a second 3 GB copy sits in
  `C:\Users\rober\.cache\huggingface\hub\models--ResembleAI--chatterbox` (safe to delete later; the node only reads
  its own folder once the files exist).
- Node classes (`/object_info`): `FL_ChatterboxTTS`, `FL_ChatterboxTurboTTS`, `FL_ChatterboxMultilingualTTS`,
  `FL_ChatterboxVC`, `FL_ChatterboxDialogTTS`.
- `FL_ChatterboxTTS` inputs: required `text` (STRING), `exaggeration` (0.25–2.0, default 0.5), `cfg_weight`
  (0.2–1.0, default 0.5), `temperature` (0.05–5.0, default 0.8), `seed` (INT); optional `audio_prompt` (AUDIO,
  reference voice for cloning — later `settings.reel_voice_path` via a `LoadAudio` node), `use_cpu` (BOOL),
  `keep_model_loaded` (BOOL). Outputs: `AUDIO` (index 0), `STRING` message (index 1).
- Limit from the node README: **about 40 s of audio per generation**. A 90–120 s narration must be voiced in
  chunks (e.g. a few lines at a time) and joined; the worker should plan for that.

### Restart (how ComfyUI was / was not restarted)

The live ComfyUI was **not** restarted. Comfy Desktop 2 owns the ComfyUI process; the only HTTP restart is
ComfyUI-Manager's `POST /v2/manager/reboot`, which on Desktop (no `__COMFY_CLI_SESSION__`) does an `os.execv`
self-replace: Desktop then sees its child exit and shows the instance as stopped while an orphan ComfyUI holds
port 8188 and the database (Desktop flags those as "survivors" and refuses to relaunch until they are gone).
That was judged too risky for the live card worker. Instead the node was proven on a **temporary side instance**
from the same venv on another port (nothing of the live instance touched; stopped afterwards), with the card
queue checked idle (`cards?status=in.(queued,generating,restamp)` → `[]`) before every GPU run:

```
cd C:\Users\rober\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ZImage
set PYTHONIOENCODING=utf-8
ComfyUI\.venv\Scripts\python.exe -s ComfyUI\main.py --listen 127.0.0.1 --port 8190 --disable-auto-launch ^
  --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI_Fill-ChatterBox --disable-api-nodes ^
  --user-directory <scratch>\user --output-directory <scratch>\out --input-directory <scratch>\in ^
  --temp-directory <scratch>\tmp --database-url sqlite:///<scratch>/side.db
```

The node imported in 1.1 s and ran on the GPU there. After the owner restarts ComfyUI Desktop the same graph
works on :8188; confirm with `GET http://127.0.0.1:8188/object_info/FL_ChatterboxTTS` (non-empty) and
`/system_stats`.

## 3. Voice: working API graph

```json
{
  "1": {"class_type": "FL_ChatterboxTTS", "inputs": {
    "text": "Before your baby turns one, they don't need flashcards. They need your voice, your face, and your arms. Here's why that matters more than anything.",
    "exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8, "seed": 42,
    "use_cpu": false, "keep_model_loaded": false}},
  "2": {"class_type": "SaveAudioAdvanced", "inputs": {
    "audio": ["1", 0], "filename_prefix": "reels/<reel-id>/voice", "format": "flac"}}
}
```

- `POST /prompt {"prompt": graph}` → `prompt_id`; poll `GET /history/{prompt_id}` until the id appears and
  `status.status_str == "success"`; the file is at `outputs["2"]["audio"][0]` =
  `{"filename": "voice_00001.flac", "subfolder": "reels/<id>", "type": "output"}`; fetch it with
  `GET /view?filename=…&subfolder=…&type=output`.
- ComfyUI's audio savers write **FLAC/MP3/Opus only** (no WAV). FLAC is lossless; convert with ffmpeg:
  `ffmpeg -y -i voice.flac -ar 24000 -ac 1 voice.wav` (Chatterbox output is 24 kHz mono).
- `SaveAudio` (FLAC, same output shape) also works but is marked DEPRECATED; prefer `SaveAudioAdvanced` with
  `"format": "flac"` (the dynamic-combo input is passed as a plain string in the API format — verified).
- To read the device: add `"3": {"class_type": "PreviewAny", "inputs": {"source": ["1", 1]}}`; its history
  output was `"Using CUDA (NVIDIA GPU) for inference … Speech generated successfully"` (the node's wording; on
  this PC "CUDA" is ROCm on the RX 9060 XT).
- Use `keep_model_loaded: false` on the live instance so Z-Image keeps its VRAM between steps.

### Timings (GPU, RX 9060 XT)

| Run | Audio | Wall time |
|---|---|---|
| First run incl. 3.2 GB model download | 6.4 s | 93 s |
| Test line, model loaded from disk (`keep_model_loaded` false) | 6.8 s | 14 s |
| Test line + 2 more sentences (~60 words), load from disk | 15.8 s | 21 s |
| Same, model kept loaded | 15.9 s | 14 s |

Sampling runs at ~33–37 tokens/s (25 speech tokens per second of audio), i.e. roughly real time plus ~7 s load.
A 100 s narration in ~3–4 chunks should take about 2–3 minutes. GPU works, so CPU was not needed.

Note: the brief's "20-second" test line is **6.4 s** when spoken by the default voice (25 words, ~4 words/s, a
brisk pace). `cfg_weight` 0.3 made it only slightly slower (7.2 s). The script length rules (230–300 words for
90–120 s) assume ~2.5 words/s, so real reels will come out shorter than planned unless the narration is longer or
the pace is slowed; the controller should decide (e.g. lower `cfg_weight`, a slower reference voice, or count
words at ~3.5–4 words/s).

## 4. faster-whisper (worker's Python)

- Worker Python (from the scheduled task's action): `C:\Users\rober\AppData\Local\Programs\Python\Python312\python.exe`
  (Python 3.12.10; the task runs `pythonw.exe` from the same folder).
- `python -m pip install faster-whisper imageio-ffmpeg` → faster-whisper **1.2.1**, ctranslate2 4.8.2,
  onnxruntime 1.30.0, av **19.0.1**, imageio-ffmpeg **0.6.0** (Pillow/numpy untouched).
- Model `small.en` downloads once (464 MB) to `C:\Users\rober\.cache\huggingface\hub\models--Systran--faster-whisper-small.en`.
- **Gotcha:** PyAV 19 breaks `faster_whisper.decode_audio` (`TypeError: open() got an unexpected keyword argument
  'metadata_errors'`). Do not pass a file path; decode with the imageio-ffmpeg binary and pass the array:

```python
import subprocess, numpy as np, imageio_ffmpeg
from faster_whisper import WhisperModel

def load_16k(path):
    raw = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-i", path,
                          "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0

model = WhisperModel("small.en", device="cpu", compute_type="int8")
segments, info = model.transcribe(load_16k(wav_path), language="en", word_timestamps=True, beam_size=5,
                                  vad_filter=False)
words = [{"w": w.word.strip(), "s": w.start, "e": w.end} for seg in segments for w in seg.words]
```

- Timing: model load 1.3–1.4 s (cached); transcription 1.8 s for 6.4 s audio, 2.4 s for 15.8 s audio
  (about 0.15x real time; a 100 s reel ≈ 15 s).
- Result on `voice.wav` was word-perfect, 25 words, e.g. `Before 0.00–0.32, your 0.32–0.46, baby 0.46–0.64, …,
  anything. 5.84–6.16`. Words carry punctuation (`"one,"`, `"arms."`): strip it before matching to the script.

## 5. ffmpeg

- Path: `imageio_ffmpeg.get_ffmpeg_exe()` →
  `C:\Users\rober\AppData\Local\Programs\Python\Python312\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe`
  (ffmpeg 7.1, has libx264 + aac).
- Test: 3 scene PNGs + `voice.wav` → 6.0 s, 1080x1920, H.264 High yuv420p 30 fps + AAC, 2.2 MB, encoded in 2.7 s.
  Per scene: `scale=2160:3840,zoompan=z='min(1+0.08*on/60,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,setsar=1,format=yuv420p`,
  then `concat=n=3:v=1:a=0`, `-c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart`.
  (Upscaling before zoompan avoids its integer-step jitter. The spike stretched 1088x1920 straight to 2160x3840; the
  real build should crop the 8 px first, "fitted to 1080x1920", to keep the aspect exact.)

## 6. Knitted-doll style for Z-Image (positive-only)

Rendered with the unchanged `worker/render.py comfy_graph(prompt, seed, 1088, 1920, prefix)` (8 steps, cfg 1,
`res_multistep`) straight to ComfyUI :8188: **~52 s per 1088x1920 image** once the model is loaded (first image
of a session ~3.5 min including model load). A 35-scene reel ≈ 30 minutes of images.

Ported from the n8n "Split Scenes" block: every "NOT a CGI render / NOT a drawing", the `AVOID ENTIRELY:` list and
"Do NOT divide …" were dropped and replaced by what should be in frame; "studio lighting" became daylight (studio
words pull in studio gear); "camera" never appears; the lens/aperture moved to a per-shot line.

### Final KNIT_STYLE (verbatim, round 3)

```text
Handmade amigurumi doll scene: every character is a soft crocheted wool doll, captured as premium handcrafted toy photography. A tight, clearly visible crochet stitch grid covers the whole face and body, with fine fuzzy wool fibres on every surface; a slightly oversized round head and soft chubby rounded limbs. Large glossy round black bead eyes with a small bright catchlight, a tiny stitched nose bump, a simple curved embroidered smile, thin embroidered eyebrows, and hair made of loose chunky yarn strands, each strand individually visible and softly fuzzy. The whole world is sewn and knitted by hand: the room is built from felt and linen, with felt walls, a felt window frame, felt shelves, a felt floor, knitted blankets, stitched felt props and yarn details, with small charming irregularities in the stitching. Soft diffused warm daylight from the front and a little to the side, gentle low contrast, soft contact shadows, gentle highlights on the wool fibres and the bead eyes. Palette: warm beige, cream, oatmeal and natural linen with mustard yellow, warm orange, rust and sage accents. Soft rounded edges everywhere, cozy and tender.
```

### Prompt assembly used (order matters: moment and lens first)

```
A single full-bleed vertical 9:16 picture of one tender moment. Moment: <scene action>. Lens: <lens line>.
<KNIT_STYLE> Characters (the same two dolls in every picture): <cast.adult>; <cast.child>.
Composition: the handmade set fills the whole frame edge to edge; the upper third is a calm, softly lit plain fabric wall where captions can sit.
No text, no letters, no words, no logo, no watermark anywhere.
```

Sample cast:
- adult: `the mom doll: a crocheted mother doll with chunky dark-brown yarn hair gathered in a low bun, warm tan wool skin, a mustard-yellow cable-knit cardigan over a cream knitted dress`
- child: `the baby doll: a small crocheted baby doll about six months old with a few soft tufts of dark-brown yarn hair, warm tan wool skin, a rust-orange knitted romper with a round cream collar`

The 3 scenes (round 3):
1. Wide two-shot — Moment: `Wide two-shot: the mom doll sits in a plump felt armchair cradling the baby doll in her arms and gazes down at the baby with a tender smile; a cozy felt living room around them with a knitted rug and a little felt window glowing with soft light.` Lens: `35mm lens at f/4, the whole cozy felt room in view, both dolls sharp`.
2. Close-up — Moment: `Tight close-up framed from the shoulders up: the two doll faces fill the frame cheek to cheek, the baby doll's head resting on the mom doll's shoulder and its tiny crocheted hand curled around a strand of her yarn hair; every stitch of both faces is large, crisp and clear.` Lens: `85mm lens at f/1.8, the two faces fill the frame, shallow depth of field`.
3. Props-forward — Moment: `Low macro still-life view: a pair of tiny knitted baby socks, a felt rattle and a small stack of felt picture cards lie on an oatmeal knitted blanket and fill the lower half of the frame, large and crisp in the foreground; far behind them, small and softly blurred, the mom doll lifts the baby doll up and the two look at each other and smile.` Lens: `100mm macro lens at f/2.8, the props large and razor sharp in front, the dolls far back in a creamy blur`.

### Verdict after 3 rounds

- **Style: pass, from round 1.** Clear crochet stitch grid on faces/bodies, fuzzy fibres, glossy black bead eyes
  with catchlights, embroidered smiles and brows, rosy cheeks, mustard/cream/rust knitwear, warm beige palette,
  soft daylight. The **same two dolls** came out in all 9 images (identical hair bun, cardigan, romper + collar):
  cast consistency is excellent. No text appeared.
- Round 2 change (yarn hair "loose chunky yarn strands") gave the baby looser yarn loops; the mom's hair stays a
  crocheted cap with a bun — reads as amigurumi, fine.
- Sets read as a cozy miniature room; some wood remains (armchair legs, window frames, shelves) despite the felt
  wording. Acceptable for the look; not worth more negative-free wording.
- **Weak point: shot framing.** Z-Image Turbo at 8 steps keeps a full-body / medium doll shot: the close-up
  (rounds 1–3) came out as a medium two-shot and the props-forward frame shows the props in front but the dolls not
  far back. Moving "Moment" + a lens line to the front (round 3) helped the props shot a little. The planner should
  vary scenes by **action and setting** more than by tight framing, and not rely on extreme close-ups.

Final sample images (1088x1920, git-ignored scratch):
- `.superpowers/reel-spike/r3-scene1-wide-two-shot.png`
- `.superpowers/reel-spike/r3-scene2-close-up.png`
- `.superpowers/reel-spike/r3-scene3-props-forward.png`
- earlier rounds: `r1-*.png`, `r2-*.png`; style versions `knit_style.r1.txt`, `knit_style.r2.txt`, `knit_style.txt`.

## 7. Sample files (all in `.superpowers/reel-spike/`, git-ignored)

- `voice.wav` — the exact test line, default voice, GPU, 6.44 s, 24 kHz mono (`voice.wav.flac` = ComfyUI's output).
- `voice_long.wav` — test line + 2 sentences, 15.8 s.
- `test.mp4` — 6 s 1080x1920 H.264 + AAC from the 3 round-3 images + `voice.wav`.
- Scripts: `tts.py` (Chatterbox via API), `whisper_test.py`, `images.py` (imports `comfy_graph` from the worker),
  `video.py` (ffmpeg), `knit_style.txt`.
