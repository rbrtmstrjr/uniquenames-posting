# The reel's video on the PC (playbook v2). The frames are drawn in Python (reel_frames: sub-pixel push-in /
# pull-out / hold moves, punch-ins on the stressed words, hard cuts and a dissolve only into time_jump scenes, the
# hook card and the word captions) and piped into ffmpeg; the sound is built first (reel_audio: voice, ducked
# music bed, generated SFX, loudness master -14 LUFS). ffmpeg comes from imageio-ffmpeg. Nothing here needs ComfyUI.
#   full MP4 (1080x1920)  -> Pictures\Unique Names\Reels\<date> <title>.mp4  (written as .part, then renamed)
#   preview MP4 (720x1280) -> storage reels/<id>/preview-v<version>.mp4     (<= ~15 MB, 45 MB hard cap)
# Reads 008's columns (reels.hook_text; reel_scenes.punch, time_jump, motion 'hold') when they are there; a database
# without 008 renders with no hook card and no punch-ins.
import datetime
import os
import re
import shutil
import subprocess
import tempfile
import time

from PIL import Image

from render import JobError, default_output_root
from supa import SupaError
import fonts
import music as music_mod
import reel_audio
import reel_frames
import timing

FPS = reel_frames.FPS
WIDTH, HEIGHT = reel_frames.WIDTH, reel_frames.HEIGHT
MIN_SCENE_S = 0.8              # a picture is never on screen for less than this
RENDER_TIMEOUT = 900
AUDIO_TIMEOUT = 300
PREVIEW_TIMEOUT = 300
HEARTBEAT_S = 60
PREVIEW_MB = 15
PREVIEW_RETRY_MB = 8
PREVIEW_CAP_MB = 45
PREVIEW_MAX_K = 2500           # a short reel doesn't need more than this at 720p
UPLOAD_TIMEOUT = 600
ERR_TAIL = 240                 # stderr chars kept in the message (reels.error holds 600)
NO_NET = "Couldn't reach the internet to save this reel. Press Retry."
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


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


frame_counts = reel_frames.frame_counts


