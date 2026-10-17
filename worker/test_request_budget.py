# How many requests the worker sends to ONE Supabase project (each one is a line in that project's logs; the Free plan
# allows 1 GB of logs a month): the 2.7.2 worker against 2.8.0, over a simulated idle day and a simulated busy hour.
# A fake Supabase counts every request; a fake clock runs the job loop and the heartbeat loop side by side.
#   python -m unittest test_request_budget        the checks
#   python test_request_budget.py report          the table
import collections
import math
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

from PIL import Image

import jobs
from supa import SupaError
from test_jobs import job

DAY = 86400
HOUR = 3600
CARD_SECONDS = 25  # one card on the GPU (Z-Image Turbo + stamping), roughly


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class CountingSupa:
    """Every method is one HTTP request. `cards` = how many card jobs are waiting (the busy hour)."""

    def __init__(self, one_claim, cards=0):
        self.one_claim = one_claim
        self.cards = cards
        self.n = 0
        self.calls = collections.Counter()

    def _card(self):
        if self.n >= self.cards:
            return None
        self.n += 1
        return job(id="c%d" % self.n)

    def rpc(self, fn, args=None):
        self.calls["rpc " + fn] += 1
        if fn == "claim_next_job":
            if not self.one_claim:
                raise SupaError('POST /rest/v1/rpc/claim_next_job -> HTTP 404 {"code":"PGRST202"}')
            card = self._card()
            return {"kind": "card", "job": card} if card else None
        if fn == "claim_next_card":
            return self._card()
        if fn.startswith("requeue_"):
            return 0
        return None  # no reel step, voice sample or theme preview waiting

    def select(self, table, query):
        self.calls["select " + table] += 1
        return [{"handle": "@unique_names", "width": 64, "height": 64}]

    def update(self, table, match, values, returning=False):
        self.calls["update " + table] += 1
        return [{"id": "x"}] if returning else None

    def upload(self, bucket, path, data, content_type="image/jpeg"):
        self.calls["upload"] += 1

    def download(self, bucket, path):
        self.calls["download"] += 1
        raise SupaError("GET x -> HTTP 404")

    def remove(self, bucket, paths):
        self.calls["remove"] += 1

    def list(self, bucket, prefix="", limit=1000, offset=0):
        self.calls["list"] += 1
        return []

    @property
    def total(self):
        return sum(self.calls.values())


class Renderer:
    """ComfyUI stand-in: always up; a photo takes CARD_SECONDS of the fake clock."""

    def __init__(self, clock):
        self.clock = clock

    def health(self):
        return {"ok": True, "gpu": "RTX", "error": None}

    def generate_photo(self, prompt, seed, width, height):
        self.clock.t += CARD_SECONDS
        return Image.new("RGB", (width, height), (90, 60, 40))

    def compose(self, photo, name, meaning, handle, style=None):
        return photo


def simulate(version, seconds, cards=0, idle_since=None):
    """Requests the worker sends in `seconds` of fake time. version "2.7.2" = the old behaviour: six calls every 3 s poll
    (requeue_stuck_cards, claim_next_card, requeue_stuck_reels, claim_next_reel_step, claim_next_voice_sample,
    claim_next_theme_preview), a heartbeat every 15 s. "2.8.0" = this worker on a database with migration 020."""
    clock = Clock()
    supa = CountingSupa(one_claim=version != "2.7.2", cards=cards)
    root = tempfile.mkdtemp()
    old = version == "2.7.2"
    patches = [mock.patch("jobs.time.time", clock), mock.patch("jobs.time.sleep")]
    if old:
        patches += [mock.patch("jobs.REQUEUE_SECONDS", 0.0), mock.patch("jobs.IDLE_POLL_SECONDS", 3.0)]
    try:
        for p in patches:
            p.start()
        runner = jobs.Runner(supa, Renderer(clock), os.path.join(root, "out"), os.path.join(root, "cache"),
                             log=lambda m: None, reels=mock.Mock())
        if old:
            runner.one_claim_off_until = math.inf          # 2.7.2 never asked for claim_next_job
            runner.heartbeat_seconds = runner.heartbeat_check_seconds = 15.0
        if idle_since is not None:
            runner.last_job_at = clock.t - idle_since
        start = clock.t
        end = start + seconds
        t_main = start
        t_beat = start + 1.0       # the heartbeat thread runs on its own: never in step with the job loop
        job_span = (0.0, 0.0)
        while True:
            if t_beat <= t_main and t_beat < end:          # the heartbeat thread's next look
                runner.current = "c" if job_span[0] <= t_beat < job_span[1] else None
                runner.heartbeat_tick(now=t_beat)
                runner.current = None
                t_beat += runner.heartbeat_check_seconds
            elif t_main < end:                             # the job loop's next poll (run_forever)
                clock.t = t_main
                runner.sweep_old_previews()
                if runner.tick():
                    job_span = (t_main, clock.t)           # the job moved the clock on
                    t_main = clock.t
                else:
                    t_main = clock.t + runner.idle_wait()
            else:
                break
    finally:
        for p in reversed(patches):
            p.stop()
        shutil.rmtree(root, ignore_errors=True)
    return supa


