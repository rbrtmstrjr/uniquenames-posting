# The reel video: captions, timeline, ffmpeg arguments, and a real tiny render with the imageio-ffmpeg binary.
import datetime
import io
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import wave
from unittest import mock

from PIL import Image

import reel_render as rr
import reels
from render import JobError
from supa import SupaError

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # reel packages not installed: the real-render tests are skipped
    FFMPEG = None

RID = "0000000a-1111-2222-3333-444444444444"
WORDS = [{"word": "Hold", "start": 0.0, "end": 0.3}, {"word": "them", "start": 0.3, "end": 0.6},
         {"word": "close,", "start": 0.6, "end": 1.0}, {"word": "every", "start": 1.2, "end": 1.5},
         {"word": "day.", "start": 1.5, "end": 2.0}]


def wav(seconds):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * int(24000 * seconds))
    return buf.getvalue()


def jpeg(colour):
    buf = io.BytesIO()
    Image.new("RGB", (1080, 1920), colour).save(buf, "JPEG")
    return buf.getvalue()


class CaptionTest(unittest.TestCase):
    def test_five_words_in_groups_with_the_spoken_word_yellow(self):
        ass = rr.ass_captions(WORDS)
        self.assertIn("PlayResX: 1080\nPlayResY: 1920", ass)
        style = [l for l in ass.splitlines() if l.startswith("Style: Cap,")][0].split(",")
        self.assertEqual(style[1], "Poppins")
        self.assertEqual(style[6], "&H80000000")                                    # soft shadow colour
        self.assertEqual((style[7], style[16], style[17], style[18]), ("-1", "6", "3", "2"))  # bold, outline, shadow, bottom-centre
        self.assertEqual(int(style[21]), round(1920 * 0.34))                       # MarginV = 34% of the height
        events = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
        self.assertEqual(len(events), 5)                                           # one per spoken word
        # "close," ends the first group (comma); the gap to "every" (0.2 s) is bridged
        self.assertEqual(events[0], "Dialogue: 0,0:00:00.00,0:00:00.30,Cap,,0,0,0,,{\\1c&H0000E6FF&}HOLD{\\1c&H00FFFFFF&} THEM CLOSE")
        self.assertTrue(events[2].startswith("Dialogue: 0,0:00:00.60,0:00:01.20,"))
        self.assertTrue(events[2].endswith("HOLD THEM {\\1c&H0000E6FF&}CLOSE{\\1c&H00FFFFFF&}"))
        self.assertTrue(events[4].startswith("Dialogue: 0,0:00:01.50,0:00:02.00,"))
        self.assertTrue(events[4].endswith("EVERY {\\1c&H0000E6FF&}DAY{\\1c&H00FFFFFF&}"))

    def test_groups_hold_at_most_three_words_and_long_text_splits(self):
        words = [{"word": w, "start": i * 0.3, "end": i * 0.3 + 0.3} for i, w in
                 enumerate("one two three four extraordinarily wonderful".split())]
        self.assertEqual([[w["text"] for w in g] for g in rr.group_words(words)],
                         [["ONE", "TWO", "THREE"], ["FOUR", "EXTRAORDINARILY"], ["WONDERFUL"]])

    def test_ass_control_characters_are_dropped(self):
        self.assertEqual(rr.caption_text("{\\b1}hi"), "B1HI")
        self.assertEqual(rr.caption_text("why?"), "WHY?")
        self.assertEqual(rr.ass_time(61.257), "0:01:01.26")


