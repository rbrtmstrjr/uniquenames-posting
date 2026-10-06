# A reel's background music: ACE-Step 1.5 through ComfyUI's native nodes (models in Comfy Desktop's shared
# models folder, see docs/reference/reel-voices-music-spike.md) makes one unique instrumental bed per reel,
# generated voice length + 8 s, as a 48 kHz stereo FLAC. The render (reel_render.py) mixes it under the voice and
# trims it to voice + 2 s with a 2 s fade-out.
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request

from render import JobError, http_json

TAGS = "heartwarming, soft piano, gentle strings, warm lullaby, slow, instrumental, no vocals"
EXTRA_SECONDS = 2.0          # the reel (and the music in it) outlasts the voice by this: the music rings out
GENERATE_EXTRA_SECONDS = 8.0  # ACE-Step writes a song that ENDS (decays to silence ~3-4 s before its length):
                              # generate longer and cut it, so the music is still playing at the last word
MAX_SECONDS = 240.0          # a reel never needs more (and ACE-Step time grows with it)
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
POLL_SECONDS = 1.5
BEAT_SECONDS = 20.0


def music_seconds(voice_seconds):
    """The length to ask ACE-Step for: voice + 8 s (the render keeps voice + 2 s of it), at most MAX_SECONDS."""
    return round(min(MAX_SECONDS, max(1.0, float(voice_seconds)) + GENERATE_EXTRA_SECONDS), 2)


def random_seed():
    return random.randint(0, 2 ** 32 - 1)


def ace_step_graph(seconds, seed, prefix="unique-names/reel-music"):
    """ComfyUI API graph (the spike's working graph): ACE-Step 1.5 turbo, 8 steps -> FLAC from node 10."""
    seconds, seed = float(seconds), int(seed)
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "acestep_v1.5_turbo.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "qwen_0.6b_ace15.safetensors",
                                                         "clip_name2": "qwen_1.7b_ace15.safetensors", "type": "ace"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ace_1.5_vae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.0}},
        "5": {"class_type": "TextEncodeAceStepAudio1.5", "inputs": {
            "clip": ["2", 0], "tags": TAGS, "lyrics": "[Instrumental]", "seed": seed, "bpm": 70, "duration": seconds,
            "timesignature": "4", "language": "en", "keyscale": "C major", "generate_audio_codes": True,
            "cfg_scale": 2.0, "temperature": 0.85, "top_p": 0.9, "top_k": 0, "min_p": 0.0}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"seconds": seconds, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {
            "model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "seed": seed,
            "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveAudioAdvanced", "inputs": {"audio": ["9", 0], "filename_prefix": prefix, "format": "flac"}},
    }


def comfy_audio(comfy_url, graph, out_node, timeout, what, beat=None, sleep=time.sleep):
    """Run a ComfyUI graph and return the bytes of the first audio file node `out_node` saved.
    beat() is called about every BEAT_SECONDS while waiting (it may raise to stop)."""
    comfy = comfy_url.rstrip("/")
    try:
        sub = http_json(comfy + "/prompt", {"prompt": graph, "client_id": "unique-names-worker"}, timeout=30)
    except urllib.error.HTTPError as e:
        raise JobError("ComfyUI refused the %s job: %s" % (what, e.read().decode("utf-8", "replace")[:300]))
    except Exception:
        raise JobError(COMFY_CLOSED)
    pid = sub.get("prompt_id")
    if not pid:
        raise JobError("ComfyUI did not accept the %s job: %s" % (what, json.dumps(sub)[:300]))
    t0 = last = time.time()
    while time.time() - t0 < timeout:
        sleep(POLL_SECONDS)
        if beat and time.time() - last >= BEAT_SECONDS:
            last = time.time()
            beat()
        try:
            entry = http_json(comfy + "/history/" + pid, timeout=15).get(pid)
        except Exception:
            raise JobError("ComfyUI stopped answering while making the %s. Is it still open?" % what)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise JobError("ComfyUI failed while making the %s: %s" % (what, json.dumps(status.get("messages"))[:300]))
        if status.get("completed"):
            files = (entry.get("outputs", {}).get(out_node, {}) or {}).get("audio") or []
            if not files:
                raise JobError("ComfyUI finished without the %s." % what)
            a = files[0]
            q = urllib.parse.urlencode({"filename": a["filename"], "subfolder": a.get("subfolder", ""), "type": a.get("type", "output")})
            with urllib.request.urlopen(comfy + "/view?" + q, timeout=60) as r:
                return r.read()
    raise JobError("ComfyUI did not finish the %s within %d seconds." % (what, timeout))


def make_bed(comfy_url, seconds, seed, timeout, beat=None):
    """FLAC bytes of a new ACE-Step bed `seconds` long."""
    return comfy_audio(comfy_url, ace_step_graph(seconds, seed), "10", timeout, "music", beat)


# ---------------------------------------------------------------- the mix (render)
def clamp_volume(pct):
    try:
        v = int(round(float(pct)))
    except (TypeError, ValueError):
        return 18
    return min(40, max(5, v))


def mix_filter(voice_in, music_in, volume, duration):
    """filter_complex part: the bed (loudness-normalised, at `volume` 0..1, fade in 1 s / out 2 s) ducked under
    the voice (sidechain, voice as key) and mixed with it into [aout], exactly `duration` s long.
    The voice and the key are padded (apad) so the compressor and amix never stop when the voice does; the bed
    is padded then trimmed so a short bed can never cut the video. The fades are on the bed only: the video
    ends when the voice does, and the last words must not fade out."""
    d = max(0.1, float(duration))
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    return ";\n".join([
        "[%s]%s,apad,asplit=2[voice][key]" % (voice_in, fmt),
        "[%s]%s,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,volume=%.2f,"
        "afade=t=in:st=0:d=1,afade=t=out:st=%.3f:d=2[bed]" % (music_in, fmt, d, float(volume), max(0.0, d - 2)),
        "[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1[ducked]",
        "[voice][ducked]amix=inputs=2:duration=shortest:normalize=0,atrim=0:%.3f[aout]" % d,
    ])
