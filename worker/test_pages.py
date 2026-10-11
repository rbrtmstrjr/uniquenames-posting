# One worker serving several pages (Supabase projects): config discovery, round-robin, backoff, heartbeats,
# per-page folders and ComfyUI names. No ComfyUI, no network.
import os
import shutil
import tempfile
import threading
import unittest
from unittest import mock

import jobs
import music
import pages
import reels
import render
import themes
import voice
from supa import SupaError
from test_jobs import FakeRenderer, FakeSupa, job


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


BASE = {"SUPABASE_URL": "https://un.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k-un", "OUTPUT_ROOT": ""}
NEST = "PAGE_ID=name-nest\nSUPABASE_URL=https://nn.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k-nn\n"


class DiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.here = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.here, True)

    def pages_file(self, name, text):
        write(os.path.join(self.here, "pages", name), text)

    def test_only_worker_env_is_unique_names_as_today(self):
        found, problems = pages.discover_pages(self.here, dict(BASE))
        self.assertEqual(problems, [])
        self.assertEqual([p.id for p in found], ["unique-names"])
        p = found[0]
        self.assertEqual(p.label, "Unique Names")
        self.assertEqual((p.url, p.key), ("https://un.supabase.co", "k-un"))
        self.assertEqual(p.output_root, render.default_output_root())       # empty OUTPUT_ROOT = Pictures\Unique Names
        self.assertIsNone(p.reels_dir)                                       # = <output_root>\Reels, as today
        self.assertEqual(p.cache_dir, os.path.join(self.here, "cache"))      # the existing cache + backup index
        self.assertIsNone(p.preview_cast)
        self.assertEqual(p.source, "worker.env")

    def test_worker_env_output_root_is_kept(self):
        found, _ = pages.discover_pages(self.here, dict(BASE, OUTPUT_ROOT=r"D:\Cards"))
        self.assertEqual(found[0].output_root, r"D:\Cards")

    def test_nothing_configured(self):
        self.assertEqual(pages.discover_pages(self.here, {}), ([], []))

    def test_worker_env_plus_a_page_file(self):
        self.pages_file("name-nest.env", NEST + "PAGE_LABEL=Name Nest\nOUTPUT_ROOT=C:\\x\\Name Nest\nREELS_OUTPUT=C:\\x\\NN Reels\n")
        found, problems = pages.discover_pages(self.here, dict(BASE))
        self.assertEqual(problems, [])
        self.assertEqual([p.id for p in found], ["unique-names", "name-nest"])   # worker.env first
        nn = found[1]
        self.assertEqual((nn.label, nn.url, nn.key), ("Name Nest", "https://nn.supabase.co", "k-nn"))
        self.assertEqual(nn.output_root, "C:\\x\\Name Nest")
        self.assertEqual(nn.reels_dir, "C:\\x\\NN Reels")
        self.assertEqual(nn.cache_dir, os.path.join(self.here, "cache", "name-nest"))
        self.assertEqual(nn.source, os.path.join("pages", "name-nest.env"))

    def test_page_defaults_from_its_id(self):
        self.pages_file("name-nest.env", "SUPABASE_URL=https://nn.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n")
        found, _ = pages.discover_pages(self.here, {})
        self.assertEqual(found[0].id, "name-nest")                             # PAGE_ID = the file name
        self.assertEqual(found[0].label, "Name Nest")
        self.assertEqual(found[0].output_root, render.default_output_root("Name Nest"))

    def test_page_file_with_the_same_id_covers_worker_env(self):
        self.pages_file("un.env", "PAGE_ID=unique-names\nSUPABASE_URL=https://other.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k2\n")
        found, problems = pages.discover_pages(self.here, dict(BASE))
        self.assertEqual(problems, [])
        self.assertEqual([(p.id, p.url) for p in found], [("unique-names", "https://other.supabase.co")])
        self.assertEqual(found[0].cache_dir, os.path.join(self.here, "cache"))  # unique-names keeps the old cache

    def test_page_file_pointing_at_worker_env_project_never_takes_it_over(self):
        # A pages file aimed at the live (worker.env) project under another id must not rename the live page
        # (its ComfyUI namespace, cache / backup index and output folder would change): worker.env keeps it.
        self.pages_file("main.env", "PAGE_ID=main\nSUPABASE_URL=https://UN.supabase.co/\nSUPABASE_SERVICE_ROLE_KEY=k2\n")
        found, problems = pages.discover_pages(self.here, dict(BASE))
        self.assertEqual([p.id for p in found], ["unique-names"])              # never two loops on one project
        self.assertEqual(found[0].cache_dir, os.path.join(self.here, "cache"))
        self.assertEqual(len(problems), 1)
        self.assertIn("pages/main.env skipped", problems[0].replace("\\", "/"))
        self.assertIn("worker.env", problems[0])

    def test_worker_env_without_keys_but_page_files(self):
        self.pages_file("name-nest.env", NEST)
        found, problems = pages.discover_pages(self.here, {"COMFY_URL": "http://127.0.0.1:8188"})
        self.assertEqual(([p.id for p in found], problems), (["name-nest"], []))

    def test_bad_page_files_are_skipped_with_a_reason(self):
        self.pages_file("a.env", "PAGE_ID=name-nest\nSUPABASE_URL=https://nn.supabase.co\n")         # no key
        self.pages_file("b.env", "PAGE_ID=Name Nest!\nSUPABASE_URL=https://b.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n")
        self.pages_file("c.env", NEST)
        self.pages_file("d.env", NEST.replace("https://nn", "https://dd"))                           # same id again
        self.pages_file("e.env", "PAGE_ID=e\nSUPABASE_URL=https://nn.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n")  # same project
        found, problems = pages.discover_pages(self.here, dict(BASE))
        self.assertEqual([p.id for p in found], ["unique-names", "name-nest"])
        self.assertEqual(found[1].source, os.path.join("pages", "c.env"))
        text = "\n".join(problems)
        self.assertEqual(len(problems), 4)
        self.assertIn("a.env", text)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", text)
        self.assertIn("b.env", text)
        self.assertIn("d.env", text)
        self.assertIn("e.env", text)

    def test_examples_and_other_files_are_ignored(self):
        self.pages_file("example.env.example", NEST)
        self.pages_file("README.md", "x")
        found, problems = pages.discover_pages(self.here, dict(BASE))
        self.assertEqual(([p.id for p in found], problems), (["unique-names"], []))

    def test_preview_cast_per_page(self):
        self.pages_file("name-nest.env", NEST + "PREVIEW_MOMENT=a dad reading to his toddler\nPREVIEW_CAST=the dad: tall\n")
        found, _ = pages.discover_pages(self.here, {})
        self.assertEqual(found[0].preview_cast, {"moment": "a dad reading to his toddler", "cast": "the dad: tall"})

    def test_shipped_example_parses(self):
        here = os.path.dirname(os.path.abspath(__file__))
        cfg = render.load_env(os.path.join(here, "pages", "example.env.example"))
        for k in ("PAGE_ID", "PAGE_LABEL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OUTPUT_ROOT", "REELS_OUTPUT"):
            self.assertIn(k, cfg)
        self.assertTrue(pages.PAGE_ID.match(cfg["PAGE_ID"]))


