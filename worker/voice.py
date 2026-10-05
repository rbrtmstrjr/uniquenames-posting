# A reel's narration in Chatterbox (ComfyUI custom node FL_ChatterboxTTS, MIT). Chatterbox speaks at most
# about 40 s per generation, so the narration is voiced in chunks of whole lines (<= ~25 s each) that are
# joined with a short natural pause. ComfyUI saves FLAC only; ffmpeg (imageio-ffmpeg) turns it into PCM.
import io
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

from render import JobError, http_json

NODE = "FL_ChatterboxTTS"
RATE = 24000                 # Chatterbox output: 24 kHz mono
WORDS_PER_SECOND = 4.0       # measured in the spike
CHUNK_SECONDS = 25.0         # well under Chatterbox's ~40 s cap
PAUSE_SECONDS = 0.35         # between chunks, like a breath between sentences
NEEDS_RESTART = "Restart ComfyUI so it loads the Chatterbox voice node."
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def chatterbox_graph(text, seed, voice_ref=None):
    """ComfyUI API graph: text -> Chatterbox -> FLAC. voice_ref = a file in ComfyUI's input folder to clone."""
    tts = {"text": text, "exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8, "seed": int(seed),
           # off: Z-Image keeps its VRAM between the voice and the images
           "use_cpu": False, "keep_model_loaded": False}
    g = {
        "1": {"class_type": NODE, "inputs": tts},
        "2": {"class_type": "SaveAudioAdvanced", "inputs": {"audio": ["1", 0], "filename_prefix": "unique-names/reel-voice",
                                                            "format": "flac"}},
    }
    if voice_ref:
        g["3"] = {"class_type": "LoadAudio", "inputs": {"audio": voice_ref}}
        tts["audio_prompt"] = ["3", 0]
    return g


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
    from timing import ffmpeg_exe
    try:
        return subprocess.run([ffmpeg_exe(), "-nostdin", "-v", "error", "-i", "pipe:0",
                               "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(RATE), "pipe:1"],
                              input=data, check=True, capture_output=True, creationflags=_NO_WINDOW).stdout
    except subprocess.CalledProcessError as e:
        raise JobError("Couldn't read the voice from ComfyUI: %s" % e.stderr.decode("utf-8", "replace")[-300:])


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


def concat_wavs(wavs, pause_s=PAUSE_SECONDS):
    """Join 24 kHz mono 16-bit WAVs with a short silence between them."""
    gap = b"\x00\x00" * int(RATE * pause_s)
    return pcm_to_wav(gap.join(wav_pcm(w) for w in wavs))


def synthesize(comfy_url, text, seed, voice_ref, timeout):
    """One Chatterbox generation (keep it under ~40 s of speech) -> WAV bytes (24 kHz mono 16-bit)."""
    comfy = comfy_url.rstrip("/")
    ensure_node(comfy)
    try:
        sub = http_json(comfy + "/prompt", {"prompt": chatterbox_graph(text, seed, voice_ref),
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
        time.sleep(1.5)
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
