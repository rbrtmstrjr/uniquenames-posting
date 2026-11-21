# Autopilot (worker 2.9.0, migration 022): while the website has an Autopilot run going, claim_next_job's answer says so
# ({"autopilot": true}) and this pinger knocks on the website's tick route about every 30 seconds from its own thread,
# so the run moves on even while a card is being made. The website does all the work; this only knocks.
import json
import threading
import time
import urllib.error
import urllib.request

PING_SECONDS = 30.0
TIMEOUT_SECONDS = 320   # the tick route may take up to 300 s
LOOP_SECONDS = 2.0


class AutopilotPinger:
    def __init__(self, url, secret, log=print, clock=time.time, post=None):
        self.url = url.rstrip("/") + "/api/autopilot/tick"
        self.secret = secret
        self.log = log
        self.clock = clock
        self.post = post or _post
        self.on = False          # the last claim answer said a run is active
        self.next_at = 0.0
        self.busy = False
        self.last_status = None
        self.stop_event = threading.Event()

    def note(self, active):
        """After every claim_next_job answer: is an Autopilot run active?"""
        active = bool(active)
        if active and not self.on:
            self.log("Autopilot run found: knocking on the website every %ds" % PING_SECONDS)
            self.next_at = 0.0
        self.on = active

    def active(self):
        return self.on

    def due(self, now=None):
        now = self.clock() if now is None else now
        return self.on and not self.busy and now >= self.next_at

    def ping_once(self):
        """One knock (blocking). The website's answer, or None after a failure (logged)."""
        self.busy = True
        try:
            answer = self.post(self.url, self.secret)
            status = (answer or {}).get("status")
            if status and status != self.last_status:
                self.log("Autopilot: %s" % status)
                self.last_status = status
            return answer
        except Exception as e:
            self.log("Autopilot knock failed: %s" % str(e)[:200])
            return None
        finally:
            self.next_at = self.clock() + PING_SECONDS
            self.busy = False

    def loop(self, wait=None):
        wait = wait or self.stop_event.wait
        while not self.stop_event.is_set():
            if self.due():
                self.ping_once()
            wait(LOOP_SECONDS)

    def start(self):
        threading.Thread(target=self.loop, name="autopilot", daemon=True).start()


def _post(url, secret):
    req = urllib.request.Request(url, data=b"{}", method="POST",
                                 headers={"content-type": "application/json", "x-autopilot-key": secret})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %d %s" % (e.code, e.read().decode("utf-8", "replace")[:200]))


def from_env(cfg, log=print):
    """A pinger when the page's env has AUTOPILOT_URL and AUTOPILOT_SECRET; None = Autopilot off for that page."""
    url = (cfg.get("AUTOPILOT_URL") or "").strip()
    secret = (cfg.get("AUTOPILOT_SECRET") or "").strip()
    if not url or not secret:
        return None
    return AutopilotPinger(url, secret, log=log)
