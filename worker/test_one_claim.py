# 2.8.0: fewer requests to Supabase (every request is a line in the project's logs; the Free plan allows 1 GB a month).
# One claim_next_job request per poll (migration 020) with the old calls as the fallback, the stuck-claim requeue once a
# minute, a slower poll while idle, and a heartbeat once a minute plus at once on a change. No ComfyUI, no network.
import os
import shutil
import tempfile
import unittest
from unittest import mock

import jobs
from supa import SupaError
from test_jobs import FakeRenderer, FakeSupa, job

MISSING = SupaError('POST /rest/v1/rpc/claim_next_job -> HTTP 404 {"code":"PGRST202","message":"Could not find the function"}')


class Clock:
    """Stands in for time.time() in jobs (patched), so minutes pass in a test without waiting."""

    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class OneClaimSupa(FakeSupa):
    """FakeSupa with migration 020: claim_next_job hands out queued {kind, job} answers."""

    def __init__(self, missing=False):
        super().__init__()
        self.claims = []          # {kind, job} answers, in order
        self.missing = missing    # True = a database without 020
        self.claim_error = None

    def rpc(self, fn, args=None):
        if fn != "claim_next_job":
            return super().rpc(fn, args)
        self.rpcs.append(fn)
        self.rpc_args.append(args)
        if self.missing:
            raise MISSING
        if self.claim_error:
            raise self.claim_error
        return self.claims.pop(0) if self.claims else None


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.clock = Clock()
        for target in ("jobs.time.time",):
            p = mock.patch(target, self.clock)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch("jobs.time.sleep")
        p.start()
        self.addCleanup(p.stop)
        self.supa = OneClaimSupa()
        self.reels = mock.Mock()
        self.logs = []
        self.r = FakeRenderer()
        self.run_ = jobs.Runner(self.supa, self.r, os.path.join(self.root, "out"), os.path.join(self.root, "cache"),
                                log=self.logs.append, reels=self.reels)

    def claim_args(self):
        return [a for f, a in zip(self.supa.rpcs, self.supa.rpc_args) if f == "claim_next_job"]


