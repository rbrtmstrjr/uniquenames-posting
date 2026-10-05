# The reel's video on the PC: every finished scene picture gets a slow Ken Burns zoom for its narration
# line, the voice goes under it, and the words appear as they are spoken (3 at a time, the spoken one in
# yellow). ffmpeg comes from imageio-ffmpeg. Nothing here needs ComfyUI.
#   full MP4 (1080x1920)  -> Pictures\Unique Names\Reels\<date> <title>.mp4  (written as .part, then renamed)
#   preview MP4 (720x1280) -> storage reels/<id>/preview-v<version>.mp4     (<= ~15 MB, 45 MB hard cap)
import datetime
import os
import re
import shutil
import subprocess
import tempfile
import time

from render import JobError, default_output_root
from supa import SupaError
import fonts
import timing

FPS = 30
WIDTH, HEIGHT = 1080, 1920
ZOOM_PER_S = 0.02              # Ken Burns: 2% per second ...
ZOOM_MAX = 0.08                # ... and at most 1.00 -> 1.08 over a scene (short scenes zoom less, not faster)
MIN_SCENE_S = 0.8              # a picture is never on screen for less than this
RENDER_TIMEOUT = 900
PREVIEW_TIMEOUT = 300
HEARTBEAT_S = 60
PREVIEW_MB = 15
PREVIEW_RETRY_MB = 8
PREVIEW_CAP_MB = 45
PREVIEW_MAX_K = 2500           # a short reel doesn't need more than this at 720p
UPLOAD_TIMEOUT = 600
YELLOW = "&H0000E6FF&"         # ASS colours are &HAABBGGRR: this is a warm yellow
CAPTION_FONT = "Poppins-Bold.ttf"
# Captions: bottom-centre, a third of the way up (clear of the platform buttons), white with a black
# outline + soft shadow; the spoken word turns YELLOW.
CAPTION_STYLE = {"size": 0.046, "align": 2, "margin_v": 0.34, "margin_lr": 0.07, "outline": 6, "shadow": 3,
                 "back": "&H80000000"}
ERR_TAIL = 240                 # stderr chars kept in the message (reels.error holds 600)
NO_NET = "Couldn't reach the internet to save this reel. Press Retry."
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# ---------------------------------------------------------------- captions
def ass_time(t):
    cs = int(round(max(0.0, float(t)) * 100))
    return "%d:%02d:%02d.%02d" % (cs // 360000, cs // 6000 % 60, cs // 100 % 60, cs % 100)


def caption_text(word):
    """ALL CAPS, no ASS control characters, no trailing , . ; : (? and ! stay)."""
    w = re.sub(r"[{}\\]", "", str(word or "")).strip().upper()
    return re.sub(r"[,.;:]+$", "", w).strip() or w


def group_words(words, max_words=3, max_chars=20):
    """Words in on-screen groups: up to `max_words`, a new group after a comma or a sentence end, or when it gets long."""
    groups, cur = [], []
    for w in words:
        text = caption_text(w.get("word"))
        if not text:
            continue
        item = {"text": text, "start": float(w["start"]), "end": float(w["end"])}
        if cur and (len(cur) >= max_words or sum(len(c["text"]) + 1 for c in cur) + len(text) > max_chars):
            groups.append(cur)
            cur = []
        cur.append(item)
        if re.search(r"[,;:.!?]$", str(w.get("word") or "").strip()):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def ass_captions(words, width=WIDTH, height=HEIGHT, linger=0.6):
    """An ASS file: one event per spoken word showing its whole group, that word in yellow.
    A group stays up until the next group starts (if that is within `linger` s), so it doesn't flicker."""
    c = CAPTION_STYLE
    size = int(round(height * c["size"]))
    lr = int(width * c["margin_lr"])
    head = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Cap,Poppins,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,%s,-1,0,0,0,100,100,0,0,1,%d,%d,%d,%d,%d,%d,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    ) % (width, height, size, c["back"], c["outline"], c["shadow"], c["align"], lr, lr, int(round(height * c["margin_v"])))
    groups = group_words(words or [])
    out = []
    for gi, g in enumerate(groups):
        nxt = groups[gi + 1][0]["start"] if gi + 1 < len(groups) else None
        g_end = g[-1]["end"]
        if nxt is not None and nxt - g_end <= linger:
            g_end = nxt
        for j, w in enumerate(g):
            start = w["start"]
            end = g[j + 1]["start"] if j + 1 < len(g) else g_end
            if end <= start:
                end = start + 0.05
            parts = [("{\\1c%s}%s{\\1c&H00FFFFFF&}" % (YELLOW, o["text"])) if k == j else o["text"]
                     for k, o in enumerate(g)]
            out.append("Dialogue: 0,%s,%s,Cap,,0,0,0,,%s" % (ass_time(start), ass_time(end), " ".join(parts)))
    return head + "\n".join(out) + "\n"