class BudgetTest(unittest.TestCase):
    def test_old_idle_day_matches_the_arithmetic(self):
        s = simulate("2.7.2", DAY, idle_since=DAY)
        polls = DAY // 3
        self.assertEqual(s.calls["rpc requeue_stuck_cards"], polls)
        self.assertEqual(s.calls["rpc claim_next_theme_preview"], polls)
        self.assertEqual(s.calls["update worker_status"], DAY // 15)
        self.assertEqual(s.total, polls * 6 + DAY // 15 + 1)  # + the daily reel-preview clean-up (1 listing)
        self.assertEqual(s.total, 178_561)

    def test_new_idle_day(self):
        s = simulate("2.8.0", DAY, idle_since=DAY)
        self.assertEqual(s.calls["rpc claim_next_job"], DAY // 15)        # one request per 15 s poll
        self.assertEqual(s.calls["update worker_status"], DAY // 60)      # one heartbeat a minute
        self.assertEqual(set(s.calls), {"rpc claim_next_job", "update worker_status", "list"})
        self.assertEqual(s.total, 5_760 + 1_440 + 1)
        self.assertLess(s.total / simulate("2.7.2", DAY, idle_since=DAY).total, 0.05)   # > 95 % fewer

    def test_just_started_or_just_finished_polls_fast_for_a_minute(self):
        s = simulate("2.8.0", HOUR)                        # idle clock starts at the start
        self.assertEqual(s.calls["rpc claim_next_job"], 20 + (HOUR - 60) // 15)

    def test_busy_hour(self):
        cards = HOUR // CARD_SECONDS + 10                  # more than an hour of cards waiting
        old, new = simulate("2.7.2", HOUR, cards=cards), simulate("2.8.0", HOUR, cards=cards)
        made = HOUR // CARD_SECONDS
        self.assertEqual((old.n, new.n), (made, made))     # the same work gets done
        per_card = 4                                       # settings, photo upload, card upload, finish
        self.assertEqual(old.total, made * (2 + per_card) + HOUR // 15 + 1)
        # one claim per card; heartbeats: once a minute + the switch to busy at the start
        self.assertEqual(new.calls["rpc claim_next_job"], made)
        self.assertLessEqual(new.calls["update worker_status"], HOUR // 60 + 2)
        self.assertLess(new.total, old.total * 0.75)

    def test_a_database_without_020_still_saves_most_requests(self):
        s = simulate("2.8.0", DAY, idle_since=DAY)
        self.assertGreater(s.calls["rpc claim_next_job"], 0)
        fallback = CountingSupa(one_claim=False)
        clock = Clock()
        with mock.patch("jobs.time.time", clock):
            r = jobs.Runner(fallback, Renderer(clock), "o", "c", log=lambda m: None, reels=mock.Mock())
            r.tick()
        # the old calls, but the requeue only on one poll a minute: 4 per idle poll (+ claim_next_job every 10 min)
        clock.t += 3
        fallback.calls.clear()
        with mock.patch("jobs.time.time", clock):
            r.tick()
        self.assertEqual(fallback.total, 4)


def report():
    rows = []
    for name, seconds, kw in (("idle day", DAY, {"idle_since": DAY}), ("busy hour (cards non-stop)", HOUR,
                                                                          {"cards": HOUR // CARD_SECONDS + 10})):
        old, new = simulate("2.7.2", seconds, **kw), simulate("2.8.0", seconds, **kw)
        rows.append((name, old.total, new.total, 100.0 * (1 - new.total / old.total)))
    print("%-28s %10s %10s %8s" % ("", "2.7.2", "2.8.0", "fewer"))
    for name, a, b, pct in rows:
        print("%-28s %10d %10d %7.1f%%" % (name, a, b, pct))
    idle_old, idle_new = rows[0][1], rows[0][2]
    print("idle month (30 days):        %10d %10d" % (idle_old * 30, idle_new * 30))


if __name__ == "__main__":
    if sys.argv[1:] == ["report"]:
        report()
    else:
        unittest.main()