class OneClaimTest(Base):
    def test_an_idle_poll_is_one_request(self):
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["claim_next_job"])
        self.assertEqual(self.supa.rpc_args, [{"p_comfy_ok": True, "p_music": True, "p_requeue": True}])

    def test_requeue_once_a_minute(self):
        for _ in range(20):                       # a minute of 3 s polls
            self.run_.tick()
            self.clock.t += 3
        flags = [a["p_requeue"] for a in self.claim_args()]
        self.assertEqual(flags, [True] + [False] * 19)
        self.run_.tick()                          # 60 s after the last requeue
        self.assertTrue(self.claim_args()[-1]["p_requeue"])
        self.assertEqual(len(self.supa.rpcs), 21)  # still one request a poll

    def test_comfy_closed_is_passed_on(self):
        self.run_.renderer = FakeRenderer(ok=False)
        self.run_.tick()
        self.assertEqual(self.claim_args()[-1], {"p_comfy_ok": False, "p_music": True, "p_requeue": True})

    def test_card_job_runs_like_before(self):
        self.supa.claims.append({"kind": "card", "job": job()})
        self.assertTrue(self.run_.tick())
        self.assertIn("cards/c1/v1.jpg", self.supa.uploads)
        self.assertEqual([u for u in self.supa.updates if u[0] == "cards"][-1][2]["status"], "done")
        self.assertEqual(self.r.composed, [("Arlo Zenith", "peak strength", "@unique_names")])
        self.assertEqual(self.supa.rpcs, ["claim_next_job"])   # no claim_next_card / requeue calls
        self.assertIsNone(self.run_.current)
        self.assertFalse(self.run_.busy)

    def test_card_restamp_with_comfy_closed(self):
        self.run_.renderer = FakeRenderer(ok=False)
        self.supa.claims.append({"kind": "card", "job": job("restamp", version=2, card_path="cards/c1/v1.jpg")})
        self.assertTrue(self.run_.tick())       # no photo stored: falls back to generate, which needs ComfyUI
        self.assertIn("Open ComfyUI Desktop", [u for u in self.supa.updates if u[0] == "cards"][-1][2]["error"])

    def test_reel_step_sample_and_preview_go_to_the_reel_runner(self):
        busy = []
        self.reels.run_step.side_effect = lambda j: busy.append(self.run_.busy)
        self.reels.run_sample.side_effect = lambda j: busy.append(self.run_.busy)
        self.reels.run_theme_preview.side_effect = lambda j: busy.append(self.run_.busy)
        step = {"step": "image", "reel": {"id": "r1", "title": "t"}, "scene": {"id": "s1", "position": 2}}
        sample = {"voice": {"id": "kore", "version": 2}}
        preview = {"theme": {"id": "clay", "version": 1}}
        self.supa.claims += [{"kind": "reel_step", "job": step}, {"kind": "voice_sample", "job": sample},
                             {"kind": "theme_preview", "job": preview}]
        self.assertTrue(self.run_.tick())
        self.assertTrue(self.run_.tick())
        self.assertTrue(self.run_.tick())
        self.reels.run_step.assert_called_once_with(step)
        self.reels.run_sample.assert_called_once_with(sample)
        self.reels.run_theme_preview.assert_called_once_with(preview)
        self.assertEqual(busy, [True, True, True])
        self.assertFalse(self.run_.busy)
        self.assertEqual(self.supa.rpcs, ["claim_next_job"] * 3)
        self.assertTrue(any("reel image: t image 2 (r1)" in m for m in self.logs))
        self.assertTrue(any("voice sample: kore" in m for m in self.logs))
        self.assertTrue(any("theme preview: clay" in m for m in self.logs))

    def test_an_unknown_kind_is_logged_not_run(self):
        self.supa.claims.append({"kind": "clip", "job": {"id": "x"}})
        self.assertFalse(self.run_.tick())
        self.assertTrue(any("unknown job kind" in m and "clip" in m for m in self.logs))
        self.reels.run_step.assert_not_called()

    def test_found_is_logged_once(self):
        self.run_.tick()
        self.run_.tick()
        self.assertEqual(len([m for m in self.logs if "020 found" in m]), 1)

    def test_network_errors_reach_the_loop(self):
        self.supa.claim_error = SupaError("POST /rest/v1/rpc/claim_next_job -> network error: timed out")
        with self.assertRaises(SupaError):
            self.run_.tick()
        self.assertEqual(self.supa.rpcs, ["claim_next_job"])   # not a fallback to the old calls

    def test_a_refused_claim_is_not_a_fallback(self):
        self.supa.claim_error = SupaError("POST /rest/v1/rpc/claim_next_job -> HTTP 400 bad")
        with self.assertRaises(SupaError):
            self.run_.tick()
        self.assertEqual(self.run_.one_claim_off_until, 0.0)

    def test_a_cards_only_runner_never_asks_for_reel_work(self):
        self.run_.reels = None
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["requeue_stuck_cards", "claim_next_card"])


class FallbackTest(Base):
    """A database without 020: the old calls, checked again every 10 minutes."""

    def setUp(self):
        super().setUp()
        self.supa.missing = True

    def test_old_calls_and_one_log_line(self):
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["claim_next_job", "requeue_stuck_cards", "claim_next_card", "requeue_stuck_reels",
                                          "claim_next_reel_step", "claim_next_voice_sample", "claim_next_theme_preview"])
        self.clock.t += 3
        self.supa.rpcs.clear()
        self.assertFalse(self.run_.tick())
        # not asked again for 10 minutes; the requeue only once a minute on the old path too
        self.assertEqual(self.supa.rpcs, ["claim_next_card", "claim_next_reel_step", "claim_next_voice_sample", "claim_next_theme_preview"])
        self.assertEqual(len([m for m in self.logs if "020_one_claim.sql" in m]), 1)

    def test_old_requeue_once_a_minute(self):
        for _ in range(21):
            self.run_.tick()
            self.clock.t += 3
        self.assertEqual(self.supa.rpcs.count("requeue_stuck_cards"), 2)   # at 0 s and 60 s
        self.assertEqual(self.supa.rpcs.count("requeue_stuck_reels"), 2)

    def test_old_path_cards_and_reels_still_run(self):
        self.supa.jobs.append(job())
        self.assertTrue(self.run_.tick())
        self.assertIn("cards/c1/v1.jpg", self.supa.uploads)

    def test_rechecked_after_10_minutes_and_switched_on(self):
        self.run_.tick()
        self.clock.t += 599
        self.run_.tick()
        self.assertEqual(self.supa.rpcs.count("claim_next_job"), 1)
        self.clock.t += 1
        self.run_.tick()
        self.assertEqual(self.supa.rpcs.count("claim_next_job"), 2)        # still missing: logged once only
        self.assertEqual(len([m for m in self.logs if "020_one_claim.sql" in m]), 1)
        self.clock.t += 600
        self.supa.missing = False                                          # the owner ran 020
        self.supa.rpcs.clear()
        self.run_.tick()
        self.assertEqual(self.supa.rpcs, ["claim_next_job"])
        self.assertEqual(len([m for m in self.logs if "020 found" in m]), 1)