class BuildRunnerTest(unittest.TestCase):
    def setUp(self):
        self.here = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.here, True)

    def test_single_page_runner_matches_today(self):
        (p,), _ = pages.discover_pages(self.here, dict(BASE))
        logs = []
        r = pages.build_runner(p, {"COMFY_URL": "http://127.0.0.1:8188"}, logs.append, prefix=False)
        self.assertIsInstance(r, jobs.Runner)
        self.assertEqual(r.supa.url, "https://un.supabase.co")
        self.assertEqual(r.renderer.comfy, "http://127.0.0.1:8188")
        self.assertEqual(r.renderer.namespace, "unique-names")
        self.assertEqual(r.output_root, render.default_output_root())
        self.assertEqual(r.reels.output_root, r.output_root)
        self.assertEqual(r.poll_seconds, 3.0)
        self.assertEqual(r.heartbeat_seconds, 15.0)
        r.log("hello")
        self.assertEqual(logs, ["hello"])                                     # no prefix with one page

    def test_page_runner_has_its_own_names_folders_and_prefix(self):
        write(os.path.join(self.here, "pages", "name-nest.env"), NEST + "OUTPUT_ROOT=C:\\nn\nREELS_OUTPUT=C:\\nn-reels\n")
        found, _ = pages.discover_pages(self.here, dict(BASE))
        logs = []
        r = pages.build_runner(found[1], {"POLL_SECONDS": "5", "GENERATE_TIMEOUT_SECONDS": "200"}, logs.append, prefix=True)
        self.assertEqual(r.supa.url, "https://nn.supabase.co")
        self.assertEqual(r.renderer.namespace, "name-nest")
        self.assertEqual(r.renderer.timeout, 200)
        self.assertEqual((r.output_root, r.cache_dir), ("C:\\nn", os.path.join(self.here, "cache", "name-nest")))
        self.assertEqual(r.reels.reels_dir, "C:\\nn-reels")
        self.assertEqual(r.poll_seconds, 5.0)
        r.log("claimed")
        r.reels.log("reel voice 1/3")
        self.assertEqual(logs, ["[name-nest] claimed", "[name-nest] reel voice 1/3"])


