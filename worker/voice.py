# A reel's narration in Chatterbox (ComfyUI custom node FL_ChatterboxTTS, MIT). Since 2.6.0 the narration is voiced
# LINE BY LINE, exactly like "2 - retuned (Gacrux)", the owner's pick in the 2026-10-10 listening test: one Chatterbox
# call per script line (exaggeration 0.6, cfg_weight 0.3, temperature 0.8), the silence before and after each line
# trimmed (EDGE_PAD kept, a 4 ms fade at both cuts), then 0.7 s of room tone after the hook line and 0.4 s between the
# others (very quiet noise, ~-60 dBFS, never digital silence). Inner pauses are left as Chatterbox spoke them. The model
# stays loaded across a reel's lines (keep_model_loaded) and is unloaded after the last one, so Z-Image gets the VRAM.
# ComfyUI saves FLAC only; ffmpeg (imageio-ffmpeg) turns it into PCM.
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

from render import JobError, http_json

NODE = "FL_ChatterboxTTS"
RATE = 24000                 # Chatterbox output: 24 kHz mono
WORDS_PER_SECOND = 4.0       # Chatterbox's raw pace (spike): only sizes chunk_lines (not used for reels since 2.6.0)
CHUNK_SECONDS = 25.0         # well under Chatterbox's ~40 s cap
PAUSE_SECONDS = 0.10         # concat_wavs' default gap (the old chunked voice)
# Silence detection, shared by the edge trim (2.6.0) and the old tightening (007).
FRAME_SECONDS = 0.01         # silence is judged on 10 ms frames (RMS)
EDGE_PAD = 0.07              # kept around the speech: breathy onsets ("h") and soft word tails survive
FADE_SECONDS = 0.004         # a 4 ms fade at every cut, so no cut ever clicks
MAX_PAUSE = 0.35             # tighten() only (no longer used for reels)
SHORT_PAUSE = 0.25
SILENCE_REL = 0.02           # a frame is silent below 2% (-34 dB) of the clip's loud speech (95th-percentile RMS) ...
SILENCE_MIN = 33.0           # ... but never below -60 dBFS (a near-silent clip) ...
SILENCE_MAX = 184.0          # ... nor above -45 dBFS (so a -40 dBFS word tail always counts as speech), 16-bit units
# Line-by-line narration (2.6.0)
LINE_GAP = 0.4               # room tone between two lines ...
HOOK_GAP = 0.7               # ... and after the first (hook) line
ROOM_TONE_DBFS = -60.0       # a soft, slightly dark hiss: a real room, not dead digital silence
ROOM_TONE_SEED = 7
POLL_SECONDS = 0.5           # how often a voice job is checked (a warm line takes ~4 s)
UNLOAD_TEXT = "Okay."        # the tiny line that unloads a model left loaded by a reel that stopped part-way
STYLE_MARK = "l1"            # in sample_key: samples made in an older style (g1 = tightened chunks) get re-made
NEEDS_RESTART = "Restart ComfyUI so it loads the Chatterbox voice node."
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
# The retuned delivery (2026-10-10 listening test): more life than 006's calm 0.35 / 0.7 / 0.5, a steadier pace.
DELIVERY = {"exaggeration": 0.6, "cfg_weight": 0.3, "temperature": 0.8}
SPEED_MIN, SPEED_MAX, SPEED_DEFAULT = 1.00, 1.25, 1.12
SAMPLE_TEXT = "They're only little once. Hold them a little longer tonight, and let the dishes wait."
SAMPLE_SEED = 42             # every voice reads the sample the same way: only the voice differs
BUILTIN = "builtin"
# The house voices (lib/reels/voices.ts HOUSE_VOICES): the only ones the app offers. Gacrux is the default narrator.
HOUSE_VOICES = ("gacrux", "sulafat", "vindemiatrix", "achernar")
DEFAULT_VOICE = "gacrux"