# ---------------------------------------------------------------- timeline
def fit_durations(raw, total, min_s=MIN_SCENE_S):
    """Durations (seconds) that keep each scene >= min_s and still add up to exactly `total`: short scenes
    are lifted to min_s and the time comes proportionally out of the longer ones."""
    n = len(raw)
    if n == 0:
        return []
    raw = [max(0.0, float(d)) for d in raw]
    if total <= n * min_s:
        return [total / n] * n
    fixed = set()
    while True:
        free = [i for i in range(n) if i not in fixed]
        budget = total - min_s * len(fixed)
        weight = sum(raw[i] for i in free)
        out = [min_s] * n
        for i in free:
            out[i] = budget * raw[i] / weight if weight > 0 else budget / len(free)
        low = [i for i in free if out[i] < min_s - 1e-9]
        if not low:
            return out
        fixed.update(low)


def scene_timeline(scenes, total, min_s=MIN_SCENE_S):
    """[(scene, seconds)] for the scenes with a finished picture, in order. Each picture covers its line
    up to the next picture's line, so a skipped scene's time goes to the picture before it (the first
    picture also covers anything before it). Lines without times are placed by their word counts."""
    starts = [s.get("start_s") for s in scenes]
    if any(t is None for t in starts):
        counts = [max(1, len((s.get("narration") or "").split())) for s in scenes]
        acc, starts = 0, []
        for c in counts:
            starts.append(total * acc / float(sum(counts)))
            acc += c
    shown = [(s, float(t)) for s, t in zip(scenes, starts) if s.get("status") == "done" and s.get("photo_path")]
    if not shown:
        return []
    bounds = [0.0] + [t for _s, t in shown[1:]] + [float(total)]
    raw = [b - a for a, b in zip(bounds, bounds[1:])]
    return list(zip([s for s, _t in shown], fit_durations(raw, float(total), min_s)))


def frame_counts(durations, fps=FPS):
    """Whole frames per scene; rounding the running total keeps the video exactly as long as the voice."""
    out, acc, done = [], 0.0, 0
    for d in durations:
        acc += d
        edge = int(round(acc * fps))
        out.append(max(1, edge - done))
        done += out[-1]
    return out


# ---------------------------------------------------------------- ffmpeg
def filter_path(p):
    """A path as a filter-graph option value (Windows drive colons and backslashes escaped)."""
    return "'%s'" % p.replace("\\", "/").replace(":", "\\:").replace("'", "")


