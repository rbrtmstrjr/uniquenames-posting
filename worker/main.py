# Unique Names card worker. Start: python main.py   (autostart: install-autostart.ps1)
# One page: worker.env, exactly as before 2.7.0. Several pages: worker/pages/*.env too (see pages.py, pages/README.md).
import os
import socket
import sys
import time

from jobs import VERSION, prune_cache, prune_render_temps, rotate_log, sweep_parts
from pages import MultiRunner, build_runner, discover_pages
from render import HERE, ensure_fonts_in_background, load_env

_LOCK = None


def main():
    global _LOCK
    rotate_log(os.path.join(HERE, "worker.log"))
    if sys.stdout is None or sys.stderr is None:
        # started hidden (pythonw at Windows logon): log to worker.log
        sys.stdout = sys.stderr = open(os.path.join(HERE, "worker.log"), "a", encoding="utf-8", buffering=1)
    cfg = load_env(os.path.join(HERE, "worker.env"))
    log = lambda m: print(time.strftime("%Y-%m-%d %H:%M:%S"), m, flush=True)  # noqa: E731
    pages, problems = discover_pages(HERE, cfg)
    for p in problems:
        log(p)
    if not pages:
        missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not cfg.get(k)]
        sys.exit("worker.env is missing: " + ", ".join(missing) + ". See worker.env.example.")
    _LOCK = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _LOCK.bind(("127.0.0.1", 47821))  # one worker per PC
    except OSError:
        sys.exit("The card worker is already running.")
    multi = len(pages) > 1
    runners = []
    for page in pages:
        prune_cache(page.cache_dir)
        sweep_parts(page.output_root)
        if page.reels_dir:
            sweep_parts(page.reels_dir)
        runners.append(build_runner(page, cfg, log, prefix=multi))
    prune_render_temps()
    comfy = runners[0].renderer.comfy
    if not multi:
        print("Unique Names worker %s -> %s (ComfyUI %s)" % (VERSION, pages[0].url, comfy), flush=True)
    else:
        print("Unique Names worker %s serving %d pages (ComfyUI %s)" % (VERSION, len(pages), comfy), flush=True)
        for page in pages:
            log("[%s] %s -> %s, cards in %s (%s)" % (page.id, page.label, page.url, page.output_root, page.source))
    # Fonts download in the background: the heartbeat must start at once, or a slow GitHub on
    # the first start after an update would make the PC look offline (and lock Generate).
    ensure_fonts_in_background(runners[0].renderer, log=log if multi else runners[0].log)
    if not multi:
        runners[0].run_forever()
    else:
        MultiRunner([(p.id, r) for p, r in zip(pages, runners)], runners[0].poll_seconds, log=log).run_forever()


if __name__ == "__main__":
    main()