def chatterbox_graph(text, seed, voice_ref=None, keep_loaded=False):
    """ComfyUI API graph: text -> Chatterbox -> FLAC. voice_ref = a file in ComfyUI's input folder to clone.
    keep_loaded: the node keeps the model for the next line (a reel's last line passes False, which unloads it)."""
    tts = {"text": text, "exaggeration": DELIVERY["exaggeration"], "cfg_weight": DELIVERY["cfg_weight"],
           "temperature": DELIVERY["temperature"], "seed": int(seed),
           "use_cpu": False, "keep_model_loaded": bool(keep_loaded)}
    g = {
        "1": {"class_type": NODE, "inputs": tts},
        "2": {"class_type": "SaveAudioAdvanced", "inputs": {"audio": ["1", 0], "filename_prefix": "unique-names/reel-voice",
                                                            "format": "flac"}},
    }
    if voice_ref:
        g["3"] = {"class_type": "LoadAudio", "inputs": {"audio": voice_ref}}
        tts["audio_prompt"] = ["3", 0]
    return g


def resolve_voice_id(reel, settings):
    """The reel's own voice (an older reel keeps whatever it was given), else the Settings default when it is a house
    voice, else Gacrux (2.6.0: only the house voices are offered)."""
    own = ((reel or {}).get("voice_id") or "").strip().lower()
    if own:
        return own
    default = ((settings or {}).get("reel_voice_id") or "").strip().lower()
    return default if default in HOUSE_VOICES else DEFAULT_VOICE


def reel_speed(settings):
    """settings.reel_speed clamped to 1.00-1.25. A database without 006 (no column) keeps the old 1.0;
    an unreadable value gets the default."""
    if "reel_speed" not in (settings or {}):
        return 1.0
    try:
        v = float(settings["reel_speed"])
    except (TypeError, ValueError):
        return SPEED_DEFAULT
    if v != v:  # NaN
        return SPEED_DEFAULT
    return round(min(SPEED_MAX, max(SPEED_MIN, v)), 2)


def atempo_filter(speed):
    """The ffmpeg filter that speeds the voice up with its pitch kept; None at 1.0 (nothing to do)."""
    speed = round(min(SPEED_MAX, max(SPEED_MIN, float(speed))), 2)
    return None if speed == 1.0 else "atempo=%.2f" % speed


def sample_key(speed):
    """What a voice sample was made with (the app re-queues samples whose key differs from the current one)."""
    return "e%g-t%g-c%g-s%.2f-%s" % (DELIVERY["exaggeration"], DELIVERY["temperature"], DELIVERY["cfg_weight"],
                                     float(speed), STYLE_MARK)


