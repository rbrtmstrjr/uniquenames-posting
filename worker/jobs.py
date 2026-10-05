# The worker's job loop: claim one card at a time from Supabase, make it with
# ComfyUI + Pillow, upload it, keep a backup copy on the PC, and heartbeat.
import datetime
import io
import json
import os
import re
import threading
import time
import traceback
import urllib.parse

from PIL import Image

from render import JobError, slugify, text_style
from supa import SupaError

VERSION = "2.0.0"
BUCKET = "cards"
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
NO_NET_SAVE = "Couldn't reach the internet to save this card. Press Retry."
NO_NET_LOAD = "Couldn't reach the internet to load this card's photo. Press Retry."
NO_NET_SETTINGS = "Couldn't reach the internet to load your settings. Press Retry."
STALE = "stale result dropped (card changed while it was being made)"


REELS_RECHECK_SECONDS = 600
PREVIEW_DAYS = 14               # reel previews leave storage after this; the full video stays on the PC
PREVIEW_SWEEP_SECONDS = 86400   # once a day


def is_missing_function(e):
    """PostgREST's answer when an RPC does not exist (yet): HTTP 404 / PGRST202."""
    return "PGRST202" in str(e) or re.search(r"HTTP 404", str(e)) is not None


def _age_days(stamp, now):
    """Days since an ISO timestamp from Supabase Storage; 0 when it is missing or unreadable (kept)."""
    try:
        t = datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if t.tzinfo is None:
        t = t.replace(tzinfo=datetime.timezone.utc)
    return (now - t.timestamp()) / 86400.0


class PhotoMissing(Exception):
    """The clean photo is not in storage any more."""


def is_http_4xx(e):
    return re.search(r"HTTP 4\d\d", str(e)) is not None


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def to_jpeg(img, quality):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------- startup housekeeping
def rotate_log(path, max_bytes=5 * 1024 * 1024):
    try:
        if os.path.getsize(path) > max_bytes:
            os.replace(path, path + ".1")
    except OSError:
        pass


def prune_cache(cache_dir, days=14, now=None):
    now = now or time.time()
    try:
        names = os.listdir(cache_dir)
    except OSError:
        return
    for n in names:
        f = os.path.join(cache_dir, n)
        try:
            if n != "backup-index.json" and os.path.isfile(f) and now - os.path.getmtime(f) > days * 86400:
                os.remove(f)
        except OSError:
            pass


def sweep_parts(root, hours=1, now=None):
    now = now or time.time()
    for d, _dirs, files in os.walk(root):
        for n in files:
            f = os.path.join(d, n)
            try:
                if n.endswith(".part") and now - os.path.getmtime(f) > hours * 3600:
                    os.remove(f)
            except OSError:
                pass


def prune_render_temps(tmp_dir=None, hours=24, now=None):
    """Leftover reel render folders (%TEMP%/reel-render-*, from a crash or a power cut) older than `hours`."""
    import shutil
    import tempfile
    tmp_dir = tmp_dir or tempfile.gettempdir()
    now = now or time.time()
    try:
        names = os.listdir(tmp_dir)
    except OSError:
        return
    for n in names:
        d = os.path.join(tmp_dir, n)
        try:
            if n.startswith("reel-render-") and os.path.isdir(d) and now - os.path.getmtime(d) > hours * 3600:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


FONT_KEYS = ("title_font", "meaning_font", "mark_font")


def with_post_fonts(settings, fonts):
    """The settings with the post's own fonts (migration 003: claim_next_card returns them
    under "fonts") over the settings fonts. A null/empty font, a null "fonts" (preview cards,
    posts made before 003) or no "fonts" key at all (DB without 003) keeps the settings font."""
    picked = {k: fonts[k] for k in FONT_KEYS if isinstance(fonts, dict) and fonts.get(k)}
    if not picked:
        return settings
    s = dict(settings, **picked)
    s["style"] = text_style(s)
    return s


