# Unique Names card worker. Start: python main.py   (autostart: install-autostart.ps1)
import os
import socket
import sys
import time

from jobs import VERSION, Runner
from render import HERE, ComfyRenderer, default_output_root, ensure_fonts, load_env
from supa import Supa

_LOCK = None


def main():
    global _LOCK
    if sys.stdout is None or sys.stderr is None:
        # started hidden (pythonw at Windows logon): log to worker.log
        sys.stdout = sys.stderr = open(os.path.join(HERE, "worker.log"), "a", encoding="utf-8", buffering=1)
    cfg = load_env(os.path.join(HERE, "worker.env"))
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not cfg.get(k)]
    if missing:
        sys.exit("worker.env is missing: " + ", ".join(missing) + ". See worker.env.example.")
    _LOCK = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _LOCK.bind(("127.0.0.1", 47821))  # one worker per PC
    except OSError:
        sys.exit("The card worker is already running.")
    renderer = ComfyRenderer(cfg.get("COMFY_URL", "http://127.0.0.1:8188"), int(cfg.get("GENERATE_TIMEOUT_SECONDS", "300")), ensure_fonts())
    runner = Runner(Supa(cfg["SUPABASE_URL"], cfg["SUPABASE_SERVICE_ROLE_KEY"]), renderer,
                    cfg.get("OUTPUT_ROOT") or default_output_root(), os.path.join(HERE, "cache"),
                    float(cfg.get("POLL_SECONDS", "3")), float(cfg.get("HEARTBEAT_SECONDS", "15")),
                    log=lambda m: print(time.strftime("%Y-%m-%d %H:%M:%S"), m, flush=True))
    print("Unique Names worker %s -> %s (ComfyUI %s)" % (VERSION, cfg["SUPABASE_URL"], renderer.comfy), flush=True)
    runner.run_forever()


if __name__ == "__main__":
    main()