class ComfyNamesTest(unittest.TestCase):
    """Each page's files in ComfyUI live under its own name; unique-names keeps today's names exactly."""

    def test_defaults_are_todays_names(self):
        self.assertEqual(render.comfy_client_id(None), "unique-names-worker")
        self.assertEqual(render.ComfyRenderer("http://c", 30).namespace, "unique-names")
        self.assertEqual(voice.chatterbox_graph("Hi.", 1)["2"]["inputs"]["filename_prefix"], "unique-names/reel-voice")
        self.assertEqual(music.ace_step_graph(5, 1)["10"]["inputs"]["filename_prefix"], "unique-names/reel-music")

    def test_page_names(self):
        self.assertEqual(render.comfy_client_id("name-nest"), "name-nest-worker")
        self.assertEqual(voice.chatterbox_graph("Hi.", 1, ns="name-nest")["2"]["inputs"]["filename_prefix"], "name-nest/reel-voice")
        self.assertEqual(music.ace_step_graph(5, 1, ns="name-nest")["10"]["inputs"]["filename_prefix"], "name-nest/reel-music")

    def test_image_job_uses_the_page_prefix_and_client(self):
        r = render.ComfyRenderer("http://c", 30, namespace="name-nest")
        r.fast = True
        sent = []

        def fake_http(url, body=None, timeout=30):
            sent.append(body)
            raise RuntimeError("stop here")
        with mock.patch.object(render, "http_json", fake_http):
            with self.assertRaises(render.JobError):
                r.generate_photo("p", 1, 1088, 1920)
        self.assertEqual(sent[0]["client_id"], "name-nest-worker")
        self.assertEqual(sent[0]["prompt"]["10"]["inputs"]["filename_prefix"], "name-nest/raw")

    def test_voice_and_music_jobs_use_the_page_client(self):
        sent = []

        def fake_http(url, body=None, timeout=30):
            sent.append(body)
            raise RuntimeError("stop here")
        with mock.patch.object(voice, "http_json", fake_http), mock.patch.object(voice, "ensure_node"):
            with self.assertRaises(render.JobError):
                voice.synthesize("http://c", "Hi.", 1, None, 5, ns="name-nest")
        with mock.patch.object(music, "http_json", fake_http):
            with self.assertRaises(render.JobError):
                music.make_bed("http://c", 5, 1, 5, ns="name-nest")
        self.assertEqual([b["client_id"] for b in sent], ["name-nest-worker", "name-nest-worker"])
        self.assertEqual(sent[0]["prompt"]["2"]["inputs"]["filename_prefix"], "name-nest/reel-voice")
        self.assertEqual(sent[1]["prompt"]["10"]["inputs"]["filename_prefix"], "name-nest/reel-music")

    def test_reel_voice_lines_carry_the_page_namespace(self):
        seen = []

        def synth(url, text, seed, ref, timeout, keep_loaded=False, ns=None):
            seen.append(ns)
            return b""
        with mock.patch.object(voice, "synthesize", synth), mock.patch.object(voice, "has_speech", return_value=True), \
                mock.patch.object(voice, "wav_pcm", return_value=b""), mock.patch.object(voice, "join_lines", return_value=b"w"):
            voice.narrate_lines("http://c", ["One.", "Two."], 1, None, 30, ns="name-nest")
        self.assertEqual(seen, ["name-nest", "name-nest"])

    def test_voice_clip_upload_goes_to_the_page_subfolder(self):
        bodies = []

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"name": "voices-x-ref-v1.wav", "subfolder": "name-nest"}'

        def fake_open(req, timeout=60):
            bodies.append(req.data)
            return Resp()
        with mock.patch.object(voice.urllib.request, "urlopen", fake_open):
            name = voice.upload_input("http://c", "voices-x-ref-v1.wav", b"RIFF", ns="name-nest")
        self.assertEqual(name, "name-nest/voices-x-ref-v1.wav")
        self.assertIn(b'name="subfolder"\r\n\r\nname-nest\r\n', bodies[0])


