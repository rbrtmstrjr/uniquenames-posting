# Reel steps on the PC: voice (Chatterbox in ComfyUI) -> timing (faster-whisper) -> one image per scene
# (Z-Image in ComfyUI) -> render (reel_render.py, Task 7). One step per claim_next_reel_step() claim.
# Contract (supabase/migrations/005_reels.sql): save each result version-guarded AND clear the claim;
# re-touch reels.claimed_at between long sub-steps; on an image's 3rd failure the reel needs attention.
import datetime
import io
import os
import re
import tempfile
import time
import traceback

from render import JobError, fit_to_size
from supa import SupaError
import timing
import voice

BUCKET = "reels"
IMAGE_W, IMAGE_H = 1088, 1920   # Z-Image latent (multiple of 16) ...
OUT_W, OUT_H = 1080, 1920       # ... fitted to the video frame
IMAGE_TRIES = 3
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
NO_NET = "Couldn't reach the internet to save this reel. Press Retry."
NO_RENDER = "Video step not built yet"
STALE = "stale reel result dropped (the reel changed while it was being made)"
SCENE_COLS = "id,position,narration,image_prompt,seed,status,photo_path,version,attempts"


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


def _match(row):
    return "id=eq.%s&version=eq.%d" % (row["id"], int(row["version"]))


class ReelRunner:
    def __init__(self, supa, renderer, log=print, sleep=time.sleep):
        self.supa = supa
        self.renderer = renderer          # ComfyRenderer: .comfy, .timeout, .health(), .generate_photo()
        self.log = log
        self.sleep = sleep

    # ------------------------------------------------------------ dispatch
    def run_step(self, job):
        step, reel, scene = job.get("step"), job.get("reel") or {}, job.get("scene")
        try:
            if step == "voice":
                self._voice(reel)
            elif step == "timing":
                self._timing(reel)
            elif step == "image":
                self._image(reel, scene)
            elif step == "render":
                self._render(reel)
            else:
                raise JobError("Unknown reel step: %s" % step)
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

    # ------------------------------------------------------------ voice
    def _voice(self, reel):
        voice.ensure_node(self.renderer.comfy)  # a clear "restart ComfyUI" before any work
        scenes = self._scenes(reel)
        lines = [s["narration"] for s in scenes if (s.get("narration") or "").strip()]
        if not lines:
            raise JobError("This reel has no narration to voice.")
        ref = self._voice_ref()
        chunks = voice.chunk_lines(lines)
        wavs = []
        for i, text in enumerate(chunks):
            self.log("reel voice %d/%d (%d words)" % (i + 1, len(chunks), len(text.split())))
            self._heartbeat(reel)
            wavs.append(voice.synthesize(self.renderer.comfy, text, voice_seed(reel["id"]), ref, self.renderer.timeout))
        wav = voice.concat_wavs(wavs)
        path = "%s/voice-v%d.wav" % (reel["id"], int(reel["version"]))
        self._net(lambda: self.supa.upload(BUCKET, path, wav, "audio/wav"))
        if not self._save_reel(reel, {"voice_path": path, "words": None, "error": None, "claimed_at": None}):
            self._drop_stale([path])
            return
        if reel.get("voice_path") and reel["voice_path"] != path:
            self._remove([reel["voice_path"]])

    def _voice_ref(self):
        rows = self._net(lambda: self.supa.select("settings", "id=eq.1&select=*")) or [{}]
        path = (rows[0] or {}).get("reel_voice_path")
        if not path:
            return None  # Chatterbox's built-in voice
        try:
            data = self._retry(lambda: self.supa.download(BUCKET, path))
        except SupaError as e:
            if is_http_4xx(e):
                raise JobError("Your voice clip is missing from storage. Choose it again in Settings.")
            raise JobError(NO_NET)
        return voice.upload_input(self.renderer.comfy, "reel-voice" + (os.path.splitext(path)[1] or ".wav"), data)

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

    # ------------------------------------------------------------ one image
    def _image(self, reel, scene):
        if not self.renderer.health()["ok"]:
            raise JobError(COMFY_CLOSED)
        photo = self.renderer.generate_photo(scene["image_prompt"], int(scene["seed"]), IMAGE_W, IMAGE_H)
        data = to_jpeg(fit_to_size(photo, OUT_W, OUT_H), 92)
        path = "%s/scenes/%02d-v%d.jpg" % (reel["id"], int(scene["position"]), int(scene["version"]))
        self._net(lambda: self.supa.upload(BUCKET, path, data))
        body = {"status": "done", "photo_path": path, "error": None, "claimed_at": None}
        rows = self._retry(lambda: self.supa.update("reel_scenes", _match(scene), body, returning=True))
        if not rows:
            self._drop_stale([path])
        elif scene.get("photo_path") and scene["photo_path"] != path:
            self._remove([scene["photo_path"]])
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
        try:
            self.supa.update("reels", _match(reel), {"claimed_at": now_iso()})
        except Exception as e:
            self.log("reel heartbeat failed: %s" % e)

    def _fail_reel(self, reel, e, extra=None):
        if not reel.get("id"):
            return
        body = {"status": "failed", "error": self._message(e)[:300], "claimed_at": None, "finished_at": now_iso()}
        body.update(extra or {})
        rows = self._retry(lambda: self.supa.update("reels", _match(reel), body, returning=True))
        if rows and "voice_path" in body and body["voice_path"] is None and reel.get("voice_path"):
            self._remove([reel["voice_path"]])  # the voice will be made again

    @staticmethod
    def _message(e):
        return str(e) if isinstance(e, JobError) else "Something went wrong on your PC: %s" % (str(e) or type(e).__name__)

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


def _redo_voice(message):
    """A failure that also clears the voice, so Retry makes it again."""
    e = JobError(message)
    e.reel_patch = {"voice_path": None, "words": None}
    return e
