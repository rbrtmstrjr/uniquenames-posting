# Several pages (Supabase projects) served by one worker (2.7.0).
#
# Config: worker.env stays as it is (one page = Unique Names). Each extra page is a worker/pages/<id>.env file
# (git-ignored, see pages/README.md). Rule for worker.env: it is the "unique-names" page (PAGE_ID in worker.env may
# rename it) unless a pages file has the same PAGE_ID or the same SUPABASE_URL - then that pages file wins, so one
# project is never served by two loops. Global settings (COMFY_URL, POLL_SECONDS, HEARTBEAT_SECONDS,
# GENERATE_TIMEOUT_SECONDS) are read from worker.env only: there is one ComfyUI.
#
# Scheduling: MultiRunner takes turns round-robin. Each turn asks the pages in order, starting after the page that ran
# last, and runs ONE job (Runner.tick: a card, or one whole reel step such as a reel's voice with Chatterbox kept
# loaded across its lines) from the first page that has one, so one page's jobs are never interleaved with another's
# and a busy page can't starve a quiet one. Within a page the order is unchanged (cards and restamps before reels,
# reel steps before voice samples and theme previews). A page whose project can't be reached is skipped and tried
# again after a wait that doubles from POLL_SECONDS up to MAX_BACKOFF; the other pages go on. Every page has its own
# heartbeat thread (worker_status in its own project) and its own log prefix ("[name-nest] ...").
# 2.7.1: while one page's job runs, every other page's heartbeat sets worker_status.message to jobs.BUSY_ELSEWHERE,
# which the website shows as "PC busy with your other page" instead of "PC ready" (one page alone never sets it).
# 2.7.2: the card photo look (photo_look.py): PHOTO_VIBRANCE / PHOTO_TEXTURE from the page's own file, else worker.env.
import glob
import os
import re
import threading
import time

import photo_look
from jobs import Runner
from reels import ReelRunner
from render import ComfyRenderer, default_output_root, load_env
from supa import Supa

DEFAULT_PAGE = "unique-names"
PAGE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_BACKOFF = 300.0
REQUIRED = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")


class Page:
    def __init__(self, id, label, url, key, output_root, reels_dir, cache_dir, preview_cast, source, look_cfg=None):
        self.id = id                      # also the ComfyUI namespace: <id>/raw..., client id <id>-worker
        self.label = label
        self.url = url
        self.key = key
        self.output_root = output_root    # the PC backup folder for cards
        self.reels_dir = reels_dir        # full reel videos (None = <output_root>\Reels)
        self.cache_dir = cache_dir
        self.preview_cast = preview_cast  # theme-preview moment / cast (None = today's)
        self.source = source              # "worker.env" or "pages\<file>.env"
        self.look_cfg = look_cfg or {}    # this page's own PHOTO_VIBRANCE / PHOTO_TEXTURE (2.7.2; unset = worker.env's)

    def __repr__(self):
        return "Page(%s, %s)" % (self.id, self.source)


def default_label(page_id):
    """name-nest -> Name Nest (unique-names -> Unique Names, today's folder name)."""
    return " ".join(w.capitalize() for w in page_id.split("-"))


def _same_project(a, b):
    return (a or "").strip().rstrip("/").lower() == (b or "").strip().rstrip("/").lower()


def _page(cfg, page_id, here, source):
    label = (cfg.get("PAGE_LABEL") or "").strip() or default_label(page_id)
    cast = {k: cfg[env].strip() for k, env in (("moment", "PREVIEW_MOMENT"), ("cast", "PREVIEW_CAST"),
                                               ("doll_cast", "PREVIEW_DOLL_CAST")) if (cfg.get(env) or "").strip()}
    # Unique Names keeps worker/cache (its backup index lives there); another page gets worker/cache/<id>.
    cache = os.path.join(here, "cache") if page_id == DEFAULT_PAGE else os.path.join(here, "cache", page_id)
    return Page(page_id, label, cfg["SUPABASE_URL"].strip(), cfg["SUPABASE_SERVICE_ROLE_KEY"].strip(),
                (cfg.get("OUTPUT_ROOT") or "").strip() or default_output_root(label),
                (cfg.get("REELS_OUTPUT") or "").strip() or None, cache, cast or None, source,
                {k: cfg[k] for k in photo_look.KEYS if (cfg.get(k) or "").strip()})