class TimelineTest(unittest.TestCase):
    def test_short_spans_get_the_minimum_and_the_total_is_kept(self):
        d = rr.fit_durations([0.0, 3.0, 0.2, 6.8], 10.0)
        self.assertAlmostEqual(sum(d), 10.0, places=6)
        self.assertEqual(d[0], rr.MIN_SCENE_S)
        self.assertEqual(d[2], rr.MIN_SCENE_S)
        self.assertAlmostEqual(d[3] / d[1], 6.8 / 3.0, places=6)

    def test_audio_too_short_for_the_minimum_splits_evenly(self):
        self.assertEqual(rr.fit_durations([0, 1, 0], 1.5), [0.5, 0.5, 0.5])

    def test_skipped_scenes_give_their_time_to_the_picture_before(self):
        scenes = [{"position": 1, "status": "done", "photo_path": "a", "start_s": 0.4},
                  {"position": 2, "status": "skipped", "photo_path": None, "start_s": 3.0},
                  {"position": 3, "status": "done", "photo_path": "c", "start_s": 6.0},
                  {"position": 4, "status": "done", "photo_path": "d", "start_s": 6.0}]   # zero-length line
        t = rr.scene_timeline(scenes, 10.0)
        self.assertEqual([s["position"] for s, _d in t], [1, 3, 4])
        self.assertAlmostEqual(sum(d for _s, d in t), 10.0, places=6)
        self.assertEqual(t[1][1], rr.MIN_SCENE_S)
        self.assertGreater(t[0][1], 5.0)

    def test_lines_without_times_are_placed_by_word_count(self):
        scenes = [{"status": "done", "photo_path": "a", "narration": "one two three", "start_s": None},
                  {"status": "done", "photo_path": "b", "narration": "four", "start_s": None}]
        self.assertEqual([round(d, 3) for _s, d in rr.scene_timeline(scenes, 8.0)], [6.0, 2.0])

    def test_frames_add_up_to_the_voice(self):
        d = rr.fit_durations([1.234, 2.345, 3.456], 7.035)
        self.assertEqual(sum(rr.frame_counts(d, 30)), round(7.035 * 30))


