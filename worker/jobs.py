# The worker's job loop: claim one card at a time from Supabase, make it with
# ComfyUI + Pillow, upload it, keep a backup copy on the PC, and heartbeat.
import datetime
import io
import os
import threading
import time
import traceback

from PIL import Image

from render import JobError, slugify
from supa import SupaError

VERSION = "2.0.0"
BUCKET = "cards"
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def to_jpeg(img, quality):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


class Runner:
    def __init__(self, supa, renderer, output_root, cache_dir, poll_seconds=3.0, heartbeat_seconds=15.0, log=print):
        self.supa = supa
        self.renderer = renderer
        self.output_root = output_root
        self.cache_dir = cache_dir
        self.poll_seconds = poll_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.log = log
        self.current = None
        self.stop_event = threading.Event()

    # ------------------------------------------------------------ heartbeat
    def heartbeat_once(self):
        h = self.renderer.health()
        self.supa.update("worker_status", "id=eq.1", {
            "last_seen": now_iso(), "comfyui_ok": bool(h["ok"]), "gpu": h.get("gpu"),
            "current_card_id": self.current, "worker_version": VERSION, "message": h.get("error"),
        })

    def _heartbeat_loop(self):
        while not self.stop_event.is_set():
            try:
                self.heartbeat_once()
            except Exception as e:
                self.log("heartbeat failed: %s" % e)
            self.stop_event.wait(self.heartbeat_seconds)

    # ------------------------------------------------------------ one job
    def tick(self):
        self.supa.rpc("requeue_stuck_cards")
        job = self.supa.rpc("claim_next_card")
        if not job:
            return False
        card = job["card"]
        self.current = card["id"]
        self.log("%s: %s (%s)" % (job["job"], card["name"], card["id"]))
        try:
            settings = self._settings()
            if job["job"] == "restamp" and card.get("photo_path"):
                self._restamp(job, settings)
            else:
                self._generate(job, settings)
        except Exception as e:
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            self._fail(card, e)
        finally:
            self.current = None
        return True

    def _settings(self):
        rows = self.supa.select("settings", "id=eq.1&select=handle,width,height")
        if not rows:
            raise JobError("The settings row is missing. Run supabase/schema.sql again.")
        return rows[0]

    def _generate(self, job, s):
        card = job["card"]
        if not self.renderer.health()["ok"]:
            raise JobError(COMFY_CLOSED)
        photo = self.renderer.generate_photo(card["prompt"], int(card["seed"]), int(s["width"]), int(s["height"]))
        photo_bytes = to_jpeg(photo, 92)
        card_bytes = to_jpeg(self.renderer.compose(photo, card["name"], card["meaning"], s["handle"]), 93)
        v = int(card["version"])
        photo_path = "photos/%s/v%d.jpg" % (card["id"], v)
        card_path = "cards/%s/v%d.jpg" % (card["id"], v)
        self.supa.upload(BUCKET, photo_path, photo_bytes)
        self.supa.upload(BUCKET, card_path, card_bytes)
        self._cache_put(photo_path, photo_bytes)
        self._finish(card, {"photo_path": photo_path, "card_path": card_path})
        self._cleanup(card, keep={photo_path, card_path})
        self._backup(job, card_bytes)

    def _restamp(self, job, s):
        card = job["card"]
        photo = Image.open(io.BytesIO(self._load_photo(card["photo_path"]))).convert("RGB")
        card_bytes = to_jpeg(self.renderer.compose(photo, card["name"], card["meaning"], s["handle"]), 93)
        card_path = "cards/%s/v%d.jpg" % (card["id"], int(card["version"]))
        self.supa.upload(BUCKET, card_path, card_bytes)
        self._finish(card, {"card_path": card_path})
        self._cleanup(card, keep={card["photo_path"], card_path})
        self._backup(job, card_bytes)

    # ------------------------------------------------------------ results
    def _match(self, card):
        # The version guard: if the owner pressed Regenerate or edited the text
        # meanwhile, the version moved on and this stale result is dropped.
        return "id=eq.%s&version=eq.%d" % (card["id"], int(card["version"]))

    def _finish(self, card, values):
        body = dict(values, status="done", finished_at=now_iso(), claimed_at=None, error=None)
        self._retry(lambda: self.supa.update("cards", self._match(card), body))

    def _fail(self, card, e):
        msg = str(e) if isinstance(e, JobError) else "Something went wrong on your PC: %s" % (str(e) or type(e).__name__)
        body = {"status": "failed", "error": msg[:300], "claimed_at": None, "finished_at": now_iso()}
        try:
            self._retry(lambda: self.supa.update("cards", self._match(card), body))
        except Exception as e2:
            self.log("could not mark the card failed: %s" % e2)

    def _retry(self, fn, tries=5):
        delay = 1.0
        for i in range(tries):
            try:
                return fn()
            except SupaError:
                if i == tries - 1:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 15)

    def _cleanup(self, card, keep):
        old = [p for p in (card.get("photo_path"), card.get("card_path")) if p and p not in keep]
        if not old:
            return
        try:
            self.supa.remove(BUCKET, old)
        except Exception as e:
            self.log("could not remove old files: %s" % e)
        for p in old:
            try:
                os.remove(self._cache_file(p))
            except OSError:
                pass

    # ------------------------------------------------------------ local files
    def _cache_file(self, path):
        return os.path.join(self.cache_dir, path.replace("/", "_"))

    def _cache_put(self, path, data):
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
            with open(self._cache_file(path), "wb") as f:
                f.write(data)
        except OSError as e:
            self.log("cache write failed: %s" % e)

    def _load_photo(self, path):
        f = self._cache_file(path)
        if os.path.exists(f):
            with open(f, "rb") as fh:
                return fh.read()
        data = self.supa.download(BUCKET, path)
        self._cache_put(path, data)
        return data

    def _backup(self, job, data):
        card = job["card"]
        if card.get("kind") != "post" or not job.get("post_date") or not job.get("gender_label"):
            return
        try:
            folder = os.path.join(self.output_root, "%s %s" % (job["post_date"], job["gender_label"]))
            os.makedirs(folder, exist_ok=True)
            prefix = "%02d-" % int(card["position"])
            name = prefix + slugify(card["name"]) + ".jpg"
            for f in os.listdir(folder):
                if f.startswith(prefix) and f.endswith(".jpg") and f != name:
                    os.remove(os.path.join(folder, f))
            tmp = os.path.join(folder, name + ".part")
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, os.path.join(folder, name))
        except OSError as e:
            self.log("backup copy failed: %s" % e)

    # ------------------------------------------------------------ forever
    def run_forever(self):
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        backoff = self.poll_seconds
        while not self.stop_event.is_set():
            try:
                ran = self.tick()
                backoff = self.poll_seconds
                if not ran:
                    self.stop_event.wait(self.poll_seconds)
            except Exception as e:
                self.log("loop error (retrying in %ds): %s" % (backoff, e))
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)