class PreviewCastTest(unittest.TestCase):
    def test_default_cast_is_todays(self):
        knitted = themes.preview_prompt({"id": "knitted", "style": "S."})
        self.assertIn(themes.MOMENT, knitted)
        self.assertIn(themes.DOLL_CAST, knitted)
        self.assertEqual(themes.preview_prompt({"id": "x", "style": "S."}, None), themes.preview_prompt({"id": "x", "style": "S."}))

    def test_page_cast_replaces_the_moment_and_cast(self):
        cast = {"moment": "a dad reading to his toddler", "cast": "the dad: tall", "doll_cast": "the dad doll: yarn"}
        p = themes.preview_prompt({"id": "watercolor", "style": "S."}, cast)
        self.assertIn("a dad reading to his toddler", p)
        self.assertIn("the dad: tall", p)
        self.assertNotIn(themes.MOMENT, p)
        self.assertIn("the dad doll: yarn", themes.preview_prompt({"id": "knitted", "style": "S."}, cast))
        partial = themes.preview_prompt({"id": "x", "style": "S."}, {"moment": "a nap"})
        self.assertIn(themes.CAST, partial)                                   # unset parts keep today's text
        self.assertEqual(themes.preview_prompt({"preview_prompt": "Saved."}, cast), "Saved.")

    def test_reel_runner_passes_the_page_cast(self):
        rr = reels.ReelRunner(None, None, preview_cast={"moment": "a nap"})
        self.assertEqual(rr.preview_cast, {"moment": "a nap"})


class FakeRunner:
    """Stands in for jobs.Runner in the round-robin: work = how many jobs it has; boom = tick raises."""

    def __init__(self, name, order, work=0, boom=None):
        self.name, self.order, self.work, self.boom = name, order, work, boom
        self.ticks = 0
        self.logs = []
        self.log = self.logs.append
        self.stop_event = threading.Event()
        self.beats = 0
        self.sweeps = 0

    def tick(self):
        self.ticks += 1
        if self.boom:
            raise self.boom
        if self.work <= 0:
            return False
        self.work -= 1
        self.order.append(self.name)
        return True

    def sweep_old_previews(self):
        self.sweeps += 1

    def heartbeat_once(self):
        self.beats += 1

    def _heartbeat_loop(self):
        while not self.stop_event.is_set():
            self.heartbeat_once()
            self.stop_event.wait(0.01)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class RoundRobinTest(unittest.TestCase):
    def make(self, *specs):
        self.order, self.clock = [], Clock()
        rs = [FakeRunner(n, self.order, **kw) for n, kw in specs]
        return pages.MultiRunner([(r.name, r) for r in rs], poll_seconds=3, log=lambda m: None, clock=self.clock), rs

    def test_pages_take_turns(self):
        m, _ = self.make(("a", {"work": 5}), ("b", {"work": 5}), ("c", {"work": 5}))
        for _ in range(9):
            self.assertTrue(m.tick())
        self.assertEqual(self.order, ["a", "b", "c"] * 3)

    def test_a_busy_page_never_starves_a_quiet_one(self):
        m, _ = self.make(("a", {"work": 100}), ("b", {"work": 2}))
        for _ in range(6):
            m.tick()
        self.assertEqual(self.order, ["a", "b", "a", "b", "a", "a"])

    def test_an_idle_page_is_passed_over_in_the_same_turn(self):
        m, (a, b) = self.make(("a", {"work": 0}), ("b", {"work": 3}))
        self.assertTrue(m.tick())
        self.assertEqual(self.order, ["b"])
        self.assertEqual(a.ticks, 1)

    def test_nothing_to_do(self):
        m, (a, b) = self.make(("a", {}), ("b", {}))
        self.assertFalse(m.tick())
        self.assertEqual((a.ticks, b.ticks), (1, 1))

    def test_one_job_per_turn(self):
        # a whole job (a reel's voice step: every line with Chatterbox kept loaded) runs inside one tick;
        # the next page only gets ComfyUI once that tick has returned
        m, (a, b) = self.make(("a", {"work": 1}), ("b", {"work": 1}))
        m.tick()
        self.assertEqual((a.ticks, b.ticks), (1, 0))

    def test_unreachable_page_is_skipped_with_backoff(self):
        m, (a, b) = self.make(("a", {"boom": SupaError("POST x -> network error: timed out")}), ("b", {"work": 10}))
        self.assertTrue(m.tick())                     # a fails, b still runs in the same turn
        self.assertEqual(self.order, ["b"])
        self.assertIn("network error", a.logs[-1])
        self.assertIn("3", a.logs[-1])                # retrying in 3 s
        m.tick()
        m.tick()
        self.assertEqual(a.ticks, 1)                  # skipped while backing off
        self.clock.t += 3
        m.tick()
        self.assertEqual(a.ticks, 2)                  # tried again, failed again: 6 s now
        self.clock.t += 5
        m.tick()
        self.assertEqual(a.ticks, 2)
        self.clock.t += 1
        m.tick()
        self.assertEqual(a.ticks, 3)
        for _ in range(12):                           # the wait doubles up to the cap
            self.clock.t += 10000
            m.tick()
        self.assertEqual(m.slots[0].backoff, pages.MAX_BACKOFF)

    def test_backoff_resets_once_the_page_answers(self):
        m, (a, b) = self.make(("a", {"boom": SupaError("down")}), ("b", {}))
        m.tick()
        self.clock.t += 3
        m.tick()
        self.assertEqual(m.slots[0].backoff, 12)
        a.boom, a.work = None, 1
        self.clock.t += 6
        self.assertTrue(m.tick())
        self.assertEqual(m.slots[0].backoff, 3)
        self.assertEqual(m.slots[0].off_until, 0.0)

    def test_previews_sweep_per_page_but_not_while_backing_off(self):
        m, (a, b) = self.make(("a", {"boom": SupaError("down")}), ("b", {}))
        m.tick()
        m.tick()
        self.assertEqual((a.sweeps, b.sweeps), (1, 2))

    def test_heartbeat_per_page(self):
        m, (a, b) = self.make(("a", {}), ("b", {}))
        threads = m.start_heartbeats()
        self.assertEqual(len(threads), 2)
        deadline = __import__("time").time() + 5
        while (a.beats < 2 or b.beats < 2) and __import__("time").time() < deadline:
            __import__("time").sleep(0.01)
        m.stop()
        for t in threads:
            t.join(2)
        self.assertGreaterEqual(a.beats, 2)
        self.assertGreaterEqual(b.beats, 2)
        self.assertTrue(a.stop_event.is_set() and b.stop_event.is_set())


