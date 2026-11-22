# Autopilot (2.9.0): claim_next_job says when a run is active; a pinger knocks on the website's tick route every 30 s
# from its own thread. No network: the post function and the clock are fakes.
import unittest

import autopilot
import jobs
from test_one_claim import Base


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


class PingerTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.calls = []
        self.logs = []
        self.p = autopilot.AutopilotPinger("https://site.example/", "s" * 40, log=self.logs.append, clock=self.clock,
                                           post=lambda url, secret: self.calls.append((url, secret)) or {"ok": True, "ran": True, "status": "running"})

    def test_knocks_only_while_a_run_is_active_and_every_30_s(self):
        self.assertFalse(self.p.due())
        self.p.note(True)
        self.assertTrue(self.p.due())
        self.p.ping_once()
        self.assertEqual(self.calls, [("https://site.example/api/autopilot/tick", "s" * 40)])
        self.assertFalse(self.p.due())
        self.clock.t += 29
        self.assertFalse(self.p.due())
        self.clock.t += 1
        self.assertTrue(self.p.due())
        self.p.note(False)
        self.assertFalse(self.p.due())

    def test_a_failed_knock_is_logged_and_tried_again_later(self):
        def boom(url, secret):
            raise RuntimeError("HTTP 500")
        self.p.post = boom
        self.p.note(True)
        self.assertIsNone(self.p.ping_once())
        self.assertIn("Autopilot knock failed: HTTP 500", self.logs[-1])
        self.assertFalse(self.p.due())
        self.clock.t += 30
        self.assertTrue(self.p.due())

    def test_from_env_needs_both_keys(self):
        self.assertIsNone(autopilot.from_env({"AUTOPILOT_URL": "https://x"}))
        self.assertIsNone(autopilot.from_env({"AUTOPILOT_SECRET": "s"}))
        self.assertIsInstance(autopilot.from_env({"AUTOPILOT_URL": "https://x", "AUTOPILOT_SECRET": "s" * 40}), autopilot.AutopilotPinger)


class RunnerFlagTest(Base):
    def setUp(self):
        super().setUp()
        self.notes = []
        self.run_.autopilot = type("P", (), {"note": lambda _s, a: self.notes.append(a), "start": lambda _s: None})()

    def test_an_idle_answer_with_the_flag_is_no_job(self):
        self.supa.claims.append({"kind": "none", "autopilot": True})
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.notes, [True])
        self.assertFalse(any("unknown job kind" in m for m in self.logs))

    def test_a_card_answer_carries_the_flag_and_null_means_no_run(self):
        from test_jobs import job
        self.supa.claims.append({"kind": "card", "job": job(), "autopilot": True})
        self.assertTrue(self.run_.tick())
        self.assertFalse(self.run_.tick())   # null answer
        self.assertEqual(self.notes, [True, False])

    def test_version(self):
        self.assertEqual(jobs.VERSION, "2.10.0")


if __name__ == "__main__":
    unittest.main()