def video_args(ffmpeg, audio, out_path, width=WIDTH, height=HEIGHT, fps=FPS):
    """Raw RGB frames on stdin + the finished sound -> H.264 + AAC."""
    return [ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (width, height), "-r", str(fps), "-i", "pipe:0",
            "-i", audio, "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", "8M", "-bufsize", "16M",
            "-pix_fmt", "yuv420p", "-r", str(fps),
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", out_path]


def pipe_ffmpeg(args, cwd, frames, timeout, what, beat=None, beat_every=HEARTBEAT_S, log=None):
    """Run ffmpeg in `cwd` feeding it `frames` (bytes, in order) on stdin, with the same timeout / heartbeat /
    error handling as run_ffmpeg. An error while making a frame stops ffmpeg and is raised as is."""
    log_path = os.path.join(cwd, "ffmpeg-%s.log" % re.sub(r"\W+", "-", what))
    with open(log_path, "wb") as errf:
        p = subprocess.Popen(args, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errf,
                             creationflags=_NO_WINDOW)
        t0 = last = time.time()

        def tick():
            nonlocal last
            now = time.time()
            if now - t0 > timeout:
                raise JobError("ffmpeg took over %d seconds making the %s." % (timeout, what))
            if beat and now - last >= beat_every:
                last = now
                beat()

        try:
            try:
                for buf in frames:
                    tick()
                    try:
                        p.stdin.write(buf)
                    except OSError:      # ffmpeg stopped reading: its exit code says why
                        break
            finally:
                close = getattr(frames, "close", None)
                if close:
                    close()
            try:
                p.stdin.close()
            except OSError:
                pass
            while True:
                try:
                    p.wait(timeout=1.0)
                    break
                except subprocess.TimeoutExpired:
                    tick()
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
            items.append(scene_item(s, name, secs))
        bed, volume = fetch_music(runner, reel, work, BUCKET, is_http_4xx)
        if bed and items:
            # the music rings out after the last word: hold the last picture (its move goes on) for the bed's extra time
            items[-1]["duration"] += music_mod.EXTRA_SECONDS
        beat()

        shots = reel_frames.build_shots(items, words, FPS)
        video_s = (shots[-1]["f0"] + shots[-1]["n"]) / float(FPS)
        hook_text = reel.get("hook_text")  # 008; missing column or null = no hook card
        has_hook = bool(reel_frames.hook_words(hook_text))
        punches = reel_frames.punch_times(shots)
        runner.log("reel render: %d pictures, %.1f s of voice%s, %d punch-ins, %d dissolves%s" % (
            len(items), total, ", music at %d%%" % round(volume * 100) if bed else "", len(punches),
            sum(1 for s in shots if s["dissolve"]), ", hook card" if has_hook else ""))
        reel_audio.make_audio(ffmpeg, work, "voice.wav", video_s, reel_audio.sfx_events(has_hook, punches, total),
                              lambda args, what: run_ffmpeg(args, work, AUDIO_TIMEOUT, what, beat, log=runner.log),
                              music=bed, volume=volume or reel_audio.MUSIC_DEFAULT_VOLUME, log=runner.log)
        beat()

        font, weight = caption_font(runner.log)
        captions = reel_frames.Captions(words, font, weight)
        hook = reel_frames.Hook(hook_text, font, weight, first_picture=first_picture(work, items, has_hook))
        frames = reel_frames.frames(shots, lambda shot: open_picture(work, shot, items), captions, hook, FPS)
        pipe_ffmpeg(video_args(ffmpeg, "audio.wav", "full.mp4"), work, frames, RENDER_TIMEOUT, "video", beat,
                    log=runner.log)
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


def caption_font(log=print):
    """(path, weight) for the captions and hook card. A worker started before this code still holds the old fonts
    module (reel_render is imported on the first render), so the Montserrat lookup is done here if it lacks the helper."""
    pick = getattr(fonts, "reel_caption_font", None)
    if pick:
        return pick(log)
    try:
        return fonts.font_file("montserrat", 800), 800
    except Exception as e:
        log("caption font unavailable (%s); using the built-in font" % e)
        return None, 800


def first_picture(work, items, has_hook):
    """The opening picture at frame size (the hook card picks its band on it); None if unneeded or unreadable
    (the broken picture is reported by the frames)."""
    if not has_hook or not items:
        return None
    try:
        with Image.open(os.path.join(work, items[0]["image"])) as im:
            return im.convert("RGB").resize((WIDTH, HEIGHT), Image.BILINEAR)
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def scene_item(scene, image, seconds):
    """What the frames need from a scene row (008's punch / time_jump read defensively: absent = none)."""
    punch = scene.get("punch")
    return {"image": image, "duration": seconds, "motion": scene.get("motion"),
            "punch": punch.strip() if isinstance(punch, str) and punch.strip() else None,
            "time_jump": scene.get("time_jump") is True, "start_s": scene.get("start_s"), "end_s": scene.get("end_s"),
            "position": scene.get("position")}


def open_picture(work, shot, items):
    """The shot's picture, ready for sub-pixel cutting; a file that isn't a picture is a clear redo message."""
    try:
        return reel_frames.load_source(os.path.join(work, shot["image"]))
    except (OSError, ValueError, Image.DecompressionBombError):
        pos = items[shot["index"]].get("position")
        raise JobError("Picture %s couldn't be opened. Redo that picture." % (pos if pos is not None else shot["index"] + 1))


def music_choice(settings, reel):
    """(music_path, volume 0..1) when the bed goes under the voice: settings.reel_music on and the reel has a
    bed (006; '' = its music step failed); else (None, 0)."""
    settings = settings or {}
    path = (reel or {}).get("music_path")
    if not path or not settings.get("reel_music", False):
        return None, 0.0
    return path, music_mod.clamp_volume(settings.get("reel_music_volume", 18)) / 100.0


def fetch_music(runner, reel, work, bucket, is_http_4xx):
    """('music.flac' in `work`, volume) or (None, 0). A bed missing from storage only means no music."""
    rows = runner._net(lambda: runner.supa.select("settings", "id=eq.1&select=*")) or [{}]
    path, volume = music_choice(rows[0] if rows else {}, reel)
    if not path:
        return None, 0.0
    try:
        data = runner._retry(lambda: runner.supa.download(bucket, path))
    except SupaError as e:
        if is_http_4xx(e):
            runner.log("the music file is missing from storage: rendering with the voice only")
            return None, 0.0
        raise JobError(NO_NET)
    with open(os.path.join(work, "music.flac"), "wb") as fh:
        fh.write(data)
    return "music.flac", volume


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