def speed_up(wav_bytes, speed):
    """24 kHz mono WAV -> the same, `speed` times faster (atempo keeps the pitch). 1.0 returns it as is."""
    f = atempo_filter(speed)
    if not f:
        return wav_bytes
    from timing import run_ffmpeg
    pcm = run_ffmpeg(["-nostdin", "-v", "error", "-f", "wav", "-i", "pipe:0", "-af", f, "-f", "s16le",
                      "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(RATE), "pipe:1"], "the voice to speed it up", wav_bytes)
    return pcm_to_wav(pcm)


def input_name(path, version):
    """A safe, stable ComfyUI input file name for a reference clip: voices/gacrux/ref.wav v3 -> voices-gacrux-ref-v3.wav."""
    base = path.rsplit("/", 1)[-1]
    stem, ext = (path[:-(len(base) - base.rindex("."))], base[base.rindex(".") + 1:]) if "." in base else (path, "")
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-")[:80] or "voice"
    ext = re.sub(r"[^A-Za-z0-9]", "", ext)[:5].lower() or "wav"
    return "%s-v%d.%s" % (stem, int(version or 0), ext)


def comfy_input_dir(comfy_url):
    """ComfyUI's input folder on this PC: --input-directory from /system_stats argv (Comfy Desktop passes it),
    else <ComfyUI>/input next to main.py when argv gives an absolute path; None if unknown."""
    import os
    from render import http_json
    argv = ((http_json(comfy_url.rstrip("/") + "/system_stats", timeout=5) or {}).get("system") or {}).get("argv") or []
    for i, a in enumerate(argv):
        if a == "--input-directory" and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith("--input-directory="):
            return a.split("=", 1)[1]
    if argv and os.path.isabs(argv[0]):
        return os.path.join(os.path.dirname(argv[0]), "input")
    return None


def prune_inputs(comfy_url, keep, input_dir=None):
    """Delete the older versions of an uploaded clip from ComfyUI's input folder: keep 'unique-names/voices-kore-ref-v3.wav'
    removes voices-kore-ref-v1.wav, -v2.wav ... in the same subfolder (only files of exactly that name pattern).
    Returns how many were removed."""
    import os
    sub, _, fn = keep.rpartition("/")
    m = re.match(r"^(.+)-v\d+\.([A-Za-z0-9]+)$", fn)
    if not m:
        return 0
    input_dir = input_dir or comfy_input_dir(comfy_url)
    if not input_dir:
        return 0
    folder = os.path.join(input_dir, *[p for p in sub.split("/") if p and p not in (".", "..")])
    pat = re.compile(r"^%s-v\d+\.%s$" % (re.escape(m.group(1)), re.escape(m.group(2))))
    n = 0
    try:
        names = os.listdir(folder)
    except OSError:
        return 0
    for name in names:
        if name != fn and pat.match(name):
            try:
                os.remove(os.path.join(folder, name))
                n += 1
            except OSError:
                pass
    return n


def input_exists(comfy_url, name):
    """True if ComfyUI still has this file in its input folder (name as LoadAudio takes it: 'sub/file')."""
    sub, _, fn = name.rpartition("/")
    q = urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": "input"})
    try:
        with urllib.request.urlopen(comfy_url.rstrip("/") + "/view?" + q, timeout=15) as r:
            return r.status == 200
    except Exception:
        return False


def chunk_lines(lines, max_words=int(CHUNK_SECONDS * WORDS_PER_SECOND)):
    """Consecutive lines grouped into chunks of at most max_words words (a longer single line is its own chunk)."""
    chunks, cur, n = [], [], 0
    for ln in (s.strip() for s in lines):
        if not ln:
            continue
        w = len(ln.split())
        if cur and n + w > max_words:
            chunks.append(" ".join(cur))
            cur, n = [], 0
        cur.append(ln)
        n += w
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def ensure_node(comfy_url):
    try:
        info = http_json(comfy_url.rstrip("/") + "/object_info/" + NODE, timeout=15)
    except Exception:
        raise JobError(COMFY_CLOSED)
    if not info:
        raise JobError(NEEDS_RESTART)


def upload_input(comfy_url, filename, data):
    """Put a reference voice clip in ComfyUI's input folder; returns the name LoadAudio takes."""
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in (("subfolder", "unique-names"), ("type", "input"), ("overwrite", "true")):
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, k, v)).encode())
    parts.append(('--%s\r\nContent-Disposition: form-data; name="image"; filename="%s"\r\n'
                  'Content-Type: application/octet-stream\r\n\r\n' % (boundary, filename)).encode() + data + b"\r\n")
    body = b"".join(parts) + ("--%s--\r\n" % boundary).encode()
    req = urllib.request.Request(comfy_url.rstrip("/") + "/upload/image", data=body, method="POST",
                                 headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        raise JobError("Couldn't give ComfyUI your voice clip: %s" % e)
    return "%s/%s" % (out["subfolder"], out["name"]) if out.get("subfolder") else out["name"]


def flac_to_pcm(data):
    """Any audio bytes -> 16-bit 24 kHz mono PCM bytes."""
    from timing import run_ffmpeg
    return run_ffmpeg(["-nostdin", "-v", "error", "-i", "pipe:0", "-f", "s16le", "-acodec", "pcm_s16le",
                       "-ac", "1", "-ar", str(RATE), "pipe:1"], "the voice from ComfyUI", data)


def pcm_to_wav(pcm):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def wav_pcm(wav_bytes):
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, RATE):
            raise JobError("The voice came back in an unexpected format.")
        return w.readframes(w.getnframes())


def silence_threshold(rms):
    """The RMS (16-bit units) below which a 10 ms frame counts as silence."""
    import numpy as np
    loud = float(np.percentile(rms, 95)) if len(rms) else 0.0
    return min(SILENCE_MAX, max(SILENCE_MIN, SILENCE_REL * loud))


