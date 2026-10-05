# Reel steps against an in-memory Supabase, a fake ComfyUI renderer and mocked voice/Whisper.
import datetime
import io
import os
import shutil
import tempfile
import unittest
import wave
from unittest import mock

from PIL import Image

import jobs
import reels
from render import JobError
from supa import SupaError

RID = "0000000a-1111-2222-3333-444444444444"


def wav(seconds=1.0):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * int(24000 * seconds))
    return buf.getvalue()


def make_reel(**kw):
    r = {"id": RID, "title": "Calm baby", "status": "voicing", "version": 3, "voice_path": None, "words": None,
         "preview_path": None, "claimed_at": "now"}
    r.update(kw)
    return r


def make_scene(pos, **kw):
    s = {"id": "s%d" % pos, "reel_id": RID, "position": pos, "narration": "Line %d is spoken here." % pos,
         "image_prompt": "prompt %d" % pos, "seed": 100 + pos, "status": "generating", "photo_path": None,
         "version": 2, "attempts": 1}
    s.update(kw)
    return s


class FakeSupa:
    def __init__(self, scenes=None):
        self.scenes = scenes if scenes is not None else [make_scene(i, status="queued") for i in (1, 2, 3)]
        self.settings = [{"id": 1, "reel_voice_path": None}]
        self.updates, self.uploads, self.removed, self.selects, self.rpcs = [], {}, [], [], []
        self.stale = set()            # tables whose version-guarded updates match 0 rows
        self.stale_key = None         # only updates carrying this key are stale (None = any)
        self.reel_steps = []
        self.rpc_error = None
        self.rpc_args = []
        self.scene_update_error = None
        self.listing = None

    def rpc(self, fn, args=None):
        self.rpcs.append(fn)
        self.rpc_args.append(args)
        if fn == "claim_next_card":
            return None
        if self.rpc_error and fn in ("requeue_stuck_reels", "claim_next_reel_step"):
            raise self.rpc_error
        if fn == "claim_next_reel_step":
            return self.reel_steps.pop(0) if self.reel_steps else None
        return 0

    def select(self, table, query):
        self.selects.append((table, query))
        return self.settings if table == "settings" else [dict(s) for s in self.scenes]

    def update(self, table, match, values, returning=False):
        if table == "reel_scenes" and self.scene_update_error:
            raise self.scene_update_error
        self.updates.append((table, match, values))
        if returning:
            stale = table in self.stale and "version=eq." in match and (self.stale_key is None or self.stale_key in values)
            return [] if stale else [{"id": "x"}]

    def upload(self, bucket, path, data, content_type="image/jpeg"):
        self.uploads[path] = (bucket, data, content_type)

    def download(self, bucket, path):
        if path not in self.uploads:
            raise SupaError("GET x -> HTTP 400 not found")
        return self.uploads[path][1]

    def remove(self, bucket, paths):
        self.removed.extend(paths)

    def list(self, bucket, prefix="", limit=1000, offset=0):
        self.selects.append(("list", prefix))
        return (self.listing or {}).get(prefix, [])

    def of(self, table):
        return [u for u in self.updates if u[0] == table]


class FakeRenderer:
    comfy = "http://comfy"
    timeout = 300

    def __init__(self, ok=True, boom=None):
        self.ok, self.boom, self.calls = ok, boom, []

    def health(self):
        return {"ok": self.ok, "gpu": "Fake", "error": None}

    def generate_photo(self, prompt, seed, width, height):
        self.calls.append((prompt, seed, width, height))
        if self.boom:
            raise self.boom
        return Image.new("RGB", (width, height), (120, 90, 60))