class Runner:
    def __init__(self, supa, renderer, output_root, cache_dir, poll_seconds=3.0, heartbeat_seconds=15.0, log=print,
                 reels=None):
        self.supa = supa
        self.renderer = renderer
        self.output_root = output_root
        self.cache_dir = cache_dir
        self.poll_seconds = poll_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.log = log
        self.current = None
        self.stop_event = threading.Event()
        self.reels = reels             # reels.ReelRunner, or None (cards only)
        self.reels_off_until = 0.0     # the reel functions are missing (migration 005 not run): re-check later
        self.reels_missing_logged = False
        self.next_preview_sweep = 0.0

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
        # With ComfyUI down, leave queued cards alone (they stay queued) but still
        # do restamps, which only need Pillow.
        comfy_ok = bool(self.renderer.health()["ok"])
        job = self.supa.rpc("claim_next_card", None if comfy_ok else {"p_restamp_only": True})
        if not job:
            # Cards always go first: a reel step only when there is no card to make.
            # With ComfyUI closed, only the steps that don't need it (timing, render) are handed out.
            return self._reel_tick(comfy_ok) if self.reels else False
        card = job["card"]
        self.current = card["id"]
        self.log("%s: %s (%s)" % (job["job"], card["name"], card["id"]))
        try:
            settings = with_post_fonts(self._settings(), job.get("fonts"))
            if job["job"] == "restamp" and card.get("photo_path"):
                try:
                    self._restamp(job, settings)
                except PhotoMissing:
                    self.log("clean photo missing from storage, generating instead")
                    self._to_generate(job, settings)
            elif job["job"] == "restamp":
                self._to_generate(job, settings)
            else:
                self._generate(job, settings)
        except Exception as e:
            if not isinstance(e, JobError):
                self.log(traceback.format_exc())
            self._fail(card, e)
        finally:
            self.current = None
        return True

    def _reel_tick(self, comfy_ok):
        if time.time() < self.reels_off_until:
            return False
        try:
            self.supa.rpc("requeue_stuck_reels")
            step = self.supa.rpc("claim_next_reel_step", {"p_no_comfy": not comfy_ok})
        except SupaError as e:
            if not is_missing_function(e):
                raise
            if not self.reels_missing_logged:
                self.log("reels are off until supabase/migrations/005_reels.sql is run (%s)" % str(e)[:120])
                self.reels_missing_logged = True
            self.reels_off_until = time.time() + REELS_RECHECK_SECONDS
            return False
        if not step:
            return False
        reel = step.get("reel") or {}
        scene = step.get("scene") or {}
        self.log("reel %s: %s%s (%s)" % (step.get("step"), reel.get("title"),
                                         " image %s" % scene.get("position") if scene else "", reel.get("id")))
        self.reels.run_step(step)
        return True

    def _settings(self):
        # select=* (not a column list): the text columns arrive with migration 002, and naming
        # a missing column would make PostgREST refuse the read and stop every card.
        rows = self._net(lambda: self.supa.select("settings", "id=eq.1&select=*"), NO_NET_SETTINGS)
        if not rows:
            raise JobError("The settings row is missing. Run supabase/schema.sql again.")
        s = dict(rows[0])
        s["style"] = text_style(s)  # missing or bad text settings get the defaults
        return s

    def _to_generate(self, job, s):
        card = job["card"]
        # Tell the UI and the stuck-card recovery that this is now a generate.
        rows = self._net(lambda: self.supa.update("cards", self._match(card), {"status": "generating"}, returning=True), NO_NET_SAVE)
        if not rows:
            self.log(STALE)
            return
        self._generate(job, s)

    def _generate(self, job, s):
        card = job["card"]
        if not self.renderer.health()["ok"]:
            raise JobError(COMFY_CLOSED)
        photo = self.renderer.generate_photo(card["prompt"], int(card["seed"]), int(s["width"]), int(s["height"]))
        photo_bytes = to_jpeg(photo, 92)
        card_bytes = to_jpeg(self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"]), 93)
        v = int(card["version"])
        photo_path = "photos/%s/v%d.jpg" % (card["id"], v)
        card_path = "cards/%s/v%d.jpg" % (card["id"], v)
        self._net(lambda: self.supa.upload(BUCKET, photo_path, photo_bytes), NO_NET_SAVE)
        self._net(lambda: self.supa.upload(BUCKET, card_path, card_bytes), NO_NET_SAVE)
        self._cache_put(photo_path, photo_bytes)
        if not self._finish(card, {"photo_path": photo_path, "card_path": card_path}):
            self._drop_stale([photo_path, card_path])
            return
        self._cleanup(card, keep={photo_path, card_path})
        self._backup(job, card_bytes)

    def _restamp(self, job, s):
        card = job["card"]
        photo = Image.open(io.BytesIO(self._load_photo(card["photo_path"]))).convert("RGB")
        card_bytes = to_jpeg(self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"]), 93)
        card_path = "cards/%s/v%d.jpg" % (card["id"], int(card["version"]))
        self._net(lambda: self.supa.upload(BUCKET, card_path, card_bytes), NO_NET_SAVE)
        if not self._finish(card, {"card_path": card_path}):
            self._drop_stale([card_path])
            return
        self._cleanup(card, keep={card["photo_path"], card_path})
        self._backup(job, card_bytes)

    # ------------------------------------------------------------ results
    def _match(self, card):
        # The version guard: if the owner pressed Regenerate or edited the text
        # meanwhile, the version moved on and this stale result is dropped.
        return "id=eq.%s&version=eq.%d" % (card["id"], int(card["version"]))

    def _finish(self, card, values):
        """True if the card row took the result, False if it moved on (0 rows matched)."""
        body = dict(values, status="done", finished_at=now_iso(), claimed_at=None, error=None)
        rows = self._retry(lambda: self.supa.update("cards", self._match(card), body, returning=True))
        return bool(rows)

    def _drop_stale(self, paths):
        # The card was regenerated, edited or deleted meanwhile. Discard what this
        # job uploaded and leave everything the DB row points to alone.
        self.log(STALE)
        try:
            self.supa.remove(BUCKET, paths)
        except Exception as e:
            self.log("could not remove stale uploads: %s" % e)
        for p in paths:
            try:
                os.remove(self._cache_file(p))
            except OSError:
                pass

    def _fail(self, card, e):
        msg = str(e) if isinstance(e, JobError) else "Something went wrong on your PC: %s" % (str(e) or type(e).__name__)
        body = {"status": "failed", "error": msg[:300], "claimed_at": None, "finished_at": now_iso()}
        try:
            # 0 rows matched (card moved on or was deleted) is fine: nothing to mark.
            self._retry(lambda: self.supa.update("cards", self._match(card), body))
        except Exception as e2:
            self.log("could not mark the card failed: %s" % e2)

    def _net(self, fn, reason):
        """Retry through network blips; if it still fails, raise a plain-language JobError."""
        try:
            return self._retry(fn)
        except SupaError as e:
            if is_http_4xx(e):
                raise JobError("Supabase refused this request: %s" % str(e)[:200])
            raise JobError(reason)

    def _retry(self, fn, tries=5):
        delay = 1.0
        for i in range(tries):
            try:
                return fn()
            except SupaError as e:
                if i == tries - 1 or is_http_4xx(e):
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
        try:
            data = self._retry(lambda: self.supa.download(BUCKET, path))
        except SupaError as e:
            if is_http_4xx(e):
                raise PhotoMissing(path)
            raise JobError(NO_NET_LOAD)
        self._cache_put(path, data)
        return data

    def _index_file(self):
        return os.path.join(self.cache_dir, "backup-index.json")

    def _index_load(self):
        try:
            with open(self._index_file(), encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}

    def _index_save(self, idx):
        os.makedirs(self.cache_dir, exist_ok=True)
        tmp = self._index_file() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(idx, fh)
        os.replace(tmp, self._index_file())

    def _backup(self, job, data):
        card = job["card"]
        if card.get("kind") != "post" or not job.get("post_date") or not job.get("gender_label"):
            return
        try:
            label = "%s %s" % (job["post_date"], job["gender_label"])
            if job.get("style_label"):
                label += " " + job["style_label"]
            rel = os.path.join(label, "%02d-%s.jpg" % (int(card["position"]), slugify(card["name"])))
            idx = self._index_load()
            old = idx.get(card["id"])
            os.makedirs(os.path.join(self.output_root, label), exist_ok=True)
            final = os.path.join(self.output_root, rel)
            tmp = final + ".part"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, final)
            # Only delete the file THIS card wrote last time, never by position prefix.
            if old and old != rel:
                try:
                    os.remove(os.path.join(self.output_root, old))
                except OSError:
                    pass
            idx[card["id"]] = rel
            self._index_save(idx)
        except OSError as e:
            self.log("backup copy failed: %s" % e)

    # ------------------------------------------------------------ reel previews
    def sweep_old_previews(self, now=None):
        """Once a day, best effort: delete reel previews older than PREVIEW_DAYS from the reels bucket and
        clear preview_path on their reels (the site then says the preview expired). Returns files removed."""
        now = now or time.time()
        if not self.reels or now < self.next_preview_sweep:
            return 0
        self.next_preview_sweep = now + PREVIEW_SWEEP_SECONDS
        removed = 0
        try:
            folders, offset = [], 0
            while True:
                page = self.supa.list("reels", "", 1000, offset) or []
                folders += [f["name"] for f in page if not f.get("id") and f.get("name")]
                if len(page) < 1000:
                    break
                offset += 1000
            for folder in folders:
                old = ["%s/%s" % (folder, f["name"]) for f in self.supa.list("reels", folder) or []
                       if f.get("id") and re.match(r"preview-v\d+\.mp4$", f.get("name") or "")
                       and _age_days(f.get("created_at"), now) > PREVIEW_DAYS]
                if not old:
                    continue
                self.supa.remove("reels", old)
                removed += len(old)
                for path in old:
                    self.supa.update("reels", "preview_path=eq.%s" % urllib.parse.quote(path, safe=""), {"preview_path": None})
            if removed:
                self.log("removed %d reel preview(s) older than %d days" % (removed, PREVIEW_DAYS))
        except Exception as e:
            self.log("reel preview clean-up skipped: %s" % str(e)[:200])
        return removed

    # ------------------------------------------------------------ forever
    def run_forever(self):
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        backoff = self.poll_seconds
        while not self.stop_event.is_set():
            self.sweep_old_previews()
            try:
                ran = self.tick()
                backoff = self.poll_seconds
                if not ran:
                    self.stop_event.wait(self.poll_seconds)
            except Exception as e:
                self.log("loop error (retrying in %ds): %s" % (backoff, e))
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)
