# Reel steps on the PC: voice (Chatterbox in ComfyUI, sped up with atempo) -> timing (faster-whisper) ->
# music (ACE-Step in ComfyUI, 006) -> one image per scene (Z-Image in ComfyUI) -> render (reel_render.py).
# One step per claim_next_reel_step() claim. Voice samples (006): one per claim_next_voice_sample() claim.
# Theme previews (007): one per claim_next_theme_preview() claim; grayscale themes (sketch) turn every picture grey,
# keep_red themes (012: Red Thread) keep only the red thread and turn the rest grey.
# Contract (supabase/migrations/005_reels.sql): save each result version-guarded AND clear the claim;
# re-touch reels.claimed_at between long sub-steps; on an image's 3rd failure the reel needs attention.
import datetime
import io
import os
import re
import tempfile
import threading
import time
import traceback
import urllib.parse
import wave

from render import JobError, fit_to_size
from supa import SupaError
import music
import themes
import timing
import voice

BUCKET = "reels"
IMAGE_W, IMAGE_H = 1088, 1920   # Z-Image latent (multiple of 16) ...
OUT_W, OUT_H = 1080, 1920       # ... fitted to the video frame
IMAGE_TRIES = 3
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
BAD_THEME = "This theme's id can't be used for a file name (only a-z and 0-9)."
NO_NET = "Couldn't reach the internet to save this reel. Press Retry."
NO_RENDER = "Video step not built yet"
STALE = "stale reel result dropped (the reel changed while it was being made)"
VOICE_ID = re.compile(r"^[a-z]+$")
# select=* (not a column list): 007 adds motion / key_moment, and naming a missing column would make PostgREST refuse
# the read on a database without 007.
SCENE_COLS = "*"


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def to_jpeg(img, quality):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def is_http_4xx(e):
    return re.search(r"HTTP 4\d\d", str(e)) is not None


def voice_seed(reel_id):
    """The same reel always gets the same delivery (Chatterbox seed)."""
    return int(str(reel_id).replace("-", "")[:8], 16)


class ThemeUnread(Exception):
    """The reel's theme (007) couldn't be read: the image waits instead of guessing its colours."""


class StaleReel(Exception):
    """The reel moved on (edited, redone or deleted) while a long step ran: stop quietly."""


def _match(row):
    return "id=eq.%s&version=eq.%d" % (row["id"], int(row["version"]))