class TwoPagesEndToEndTest(unittest.TestCase):
    """Two real job loops (in-memory Supabase each): each page's card lands in its own project and folder."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        p = mock.patch("jobs.time.sleep")
        p.start()
        self.addCleanup(p.stop)

    def runner(self, page_id, handle):
        s = FakeSupa()
        s.settings = [{"handle": handle, "width": 1080, "height": 1080}]
        r = jobs.Runner(s, FakeRenderer(), os.path.join(self.root, page_id), os.path.join(self.root, "cache", page_id),
                        log=lambda m: None)
        return s, r

    def test_cards_go_to_their_own_page(self):
        su, ru = self.runner("Unique Names", "@unique_names")
        sn, rn = self.runner("Name Nest", "@namenest")
        su.jobs += [job(), job(id="c2", position=4, name="Zuri")]
        sn.jobs += [job(id="n1", name="Olivia")]
        m = pages.MultiRunner([("unique-names", ru), ("name-nest", rn)], poll_seconds=3, log=lambda m: None)
        self.assertTrue(m.tick())
        self.assertTrue(m.tick())
        self.assertTrue(m.tick())
        self.assertFalse(m.tick())
        folder = "2026-10-05 Boy Two-word"
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "Unique Names", folder))), ["03-arlo-zenith.jpg", "04-zuri.jpg"])
        self.assertEqual(os.listdir(os.path.join(self.root, "Name Nest", folder)), ["03-olivia.jpg"])
        self.assertEqual(sorted(su.uploads), ["cards/c1/v1.jpg", "cards/c2/v1.jpg", "photos/c1/v1.jpg", "photos/c2/v1.jpg"])
        self.assertEqual(sorted(sn.uploads), ["cards/n1/v1.jpg", "photos/n1/v1.jpg"])
        self.assertEqual([c[2] for c in rn.renderer.composed], ["@namenest"])  # the watermark comes from that page's settings
        self.assertEqual({c[2] for c in ru.renderer.composed}, {"@unique_names"})
        self.assertTrue(os.path.exists(os.path.join(self.root, "cache", "Name Nest", "backup-index.json")))


class BusyElsewhereTest(unittest.TestCase):
    """2.7.1: while the shared PC works for one page, the other pages' status says so (worker_status.message)."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        p = mock.patch("jobs.time.sleep")
        p.start()
        self.addCleanup(p.stop)

    def runner(self, page_id, renderer=None):
        s = FakeSupa()
        r = jobs.Runner(s, renderer or FakeRenderer(), os.path.join(self.root, page_id), os.path.join(self.root, "cache", page_id),
                        log=lambda m: None)
        return s, r

    @staticmethod
    def message(supa):
        return [u for u in supa.updates if u[0] == "worker_status"][-1][2]["message"]

    def test_the_other_page_says_busy_while_one_page_works(self):
        su, ru = self.runner("un")
        sn, rn = self.runner("nn")
        pages.MultiRunner([("unique-names", ru), ("name-nest", rn)], poll_seconds=3, log=lambda m: None)
        ru.busy = True
        rn.heartbeat_once()
        ru.heartbeat_once()
        self.assertEqual(self.message(sn), jobs.BUSY_ELSEWHERE)
        self.assertEqual(jobs.BUSY_ELSEWHERE, "PC busy with your other page")
        self.assertIsNone(self.message(su))           # the page being served looks ready, as today
        ru.busy = False
        rn.heartbeat_once()
        self.assertIsNone(self.message(sn))

    def test_busy_is_set_only_while_a_job_runs(self):
        seen = []

        class Watching(FakeRenderer):
            def generate_photo(inner, *a):
                rn.heartbeat_once()
                seen.append((ru.busy, self.message(sn)))
                return FakeRenderer.generate_photo(inner, *a)

        su, ru = self.runner("un", Watching())
        sn, rn = self.runner("nn")
        m = pages.MultiRunner([("unique-names", ru), ("name-nest", rn)], poll_seconds=3, log=lambda m: None)
        su.jobs.append(job())
        self.assertTrue(m.tick())
        self.assertEqual(seen, [(True, jobs.BUSY_ELSEWHERE)])
        self.assertFalse(ru.busy)
        self.assertFalse(m.tick())                    # polling with nothing to do is not "busy"
        rn.heartbeat_once()
        self.assertIsNone(self.message(sn))

    def test_reel_steps_count_as_busy(self):
        seen = []
        su, ru = self.runner("un")
        sn, rn = self.runner("nn")
        pages.MultiRunner([("unique-names", ru), ("name-nest", rn)], poll_seconds=3, log=lambda m: None)

        class Reels:
            def run_step(self_, step):
                seen.append(ru.busy)

        ru.reels = Reels()
        su.rpc = lambda fn, args=None: {"step": "voice", "reel": {"id": "r1", "title": "t"}} if fn == "claim_next_reel_step" else None
        self.assertTrue(ru.tick())
        self.assertEqual(seen, [True])
        self.assertFalse(ru.busy)

    def test_a_comfyui_problem_wins_over_busy(self):
        su, ru = self.runner("un")
        sn, rn = self.runner("nn", FakeRenderer(ok=False))
        pages.MultiRunner([("unique-names", ru), ("name-nest", rn)], poll_seconds=3, log=lambda m: None)
        ru.busy = True
        rn.heartbeat_once()
        self.assertEqual(self.message(sn), "ComfyUI is not reachable")

    def test_one_page_never_says_busy(self):
        su, ru = self.runner("un")
        su.jobs.append(job())
        ru.tick()
        ru.heartbeat_once()
        self.assertIsNone(self.message(su))
        self.assertIsNone(ru.busy_elsewhere)

    def test_version(self):
        self.assertEqual(jobs.VERSION, "2.7.2")


class ReelsFolderTest(unittest.TestCase):
    def test_reels_dir_default_and_override(self):
        self.assertIsNone(reels.ReelRunner(None, None, output_root="C:\\o").reels_dir)
        self.assertEqual(reels.ReelRunner(None, None, output_root="C:\\o", reels_dir="D:\\r").reels_dir, "D:\\r")
        import reel_render
        self.assertEqual(reel_render.reels_folder(reels.ReelRunner(None, None, output_root="C:\\o")), os.path.join("C:\\o", "Reels"))
        self.assertEqual(reel_render.reels_folder(reels.ReelRunner(None, None, output_root="C:\\o", reels_dir="D:\\r")), "D:\\r")
        self.assertEqual(reel_render.reels_folder(reels.ReelRunner(None, None)),
                         os.path.join(render.default_output_root(), "Reels"))


if __name__ == "__main__":
    unittest.main()