def ffmpeg_args(ffmpeg, scenes, voice_wav, ass_path, out_path, width=WIDTH, height=HEIGHT, fps=FPS, fontsdir=None):
    """scenes: [{"image": path, "duration": seconds}]. One input per picture (a single frame that zoompan
    turns into the scene's frames), zoom in / out alternately, concat, captions, H.264 + AAC."""
    frames = frame_counts([s["duration"] for s in scenes], fps)
    args = [ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error"]
    for s in scenes:
        args += ["-i", s["image"]]
    args += ["-i", voice_wav]
    parts = []
    for i, n in enumerate(frames):
        last = max(1, n - 1)
        amt = min(ZOOM_MAX, ZOOM_PER_S * n / float(fps))
        z = ("1+%.4f*on/%d" % (amt, last)) if i % 2 == 0 else ("%.4f-%.4f*on/%d" % (1 + amt, amt, last))
        # 2x up first: zoompan crops in whole pixels, so a bigger source keeps the slow zoom smooth
        parts.append(
            "[%d:v]scale=%d:%d:force_original_aspect_ratio=increase:flags=lanczos,crop=%d:%d,setsar=1,"
            "zoompan=z='%s':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=%d:s=%dx%d:fps=%d,setsar=1,format=yuv420p[v%d]"
            % (i, 2 * width, 2 * height, 2 * width, 2 * height, z, n, width, height, fps, i))
    parts.append("".join("[v%d]" % i for i in range(len(frames))) + "concat=n=%d:v=1:a=0[vcat]" % len(frames))
    subs = "subtitles=filename=%s" % filter_path(ass_path)
    if fontsdir:
        subs += ":fontsdir=%s" % filter_path(fontsdir)
    parts.append("[vcat]%s[vout]" % subs)
    args += ["-filter_complex", ";\n".join(parts), "-map", "[vout]", "-map", "%d:a" % len(scenes),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", "8M", "-bufsize", "16M",
             "-pix_fmt", "yuv420p", "-r", str(fps),
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", out_path]
    return args


def preview_bitrate_k(duration, target_mb=PREVIEW_MB):
    """Video kbps so the whole preview lands near target_mb (128k of it is the audio); never below 600k,
    and never above PREVIEW_MAX_K (a 20 s reel would otherwise get a needlessly heavy preview)."""
    return min(PREVIEW_MAX_K, max(600, int(target_mb * 8192 / max(1.0, float(duration)) - 128)))


def preview_args(ffmpeg, src, out, target_mb=PREVIEW_MB, duration=60.0):
    k = preview_bitrate_k(duration, target_mb)
    return [ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error", "-i", src,
            "-vf", "scale=720:1280:flags=lanczos,setsar=1", "-c:v", "libx264", "-preset", "veryfast",
            "-b:v", "%dk" % k, "-maxrate", "%dk" % k, "-bufsize", "%dk" % (2 * k), "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out]


def use_filter_script(args, script_path):
    """Move a long -filter_complex into a file (Windows caps a command line at 32k characters).
    `-/option file` reads an option's value from a file (ffmpeg 7+; the bundled 7.1 has it, and
    -filter_complex_script is deprecated)."""
    i = args.index("-filter_complex")
    with open(script_path, "w", encoding="utf-8") as fh:
        fh.write(args[i + 1])
    return args[:i] + ["-/filter_complex", os.path.basename(script_path)] + args[i + 2:]


def probe_duration(ffmpeg, path):
    """Seconds, read from `ffmpeg -i` (imageio-ffmpeg has no ffprobe)."""
    try:
        r = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", path], capture_output=True, timeout=60,
                           creationflags=_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise JobError("ffmpeg took over 60 seconds reading the finished video.")
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr.decode("utf-8", "replace"))
    if not m:
        raise JobError("Couldn't read the length of the finished video.")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def run_ffmpeg(args, cwd, timeout, what, beat=None, beat_every=HEARTBEAT_S, log=None):
    """Run ffmpeg in `cwd`, calling beat() every `beat_every` s (it may raise to stop). stderr goes to a
    file, not a pipe, so a chatty run can never block. A hang or a failure becomes a plain JobError."""
    log_path = os.path.join(cwd, "ffmpeg-%s.log" % re.sub(r"\W+", "-", what))
    with open(log_path, "wb") as errf:
        p = subprocess.Popen(args, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errf,
                             creationflags=_NO_WINDOW)
        t0 = last = time.time()
        try:
            while True:
                try:
                    p.wait(timeout=1.0)
                    break
                except subprocess.TimeoutExpired:
                    pass
                now = time.time()
                if now - t0 > timeout:
                    raise JobError("ffmpeg took over %d seconds making the %s." % (timeout, what))
                if beat and now - last >= beat_every:
                    last = now
                    beat()
        finally:
            if p.poll() is None:
                p.kill()
                p.wait()
    if p.returncode != 0:
        with open(log_path, "rb") as fh:
            err = fh.read().decode("utf-8", "replace").strip()
        if log:
            log("ffmpeg (%s) failed, exit %d:\n%s" % (what, p.returncode, err[-4000:]))
        raise JobError("ffmpeg couldn't make the %s: %s" % (what, err[-ERR_TAIL:] or "exit code %d" % p.returncode))


# ---------------------------------------------------------------- PC file
_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {"COM%d" % i for i in range(1, 10)} | {"LPT%d" % i for i in range(1, 10)}


def safe_title(title, limit=80):
    """A Windows-safe file name part: no <>:"/\\|?* or control characters, no trailing dot/space, <= limit."""
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(title or ""))
    s = re.sub(r"\s+", " ", s).strip()[:limit].rstrip(" .")
    if not s:
        s = "Reel"
    if s.split(".")[0].upper() in _RESERVED:
        s = "Reel " + s
    return s


def _same(a, b):
    return bool(a and b) and os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def inside(path, folder):
    """True if `path` is a file somewhere under `folder`."""
    try:
        p, f = os.path.normcase(os.path.abspath(path)), os.path.normcase(os.path.abspath(folder))
        return os.path.commonpath([p, f]) == f and p != f
    except ValueError:  # another drive
        return False


def pc_path(folder, title, day=None, reuse=None):
    """<folder>\\<YYYY-MM-DD> <title>.mp4, with " (2)", " (3)" ... if that name is taken. `reuse` = this
    reel's previous video: a name it already holds is used again (the new video replaces it)."""
    day = day or datetime.date.today()
    base = "%s %s" % (day.isoformat(), safe_title(title))
    path, n = os.path.join(folder, base + ".mp4"), 2
    while os.path.exists(path) and not _same(path, reuse):
        path, n = os.path.join(folder, "%s (%d).mp4" % (base, n)), n + 1
    return path


def copy_to_pc(src, dest):
    """Copy via <dest>.part, then rename: OneDrive never syncs a half-written video."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    try:
        shutil.copyfile(src, part)
        os.replace(part, dest)
    except OSError:
        try:
            os.remove(part)
        except OSError:
            pass
        raise


def caption_font(log=print):
    """worker/fonts/Poppins-Bold.ttf (fetched once), else Poppins SemiBold; None = libass picks a system font."""
    dest = os.path.join(fonts.FONTS_DIR, CAPTION_FONT)
    if not os.path.exists(dest):
        try:
            os.makedirs(fonts.FONTS_DIR, exist_ok=True)
            fonts._download(fonts.file_url("poppins", CAPTION_FONT), dest, timeout=30)
        except Exception as e:
            log("caption font download failed (%s); using Poppins SemiBold" % e)
            try:
                return fonts.font_file("poppins", 600)
            except Exception:
                return None
    return dest


# ---------------------------------------------------------------- the step
def render_reel(runner, reel, scenes):
    from reels import BUCKET, _redo_voice, is_http_4xx  # here: reels imports this module lazily
    ffmpeg = timing.ffmpeg_exe()
    words = reel.get("words") or []
    if not reel.get("voice_path") or not words:
        raise _redo_voice("The voice is missing. Press Retry to make it again.")
    shown = [s for s in scenes if s.get("status") == "done" and s.get("photo_path")]
    if not shown:
        raise JobError("Every image was skipped.")
    version = int(reel["version"])
    beat = lambda: runner._heartbeat(reel)  # noqa: E731  (raises StaleReel if the reel moved on)
    work = tempfile.mkdtemp(prefix="reel-render-")
    t0 = time.time()
    try:
        def fetch(path, missing):
            try:
                return runner._retry(lambda: runner.supa.download(BUCKET, path))
            except SupaError as e:
                if is_http_4xx(e):
                    raise missing
                raise JobError(NO_NET)

        with open(os.path.join(work, "voice.wav"), "wb") as fh:
            fh.write(fetch(reel["voice_path"], _redo_voice("The voice file is missing. Press Retry to make it again.")))
        total = timing.wav_duration(os.path.join(work, "voice.wav"))
        timeline = scene_timeline(scenes, total)
        items = []
        for k, (s, secs) in enumerate(timeline):
            name = "img_%02d.jpg" % k
            with open(os.path.join(work, name), "wb") as fh:
                fh.write(fetch(s["photo_path"], JobError("Picture %s is missing from storage. Redo that picture." % s.get("position"))))
            items.append({"image": name, "duration": secs})
        beat()

        with open(os.path.join(work, "captions.ass"), "w", encoding="utf-8") as fh:
            fh.write(ass_captions(words))
        font = caption_font(runner.log)
        fontsdir = None
        if font:
            os.makedirs(os.path.join(work, "fonts"))
            shutil.copyfile(font, os.path.join(work, "fonts", os.path.basename(font)))
            fontsdir = "fonts"

        runner.log("reel render: %d pictures, %.1f s of voice" % (len(items), total))
        args = ffmpeg_args(ffmpeg, items, "voice.wav", "captions.ass", "full.mp4", fontsdir=fontsdir)
        args = use_filter_script(args, os.path.join(work, "graph.txt"))
        run_ffmpeg(args, work, RENDER_TIMEOUT, "video", beat, log=runner.log)
        full = os.path.join(work, "full.mp4")
        duration = probe_duration(ffmpeg, full)

        preview = os.path.join(work, "preview.mp4")
        run_ffmpeg(preview_args(ffmpeg, full, preview, PREVIEW_MB, duration), work, PREVIEW_TIMEOUT, "preview", beat,
                   log=runner.log)
        if os.path.getsize(preview) > PREVIEW_CAP_MB * 1024 * 1024:
            run_ffmpeg(preview_args(ffmpeg, full, preview, PREVIEW_RETRY_MB, duration), work, PREVIEW_TIMEOUT, "preview", beat,
                       log=runner.log)
            if os.path.getsize(preview) > PREVIEW_CAP_MB * 1024 * 1024:
                raise JobError("The preview came out over %d MB. Press Retry." % PREVIEW_CAP_MB)
        beat()

        reels_dir = os.path.join(getattr(runner, "output_root", None) or default_output_root(), "Reels")
        old_pc = reel.get("pc_path")
        dest = pc_path(reels_dir, reel.get("title"), reuse=old_pc)
        try:
            copy_to_pc(full, dest)
        except OSError as e:
            raise JobError("Couldn't save the video on your PC (%s)." % (e.strerror or e))
        with open(preview, "rb") as fh:
            data = fh.read()
        path = "%s/preview-v%d.mp4" % (reel["id"], version)
        def upload():
            beat()  # before every try: slow retries must not let the claim go stale
            return runner.supa.upload(BUCKET, path, data, "video/mp4", timeout=UPLOAD_TIMEOUT)
        try:
            runner._net(upload)
        except Exception:
            if not _same(dest, old_pc):
                _remove_file(dest)
            raise
        saved = runner._save_reel(reel, {
            "status": "ready", "preview_path": path, "pc_path": dest, "duration_s": round(duration, 2),
            "error": None, "claimed_at": None, "finished_at": _now_iso()})
        if not saved:
            if not _same(dest, old_pc):
                _remove_file(dest)  # the reel was redone meanwhile: this video is not the one wanted
            runner._drop_stale([path])
            return
        runner.log("reel ready in %.0f s: %s (%.1f s, preview %.1f MB)" % (
            time.time() - t0, dest, duration, len(data) / 1048576.0))
        remove_old_previews(runner, reel["id"], keep=path)
        if old_pc and not _same(old_pc, dest) and inside(old_pc, reels_dir):
            _remove_file(old_pc)  # this reel's superseded video (only ever inside the Reels folder)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def remove_old_previews(runner, reel_id, keep):
    """Best effort: earlier previews of this reel (a re-render clears preview_path without deleting the file)."""
    try:
        from reels import BUCKET
        rows = runner.supa.list(BUCKET, str(reel_id)) or []
        old = ["%s/%s" % (reel_id, r["name"]) for r in rows
               if r.get("id") and re.match(r"preview-v\d+\.mp4$", r.get("name") or "")]
        old = [p for p in old if p != keep]
        if old:
            runner._remove(old)
    except Exception as e:
        runner.log("could not tidy old previews: %s" % e)


def _remove_file(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
