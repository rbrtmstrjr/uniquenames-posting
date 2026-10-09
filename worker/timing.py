# Word times for a reel's voice (faster-whisper on the CPU) and the start/end of each narration line.
# faster-whisper, numpy and imageio-ffmpeg are imported lazily: a card-only worker never loads them.
import difflib
import re
import subprocess
import threading
import wave

from render import JobError

WHISPER_MODEL = "small.en"
_model = None
_model_lock = threading.Lock()
FFMPEG_TIMEOUT = 120
PIP_HINT = "Run: pip install faster-whisper imageio-ffmpeg"


def _need(module):
    """Import a reel-only package, or tell the owner what to install."""
    import importlib
    try:
        return importlib.import_module(module)
    except ImportError:
        raise JobError(PIP_HINT)


def run_ffmpeg(args, what, data=None):
    """ffmpeg (imageio-ffmpeg) -> stdout bytes; a hang or an error becomes a plain JobError."""
    try:
        return subprocess.run([ffmpeg_exe()] + args, input=data, check=True, capture_output=True,
                              timeout=FFMPEG_TIMEOUT, creationflags=_NO_WINDOW).stdout
    except subprocess.TimeoutExpired:
        raise JobError("ffmpeg took over %d seconds reading %s." % (FFMPEG_TIMEOUT, what))
    except subprocess.CalledProcessError as e:
        raise JobError("ffmpeg couldn't read %s: %s" % (what, (e.stderr or b"").decode("utf-8", "replace")[-300:]))


def ffmpeg_exe():
    return _need("imageio_ffmpeg").get_ffmpeg_exe()


def load_16k(path):
    """Decode any audio file to 16 kHz mono float32 with the imageio-ffmpeg binary.
    (faster-whisper's own decoder breaks on PyAV 19, so it never gets a file path.)"""
    np = _need("numpy")
    raw = run_ffmpeg(["-nostdin", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], "the voice")
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # pythonw: no console flash per ffmpeg call


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            _model = _need("faster_whisper").WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        return _model


def transcribe(wav_path):
    """[{word, start, end}] for every word Whisper hears (punctuation kept on the word, times in seconds)."""
    segments, _info = _get_model().transcribe(load_16k(wav_path), language="en", word_timestamps=True,
                                              beam_size=5, vad_filter=False)
    out = []
    for seg in segments:
        for w in seg.words or []:
            word = (w.word or "").strip()
            if word:
                out.append({"word": word, "start": round(float(w.start), 3), "end": round(float(w.end), 3)})
    return out


def wav_duration(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


# ---------------------------------------------------------------- lines
def _norm(text):
    """Letters and digits only, lower case: 'Don't,' -> 'dont'. Spaces/punctuation never take part in matching."""
    return re.sub(r"[^0-9a-z]", "", text.lower())


def assign_lines(words, lines, duration=None):
    """(start, end) for each narration line, in seconds.

    The script and the transcript are matched letter by letter (so Whisper splitting or merging words,
    or adding punctuation, does not matter). A line starts where its first matched letter is heard; a line
    Whisper missed is placed in proportion to its length between its neighbours. The result is monotonic
    and gapless: the first line starts at 0, each line ends where the next starts, and the last line ends
    at the end of the audio (`duration`, or the last word's end)."""
    n = len(lines)
    if n == 0:
        return []
    end_t = max([float(duration or 0)] + [float(w["end"]) for w in words])

    # script letters, and where each line starts within them
    script, line_at = [], []
    for ln in lines:
        line_at.append(len(script))
        script.extend(_norm(ln))
    total = len(script)

    # heard letters, each with a time spread evenly across its word
    heard, times = [], []
    for w in words:
        s, e = float(w["start"]), float(w["end"])
        letters = _norm(w["word"])
        for k, ch in enumerate(letters):
            heard.append(ch)
            times.append(s + (e - s) * k / len(letters))

    sec_per_char = end_t / total if total else 0.0
    starts = [None] * n
    starts[0] = 0.0
    if script and heard:
        sm = difflib.SequenceMatcher(None, "".join(script), "".join(heard), autojunk=False)
        matched = {}  # script letter index -> heard time
        for a, b, size in sm.get_matching_blocks():
            if size >= 3:  # 1-2 letter blocks are coincidences, not anchors
                for k in range(size):
                    matched[a + k] = times[b + k]
        for i in range(1, n):
            lo, hi = line_at[i], (line_at[i + 1] if i + 1 < n else total)
            for j in range(lo, hi):
                if j in matched:
                    # back up over any unmatched letters at the line's start
                    starts[i] = max(0.0, matched[j] - (j - lo) * sec_per_char)
                    break

    # lines with no anchor: in proportion to letters between the known neighbours
    known = [(i, starts[i], line_at[i]) for i in range(n) if starts[i] is not None] + [(n, end_t, total)]
    for (i0, t0, c0), (i1, t1, c1) in zip(known, known[1:]):
        for i in range(i0 + 1, i1):
            frac = (line_at[i] - c0) / (c1 - c0) if c1 > c0 else (i - i0) / (i1 - i0)
            starts[i] = t0 + (t1 - t0) * frac

    # monotonic, inside the audio
    for i in range(1, n):
        starts[i] = min(max(starts[i], starts[i - 1]), end_t)
    ends = starts[1:] + [end_t]
    return [(round(s, 3), round(e, 3)) for s, e in zip(starts, ends)]