def tighten_pcm(pcm, rate=RATE):
    """16-bit mono PCM with the silence before the first and after the last word trimmed (EDGE_PAD kept) and
    every inner pause longer than MAX_PAUSE shortened to SHORT_PAUSE (its two edges kept, the middle cut out),
    with a FADE_SECONDS fade on both sides of every cut. Audio with no speech at all is returned unchanged (nothing to measure against)."""
    import numpy as np
    x = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32)
    win = max(1, int(round(rate * FRAME_SECONDS)))
    n = len(x) // win
    if n == 0:
        return pcm
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1))
    voiced = rms > silence_threshold(rms)
    idx = np.flatnonzero(voiced)
    if len(idx) == 0:
        return pcm
    pad = int(round(rate * EDGE_PAD))
    start = max(0, idx[0] * win - pad)
    end = min(len(x), (idx[-1] + 1) * win + pad)
    keep_half = int(round(rate * SHORT_PAUSE / 2))
    pieces, cur = [], start
    # inner silent runs: between consecutive voiced frames
    gaps = np.flatnonzero(np.diff(idx) > 1)
    for g in gaps:
        a = (idx[g] + 1) * win          # first silent sample
        b = idx[g + 1] * win            # first voiced sample after the run
        if (b - a) / float(rate) > MAX_PAUSE:
            pieces.append((cur, a + keep_half))
            cur = b - keep_half
    pieces.append((cur, end))
    fade = max(1, int(round(rate * FADE_SECONDS)))
    parts = []
    for p, q in pieces:
        seg = x[p:q].copy()
        k = min(fade, len(seg))
        if p > 0 and k:                 # a cut before this piece: fade in
            seg[:k] *= np.linspace(0.0, 1.0, k, endpoint=False, dtype=np.float32)
        if q < len(x) and k:            # a cut after it: fade out
            seg[-k:] *= np.linspace(1.0, 0.0, k, dtype=np.float32)
        parts.append(seg)
    out = np.clip(np.round(np.concatenate(parts)), -32768, 32767).astype("<i2")
    return out.tobytes()


def tighten(wav_bytes):
    """A 24 kHz mono WAV with its silences tightened (tighten_pcm)."""
    return pcm_to_wav(tighten_pcm(wav_pcm(wav_bytes)))


def concat_wavs(wavs, pause_s=PAUSE_SECONDS):
    """Join 24 kHz mono 16-bit WAVs with a short silence between them."""
    gap = b"\x00\x00" * int(RATE * pause_s)
    return pcm_to_wav(gap.join(wav_pcm(w) for w in wavs))


def synthesize(comfy_url, text, seed, voice_ref, timeout, keep_loaded=False):
    """One Chatterbox generation (keep it under ~40 s of speech) -> WAV bytes (24 kHz mono 16-bit)."""
    comfy = comfy_url.rstrip("/")
    ensure_node(comfy)
    try:
        sub = http_json(comfy + "/prompt", {"prompt": chatterbox_graph(text, seed, voice_ref, keep_loaded),
                                            "client_id": "unique-names-worker"}, timeout=30)
    except urllib.error.HTTPError as e:
        raise JobError("ComfyUI refused the voice job: %s" % e.read().decode("utf-8", "replace")[:300])
    except Exception:
        raise JobError(COMFY_CLOSED)
    pid = sub.get("prompt_id")
    if not pid:
        raise JobError("ComfyUI did not accept the voice job: %s" % json.dumps(sub)[:300])
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(POLL_SECONDS)
        try:
            entry = http_json(comfy + "/history/" + pid, timeout=15).get(pid)
        except Exception:
            raise JobError("ComfyUI stopped answering while making the voice. Is it still open?")
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise JobError("ComfyUI failed while making the voice: %s" % json.dumps(status.get("messages"))[:300])
        if status.get("completed"):
            files = (entry.get("outputs", {}).get("2", {}) or {}).get("audio") or []
            if not files:
                raise JobError("ComfyUI finished without the voice.")
            a = files[0]
            q = urllib.parse.urlencode({"filename": a["filename"], "subfolder": a.get("subfolder", ""), "type": a.get("type", "output")})
            with urllib.request.urlopen(comfy + "/view?" + q, timeout=60) as r:
                data = r.read()
            return pcm_to_wav(flac_to_pcm(data))
    raise JobError("ComfyUI did not finish the voice within %d seconds." % timeout)


# ---------------------------------------------------------------- line by line (2.6.0)
def _floats(pcm):
    import numpy as np
    return np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32)


def _voiced(x, rate):
    """(10 ms frame size, indices of the voiced frames) of float samples."""
    import numpy as np
    win = max(1, int(round(rate * FRAME_SECONDS)))
    n = len(x) // win
    if n == 0:
        return win, np.zeros(0, dtype=int)
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1))
    return win, np.flatnonzero(rms > silence_threshold(rms))


