# The worker's job loop: claim one card at a time from Supabase, make it with
# ComfyUI + Pillow, upload it, keep a backup copy on the PC, and heartbeat.
# 2.8.0: every request to Supabase is a line in the project's logs (the Free plan allows 1 GB a month), so a poll is
# ONE request (claim_next_job, migration 020; the old one-function-at-a-time calls stay as the fallback), the stuck-claim
# requeue rides on one poll a minute, an idle worker polls every 15 s instead of every 3 s, and worker_status is written
# once a minute plus at once when something the website shows changes (ComfyUI open/closed, busy/idle).
import contextlib
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

import photo_look
from render import JobError, card_layout, detail_line, slugify, text_style
from supa import SupaError

VERSION = "2.8.0"
BUCKET = "cards"
COMFY_CLOSED = "ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry."
NO_NET_SAVE = "Couldn't reach the internet to save this card. Press Retry."
NO_NET_LOAD = "Couldn't reach the internet to load this card's photo. Press Retry."
NO_NET_SETTINGS = "Couldn't reach the internet to load your settings. Press Retry."
STALE = "stale result dropped (card changed while it was being made)"
# worker_status.message of a page while the shared PC works for another page (2.7.1). The website shows it instead
# of "PC ready" (lib/status/worker-health.ts BUSY_ELSEWHERE: the same words).
BUSY_ELSEWHERE = "PC busy with your other page"


CTA_FILENAME = "99-follow.jpg"  # the closing card's PC backup name (migration 010)

REELS_RECHECK_SECONDS = 600
ONE_CLAIM_RECHECK_SECONDS = 600  # claim_next_job missing (020 not run): the old calls, checked again after this
REQUEUE_SECONDS = 60.0           # the stuck-claim requeue runs on one poll a minute, not on every poll
IDLE_AFTER_SECONDS = 60.0        # no job for this long: poll every IDLE_POLL_SECONDS instead of POLL_SECONDS
IDLE_POLL_SECONDS = 15.0         # (a new job then starts within ~15 s; back to POLL_SECONDS at once after any job)
HEARTBEAT_SECONDS = 60.0         # worker_status at least once a minute (the website: "PC offline" after 3 minutes) ...
HEARTBEAT_CHECK_SECONDS = 5.0    # ... and within 5 s of a change it shows; the look itself is local (no request)
HEARTBEAT_RETRY_SECONDS = 15.0   # after a failed heartbeat
PREVIEW_DAYS = 14               # reel previews leave storage after this; the full video stays on the PC
PREVIEW_SWEEP_SECONDS = 86400   # once a day


def is_missing_function(e):
    """PostgREST's answer when an RPC does not exist (yet): HTTP 404 / PGRST202."""
    return "PGRST202" in str(e) or re.search(r"HTTP 404", str(e)) is not None