class ReelRunner:
    def __init__(self, supa, renderer, log=print, sleep=time.sleep, output_root=None):
        self.supa = supa
        self.output_root = output_root    # full videos go to <output_root>/Reels (None = Pictures/Unique Names)
        self.renderer = renderer          # ComfyRenderer: .comfy, .timeout, .health(), .generate_photo()
        self.log = log
        self.sleep = sleep
        self._refs = {}                   # (ref_path, version) -> the clip's name in ComfyUI's input folder
        self._refs_lock = threading.Lock()

    # ------------------------------------------------------------ dispatch
    def run_step(self, job):
        step, reel, scene = job.get("step"), job.get("reel") or {}, job.get("scene")
        try:
            self._dispatch(step, reel, scene)
        except StaleReel:
            self.log(STALE)
        except Exception as e:
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            try:
                if step == "image" and scene:
                    self._image_failed(reel, scene, e)
                else:
                    self._fail_reel(reel, e, getattr(e, "reel_patch", None))
            except Exception as e2:
                self.log("could not save the reel failure: %s" % e2)

    def _dispatch(self, step, reel, scene):
        if step == "voice":
            self._voice(reel)
        elif step == "timing":
            self._timing(reel)
        elif step == "music":
            self._music(reel)
        elif step == "image":
            self._image(reel, scene)
        elif step == "render":
            self._render(reel)
        else:
            raise JobError("Unknown reel step: %s" % step)

    # ------------------------------------------------------------ voice
    def _voice(self, reel):
        voice.ensure_node(self.renderer.comfy)  # a clear "restart ComfyUI" before any work
        scenes = self._scenes(reel)
        lines = [s["narration"] for s in scenes if (s.get("narration") or "").strip()]
        if not lines:
            raise JobError("This reel has no narration to voice.")
        settings = self._settings_row()
        ref = self._voice_ref(reel, settings)
        speed = voice.reel_speed(settings)
        chunks = voice.chunk_lines(lines)
        wavs = []
        for i, text in enumerate(chunks):
            self.log("reel voice %d/%d (%d words)" % (i + 1, len(chunks), len(text.split())))
            self._heartbeat(reel)
            wavs.append(voice.tighten(voice.synthesize(self.renderer.comfy, text, voice_seed(reel["id"]), ref,
                                                       self.renderer.timeout)))
        # tightened chunks (no dead air, 0.10 s apart), then sped up
        wav = voice.speed_up(voice.concat_wavs(wavs), speed)  # Whisper (timing) then hears the sped-up track
        path = "%s/voice-v%d.wav" % (reel["id"], int(reel["version"]))
        self._net(lambda: self.supa.upload(BUCKET, path, wav, "audio/wav"))
        if not self._save_reel(reel, {"voice_path": path, "words": None, "error": None, "claimed_at": None}):
            self._drop_stale([path])
            return
        if reel.get("voice_path") and reel["voice_path"] != path:
            self._remove([reel["voice_path"]])

    def _settings_row(self):
        rows = self._net(lambda: self.supa.select("settings", "id=eq.1&select=*")) or [{}]
        return rows[0] or {}

    def _voice_ref(self, reel, settings):
        """The LoadAudio name of the narrator's reference clip, or None for Chatterbox's built-in voice.
        Voice: reels.voice_id -> settings.reel_voice_id -> builtin (006). A database without 006 keeps 005's
        single clip (settings.reel_voice_path)."""
        if "reel_voice_id" not in settings and not reel.get("voice_id"):
            path = settings.get("reel_voice_path")
            if not path:
                return None
            return self._comfy_ref(path, 0, "Your voice clip is missing from storage. Clear settings.reel_voice_path "
                                            "in Supabase to use the built-in voice.")
        vid = voice.resolve_voice_id(reel, settings)
        if vid == voice.BUILTIN:
            return None
        rows = []
        if VOICE_ID.match(vid):
            rows = self._net(lambda: self.supa.select("reel_voices", "id=eq.%s&select=id,label,ref_path,version" % vid)) or []
        if not rows or not rows[0].get("ref_path"):
            self.log("voice %s has no reference clip yet: using the built-in voice" % vid)
            return None
        row = rows[0]
        return self._comfy_ref(row["ref_path"], row.get("version") or 1,
                               "The %s voice clip is missing from storage. Press Set up voices in Settings, or pick "
                               "another voice." % (row.get("label") or vid))

    def _comfy_ref(self, path, version, missing):
        """Download a reference clip once and put it in ComfyUI's input folder (cached by path + version; sent
        again if ComfyUI lost the file). Returns the name LoadAudio takes."""
        key = (path, int(version or 0))
        with self._refs_lock:
            name = self._refs.get(key)
        if name and voice.input_exists(self.renderer.comfy, name):
            return name
        try:
            data = self._retry(lambda: self.supa.download(BUCKET, path))
        except SupaError as e:
            if is_http_4xx(e):
                raise JobError(missing)
            raise JobError(NO_NET)
        name = voice.upload_input(self.renderer.comfy, voice.input_name(path, version), data)
        with self._refs_lock:
            self._refs[key] = name
        try:
            gone = voice.prune_inputs(self.renderer.comfy, name)  # this clip's older versions in ComfyUI's input folder
            if gone:
                self.log("removed %d older voice clip(s) from ComfyUI's input folder" % gone)
        except Exception as e:
            self.log("could not tidy ComfyUI's input folder: %s" % e)
        return name

    # ------------------------------------------------------------ timing
    def _timing(self, reel):
        path = reel.get("voice_path")
        try:
            data = self._retry(lambda: self.supa.download(BUCKET, path))
        except SupaError as e:
            if is_http_4xx(e):
                raise _redo_voice("The voice file is missing. Press Retry to make it again.")
            raise JobError(NO_NET)
        fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="reel-voice-")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            words = timing.transcribe(tmp)
            duration = timing.wav_duration(tmp)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        if not words:
            raise _redo_voice("No words could be heard in the voice. Press Retry to make it again.")
        scenes = self._scenes(reel)
        times = timing.assign_lines(words, [s["narration"] for s in scenes], duration)
        # Narration can't change after approval, so a scene's times are written by id (a redo of the
        # scene's picture bumps its version but keeps its line). The reel's words go last: they move
        # the reel on to the images.
        for s, (start, end) in zip(scenes, times):
            self._net(lambda: self.supa.update("reel_scenes", "id=eq.%s" % s["id"], {"start_s": start, "end_s": end}))
        if not self._save_reel(reel, {"words": words, "error": None, "claimed_at": None}):
            self.log(STALE)

    # ------------------------------------------------------------ music (006)
    def _music(self, reel):
        """One ACE-Step bed, voice length + 8 s (the render keeps voice + 2 s). Any failure leaves music_path '' (the reel goes on with the
        voice only and the step is not retried); ComfyUI being closed just hands the step back."""
        if not self.renderer.health()["ok"]:
            self.log("ComfyUI is closed: the music waits")
            self._release(reel)
            return
        path = "%s/music-v%d.flac" % (reel["id"], int(reel["version"]))
        try:
            data = self._retry(lambda: self.supa.download(BUCKET, reel.get("voice_path")))
            secs = music.music_seconds(voice_seconds(data))
            seed = music.random_seed()
            self.log("reel music: %.1f s bed (seed %d)" % (secs, seed))
            self._heartbeat(reel)
            flac = music.make_bed(self.renderer.comfy, secs, seed, self.renderer.timeout, lambda: self._heartbeat(reel))
            self._heartbeat(reel)
            self._retry(lambda: self.supa.upload(BUCKET, path, flac, "audio/flac"))
        except StaleReel:
            raise
        except Exception as e:
            if not self.renderer.health()["ok"]:
                self.log("ComfyUI closed while making the music: it waits")
                self._release(reel)
                return
            if isinstance(e, SupaError) and not is_http_4xx(e):
                # the internet, not the music: hand the step back and make the bed again later
                self.log("reel music: no internet (%s), trying again later" % str(e)[:160])
                try:
                    self._release(reel)
                except Exception as e2:
                    self.log("could not release the reel: %s" % e2)  # requeue_stuck_reels frees it in 10 minutes
                return
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            self.log("reel music failed, the reel goes on with the voice only: %s" % e)
            try:
                self._save_reel(reel, {"music_path": "", "claimed_at": None})
            except Exception as e2:
                self.log("could not save the music failure: %s" % e2)
            return
        if not self._save_reel(reel, {"music_path": path, "claimed_at": None}):
            self._drop_stale([path])
            return
        self._tidy(str(reel["id"]), r"music-v\d+\.flac$", path)

    # ------------------------------------------------------------ voice samples (006)
    def run_sample(self, job):
        """Read the sample sentence with one voice at the current calm + speed settings (claim_next_voice_sample)."""
        row = (job or {}).get("voice") or {}
        vid = str(row.get("id") or "")
        if not VOICE_ID.match(vid):
            self.log("voice sample skipped: bad voice id %r" % vid)
            return
        version = int(row.get("version") or 0)
        match = "id=eq.%s&version=eq.%d" % (vid, version)
        path = "voices/%s/sample-v%d.wav" % (vid, version)
        try:
            voice.ensure_node(self.renderer.comfy)
            speed = voice.reel_speed(self._settings_row())
            ref = None
            if vid != voice.BUILTIN:
                if not row.get("ref_path"):
                    raise JobError("This voice has no reference clip yet. Press Set up voices.")
                ref = self._comfy_ref(row["ref_path"], version, "The reference clip is missing from storage. Press Set up voices.")
            wav = voice.synthesize(self.renderer.comfy, voice.SAMPLE_TEXT, voice.SAMPLE_SEED, ref, self.renderer.timeout)
            wav = voice.speed_up(voice.tighten(wav), speed)
            self._net(lambda: self.supa.upload(BUCKET, path, wav, "audio/wav"))
        except Exception as e:
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            try:
                if not self.renderer.health()["ok"]:
                    self.log("ComfyUI is closed: the %s sample goes back in line" % vid)
                    body = {"sample_status": "queued", "claimed_at": None}
                else:
                    self.log("voice sample %s failed: %s" % (vid, e))
                    body = {"sample_status": "failed", "error": self._message(e)[:300], "claimed_at": None}
                self._retry(lambda: self.supa.update("reel_voices", match, body))
            except Exception as e2:
                self.log("could not save the sample failure: %s" % e2)
            return
        body = {"sample_status": "ready", "sample_path": path, "sample_key": voice.sample_key(speed), "error": None,
                "claimed_at": None}
        if not self._retry(lambda: self.supa.update("reel_voices", match, body, returning=True)):
            self._drop_stale([path])  # re-queued meanwhile (new version): this sample is not the one wanted
            return
        self._tidy("voices/%s" % vid, r"sample-v\d+\.wav$", path)

    # ------------------------------------------------------------ theme previews (007)
    def run_theme_preview(self, job):
        """One theme's preview picture (claim_next_theme_preview): Z-Image with the theme's style + the fixed
        moment, grey for grayscale themes, saved only if the row's version still matches."""
        row = (job or {}).get("theme") or {}
        tid = str(row.get("id") or "")
        if not themes.THEME_ID.match(tid):
            self.log("theme preview failed: bad theme id %r" % tid)
            if tid:
                bad = "id=eq.%s&version=eq.%d" % (urllib.parse.quote(tid, safe=""), int(row.get("version") or 0))
                try:
                    self._retry(lambda: self.supa.update("reel_themes", bad, {
                        "preview_status": "failed", "error": BAD_THEME, "claimed_at": None}))
                except Exception as e:
                    self.log("could not save the preview failure: %s" % e)
            return
        version = int(row.get("version") or 0)
        match = "id=eq.%s&version=eq.%d" % (tid, version)
        path = themes.preview_path(tid, version)
        try:
            if not self.renderer.health()["ok"]:
                raise JobError(COMFY_CLOSED)
            if not str(row.get("style") or "").strip():
                raise JobError("This theme has no style text.")
            photo = self.renderer.generate_photo(themes.preview_prompt(row), themes.PREVIEW_SEED, IMAGE_W, IMAGE_H)
            photo = themes.apply_colour(photo, themes.colour_mode(row))
            data = to_jpeg(fit_to_size(photo, OUT_W, OUT_H), 90)
            self._net(lambda: self.supa.upload(BUCKET, path, data))
        except Exception as e:
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            try:
                if not self.renderer.health()["ok"]:
                    self.log("ComfyUI is closed: the %s preview goes back in line" % tid)
                    body = {"preview_status": "queued", "claimed_at": None}
                else:
                    self.log("theme preview %s failed: %s" % (tid, e))
                    body = {"preview_status": "failed", "error": self._message(e)[:300], "claimed_at": None}
                self._retry(lambda: self.supa.update("reel_themes", match, body))
            except Exception as e2:
                self.log("could not save the preview failure: %s" % e2)
            return
        body = {"preview_status": "ready", "preview_path": path, "error": None, "claimed_at": None}
        if not self._retry(lambda: self.supa.update("reel_themes", match, body, returning=True)):
            self._drop_stale([path])  # re-queued meanwhile (new version): this preview is not the one wanted
            return
        self._tidy("themes/%s" % tid, r"preview-v\d+\.jpg$", path)

    def _colour_mode(self, reel):
        """What the reel's theme (reels.theme_id, null = knitted; see themes.theme_id_for) does to its pictures:
        "red" (012 keep_red: Red Thread), "gray" (sketch) or None; None on a database without 007. Raises ThemeUnread
        if the settings or the theme can't be read (the image goes back in line without using an attempt, rather than
        coming out in the wrong colours). select=* because keep_red is missing on a database before 012."""
        try:
            settings = self._settings_row()
        except Exception as e:
            raise ThemeUnread(e)
        tid = themes.theme_id_for(reel, settings)
        if not tid:
            return None
        try:
            rows = self._retry(lambda: self.supa.select("reel_themes", "id=eq.%s&select=*" % tid)) or []
        except Exception as e:
            raise ThemeUnread(e)
        return themes.colour_mode(rows[0] if rows else None)

    # ------------------------------------------------------------ one image
    def _image(self, reel, scene):
        try:
            if not self.renderer.health()["ok"]:
                raise JobError(COMFY_CLOSED)
            mode = self._colour_mode(reel)
            photo = self.renderer.generate_photo(scene["image_prompt"], int(scene["seed"]), IMAGE_W, IMAGE_H)
        except ThemeUnread as e:
            self._requeue_scene(reel, scene, "couldn't read the reel's theme (%s)" % str(e.args[0])[:160])
            return
        except JobError as e:
            if str(e) != COMFY_CLOSED:
                raise
            self._requeue_scene(reel, scene)  # not the picture's fault: no attempt used
            return
        photo = themes.apply_colour(photo, mode)
        data = to_jpeg(fit_to_size(photo, OUT_W, OUT_H), 92)
        path = "%s/scenes/%02d-v%d.jpg" % (reel["id"], int(scene["position"]), int(scene["version"]))
        self._net(lambda: self.supa.upload(BUCKET, path, data))
        body = {"status": "done", "photo_path": path, "error": None, "claimed_at": None}
        try:
            rows = self._retry(lambda: self.supa.update("reel_scenes", _match(scene), body, returning=True))
        except Exception:
            self._remove([path])  # not saved: don't leave an orphan in storage
            raise
        if not rows:
            self._drop_stale([path])
        elif scene.get("photo_path") and scene["photo_path"] != path:
            self._remove([scene["photo_path"]])
        self._release(reel)

    def _requeue_scene(self, reel, scene, why="ComfyUI is closed"):
        self.log("%s: image %s goes back in line" % (why, scene.get("position")))
        body = {"status": "queued", "attempts": max(0, int(scene.get("attempts") or 0) - 1), "error": None, "claimed_at": None}
        self._retry(lambda: self.supa.update("reel_scenes", _match(scene), body))
        self._release(reel)

    def _image_failed(self, reel, scene, e):
        msg = self._message(e)
        body = {"status": "failed", "error": msg[:300], "claimed_at": None}
        rows = self._retry(lambda: self.supa.update("reel_scenes", _match(scene), body, returning=True))
        if rows and int(scene.get("attempts") or 0) >= IMAGE_TRIES:
            err = "Image %d failed %d times: %s" % (int(scene["position"]), IMAGE_TRIES, msg)
            self._save_reel(reel, {"status": "needs_attention", "error": err[:300], "claimed_at": None})
        else:
            self._release(reel)

    # ------------------------------------------------------------ render (Task 7)
    def _render(self, reel):
        try:
            import reel_render
        except ImportError:
            reel_render = None
        if reel_render is None or not hasattr(reel_render, "render_reel"):
            raise JobError(NO_RENDER)
        reel_render.render_reel(self, reel, self._scenes(reel))

    # ------------------------------------------------------------ helpers
    def _scenes(self, reel):
        q = "reel_id=eq.%s&select=%s&order=position" % (reel["id"], SCENE_COLS)
        return self._net(lambda: self.supa.select("reel_scenes", q)) or []

    def _save_reel(self, reel, values):
        """True if the reel took the values; False if it moved on (version bumped or deleted)."""
        return bool(self._retry(lambda: self.supa.update("reels", _match(reel), values, returning=True)))

    def _release(self, reel):
        # 0 rows = the owner changed the reel meanwhile; their change already cleared the claim.
        self._retry(lambda: self.supa.update("reels", _match(reel), {"claimed_at": None}))

    def _heartbeat(self, reel):
        """Re-touch the claim; raises StaleReel if the reel moved on (its change already cleared the claim)."""
        try:
            rows = self.supa.update("reels", _match(reel), {"claimed_at": now_iso()}, returning=True)
        except Exception as e:
            self.log("reel heartbeat failed: %s" % e)
            return
        if not rows:
            raise StaleReel()

    def _fail_reel(self, reel, e, extra=None):
        if not reel.get("id"):
            return
        body = {"status": "failed", "error": self._message(e)[:600], "claimed_at": None, "finished_at": now_iso()}
        body.update(extra or {})
        redo = "voice_path" in body and body["voice_path"] is None
        if redo and "music_path" in reel:
            body["music_path"] = None  # a new voice gets a new bed (its length follows the voice); 006 only
        rows = self._retry(lambda: self.supa.update("reels", _match(reel), body, returning=True))
        if rows and redo:
            old = [p for p in (reel.get("voice_path"), reel.get("music_path")) if p]
            if old:
                self._remove(old)  # the voice (and its music) will be made again

    @staticmethod
    def _message(e):
        return str(e) if isinstance(e, JobError) else "Something went wrong on your PC: %s" % (str(e) or type(e).__name__)

    def _tidy(self, folder, pattern, keep):
        """Best effort: remove this folder's superseded files matching `pattern` (all but `keep`)."""
        try:
            rows = self.supa.list(BUCKET, folder) or []
            old = ["%s/%s" % (folder, r["name"]) for r in rows if r.get("id") and re.match(pattern, r.get("name") or "")]
            old = [p for p in old if p != keep]
            if old:
                self._remove(old)
        except Exception as e:
            self.log("could not tidy old files: %s" % e)

    def _drop_stale(self, paths):
        self.log(STALE)
        self._remove(paths)

    def _remove(self, paths):
        try:
            self.supa.remove(BUCKET, paths)
        except Exception as e:
            self.log("could not remove reel files: %s" % e)

    def _net(self, fn):
        try:
            return self._retry(fn)
        except SupaError as e:
            if is_http_4xx(e):
                raise JobError("Supabase refused this request: %s" % str(e)[:200])
            raise JobError(NO_NET)

    def _retry(self, fn, tries=5):
        delay = 1.0
        for i in range(tries):
            try:
                return fn()
            except SupaError as e:
                if i == tries - 1 or is_http_4xx(e):
                    raise
                self.sleep(delay)
                delay = min(delay * 2, 15)


def voice_seconds(wav_bytes):
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except (wave.Error, EOFError):
        raise JobError("The voice file could not be read.")


def _redo_voice(message):
    """A failure that also clears the voice, so Retry makes it again."""
    e = JobError(message)
    e.reel_patch = {"voice_path": None, "words": None}
    return e