class ArgsTest(unittest.TestCase):
    def test_ffmpeg_args(self):
        args = rr.ffmpeg_args("ffmpeg", [{"image": "a.jpg", "duration": 2.0}, {"image": "b.jpg", "duration": 1.5},
                                         {"image": "c.jpg", "duration": 6.0}],
                              "voice.wav", "C:\\tmp\\captions.ass", "out.mp4", fontsdir="fonts")
        graph = args[args.index("-filter_complex") + 1]
        self.assertIn("scale=2160:3840", graph)
        self.assertIn("z='1+0.0400*on/59'", graph)                # 2 s: zooms in 4% (2% a second)
        self.assertIn("z='1.0300-0.0300*on/44'", graph)           # 1.5 s: zooms out 3%
        self.assertIn("z='1+0.0800*on/179'", graph)               # 6 s: capped at 8%
        self.assertIn(":d=60:s=1080x1920:fps=30", graph)
        self.assertIn(":d=45:s=1080x1920:fps=30", graph)
        self.assertIn("concat=n=3:v=1:a=0", graph)
        self.assertIn("subtitles=filename='C\\:/tmp/captions.ass':fontsdir='fonts'", graph)
        tail = " ".join(args[args.index("-map"):])
        for want in ("-map 3:a", "-c:v libx264 -preset veryfast -crf 20", "-pix_fmt yuv420p", "-c:a aac -b:a 160k",
                     "-movflags +faststart", "-shortest"):
            self.assertIn(want, tail)
        self.assertEqual(args[-1], "out.mp4")

    def test_filter_script(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        args = rr.use_filter_script(["ff", "-filter_complex", "GRAPH", "-map", "[v]"], os.path.join(d, "g.txt"))
        self.assertEqual(args, ["ff", "-/filter_complex", "g.txt", "-map", "[v]"])
        with open(os.path.join(d, "g.txt")) as fh:
            self.assertEqual(fh.read(), "GRAPH")

    def test_preview_bitrate(self):
        self.assertEqual(rr.preview_bitrate_k(100), int(15 * 8192 / 100 - 128))   # 1100k for a 100 s reel
        self.assertEqual(rr.preview_bitrate_k(400), 600)                          # floor
        self.assertEqual(rr.preview_bitrate_k(10), rr.PREVIEW_MAX_K)               # ceiling
        args = rr.preview_args("ff", "in.mp4", "out.mp4", 15, 100)
        self.assertIn("scale=720:1280:flags=lanczos,setsar=1", args)
        self.assertEqual(args[args.index("-b:v") + 1], "1100k")

    def test_safe_title_and_pc_path(self):
        self.assertEqual(rr.safe_title('Why "no" is: OK?  <yes>. '), "Why no is OK yes")
        self.assertEqual(rr.safe_title("CON"), "Reel CON")
        self.assertEqual(rr.safe_title("   "), "Reel")
        self.assertEqual(len(rr.safe_title("x" * 200)), 80)
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        day = datetime.date(2026, 10, 5)
        first = rr.pc_path(d, "Calm baby", day)
        self.assertEqual(first, os.path.join(d, "2026-10-05 Calm baby.mp4"))
        open(first, "wb").close()
        self.assertEqual(rr.pc_path(d, "Calm baby", day), os.path.join(d, "2026-10-05 Calm baby (2).mp4"))
        self.assertEqual(rr.pc_path(d, "Calm baby", day, reuse=first), first)    # this reel's own old video
        self.assertTrue(rr.inside(first, d))
        self.assertFalse(rr.inside(os.path.join(d, "..", "x.mp4"), d))
        self.assertFalse(rr.inside(d, d))


class FakeSupa:
    def __init__(self, store):
        self.store, self.uploads, self.updates, self.removed = store, {}, [], []
        self.stale = False
        self.listing = []

    def download(self, bucket, path):
        if path not in self.store:
            raise SupaError("GET x -> HTTP 400 not found")
        return self.store[path]

    def upload(self, bucket, path, data, content_type="image/jpeg", timeout=None):
        self.uploads[path] = (data, content_type, timeout)

    def update(self, table, match, values, returning=False):
        self.updates.append((table, match, values))
        if returning:
            return [] if (self.stale and "status" in values) else [{"id": "x"}]

    def select(self, table, query):
        return []

    def list(self, bucket, prefix=""):
        return self.listing

    def remove(self, bucket, paths):
        self.removed.extend(paths)


@unittest.skipIf(FFMPEG is None, "imageio-ffmpeg is not installed")
class RealRenderTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.store = {RID + "/voice-v4.wav": wav(3.0), RID + "/scenes/01-v1.jpg": jpeg((200, 60, 40)),
                      RID + "/scenes/02-v1.jpg": jpeg((40, 90, 200))}
        self.supa = FakeSupa(self.store)
        self.logs = []
        self.runner = reels.ReelRunner(self.supa, None, log=self.logs.append, sleep=lambda s: None, output_root=self.root)
        self.reel = {"id": RID, "title": "Calm: baby?", "version": 4, "status": "rendering",
                     "voice_path": RID + "/voice-v4.wav", "words": WORDS, "preview_path": None}
        self.scenes = [
            {"id": "s1", "position": 1, "status": "done", "photo_path": RID + "/scenes/01-v1.jpg", "start_s": 0.0, "narration": "a"},
            {"id": "s2", "position": 2, "status": "skipped", "photo_path": None, "start_s": 1.0, "narration": "b"},
            {"id": "s3", "position": 3, "status": "done", "photo_path": RID + "/scenes/02-v1.jpg", "start_s": 1.5, "narration": "c"},
        ]

    def render(self):
        with mock.patch.object(rr, "caption_font", return_value=None):
            rr.render_reel(self.runner, self.reel, self.scenes)

    def probe(self, path):
        err = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True).stderr.decode("utf-8", "replace")
        return err

    def test_renders_full_video_preview_and_saves(self):
        self.supa.listing = [{"name": "preview-v3.mp4", "id": "o1"}, {"name": "preview-v4.mp4", "id": "o2"},
                             {"name": "scenes", "id": None}]
        self.render()
        pc = os.path.join(self.root, "Reels", "%s Calm baby.mp4" % datetime.date.today().isoformat())
        self.assertTrue(os.path.exists(pc))
        info = self.probe(pc)
        self.assertIn("1080x1920", info)
        self.assertAlmostEqual(rr.probe_duration(FFMPEG, pc), 3.0, delta=0.15)
        path = RID + "/preview-v4.mp4"
        data, ctype, timeout = self.supa.uploads[path]
        self.assertEqual((ctype, timeout), ("video/mp4", rr.UPLOAD_TIMEOUT))
        prev = os.path.join(self.root, "p.mp4")
        with open(prev, "wb") as fh:
            fh.write(data)
        self.assertIn("720x1280", self.probe(prev))
        table, match, v = [u for u in self.supa.updates if "status" in u[2]][-1]
        self.assertEqual((table, match), ("reels", "id=eq.%s&version=eq.4" % RID))
        self.assertEqual((v["status"], v["preview_path"], v["pc_path"], v["claimed_at"], v["error"]),
                         ("ready", path, pc, None, None))
        self.assertAlmostEqual(v["duration_s"], 3.0, delta=0.15)
        self.assertTrue(v["finished_at"])
        self.assertEqual(self.supa.removed, [RID + "/preview-v3.mp4"])          # the superseded preview
        self.assertEqual([f for f in os.listdir(os.path.join(self.root, "Reels")) if f.endswith(".part")], [])

    def test_a_reel_changed_meanwhile_drops_the_result(self):
        self.supa.stale = True
        self.render()
        self.assertEqual(os.listdir(os.path.join(self.root, "Reels")), [])
        self.assertIn(RID + "/preview-v4.mp4", self.supa.removed)
        self.assertIn(reels.STALE, self.logs)

    def test_ffmpeg_failure_fails_the_reel_with_its_message(self):
        self.store[RID + "/scenes/02-v1.jpg"] = b"not a picture at all"
        with mock.patch.object(rr, "caption_font", return_value=None), \
                mock.patch.object(self.runner, "_scenes", return_value=self.scenes):
            self.runner.run_step({"step": "render", "reel": self.reel, "scene": None})
        v = self.supa.updates[-1][2]
        self.assertEqual(v["status"], "failed")
        self.assertIn("ffmpeg couldn't make the video", v["error"])
        self.assertLessEqual(len(v["error"]), len("ffmpeg couldn't make the video: ") + rr.ERR_TAIL)
        self.assertIsNone(v["claimed_at"])
        self.assertTrue(any(m.startswith("ffmpeg (video) failed") for m in self.logs))   # the full stderr

    def test_missing_picture_and_missing_voice(self):
        del self.store[RID + "/scenes/02-v1.jpg"]
        with self.assertRaises(JobError) as cm:
            self.render()
        self.assertIn("Picture 3 is missing", str(cm.exception))
        self.reel["words"] = None
        with self.assertRaises(JobError) as cm:
            self.render()
        self.assertEqual(cm.exception.reel_patch, {"voice_path": None, "words": None})

    def test_timeout_and_heartbeat(self):
        beats = []
        args = [FFMPEG, "-nostdin", "-v", "error", "-re", "-f", "lavfi", "-i", "nullsrc=s=16x16", "-f", "null", "-"]
        with self.assertRaises(JobError) as cm:
            rr.run_ffmpeg(args, self.root, 2.5, "video", lambda: beats.append(1), beat_every=0.5)
        self.assertIn("took over 2 seconds", str(cm.exception))
        self.assertGreaterEqual(len(beats), 2)

    def test_superseded_pc_video_is_replaced_or_removed(self):
        reels_dir = os.path.join(self.root, "Reels")
        os.makedirs(reels_dir)
        same = os.path.join(reels_dir, "%s Calm baby.mp4" % datetime.date.today().isoformat())
        with open(same, "wb") as fh:
            fh.write(b"old video")
        self.reel["pc_path"] = same                       # same day + title: overwritten in place
        self.render()
        self.assertEqual(sorted(os.listdir(reels_dir)), [os.path.basename(same)])
        self.assertGreater(os.path.getsize(same), 1000)
        older = os.path.join(reels_dir, "2026-01-01 Calm baby.mp4")
        os.rename(same, older)
        self.reel["pc_path"] = older                      # another day: the new one is written, the old removed
        self.render()
        self.assertEqual(sorted(os.listdir(reels_dir)), [os.path.basename(same)])
        outside = os.path.join(self.root, "elsewhere.mp4")
        open(outside, "wb").close()
        self.reel["pc_path"] = outside                    # never deleted outside the Reels folder
        self.render()
        self.assertTrue(os.path.exists(outside))

    def test_upload_retries_keep_the_claim_alive(self):
        calls = []
        real = self.supa.upload

        def flaky(*a, **kw):
            calls.append(1)
            if len(calls) < 3:
                raise SupaError("POST x -> network error: reset")
            return real(*a, **kw)
        self.supa.upload = flaky
        n0 = len(self.supa.updates)
        self.render()
        beats = [u for u in self.supa.updates[n0:] if set(u[2]) == {"claimed_at"} and u[2]["claimed_at"]]
        self.assertEqual(len(calls), 3)
        self.assertGreaterEqual(len(beats), 5)            # 2 around the render + one before each upload try

    def test_probe_timeout_is_a_job_error(self):
        with mock.patch.object(rr.subprocess, "run", side_effect=subprocess.TimeoutExpired("ff", 60)):
            with self.assertRaises(JobError):
                rr.probe_duration("ff", "x.mp4")

    def test_render_does_not_touch_comfyui(self):
        self.runner.renderer = mock.Mock(side_effect=AssertionError("ComfyUI used"))
        self.render()
        self.assertEqual(self.runner.renderer.mock_calls, [])


if __name__ == "__main__":
    unittest.main()