class IdleTest(Base):
    def test_poll_fast_for_a_minute_after_a_job_then_every_15_s(self):
        self.assertEqual(self.run_.idle_wait(), 3.0)          # just started
        self.clock.t += 59
        self.assertEqual(self.run_.idle_wait(), 3.0)
        self.clock.t += 1
        self.assertEqual(self.run_.idle_wait(), 15.0)         # a minute with nothing to do
        self.supa.claims.append({"kind": "reel_step", "job": {"step": "timing", "reel": {"id": "r", "title": "t"}}})
        self.assertTrue(self.run_.tick())
        self.assertEqual(self.run_.idle_wait(), 3.0)          # back to 3 s at once after any job
        self.assertFalse(self.run_.tick())                    # an empty poll does not reset it
        self.clock.t += 60
        self.assertEqual(self.run_.idle_wait(), 15.0)

    def test_a_slow_poll_setting_is_never_made_faster(self):
        self.run_.poll_seconds = 20.0
        self.clock.t += 120
        self.assertEqual(self.run_.idle_wait(), 20.0)
        self.assertEqual(jobs.idle_poll_seconds(0, 3.0), 3.0)
        self.assertEqual(jobs.idle_poll_seconds(jobs.IDLE_AFTER_SECONDS, 3.0), jobs.IDLE_POLL_SECONDS)

    def test_run_forever_waits_the_idle_time(self):
        waits = []

        def wait(seconds):
            waits.append(seconds)
            self.clock.t += seconds
            if len(waits) >= 30:
                self.run_.stop_event.set()
            return self.run_.stop_event.is_set()
        self.run_.stop_event.wait = wait
        self.supa.claims.append({"kind": "voice_sample", "job": {"voice": {"id": "kore"}}})
        with mock.patch("jobs.threading.Thread"):              # no heartbeat thread in this test
            self.run_.run_forever()
        self.assertEqual(waits[:20], [3.0] * 20)               # 60 s of 3 s polls after the job
        self.assertEqual(set(waits[20:]), {15.0})
        self.assertEqual(len(self.claim_args()), 31)           # the job's poll + one per wait