class ReelRunnerTest(unittest.TestCase):
    def setUp(self):
        self.supa = FakeSupa()
        self.r = FakeRenderer()
        self.logs = []
        self.rr = reels.ReelRunner(self.supa, self.r, log=self.logs.append, sleep=lambda s: None)

    # ------------------------------------------------------------ voice
    def run_voice(self, reel=None, chunks=None):
        synth = mock.Mock(side_effect=lambda url, text, seed, ref, timeout: wav(1.0))
        with mock.patch.object(reels.voice, "ensure_node"), mock.patch.object(reels.voice, "synthesize", synth), \
                mock.patch.object(reels.voice, "chunk_lines", side_effect=chunks or reels.voice.chunk_lines):
            self.rr.run_step({"step": "voice", "reel": reel or make_reel(), "scene": None})
        return synth

    def test_voice_chunks_uploads_versioned_wav_and_saves(self):
        synth = self.run_voice(chunks=lambda lines: ["chunk one", "chunk two"])
        self.assertEqual(synth.call_count, 2)
        self.assertEqual(synth.call_args[0][0], "http://comfy")
        self.assertIsNone(synth.call_args[0][3])                      # default voice
        path = "%s/voice-v3.wav" % RID
        bucket, data, ctype = self.supa.uploads[path]
        self.assertEqual((bucket, ctype), ("reels", "audio/wav"))
        with wave.open(io.BytesIO(data), "rb") as w:                  # 2 x 1 s + one pause
            self.assertAlmostEqual(w.getnframes() / 24000, 2 + reels.voice.PAUSE_SECONDS, places=2)
        heartbeats = [u for u in self.supa.of("reels") if set(u[2]) == {"claimed_at"} and u[2]["claimed_at"]]
        self.assertEqual(len(heartbeats), 2)                          # before each chunk
        table, match, v = self.supa.of("reels")[-1]
        self.assertEqual(match, "id=eq.%s&version=eq.3" % RID)
        self.assertEqual(v["voice_path"], path)
        self.assertIsNone(v["claimed_at"])

    def test_voice_joins_the_narration_lines(self):
        synth = self.run_voice()
        self.assertEqual(synth.call_count, 1)
        self.assertEqual(synth.call_args[0][1], "Line 1 is spoken here. Line 2 is spoken here. Line 3 is spoken here.")

    def test_voice_uses_the_reference_clip_from_settings(self):
        self.supa.settings = [{"id": 1, "reel_voice_path": "voice/ref.mp3"}]
        self.supa.uploads["voice/ref.mp3"] = ("reels", b"MP3", "audio/mpeg")
        with mock.patch.object(reels.voice, "upload_input", return_value="unique-names/reel-voice.mp3") as up:
            synth = self.run_voice()
        up.assert_called_once_with("http://comfy", "reel-voice.mp3", b"MP3")
        self.assertEqual(synth.call_args[0][3], "unique-names/reel-voice.mp3")

    def test_voice_stale_result_is_dropped(self):
        self.supa.stale.add("reels")
        self.supa.stale_key = "voice_path"
        self.run_voice()
        self.assertEqual(self.supa.removed, ["%s/voice-v3.wav" % RID])
        self.assertIn(reels.STALE, self.logs)

    def test_heartbeat_on_a_changed_reel_stops_voicing_quietly(self):
        self.supa.stale.add("reels")
        synth = self.run_voice(chunks=lambda lines: ["chunk one", "chunk two"])
        self.assertEqual(synth.call_count, 0)
        self.assertEqual(self.supa.uploads, {})
        self.assertIn(reels.STALE, self.logs)
        self.assertFalse([u for u in self.supa.of("reels") if "status" in u[2]])   # not marked failed

    def test_voice_missing_node_fails_the_reel_with_a_clear_message(self):
        with mock.patch.object(reels.voice, "http_json", return_value={}):
            self.rr.run_step({"step": "voice", "reel": make_reel(), "scene": None})
        _t, match, v = self.supa.of("reels")[-1]
        self.assertEqual(v["status"], "failed")
        self.assertEqual(v["error"], "Restart ComfyUI so it loads the Chatterbox voice node.")
        self.assertIsNone(v["claimed_at"])
        self.assertEqual(self.supa.uploads, {})

    # ------------------------------------------------------------ timing
    def test_timing_saves_scene_times_then_words(self):
        reel = make_reel(voice_path="%s/voice-v3.wav" % RID)
        self.supa.uploads[reel["voice_path"]] = ("reels", wav(4.0), "audio/wav")
        words = [{"word": w, "start": i * 0.25, "end": i * 0.25 + 0.25}
                 for i, w in enumerate("Line 1 is spoken here. Line 2 is spoken here. Line 3 is spoken here.".split())]
        with mock.patch.object(reels.timing, "transcribe", return_value=words) as tr:
            self.rr.run_step({"step": "timing", "reel": reel, "scene": None})
        self.assertTrue(tr.call_args[0][0].endswith(".wav"))
        self.assertFalse(os.path.exists(tr.call_args[0][0]))          # temp file cleaned up
        times = [u for u in self.supa.of("reel_scenes")]
        self.assertEqual([u[1] for u in times], ["id=eq.s1", "id=eq.s2", "id=eq.s3"])
        self.assertEqual(times[0][2], {"start_s": 0.0, "end_s": 1.25})
        self.assertEqual(times[2][2]["end_s"], 4.0)                   # last line ends at the audio end
        _t, match, v = self.supa.of("reels")[-1]
        self.assertEqual(match, "id=eq.%s&version=eq.3" % RID)
        self.assertEqual(v["words"], words)
        self.assertIsNone(v["claimed_at"])

    def test_timing_with_no_words_clears_the_voice_for_retry(self):
        reel = make_reel(voice_path="%s/voice-v3.wav" % RID)
        self.supa.uploads[reel["voice_path"]] = ("reels", wav(1.0), "audio/wav")
        with mock.patch.object(reels.timing, "transcribe", return_value=[]):
            self.rr.run_step({"step": "timing", "reel": reel, "scene": None})
        v = self.supa.of("reels")[-1][2]
        self.assertEqual(v["status"], "failed")
        self.assertIsNone(v["voice_path"])
        self.assertIn("No words", v["error"])
        self.assertEqual(self.supa.removed, [reel["voice_path"]])

    def test_timing_missing_voice_file(self):
        self.rr.run_step({"step": "timing", "reel": make_reel(voice_path="gone.wav"), "scene": None})
        v = self.supa.of("reels")[-1][2]
        self.assertEqual((v["status"], v["voice_path"]), ("failed", None))

    # ------------------------------------------------------------ image
    def test_image_renders_fits_uploads_and_finishes(self):
        scene = make_scene(4, photo_path="%s/scenes/04-v1.jpg" % RID)
        reel = make_reel(status="imaging", words=[])
        self.rr.run_step({"step": "image", "reel": reel, "scene": scene})
        self.assertEqual(self.r.calls, [("prompt 4", 104, 1088, 1920)])
        path = "%s/scenes/04-v2.jpg" % RID
        bucket, data, _ = self.supa.uploads[path]
        self.assertEqual(bucket, "reels")
        img = Image.open(io.BytesIO(data))
        self.assertEqual((img.format, img.size), ("JPEG", (1080, 1920)))
        _t, match, v = self.supa.of("reel_scenes")[-1]
        self.assertEqual(match, "id=eq.s4&version=eq.2")
        self.assertEqual(v, {"status": "done", "photo_path": path, "error": None, "claimed_at": None})
        self.assertEqual(self.supa.removed, ["%s/scenes/04-v1.jpg" % RID])   # the superseded picture
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})

    def test_image_version_guard_drops_a_stale_picture(self):
        self.supa.stale.add("reel_scenes")
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(1)})
        self.assertEqual(self.supa.removed, ["%s/scenes/01-v2.jpg" % RID])
        self.assertIn(reels.STALE, self.logs)
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})

    def test_image_failure_before_the_third_try(self):
        self.r.boom = JobError("ComfyUI failed while making the picture: oom")
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(2, attempts=2)})
        v = self.supa.of("reel_scenes")[-1][2]
        self.assertEqual((v["status"], v["claimed_at"]), ("failed", None))
        self.assertIn("oom", v["error"])
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})

    def test_third_image_failure_needs_attention(self):
        self.r.boom = RuntimeError("boom")
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(2, attempts=3)})
        self.assertEqual(self.supa.of("reel_scenes")[-1][2]["status"], "failed")
        _t, match, v = self.supa.of("reels")[-1]
        self.assertEqual(match, "id=eq.%s&version=eq.3" % RID)
        self.assertEqual(v["status"], "needs_attention")
        self.assertTrue(v["error"].startswith("Image 2 failed 3 times: Something went wrong on your PC: boom"))
        self.assertIsNone(v["claimed_at"])

    def test_third_failure_on_a_redone_scene_does_not_flag_the_reel(self):
        self.supa.stale.add("reel_scenes")
        self.r.boom = JobError("x")
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(2, attempts=3)})
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})

    def test_image_with_comfy_closed_goes_back_in_line(self):
        self.r.ok = False
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(1, attempts=2)})
        self.assertEqual(self.r.calls, [])
        _t, match, v = self.supa.of("reel_scenes")[-1]
        self.assertEqual(match, "id=eq.s1&version=eq.2")
        self.assertEqual(v, {"status": "queued", "attempts": 1, "error": None, "claimed_at": None})
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})

    def test_comfy_closing_mid_picture_goes_back_in_line(self):
        self.r.boom = JobError(reels.COMFY_CLOSED)
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(1, attempts=3)})
        self.assertEqual(self.supa.of("reel_scenes")[-1][2]["status"], "queued")
        self.assertEqual(self.supa.of("reel_scenes")[-1][2]["attempts"], 2)
        self.assertFalse([u for u in self.supa.of("reels") if "status" in u[2]])   # no needs_attention

    def test_upload_is_removed_when_the_scene_save_fails(self):
        self.supa.scene_update_error = SupaError("PATCH x -> HTTP 400 bad")
        self.rr.run_step({"step": "image", "reel": make_reel(), "scene": make_scene(1)})
        self.assertIn("%s/scenes/01-v2.jpg" % RID, self.supa.removed)

    # ------------------------------------------------------------ render (Task 7)
    def test_render_not_built_yet(self):
        with mock.patch.dict("sys.modules", {"reel_render": None}):
            self.rr.run_step({"step": "render", "reel": make_reel(status="rendering"), "scene": None})
        v = self.supa.of("reels")[-1][2]
        self.assertEqual((v["status"], v["error"]), ("failed", reels.NO_RENDER))

    def test_render_delegates_when_present(self):
        fake = mock.Mock()
        with mock.patch.dict("sys.modules", {"reel_render": fake}):
            self.rr.run_step({"step": "render", "reel": make_reel(), "scene": None})
        runner, reel, scenes = fake.render_reel.call_args[0]
        self.assertIs(runner, self.rr)
        self.assertEqual(len(scenes), 3)


class RunnerReelTickTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.supa = FakeSupa()
        self.reels = mock.Mock()
        self.logs = []
        self.run_ = jobs.Runner(self.supa, FakeRenderer(), os.path.join(self.root, "out"), os.path.join(self.root, "c"),
                                log=self.logs.append, reels=self.reels)

    def test_reel_step_only_after_no_card(self):
        step = {"step": "image", "reel": make_reel(), "scene": make_scene(1)}
        self.supa.reel_steps.append(step)
        self.assertTrue(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["requeue_stuck_cards", "claim_next_card", "requeue_stuck_reels", "claim_next_reel_step"])
        self.reels.run_step.assert_called_once_with(step)

    def test_no_reel_step(self):
        self.assertFalse(self.run_.tick())
        self.reels.run_step.assert_not_called()

    def test_comfy_down_asks_only_for_steps_without_comfy(self):
        self.run_.renderer = FakeRenderer(ok=False)
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpc_args[-1], {"p_no_comfy": True})
        self.run_.renderer = FakeRenderer()
        self.run_.tick()
        self.assertEqual(self.supa.rpc_args[-1], {"p_no_comfy": False})

    def test_missing_rpc_is_skipped_quietly_and_rechecked_later(self):
        self.supa.rpc_error = SupaError('POST /rest/v1/rpc/requeue_stuck_reels -> HTTP 404 {"code":"PGRST202"}')
        self.assertFalse(self.run_.tick())
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs.count("requeue_stuck_reels"), 1)   # not hammered every poll
        self.assertEqual(len([m for m in self.logs if "005_reels" in m]), 1)
        self.run_.reels_off_until = 0
        self.supa.rpc_error = None
        self.assertFalse(self.run_.tick())
        self.assertIn("claim_next_reel_step", self.supa.rpcs)

    def test_other_rpc_errors_reach_the_loop(self):
        self.supa.rpc_error = SupaError("POST x -> network error: down")
        with self.assertRaises(SupaError):
            self.run_.tick()

    def test_daily_sweep_removes_previews_older_than_14_days(self):
        now = 1_800_000_000.0
        old = datetime.datetime.fromtimestamp(now - 15 * 86400, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        new = datetime.datetime.fromtimestamp(now - 2 * 86400, datetime.timezone.utc).isoformat()
        self.supa.listing = {"": [{"name": RID, "id": None}, {"name": "r2", "id": None}],
                             RID: [{"name": "preview-v2.mp4", "id": "a", "created_at": old},
                                   {"name": "voice-v2.wav", "id": "b", "created_at": old},
                                   {"name": "scenes", "id": None}],
                             "r2": [{"name": "preview-v1.mp4", "id": "c", "created_at": new}]}
        self.assertEqual(self.run_.sweep_old_previews(now), 1)
        self.assertEqual(self.supa.removed, [RID + "/preview-v2.mp4"])
        self.assertEqual(self.supa.updates[-1], ("reels", "preview_path=eq.%s%%2Fpreview-v2.mp4" % RID, {"preview_path": None}))
        self.assertEqual(self.run_.sweep_old_previews(now + 3600), 0)          # once a day
        self.assertEqual(len(self.supa.removed), 1)

    def test_sweep_errors_are_only_logged(self):
        self.supa.list = mock.Mock(side_effect=SupaError("POST x -> HTTP 400 Bucket not found"))
        self.assertEqual(self.run_.sweep_old_previews(), 0)
        self.assertTrue(any("clean-up skipped" in m for m in self.logs))
        self.run_.reels = None
        self.run_.next_preview_sweep = 0
        self.assertEqual(self.run_.sweep_old_previews(), 0)                   # cards-only worker: no sweep
        self.assertEqual(self.supa.list.call_count, 1)

    def test_without_a_reel_runner_cards_behave_as_before(self):
        self.run_.reels = None
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["requeue_stuck_cards", "claim_next_card"])


if __name__ == "__main__":
    unittest.main()