def idle_poll_seconds(idle_for, poll_seconds):
    """The wait after a poll that found nothing: poll_seconds while a job ran in the last IDLE_AFTER_SECONDS (or the
    worker just started), then IDLE_POLL_SECONDS (never faster than poll_seconds)."""
    return poll_seconds if idle_for < IDLE_AFTER_SECONDS else max(poll_seconds, IDLE_POLL_SECONDS)


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
    def __init__(self, supa, renderer, output_root, cache_dir, poll_seconds=3.0, heartbeat_seconds=HEARTBEAT_SECONDS,
                 log=print, reels=None, look=None):
        self.supa = supa
        self.renderer = renderer
        self.output_root = output_root
        self.cache_dir = cache_dir
        self.poll_seconds = poll_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.heartbeat_check_seconds = HEARTBEAT_CHECK_SECONDS
        self.log = log
        self.current = None
        self.stop_event = threading.Event()
        self.reels = reels             # reels.ReelRunner, or None (cards only)
        self.look = look               # (vibrance, texture) for new card photos (photo_look, 2.7.2); None/0,0 = off
        self.reels_off_until = 0.0     # the reel functions are missing (migration 005 not run): re-check later
        self.reels_missing_logged = False
        self.music_off_until = 0.0     # the 006 functions are missing: claim without music, no voice samples
        self.music_state = None        # None = not known yet, True = 006 there, False = 006 missing
        self.themes_off_until = 0.0    # claim_next_theme_preview is missing (007 not run): re-check later
        self.themes_state = None       # None = not known yet, True = 007 there, False = 007 missing
        self.next_preview_sweep = 0.0
        self.busy = False              # a job of this page is running (a card, a reel step, a sample, a preview)
        self.busy_elsewhere = None     # set by pages.MultiRunner: () -> True while another page's job runs
        self.one_claim_off_until = 0.0 # claim_next_job is missing (020 not run): the old calls until then
        self.one_claim_state = None    # None = not known yet, True = 020 there, False = 020 missing
        self.next_requeue = 0.0        # when the next poll runs the stuck-claim requeue
        self.last_job_at = time.time() # the idle poll starts IDLE_AFTER_SECONDS after this
        self._beat_key = None          # what the website last got (see _status_key)
        self._beat_look = None         # what the last look saw
        self._beat_next = 0.0          # the next keep-alive heartbeat
        self._beat_retry_at = 0.0      # after a failed heartbeat

    @contextlib.contextmanager
    def _working(self):
        self.busy = True
        try:
            yield
        finally:
            self.busy = False

    # ------------------------------------------------------------ heartbeat
    def _status(self):
        """worker_status as the website should see it now (ComfyUI is asked locally; no request to Supabase)."""
        h = self.renderer.health()
        message = h.get("error")
        if not message and not self.busy and self.busy_elsewhere and self.busy_elsewhere():
            message = BUSY_ELSEWHERE
        return {"comfyui_ok": bool(h["ok"]), "gpu": h.get("gpu"), "current_card_id": self.current,
                "worker_version": VERSION, "message": message}

    @staticmethod
    def _status_key(status):
        """What the website shows: PC ready / ComfyUI closed (+ why), busy with the other page, working on a card."""
        return (status["comfyui_ok"], status["gpu"], status["message"], status["current_card_id"] is not None)

    def heartbeat_once(self, status=None):
        """Write worker_status now."""
        status = status or self._status()
        self.supa.update("worker_status", "id=eq.1", dict({"last_seen": now_iso()}, **status))
        return status

    def heartbeat_tick(self, now=None):
        """One look at the local state (every HEARTBEAT_CHECK_SECONDS): write worker_status HEARTBEAT_SECONDS after the
        last write (the keep-alive), at once when ComfyUI opened or closed, and when busy / idle changed and the next look
        agrees (the split second between two jobs is never sent as "idle"). True if it was written."""
        now = time.time() if now is None else now
        if now < self._beat_retry_at:
            return False
        status = self._status()
        key = self._status_key(status)
        last_look, self._beat_look = self._beat_look, key
        comfy_moved = self._beat_key is None or key[:2] != self._beat_key[:2]
        changed = key != self._beat_key and (comfy_moved or key == last_look)
        if not changed and now < self._beat_next:
            return False
        try:
            self.heartbeat_once(status)
        except Exception as e:
            self.log("heartbeat failed: %s" % e)
            self._beat_retry_at = now + HEARTBEAT_RETRY_SECONDS
            return False
        self._beat_key, self._beat_next = key, now + self.heartbeat_seconds
        return True

    def _heartbeat_loop(self):
        while not self.stop_event.is_set():
            try:
                self.heartbeat_tick()
            except Exception as e:  # a look that failed never stops the loop
                self.log("heartbeat failed: %s" % e)
            self.stop_event.wait(self.heartbeat_check_seconds)

    # ------------------------------------------------------------ one job
    def tick(self):
        """Claim and run one job (a card, a reel step, a voice sample or a theme preview). True if a job ran."""
        ran = self._tick()
        if ran:
            self.last_job_at = time.time()
        return ran

    def idle_wait(self, now=None):
        """How long run_forever waits after a poll that found nothing."""
        now = time.time() if now is None else now
        return idle_poll_seconds(now - self.last_job_at, self.poll_seconds)

    def _tick(self):
        # With ComfyUI down, leave queued cards alone (they stay queued) but still
        # do restamps, which only need Pillow.
        comfy_ok = bool(self.renderer.health()["ok"])
        requeue = time.time() >= self.next_requeue
        if self.reels and time.time() >= self.one_claim_off_until:
            # 020: the whole poll in one request, in the same order as the calls below
            try:
                got = self.supa.rpc("claim_next_job", {"p_comfy_ok": comfy_ok, "p_music": True, "p_requeue": requeue})
            except SupaError as e:
                if not is_missing_function(e):
                    raise
                self._one_claim_off(e)
            else:
                self._one_claim_on()
                if requeue:
                    self.next_requeue = time.time() + REQUEUE_SECONDS
                return self._run_claimed(got)
        # The old way, one function at a time (a database without 020, or a cards-only runner).
        if requeue:
            self.supa.rpc("requeue_stuck_cards")
            self.next_requeue = time.time() + REQUEUE_SECONDS
        job = self.supa.rpc("claim_next_card", None if comfy_ok else {"p_restamp_only": True})
        if not job:
            # Cards always go first: a reel step only when there is no card to make.
            # With ComfyUI closed, only the steps that don't need it (timing, render) are handed out.
            return self._reel_tick(comfy_ok, requeue) if self.reels else False
        return self._card(job)

    def _run_claimed(self, got):
        """Run what claim_next_job handed out: {kind, job} (job = what the one-kind claim function answers) or null."""
        if not got:
            return False
        kind, job = got.get("kind"), got.get("job")
        if kind == "card":
            return self._card(job)
        if kind == "reel_step":
            return self._reel_step(job)
        if kind == "voice_sample":
            return self._sample(job)
        if kind == "theme_preview":
            return self._preview(job)
        self.log("unknown job kind from claim_next_job: %r (skipped; update the worker)" % (kind,))
        return False

    def _one_claim_off(self, e):
        self.one_claim_off_until = time.time() + ONE_CLAIM_RECHECK_SECONDS
        if self.one_claim_state is not False:
            self.log("one request per poll is off until supabase/migrations/020_one_claim.sql is run: asking the old "
                     "way (%s)" % str(e)[:120])
        self.one_claim_state = False

    def _one_claim_on(self):
        if self.one_claim_state is not True:
            self.log("jobs are claimed with one request per poll (020 found)")
        self.one_claim_state = True

    def _card(self, job):
        card = job["card"]
        self.current = card["id"]
        self.busy = True
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
            self.busy = False
        return True

    def _reel_tick(self, comfy_ok, requeue=True):
        if time.time() < self.reels_off_until:
            return False
        try:
            if requeue:
                self.supa.rpc("requeue_stuck_reels")
            step = self._claim_reel_step(comfy_ok)
        except SupaError as e:
            if not is_missing_function(e):
                raise
            if not self.reels_missing_logged:
                self.log("reels are off until supabase/migrations/005_reels.sql is run (%s)" % str(e)[:120])
                self.reels_missing_logged = True
            self.reels_off_until = time.time() + REELS_RECHECK_SECONDS
            return False
        if not step:
            # Voice samples, then theme previews, only when no reel step can run and only with ComfyUI up
            # (Chatterbox / Z-Image).
            if not comfy_ok:
                return False
            return self._sample_tick() or self._preview_tick()
        return self._reel_step(step)

    def _reel_step(self, step):
        reel = step.get("reel") or {}
        scene = step.get("scene") or {}
        self.log("reel %s: %s%s (%s)" % (step.get("step"), reel.get("title"),
                                         " image %s" % scene.get("position") if scene else "", reel.get("id")))
        with self._working():
            self.reels.run_step(step)
        return True

    def _claim_reel_step(self, comfy_ok):
        """claim_next_reel_step with the music step (006: p_music). A database without 006 has only 005's
        one-argument function (PostgREST answers PGRST202): then ask without music, re-checked every
        REELS_RECHECK_SECONDS. Each switch (off, and back on once 006 is run) is logged once."""
        if time.time() >= self.music_off_until:
            try:
                step = self.supa.rpc("claim_next_reel_step", {"p_no_comfy": not comfy_ok, "p_music": True})
            except SupaError as e:
                if "PGRST202" not in str(e):
                    raise
                self._music_off()
            else:
                self._music_on()
                return step
        return self.supa.rpc("claim_next_reel_step", {"p_no_comfy": not comfy_ok})

    def _music_off(self):
        self.music_off_until = time.time() + REELS_RECHECK_SECONDS
        if self.music_state is not False:
            self.log("reel music and voices are off until supabase/migrations/006_reel_voices.sql is run")
        self.music_state = False

    def _music_on(self):
        if self.music_state is False:
            self.log("reel music and voices are on (006 found)")
        self.music_state = True

    def _sample_tick(self):
        if time.time() < self.music_off_until or not hasattr(self.reels, "run_sample"):
            return False
        try:
            job = self.supa.rpc("claim_next_voice_sample")
        except SupaError as e:
            if "PGRST202" not in str(e):
                raise
            self._music_off()
            return False
        return self._sample(job)

    def _sample(self, job):
        if not isinstance(job, dict) or not job.get("voice"):
            return False
        self.log("voice sample: %s" % (job["voice"].get("id")))
        with self._working():
            self.reels.run_sample(job)
        return True

    def _preview_tick(self):
        """One theme preview (007). A database without 007 has no claim_next_theme_preview: previews are off,
        logged once, re-checked every REELS_RECHECK_SECONDS (also off while 006 is missing: 007 needs it)."""
        if time.time() < max(self.themes_off_until, self.music_off_until) or not hasattr(self.reels, "run_theme_preview"):
            return False
        try:
            job = self.supa.rpc("claim_next_theme_preview")
        except SupaError as e:
            if not is_missing_function(e):
                raise
            self.themes_off_until = time.time() + REELS_RECHECK_SECONDS
            if self.themes_state is not False:
                self.log("theme previews are off until supabase/migrations/007_reel_themes.sql is run")
            self.themes_state = False
            return False
        if self.themes_state is False:
            self.log("theme previews are on (007 found)")
        self.themes_state = True
        return self._preview(job)

    def _preview(self, job):
        if not isinstance(job, dict) or not job.get("theme"):
            return False
        self.log("theme preview: %s" % job["theme"].get("id"))
        with self._working():
            self.reels.run_theme_preview(job)
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
        if self.look and any(self.look):
            # 2.7.2: once, on the new photo, before it is stored and stamped (a restamp reuses the stored photo)
            photo = photo_look.apply_look(photo, vibrance=self.look[0], texture=self.look[1])
        photo_bytes = to_jpeg(photo, 92)
        card_bytes = to_jpeg(self._compose(card, photo, s), 93)
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
        card_bytes = to_jpeg(self._compose(card, photo, s), 93)
        card_path = "cards/%s/v%d.jpg" % (card["id"], int(card["version"]))
        self._net(lambda: self.supa.upload(BUCKET, card_path, card_bytes), NO_NET_SAVE)
        if not self._finish(card, {"card_path": card_path}):
            self._drop_stale([card_path])
            return
        self._cleanup(card, keep={card["photo_path"], card_path})
        self._backup(job, card_bytes)

    def _compose(self, card, photo, s):
        """The stamped card: the closing card (kind 'cta', migration 010) gets its message lines
        (name = the message, "/" = a line break) and no meaning; every other card its name + meaning.
        The Name Nest layout (settings.card_layout, migration 015) also gets the name's US rank / origin line."""
        layout = card_layout(s)
        if layout == "classic":  # Unique Names: exactly the calls from before 015
            if card.get("kind") == "cta":
                return self.renderer.compose_cta(photo, card["name"], s["handle"], s["style"])
            return self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"])
        if card.get("kind") == "cta":
            return self.renderer.compose_cta(photo, card["name"], s["handle"], s["style"], layout=layout)
        return self.renderer.compose(photo, card["name"], card["meaning"], s["handle"], s["style"], layout=layout,
                                     detail=self._name_detail(card))

    def _name_detail(self, card):
        """"#38 in the US · Greek" from the card's name row, or None: no name row, a card whose text was changed to
        another name, a name with neither, or a read that failed (logged; the card is stamped without the line)."""
        if not card.get("name_id"):
            return None
        try:
            rows = self._retry(lambda: self.supa.select(
                "names", "id=eq.%s&select=name,origin,us_rank,us_year" % urllib.parse.quote(str(card["name_id"]), safe="")))
        except SupaError as e:
            self.log("could not read the name's US rank / origin (stamping without it): %s" % str(e)[:160])
            return None
        row = (rows or [None])[0]
        if not row or str(row.get("name") or "").strip().lower() != str(card.get("name") or "").strip().lower():
            return None
        return detail_line(row.get("us_rank"), row.get("origin"))

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
        if card.get("kind") not in ("post", "cta") or not job.get("post_date") or not job.get("gender_label"):
            return
        try:
            label = "%s %s" % (job["post_date"], job["gender_label"])
            if job.get("style_label"):
                label += " " + job["style_label"]
            # The closing card sorts last in the post's folder, whatever its position.
            fname = CTA_FILENAME if card.get("kind") == "cta" else "%02d-%s.jpg" % (int(card["position"]), slugify(card["name"]))
            rel = os.path.join(label, fname)
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
                    self.stop_event.wait(self.idle_wait())
            except Exception as e:
                self.log("loop error (retrying in %ds): %s" % (backoff, e))
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)
