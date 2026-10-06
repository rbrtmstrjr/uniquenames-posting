# Reels voices + music PC spike (Task 1)

Run on 2026-10-06 on the owner's PC (Windows 11, AMD Radeon RX 9060 XT 16 GB), against the **live** ComfyUI
Desktop on :8188 (ComfyUI 0.38.2). Before every GPU job the spike checked (read-only, service key) that no card was
`queued|generating|restamp`, no reel was `queued|voicing|imaging|rendering|music`, and ComfyUI's `/queue` was empty.
Nothing was restarted.

Verdict: **all four pieces work**. ACE-Step 1.5 runs through ComfyUI's native nodes with no restart and makes a
60 s bed in ~18–22 s. Chatterbox clones a Gemini Gacrux clip at the calm params, word-perfect. All 30 Gemini voice
names are current. The ducking mix works with ffmpeg 7.1 after two fixes (pad the voice and the sidechain key).

Nobody listened to the files during the spike (the agent cannot hear). The owner should listen to the sample
files in section 6 for taste: music mood, the cloned voice, and the music level.

## 1. ACE-Step 1.5 (native ComfyUI nodes)

### Model files (official `Comfy-Org/ace_step_1.5_ComfyUI_files`, "split" turbo set)

Destination = Comfy Desktop's shared models folder (`ComfyUI-Shared\models`, the instance's `is_default` extra
model path), **not** `ZImage\ComfyUI\models`:
`C:\Users\rober\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\`

| File | Folder | Bytes | URL (`.../resolve/main/split_files/...`) |
|---|---|---|---|
| `acestep_v1.5_turbo.safetensors` | `diffusion_models\` | 4,787,825,604 (4.79 GB) | `diffusion_models/acestep_v1.5_turbo.safetensors` |
| `qwen_0.6b_ace15.safetensors` | `text_encoders\` | 1,191,588,248 (1.19 GB) | `text_encoders/qwen_0.6b_ace15.safetensors` |
| `qwen_1.7b_ace15.safetensors` | `text_encoders\` | 3,708,523,360 (3.71 GB) | `text_encoders/qwen_1.7b_ace15.safetensors` |
| `ace_1.5_vae.safetensors` | `vae\` | 337,431,732 (0.34 GB) | `vae/ace_1.5_vae.safetensors` |

Total **10.03 GB** (sizes equal the Hugging Face API sizes). Downloaded in ~3 min. 185 GB were free on C: before.
Base URL: `https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/`.
The repo also has an all-in-one `checkpoints/ace_step_1.5_turbo_aio.safetensors` (10.03 GB, for
`CheckpointLoaderSimple`) and XL / 4B variants; not needed. The graph follows the bundled template
`comfyui_workflow_templates_json/templates/audio_ace_step_1_5_split.json`.

**No restart needed:** right after the download, `GET /object_info/UNETLoader` (and `DualCLIPLoader`, `VAELoader`)
already listed the new files; ComfyUI rescans model folders per request.

### Node inputs (from `/object_info`)

- `TextEncodeAceStepAudio1.5`: `clip`, `tags` (STRING), `lyrics` (STRING), `seed` (INT), `bpm` (INT 10–300, default
  120), `duration` (FLOAT seconds), `timesignature` (`"2"|"3"|"4"|"6"`), `language` (`en`…), `keyscale`
  (`"C major"`…`"B minor"`), advanced: `generate_audio_codes` (BOOL, default true: the LM writes audio codes, slower
  but better), `cfg_scale` 2.0, `temperature` 0.85, `top_p` 0.9, `top_k` 0, `min_p` 0.0.
- `EmptyAceStep1.5LatentAudio`: `seconds` (FLOAT), `batch_size`.
- `DualCLIPLoader` with `type: "ace"`; `UNETLoader` `weight_dtype: "default"`; `ModelSamplingAuraFlow` `shift` 3;
  `KSampler` 8 steps, cfg 1, euler/simple (template values); negative = `ConditioningZeroOut` of the positive.
- `VAEDecodeAudio` → `SaveAudioAdvanced` (`format: "flac"`). Output: **48 kHz stereo FLAC**.

### Working API graph (60 s)

```json
{
 "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "acestep_v1.5_turbo.safetensors", "weight_dtype": "default"}},
 "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "qwen_0.6b_ace15.safetensors", "clip_name2": "qwen_1.7b_ace15.safetensors", "type": "ace"}},
 "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ace_1.5_vae.safetensors"}},
 "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.0}},
 "5": {"class_type": "TextEncodeAceStepAudio1.5", "inputs": {"clip": ["2", 0],
        "tags": "heartwarming, soft piano, gentle strings, warm lullaby, slow, instrumental, no vocals",
        "lyrics": "[Instrumental]", "seed": 31, "bpm": 70, "duration": 60.0, "timesignature": "4", "language": "en",
        "keyscale": "C major", "generate_audio_codes": true, "cfg_scale": 2.0, "temperature": 0.85, "top_p": 0.9,
        "top_k": 0, "min_p": 0.0}},
 "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
 "7": {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"seconds": 60.0, "batch_size": 1}},
 "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
        "latent_image": ["7", 0], "seed": 31, "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
 "9": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
 "10": {"class_type": "SaveAudioAdvanced", "inputs": {"audio": ["9", 0], "filename_prefix": "voice-spike/music", "format": "flac"}}
}
```

For a reel: `duration` and `seconds` = voice length + 2 s; `seed` per reel (e.g. from the reel id) so every bed
is unique. Output is at `outputs["10"]["audio"][0]` (same `/history` + `/view` flow as the voice).

### Timings and checks

| Run | Audio | Wall time (submit → FLAC ready) |
|---|---|---|
| seed 31, first ACE run (models loaded from disk) | 60.00 s | **21.5 s** |
| seed 7, second run | 60.00 s | **17.9 s** |

| File | Integrated | True peak | LRA | Notes |
|---|---|---|---|---|
| `music.flac` (seed 31) | −20.4 LUFS | −0.7 dBTP | 13.2 LU | 2 s windows: −18.6 dB at 0 s, −37 dB at 10 s, ~−25 dB at 20–40 s, natural ending (−64 dB at 58 s) |
| `music_seed7.flac` | −24.3 LUFS | | 20.0 LU | |

- Loudness varies a lot between seeds and inside a track (LRA 13–20 LU), so the mix **normalizes the bed**
  (`loudnorm=I=-16:TP=-1.5:LRA=7`) before applying the volume percentage; otherwise 18 % means different levels per reel.
- Vocals proxy: faster-whisper `small.en` with VAD found **no speech** in `music.wav`. That does not prove "no
  humming/ooh"; the owner should listen.
- The bed tends to end with a natural decay/silence near the end; the 2 s fade-out covers that.

## 2. Voice: Gemini reference clip → Chatterbox clone → atempo

### Gemini reference clip

- Models seen in `GET /v1beta/models` (2026-10-06): `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`,
  `gemini-3.1-flash-tts-preview`, `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`. Used the newest GA one:
  **`gemini-3.8-flash-tts`**.
- Request: `generateContent` with `responseModalities: ["AUDIO"]`,
  `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName: "Gacrux"`, text = the spec's reference text. 28 prompt
  tokens, 231 audio tokens.
- **Gotcha:** `gemini-3.8-flash-tts` returns `mimeType: "audio/wav"`, i.e. the base64 data is a **complete WAV file**
  (RIFF header, 24 kHz mono 16-bit), unlike 2.5-preview's raw `audio/L16;codec=pcm;rate=24000`. The server code must
  branch on `mimeType` (if it starts with `audio/wav`, store the bytes as-is; if `audio/L16`/`pcm`, wrap in a WAV
  header). Wrapping a WAV again leaves a 44-byte header click at the start.
- Result `ref.wav`: 9.24 s, 24 kHz mono, mean −20.7 dB, peak −4.1 dB.
- Gemini calls spent: 2 (one deliberately invalid voice name, which errors with no list and no audio; one real clip).

### Chatterbox clone (live :8188, FL_ChatterboxTTS loaded)

Upload with the worker's `voice.upload_input` (`POST /upload/image`, subfolder `unique-names`) → `LoadAudio`.

```json
{
 "1": {"class_type": "FL_ChatterboxTTS", "inputs": {
   "text": "They're only little once. Hold them a little longer tonight, and let the dishes wait.",
   "exaggeration": 0.35, "cfg_weight": 0.5, "temperature": 0.7, "seed": 42,
   "use_cpu": false, "keep_model_loaded": false, "audio_prompt": ["3", 0]}},
 "2": {"class_type": "SaveAudioAdvanced", "inputs": {"audio": ["1", 0], "filename_prefix": "voice-spike/clone", "format": "flac"}},
 "3": {"class_type": "LoadAudio", "inputs": {"audio": "unique-names/spike-gacrux-ref.wav"}}
}
```

- Wall time **25.2 s** (submit → FLAC ready; model loaded from disk, cloning conditioning included) for 5.60 s of speech.
- `clone.wav` 5.60 s, mean −19.0 dB. Speed-up: `ffmpeg -i clone.wav -af atempo=1.12 -ar 24000 -ac 1 clone_fast.wav`
  → **4.98 s** (5.60 / 1.12 = 5.00), pitch kept.
- faster-whisper on `clone_fast.wav`: "They're only little once. Hold them a little longer tonight and let the dishes
  wait." (word-perfect at 1.12×). 16 words in 4.98 s ≈ 3.2 words/s after speed-up for this calm sentence; the spec's
  3.8 × speed target may run a little long for calm reading — re-check on a full reel.

## 3. Gemini prebuilt voices (verified 2026-10-06)

The invalid-name error does not list voices (`No matching speaker voice found for name: Notavoice`), so the list
comes from https://ai.google.dev/gemini-api/docs/speech-generation. **All 30 names in the spec match exactly**;
`Gacrux` was also proven live.

| Voice | Tone | Voice | Tone | Voice | Tone |
|---|---|---|---|---|---|
| Zephyr | Bright | Puck | Upbeat | Charon | Informative |
| Kore | Firm | Fenrir | Excitable | Leda | Youthful |
| Orus | Firm | Aoede | Breezy | Callirrhoe | Easy-going |
| Autonoe | Bright | Enceladus | Breathy | Iapetus | Clear |
| Umbriel | Easy-going | Algieba | Smooth | Despina | Smooth |
| Erinome | Clear | Algenib | Gravelly | Rasalgethi | Informative |
| Laomedeia | Upbeat | Achernar | Soft | Alnilam | Firm |
| Schedar | Even | Gacrux | Mature | Pulcherrima | Forward |
| Achird | Friendly | Zubenelgenubi | Casual | Vindemiatrix | Gentle |
| Sadachbia | Lively | Sadaltager | Knowledgeable | Sulafat | Warm |

The docs give no gender; leave `gender` null (or fill by ear later).

## 4. Music-under-voice mix (ffmpeg 7.1 from imageio-ffmpeg)

Inputs: `0` = voice (already `atempo`-ed), `1` = music bed (voice + 2 s long). `VOL` = settings volume / 100
(0.18 default), `D` = music length, fade-out start = `D − 2`.

```
[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,asplit=2[voice][key];
[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:D,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,volume=VOL[bed];
[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1[ducked];
[voice][ducked]amix=inputs=2:duration=shortest:normalize=0,afade=t=in:st=0:d=1,afade=t=out:st=D-2:d=2[out]
```

Then `-map "[out]"` (+ the video map) and encode (`-c:a aac -b:a 160k` in the reel; the check used libmp3lame 192k).

Pitfalls found:
- `sidechaincompress` stops when its **key** ends, and `amix` (even `duration=longest`) stopped at the voice's end:
  the first two attempts cut the music when the voice ended. **`apad` on the voice before `asplit`** (so both the
  voice and the key are endless) and `amix duration=shortest` (the bed sets the length) fixed it.
- `normalize=0` on `amix`, otherwise amix halves both inputs.
- `loudnorm` upsamples to 192 kHz internally; `aresample=48000` after it.

Measured on `mix_check.mp3` (20.04 s): voice windows −21.5 dB; music-only gaps −39 dB (seed 31) / −32 dB (seed 7);
tail 16.5–18 s still has music (−40/−36 dB), fading to the end. On the bed alone, ducking took the music from
−34 dB to −45 dB while the voice spoke (**~11–12 dB ducking**) and left it unchanged in gaps. Whole mix ≈ −19.6 LUFS
integrated, true peak −6.4 dBTP (a final `loudnorm` to ~−14 LUFS for social could be added in the render, optional).

## 5. Scripts (scratch, git-ignored)

`.superpowers/voice-spike/`: `busy.py` (idle check: cards, reels, ComfyUI queue), `comfy.py` (submit + poll +
download, waits for idle first), `ace.py <seconds> <seed> <out>`, `clone.py`, `gem.py` (models list / TTS → WAV),
`mix.sh <music> <out.mp3> <vol>`, `ace.graph.json`, `clone.graph.json`.

## 6. Sample files for the owner to listen to

All in `C:\Users\rober\OneDrive\Documents\uniquenames-posting\.superpowers\voice-spike\`:

- `music.flac` — 60 s ACE-Step bed, seed 31 (also `music.wav`).
- `music_seed7.flac` — second 60 s bed, seed 7.
- `ref.wav` — Gemini Gacrux reference clip (9.2 s).
- `clone.wav` — Chatterbox clone of Gacrux, calm params (5.6 s).
- `clone_fast.wav` — the same at 1.12× (5.0 s).
- `mix_check.mp3` — 20 s: `clone_fast` at 2 s and 11 s over the seed-31 bed at 18 %, ducked, faded.
- `mix_check_seed7.mp3` — same with the seed-7 bed.
