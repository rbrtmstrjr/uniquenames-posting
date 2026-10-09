# Reels: voice library, calm + faster narration, background music

Date: 2026-10-06 · Builds on `2026-10-05-reels-design.md`.

## Decisions (owner, 2026-10-06)

| # | Topic | Decision |
|---|---|---|
| 1 | Voices | All 30 Gemini TTS prebuilt voices become a selectable library. Each voice gets a one-time ~10 s **reference clip** made with Gemini TTS (server-side, ~$0.01 each) that Chatterbox clones; plus the Chatterbox **built-in** voice. |
| 2 | Samples | Each voice has a **sample** made by the PC with Chatterbox (the reel engine) reading one fixed sentence, at the current calm/speed settings, so what the owner hears is what reels sound like. Play buttons in Settings and on the review page. |
| 3 | Choice | Settings → default narrator voice. Review page → per-reel voice picker (defaults to Settings). |
| 4 | Tone | Calm: Chatterbox `exaggeration` 0.35 (was 0.5), `temperature` 0.7, `cfg_weight` 0.5. |
| 5 | Pace | Faster: the voice track is sped up with ffmpeg `atempo` (pitch kept). Settings slider 1.00–1.25×, default **1.12×**. Whisper timing runs on the sped-up track. The script word target scales with speed (≈ 3.8 words/s × speed). |
| 6 | Music | Per reel, ACE-Step 1.5 (native ComfyUI nodes) generates a unique instrumental bed: "heartwarming, soft piano, gentle strings, warm lullaby, slow, instrumental, no vocals", length = voice + 2 s. Mixed under the voice with sidechain ducking, fade-in 1 s / fade-out 2 s. Settings: Music on/off (default on), Music volume (default 18 %, range 5–40 %). Unique generated music → nothing to match in Content ID. |

## Voice list (Gemini prebuilt, verify names against the live API in Task 1)

Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat — plus `builtin`.

Reference clip text (warm, neutral, ~10 s): "Hello, mama. Every little moment with your baby matters. Let's take a deep breath, slow down, and enjoy it together."
Sample sentence (Chatterbox): "They're only little once. Hold them a little longer tonight, and let the dishes wait."

## Data (migration `006_reel_voices.sql`, idempotent, folded into schema.sql)

- `reel_voices`: `id text pk` (gemini voice name lower-case or `builtin`), `label text`, `tone text` (Gemini's descriptor, e.g. "Warm", "Firm"), `gender text null`, `ref_path text null` (bucket `reels`, `voices/<id>/ref.wav`), `sample_path text null` (`voices/<id>/sample-v<version>.wav`), `sample_status text` (`missing|queued|making|ready|failed`), `sample_key text null` (calm/speed settings the sample was made with), `error text null`, `version int`, timestamps. Owner RLS; service role full; realtime.
- `settings`: `reel_voice_id text default 'gacrux'`, `reel_speed numeric(3,2) default 1.12 check 1.00..1.25`, `reel_music boolean default true`, `reel_music_volume int default 18 check 5..40`.
- `reels`: `voice_id text null` (null = settings default), `music_path text null`.
- `claim_next_reel_step(p_no_comfy)` gains step `music` between `timing` and `image` when `reel_music` is on and `music_path` is null (needs ComfyUI, so skipped when `p_no_comfy`); voice samples are claimed by a new `claim_next_voice_sample()` (only when no card and no reel step is runnable; needs ComfyUI).

## Web app

- Settings → **Narrator & music** section: voice grid (label, tone, ▶ sample, "Default" radio), **Make samples** button (queues missing/stale samples), Speed slider, Music switch + volume slider. A one-time **Set up voices** button (server action) creates the 30 Gemini reference clips (skips ones that exist; progress toast; ~30 Gemini TTS calls, ≈ $0.30 total) and queues their samples.
- Review page → voice picker (Select with ▶ sample) stored on `reels.voice_id`.

## Worker

- Voice step: resolve voice (`reels.voice_id` → `settings.reel_voice_id` → builtin); download its ref clip into ComfyUI's input folder (cache by path); Chatterbox with calm params; join chunks; `atempo=speed`; upload as before.
- Music step: ACE-Step 1.5 graph (duration = voice length + 2 s) → WAV/FLAC → `reels/<id>/music-v<version>.flac`.
- Render: mix `music` under voice: `sidechaincompress` (voice as key) + `volume`, `afade`; output AAC as before. Music off or missing → voice only.
- Voice sample job: Chatterbox sample sentence with the voice + current calm/speed → upload `voices/<id>/sample-v<n>.wav`, `sample_status ready`, `sample_key`.

## Testing

Unit tests for every new pure piece (voice resolution, atempo filter, ducking filter graph, word-target scaling, claim order incl. music + samples); PGlite migration tests for 006; jsdom for the Settings section + review picker; a real PC check: ACE-Step 60 s bed, one cloned voice sample, and a 10-image reel with music.