def discover_pages(here, base_cfg):
    """([Page], [problem]) from worker.env (base_cfg) and here/pages/*.env. A pages file that can't be used is
    skipped and named in the problems (the other pages still run). worker.env's page comes first."""
    found, problems = [], []
    for path in sorted(glob.glob(os.path.join(here, "pages", "*.env"))):
        name = os.path.basename(path)
        source = os.path.join("pages", name)
        cfg = load_env(path)
        page_id = (cfg.get("PAGE_ID") or "").strip() or name[:-len(".env")]
        missing = [k for k in REQUIRED if not (cfg.get(k) or "").strip()]
        if not PAGE_ID.match(page_id):
            problems.append("%s skipped: PAGE_ID %r must be lower-case letters, digits and hyphens (e.g. name-nest)"
                            % (source, page_id))
        elif missing:
            problems.append("%s skipped: missing %s" % (source, ", ".join(missing)))
        elif any(p.id == page_id for p in found):
            problems.append("%s skipped: PAGE_ID %s is already used by another pages file" % (source, page_id))
        elif any(_same_project(p.url, cfg["SUPABASE_URL"]) for p in found):
            problems.append("%s skipped: its SUPABASE_URL is already served by another pages file" % source)
        else:
            found.append(_page(cfg, page_id, here, source))
    if all((base_cfg.get(k) or "").strip() for k in REQUIRED):
        base_id = (base_cfg.get("PAGE_ID") or "").strip() or DEFAULT_PAGE
        if not PAGE_ID.match(base_id):
            problems.append("worker.env: PAGE_ID %r is not valid, using %s" % (base_id, DEFAULT_PAGE))
            base_id = DEFAULT_PAGE
        # A pages file aimed at worker.env's project under another id must never take the live page over (its
        # ComfyUI namespace, cache / backup index and output folder would change): worker.env keeps that project.
        for p in [p for p in found if p.id != base_id and _same_project(p.url, base_cfg["SUPABASE_URL"])]:
            found.remove(p)
            problems.append("%s skipped: its SUPABASE_URL is worker.env's project, which stays page %s (worker.env)"
                            % (p.source, base_id))
        covered = any(p.id == base_id for p in found)
        if not covered:
            found.insert(0, _page(base_cfg, base_id, here, "worker.env"))
    return found, problems


def page_log(log, page_id):
    return lambda m: log("[%s] %s" % (page_id, m))


def build_runner(page, base_cfg, log, prefix=False):
    """A jobs.Runner (with its ReelRunner) for one page. prefix: put "[<id>] " before its log lines (several pages)."""
    plog = page_log(log, page.id) if prefix else log
    renderer = ComfyRenderer(base_cfg.get("COMFY_URL", "http://127.0.0.1:8188"),
                             int(base_cfg.get("GENERATE_TIMEOUT_SECONDS", "300")), log=plog, namespace=page.id)
    supa = Supa(page.url, page.key)
    reels = ReelRunner(supa, renderer, log=plog, output_root=page.output_root, reels_dir=page.reels_dir,
                       preview_cast=page.preview_cast)
    return Runner(supa, renderer, page.output_root, page.cache_dir,
                  float(base_cfg.get("POLL_SECONDS", "3")), float(base_cfg.get("HEARTBEAT_SECONDS", "15")),
                  log=plog, reels=reels, look=photo_look.settings(page.look_cfg, base_cfg, log=plog))


class _Slot:
    def __init__(self, page_id, runner, backoff):
        self.id = page_id
        self.runner = runner
        self.backoff = backoff
        self.off_until = 0.0


class MultiRunner:
    """Round-robin over several page Runners, one job at a time (see the top of this file)."""

    def __init__(self, runners, poll_seconds=3.0, log=print, clock=time.time, max_backoff=MAX_BACKOFF):
        self.poll_seconds = float(poll_seconds)
        self.slots = [_Slot(pid, r, self.poll_seconds) for pid, r in runners]
        # 2.7.1: each page's heartbeat says "PC busy with your other page" while another page's job runs
        for slot in self.slots:
            slot.runner.busy_elsewhere = lambda me=slot: any(getattr(o.runner, "busy", False) for o in self.slots if o is not me)
        self.log = log
        self.clock = clock
        self.max_backoff = float(max_backoff)
        self.next = 0
        self.stop_event = threading.Event()

    def tick(self):
        """Run one job from the next page that has one. True if a job ran."""
        n = len(self.slots)
        for k in range(n):
            i = (self.next + k) % n
            slot = self.slots[i]
            if self.clock() < slot.off_until:
                continue
            slot.runner.sweep_old_previews()  # once a day per page, never raises
            try:
                ran = slot.runner.tick()
            except Exception as e:
                slot.runner.log("loop error (skipping this page for %ds): %s" % (slot.backoff, e))
                slot.off_until = self.clock() + slot.backoff
                slot.backoff = min(slot.backoff * 2, self.max_backoff)
                continue
            slot.backoff, slot.off_until = self.poll_seconds, 0.0
            if ran:
                self.next = (i + 1) % n
                return True
        return False

    def start_heartbeats(self):
        """One heartbeat thread per page: a slow or unreachable project never delays another page's heartbeat."""
        threads = []
        for slot in self.slots:
            t = threading.Thread(target=slot.runner._heartbeat_loop, name="heartbeat-" + slot.id, daemon=True)
            t.start()
            threads.append(t)
        return threads

    def stop(self):
        self.stop_event.set()
        for slot in self.slots:
            slot.runner.stop_event.set()

    def run_forever(self):
        self.start_heartbeats()
        while not self.stop_event.is_set():
            try:
                ran = self.tick()
            except Exception as e:  # tick catches per page; this is a last guard so the loop never dies
                self.log("loop error: %s" % e)
                ran = False
            if not ran:
                self.stop_event.wait(self.poll_seconds)