def has_speech(pcm, rate=RATE):
    """True if 16-bit mono PCM holds any voiced 10 ms frame."""
    return len(_voiced(_floats(pcm), rate)[1]) > 0


def trim_edges_pcm(pcm, rate=RATE):
    """16-bit mono PCM with only the silence before the first and after the last word trimmed (EDGE_PAD kept) and a
    FADE_SECONDS fade in and out, so lines join without clicks. Inner pauses are untouched. No speech: returned as is."""
    import numpy as np
    x = _floats(pcm)
    win, idx = _voiced(x, rate)
    if len(idx) == 0:
        return pcm
    pad = int(round(rate * EDGE_PAD))
    seg = x[max(0, idx[0] * win - pad): min(len(x), (idx[-1] + 1) * win + pad)].copy()
    k = min(max(1, int(round(rate * FADE_SECONDS))), len(seg))
    seg[:k] *= np.linspace(0.0, 1.0, k, dtype=np.float32)
    seg[-k:] *= np.linspace(1.0, 0.0, k, dtype=np.float32)
    return np.clip(np.round(seg), -32768, 32767).astype("<i2").tobytes()


def room_tone_pcm(seconds, rate=RATE, dbfs=ROOM_TONE_DBFS):
    """`seconds` of very quiet, slightly dark noise (RMS at `dbfs`) as 16-bit mono PCM: the pause between two lines
    sounds like the same room, never like a dropout. The same every time (fixed seed)."""
    import numpy as np
    n = int(round(rate * seconds))
    if n <= 0:
        return b""
    w = np.random.default_rng(ROOM_TONE_SEED).standard_normal(n + 64).astype(np.float32)
    y = np.convolve(w, np.ones(8, dtype=np.float32) / 8, mode="same")[:n]
    y *= (32768 * 10 ** (dbfs / 20)) / (float(np.sqrt(np.mean(y ** 2))) + 1e-9)
    return np.clip(np.round(y), -32768, 32767).astype("<i2").tobytes()


def join_lines(wavs):
    """The lines' WAVs (24 kHz mono 16-bit), each edge-trimmed, joined with room tone: HOOK_GAP after the first,
    LINE_GAP after the others."""
    parts = []
    for i, w in enumerate(wavs):
        if i:
            parts.append(room_tone_pcm(HOOK_GAP if i == 1 else LINE_GAP))
        parts.append(trim_edges_pcm(wav_pcm(w)))
    return pcm_to_wav(b"".join(parts))


def unload_model(comfy_url, voice_ref, timeout):
    """Free the VRAM of a Chatterbox model left loaded by a reel that stopped part-way: one tiny line without
    keep_model_loaded (the node then drops its cached model). Never raises."""
    try:
        synthesize(comfy_url, UNLOAD_TEXT, SAMPLE_SEED, voice_ref, min(int(timeout), 120), keep_loaded=False)
    except Exception:
        pass


def narrate_lines(comfy_url, lines, seed, voice_ref, timeout, on_line=None):
    """The narration as one WAV: one Chatterbox call per non-empty line (the same seed), the model kept loaded until
    the last line (which unloads it), joined by join_lines. on_line(i, n, text) runs before each line (logging, the
    reel's heartbeat). If anything fails after a line asked to keep the model, the model is unloaded before re-raising."""
    lines = [ln.strip() for ln in lines if (ln or "").strip()]
    if not lines:
        raise JobError("This reel has no narration to voice.")
    wavs, maybe_loaded = [], False
    try:
        for i, text in enumerate(lines):
            if on_line:
                on_line(i, len(lines), text)
            keep = i < len(lines) - 1
            maybe_loaded = maybe_loaded or keep
            w = synthesize(comfy_url, text, seed, voice_ref, timeout, keep_loaded=keep)
            if not has_speech(wav_pcm(w)):
                raise JobError("Chatterbox gave no speech for line %d. Press Retry." % (i + 1))
            wavs.append(w)
        maybe_loaded = False  # the last line ran without keep_model_loaded: the node dropped the model
    finally:
        if maybe_loaded:
            unload_model(comfy_url, voice_ref, timeout)
    return join_lines(wavs)