class HeartbeatTest(Base):
    def beats(self):
        return [u for u in self.supa.updates if u[0] == "worker_status"]

    def test_once_a_minute_while_nothing_changes(self):
        self.assertTrue(self.run_.heartbeat_tick())            # at once on start
        for _ in range(11):                                    # the 5 s local looks of the next 55 s
            self.clock.t += 5
            self.assertFalse(self.run_.heartbeat_tick())
        self.clock.t += 5
        self.assertTrue(self.run_.heartbeat_tick())            # 60 s
        self.assertEqual(len(self.beats()), 2)
        self.assertEqual(self.run_.heartbeat_seconds, 60.0)
        self.assertEqual(jobs.HEARTBEAT_CHECK_SECONDS, 5.0)

    def test_at_once_when_comfyui_opens_or_closes(self):
        self.run_.heartbeat_tick()
        self.clock.t += 5
        self.r.ok = False
        self.assertTrue(self.run_.heartbeat_tick())
        self.assertFalse(self.beats()[-1][2]["comfyui_ok"])
        self.assertIn("not reachable", self.beats()[-1][2]["message"])
        self.clock.t += 5
        self.assertFalse(self.run_.heartbeat_tick())
        self.r.ok = True
        self.clock.t += 5
        self.assertTrue(self.run_.heartbeat_tick())
        self.assertTrue(self.beats()[-1][2]["comfyui_ok"])

    def test_on_the_next_look_when_the_pc_starts_or_stops_a_card(self):
        self.run_.heartbeat_tick()
        self.clock.t += 5
        self.run_.current = "c1"
        self.assertFalse(self.run_.heartbeat_tick())          # busy now: sent once the next look agrees
        self.clock.t += 5
        self.assertTrue(self.run_.heartbeat_tick())
        self.assertEqual(self.beats()[-1][2]["current_card_id"], "c1")
        self.clock.t += 5
        self.run_.current = "c2"                              # the next card of the same post: still busy
        self.assertFalse(self.run_.heartbeat_tick())
        self.clock.t += 5
        self.run_.current = None
        self.assertFalse(self.run_.heartbeat_tick())
        self.clock.t += 5
        self.assertTrue(self.run_.heartbeat_tick())
        self.assertIsNone(self.beats()[-1][2]["current_card_id"])

    def test_the_moment_between_two_jobs_is_not_sent_as_idle(self):
        self.run_.current = "c1"
        self.run_.heartbeat_tick()
        for i in range(11):                                   # card after card; one look lands between two of them
            self.clock.t += 5
            self.run_.current = None if i == 4 else "c%d" % i
            self.assertFalse(self.run_.heartbeat_tick())
        self.assertEqual(len(self.beats()), 1)

    def test_when_the_other_page_gets_busy(self):
        other = {"busy": False}
        self.run_.busy_elsewhere = lambda: other["busy"]
        self.run_.heartbeat_tick()
        self.clock.t += 5
        other["busy"] = True
        self.assertFalse(self.run_.heartbeat_tick())
        self.clock.t += 5
        self.assertTrue(self.run_.heartbeat_tick())           # within 10 s
        self.assertEqual(self.beats()[-1][2]["message"], jobs.BUSY_ELSEWHERE)
        self.clock.t += 5
        other["busy"] = False
        self.assertFalse(self.run_.heartbeat_tick())
        self.clock.t += 5
        self.assertTrue(self.run_.heartbeat_tick())
        self.assertIsNone(self.beats()[-1][2]["message"])

    def test_a_failed_heartbeat_is_retried_after_15_s_not_every_look(self):
        self.supa.fail_updates = 99
        self.assertFalse(self.run_.heartbeat_tick())
        self.assertEqual(len([m for m in self.logs if "heartbeat failed" in m]), 1)
        for _ in range(2):
            self.clock.t += 5
            self.assertFalse(self.run_.heartbeat_tick())
        self.assertEqual(len([m for m in self.logs if "heartbeat failed" in m]), 1)
        self.supa.fail_updates = 0
        self.clock.t += 5                                      # 15 s after the failure
        self.assertTrue(self.run_.heartbeat_tick())

    def test_the_loop_looks_every_5_s(self):
        waits = []

        def wait(seconds):
            waits.append(seconds)
            self.clock.t += seconds
            if len(waits) >= 24:
                self.run_.stop_event.set()
            return self.run_.stop_event.is_set()
        self.run_.stop_event.wait = wait
        self.run_._heartbeat_loop()
        self.assertEqual(set(waits), {5.0})
        self.assertEqual(len(self.beats()), 2)                 # 2 minutes: 0 s and 60 s (120 s is the next one)

    def test_payload_is_unchanged(self):
        self.run_.current = "c9"
        self.run_.heartbeat_tick()
        values = self.beats()[-1][2]
        self.assertEqual(set(values), {"last_seen", "comfyui_ok", "gpu", "current_card_id", "worker_version", "message"})
        self.assertEqual((values["gpu"], values["worker_version"]), ("Fake GPU", jobs.VERSION))


class VersionTest(unittest.TestCase):
    def test_version(self):
        self.assertEqual(jobs.VERSION, "2.8.0")


if __name__ == "__main__":
    unittest.main()
