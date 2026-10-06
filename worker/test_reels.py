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


def _has_ffmpeg():
    try:
        import imageio_ffmpeg
        return bool(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return False


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
        self.voices = []
        self.sample_jobs = []
        self.music_rpc_error = None   # raised for claim_next_reel_step calls that pass p_music (a pre-006 DB)

    def rpc(self, fn, args=None):
        self.rpcs.append(fn)
        self.rpc_args.append(args)
        if fn == "claim_next_card":
            return None
        if self.rpc_error and fn in ("requeue_stuck_reels", "claim_next_reel_step"):
            raise self.rpc_error
        if fn == "claim_next_reel_step":
            if self.music_rpc_error and "p_music" in (args or {}):
                raise self.music_rpc_error
            return self.reel_steps.pop(0) if self.reel_steps else None
        if fn == "claim_next_voice_sample":
            if self.music_rpc_error:
                raise self.music_rpc_error
            return self.sample_jobs.pop(0) if self.sample_jobs else None
        return 0

    def select(self, table, query):
        self.selects.append((table, query))
        if table == "reel_voices":
            return [dict(v) for v in self.voices if "id=eq.%s&" % v["id"] in query + "&"]
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
        p = mock.patch.object(reels.voice, "prune_inputs", return_value=0)   # never the real ComfyUI input folder
        self.prune = p.start()
        self.addCleanup(p.stop)

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
        up.assert_called_once_with("http://comfy", "voice-ref-v0.mp3", b"MP3")
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

    # ------------------------------------------------------------ voice resolution (006)
    def voices_db(self):
        self.supa.settings = [{"id": 1, "reel_voice_id": "gacrux", "reel_speed": 1.12, "reel_music": True}]
        self.supa.voices = [{"id": "gacrux", "label": "Gacrux", "ref_path": "voices/gacrux/ref.wav", "version": 2},
                            {"id": "kore", "label": "Kore", "ref_path": "voices/kore/ref.wav", "version": 1},
                            {"id": "puck", "label": "Puck", "ref_path": None, "version": 1}]
        self.supa.uploads["voices/gacrux/ref.wav"] = ("reels", b"GAC", "audio/wav")
        self.supa.uploads["voices/kore/ref.wav"] = ("reels", b"KORE", "audio/wav")

    def run_voice_006(self, reel, exists=True):
        up = mock.Mock(side_effect=lambda url, name, data: "unique-names/" + name)
        with mock.patch.object(reels.voice, "upload_input", up), \
                mock.patch.object(reels.voice, "input_exists", return_value=exists), \
                mock.patch.object(reels.voice, "speed_up", side_effect=lambda w, s: w) as sp:
            synth = self.run_voice(reel)
        return up, synth, sp

    def test_voice_defaults_to_the_settings_voice_with_its_speed(self):
        self.voices_db()
        up, synth, sp = self.run_voice_006(make_reel())
        up.assert_called_once_with("http://comfy", "voices-gacrux-ref-v2.wav", b"GAC")
        self.assertEqual(synth.call_args[0][3], "unique-names/voices-gacrux-ref-v2.wav")
        self.assertEqual(sp.call_args[0][1], 1.12)

    def test_the_reels_own_voice_wins(self):
        self.voices_db()
        up, synth, _sp = self.run_voice_006(make_reel(voice_id="kore"))
        self.assertEqual(up.call_args[0][1:], ("voices-kore-ref-v1.wav", b"KORE"))

    def test_builtin_and_unready_voices_use_the_built_in_voice(self):
        self.voices_db()
        up, synth, _sp = self.run_voice_006(make_reel(voice_id="builtin"))
        up.assert_not_called()
        self.assertIsNone(synth.call_args[0][3])
        up, synth, _sp = self.run_voice_006(make_reel(voice_id="puck"))   # no reference clip yet
        self.assertIsNone(synth.call_args[0][3])
        self.assertTrue(any("puck has no reference clip" in m for m in self.logs))
        self.supa.settings = [{"id": 1, "reel_voice_id": None}]
        up, synth, _sp = self.run_voice_006(make_reel())
        self.assertIsNone(synth.call_args[0][3])

    def test_reference_clip_is_cached_until_comfyui_loses_it(self):
        self.voices_db()
        self.run_voice_006(make_reel())
        up2, synth, _sp = self.run_voice_006(make_reel())
        up2.assert_not_called()                                            # cached: no download, no upload
        self.assertEqual(synth.call_args[0][3], "unique-names/voices-gacrux-ref-v2.wav")
        up3, _s, _sp = self.run_voice_006(make_reel(), exists=False)        # the input folder lost it
        self.assertEqual(up3.call_count, 1)
        self.assertEqual(self.prune.call_args[0], ("http://comfy", "unique-names/voices-gacrux-ref-v2.wav"))
        self.supa.voices[0]["version"] = 3                                   # a newer version: older ones pruned
        self.run_voice_006(make_reel())
        self.assertEqual(self.prune.call_args[0][1], "unique-names/voices-gacrux-ref-v3.wav")
        self.prune.side_effect = OSError("locked")
        self.supa.voices[0]["version"] = 4
        self.run_voice_006(make_reel())                                       # tidying never fails the voice
        self.assertTrue(any("could not tidy ComfyUI" in m for m in self.logs))
        self.assertIn("voice_path", self.supa.of("reels")[-1][2])

    def test_missing_reference_file_fails_with_a_clear_message(self):
        self.voices_db()
        del self.supa.uploads["voices/gacrux/ref.wav"]
        self.run_voice_006(make_reel())
        v = self.supa.of("reels")[-1][2]
        self.assertEqual(v["status"], "failed")
        self.assertIn("Gacrux voice clip is missing", v["error"])

    @unittest.skipIf(not _has_ffmpeg(), "imageio-ffmpeg is not installed")
    def test_voice_is_sped_up_before_upload(self):
        self.voices_db()
        self.supa.settings[0]["reel_speed"] = 1.25
        with mock.patch.object(reels.voice, "upload_input", return_value="x.wav"), \
                mock.patch.object(reels.voice, "input_exists", return_value=True):
            self.run_voice()
        with wave.open(io.BytesIO(self.supa.uploads["%s/voice-v3.wav" % RID][1]), "rb") as w:
            self.assertEqual((w.getnchannels(), w.getframerate()), (1, 24000))
            self.assertAlmostEqual(w.getnframes() / 24000.0, 1.0 / 1.25, delta=0.03)

    # ------------------------------------------------------------ music (006)
    def music_reel(self, **kw):
        reel = make_reel(voice_path="%s/voice-v3.wav" % RID, words=[{"word": "hi", "start": 0, "end": 1}], music_path=None)
        reel.update(kw)
        self.supa.uploads[reel["voice_path"]] = ("reels", wav(10.0), "audio/wav")
        return reel

    def run_music(self, reel, bed=b"fLaC-bed", boom=None):
        mk = mock.Mock(side_effect=boom, return_value=bed)
        with mock.patch.object(reels.music, "make_bed", mk), mock.patch.object(reels.music, "random_seed", return_value=77):
            self.rr.run_step({"step": "music", "reel": reel, "scene": None})
        return mk

    def test_music_makes_a_bed_two_seconds_longer_than_the_voice(self):
        self.supa.listing = {RID: [{"name": "music-v2.flac", "id": "a"}, {"name": "voice-v3.wav", "id": "b"}]}
        mk = self.run_music(self.music_reel())
        url, secs, seed, timeout = mk.call_args[0][:4]
        self.assertEqual((url, secs, seed, timeout), ("http://comfy", 12.0, 77, 300))
        path = "%s/music-v3.flac" % RID
        self.assertEqual(self.supa.uploads[path], ("reels", b"fLaC-bed", "audio/flac"))
        _t, match, v = self.supa.of("reels")[-1]
        self.assertEqual(match, "id=eq.%s&version=eq.3" % RID)
        self.assertEqual(v, {"music_path": path, "claimed_at": None})
        self.assertEqual(self.supa.removed, ["%s/music-v2.flac" % RID])       # the superseded bed only
        heartbeats = [u for u in self.supa.of("reels") if set(u[2]) == {"claimed_at"} and u[2]["claimed_at"]]
        self.assertGreaterEqual(len(heartbeats), 2)

    def test_music_failure_goes_on_with_the_voice_only(self):
        self.run_music(self.music_reel(), boom=JobError("ComfyUI refused the music job: no such node"))
        _t, _m, v = self.supa.of("reels")[-1]
        self.assertEqual(v, {"music_path": "", "claimed_at": None})          # not failed, not retried
        self.assertFalse([u for u in self.supa.of("reels") if "status" in u[2]])
        self.assertTrue(any("voice only" in m for m in self.logs))

    def test_music_with_comfy_closed_waits(self):
        self.r.ok = False
        mk = self.run_music(self.music_reel())
        mk.assert_not_called()
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})

    def test_comfy_closing_mid_music_waits(self):
        def boom(*a, **kw):
            self.r.ok = False
            raise JobError("ComfyUI stopped answering while making the music. Is it still open?")
        self.run_music(self.music_reel(), boom=boom)
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})   # no '': it runs again later

    def test_no_internet_for_the_bed_upload_retries_later(self):
        reel = self.music_reel()
        self.supa.upload = mock.Mock(side_effect=SupaError("POST x -> network error: reset"))
        self.run_music(reel)
        self.assertEqual(self.supa.upload.call_count, 5)                      # retried first
        self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})   # released, not ''
        self.assertFalse([u for u in self.supa.of("reels") if "music_path" in u[2]])

    def test_stale_music_is_dropped(self):
        self.supa.stale.add("reels")
        self.supa.stale_key = "music_path"
        self.run_music(self.music_reel())
        self.assertEqual(self.supa.removed, ["%s/music-v3.flac" % RID])
        self.assertIn(reels.STALE, self.logs)

    # ------------------------------------------------------------ voice samples (006)
    def run_sample(self, row, synth_boom=None):
        self.supa.settings = [{"id": 1, "reel_voice_id": "gacrux", "reel_speed": 1.12}]
        self.supa.uploads["voices/kore/ref.wav"] = ("reels", b"KORE", "audio/wav")
        synth = mock.Mock(side_effect=synth_boom, return_value=wav(2.0))
        with mock.patch.object(reels.voice, "ensure_node"), mock.patch.object(reels.voice, "synthesize", synth), \
                mock.patch.object(reels.voice, "upload_input", side_effect=lambda u, n, d: "unique-names/" + n), \
                mock.patch.object(reels.voice, "speed_up", side_effect=lambda w, s: w) as sp:
            self.rr.run_sample({"voice": row})
        return synth, sp

    def test_sample_reads_the_sentence_and_saves_versioned(self):
        self.supa.listing = {"voices/kore": [{"name": "ref.wav", "id": "r"}, {"name": "sample-v3.wav", "id": "o"}]}
        row = {"id": "kore", "ref_path": "voices/kore/ref.wav", "version": 4, "sample_path": "voices/kore/sample-v3.wav"}
        synth, sp = self.run_sample(row)
        _u, text, seed, ref, _t = synth.call_args[0]
        self.assertEqual((text, seed, ref), (reels.voice.SAMPLE_TEXT, 42, "unique-names/voices-kore-ref-v4.wav"))
        self.assertEqual(sp.call_args[0][1], 1.12)
        self.assertIn("voices/kore/sample-v4.wav", self.supa.uploads)
        _table, match, v = self.supa.of("reel_voices")[-1]
        self.assertEqual(match, "id=eq.kore&version=eq.4")
        self.assertEqual(v, {"sample_status": "ready", "sample_path": "voices/kore/sample-v4.wav",
                             "sample_key": "e0.35-t0.7-c0.5-s1.12", "error": None, "claimed_at": None})
        self.assertEqual(self.supa.removed, ["voices/kore/sample-v3.wav"])

    def test_builtin_sample_needs_no_reference(self):
        synth, _sp = self.run_sample({"id": "builtin", "ref_path": None, "version": 1})
        self.assertIsNone(synth.call_args[0][3])
        self.assertEqual(self.supa.of("reel_voices")[-1][2]["sample_status"], "ready")

    def test_requeued_sample_is_dropped(self):
        self.supa.stale.add("reel_voices")
        self.run_sample({"id": "kore", "ref_path": "voices/kore/ref.wav", "version": 4})
        self.assertEqual(self.supa.removed, ["voices/kore/sample-v4.wav"])

    def test_sample_failure_and_comfy_closed(self):
        self.run_sample({"id": "kore", "ref_path": "voices/kore/ref.wav", "version": 4}, synth_boom=JobError("oom"))
        _t, match, v = self.supa.of("reel_voices")[-1]
        self.assertEqual((match, v), ("id=eq.kore&version=eq.4", {"sample_status": "failed", "error": "oom", "claimed_at": None}))
        self.r.ok = False
        self.run_sample({"id": "kore", "ref_path": "voices/kore/ref.wav", "version": 4}, synth_boom=JobError("down"))
        self.assertEqual(self.supa.of("reel_voices")[-1][2], {"sample_status": "queued", "claimed_at": None})
        self.r.ok = True
        self.run_sample({"id": "puck", "ref_path": None, "version": 1})
        self.assertIn("no reference clip", self.supa.of("reel_voices")[-1][2]["error"])
        n = len(self.supa.updates)
        self.rr.run_sample({"voice": {"id": "../x", "version": 1}})            # never a path from a bad id
        self.assertEqual(len(self.supa.updates), n)

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
        self.assertNotIn("music_path", v)                                     # a pre-006 reel: no such column

    def test_redoing_the_voice_also_clears_its_music(self):
        reel = make_reel(voice_path="%s/voice-v3.wav" % RID, music_path="%s/music-v3.flac" % RID)
        self.supa.uploads[reel["voice_path"]] = ("reels", wav(1.0), "audio/wav")
        with mock.patch.object(reels.timing, "transcribe", return_value=[]):
            self.rr.run_step({"step": "timing", "reel": reel, "scene": None})
        v = self.supa.of("reels")[-1][2]
        self.assertEqual((v["status"], v["voice_path"], v["music_path"]), ("failed", None, None))
        self.assertEqual(self.supa.removed, [reel["voice_path"], reel["music_path"]])
        self.supa.removed.clear()
        self.rr.run_step({"step": "timing", "reel": make_reel(voice_path="gone.wav", music_path=""), "scene": None})
        self.assertIsNone(self.supa.of("reels")[-1][2]["music_path"])             # '' (failed bed) -> made again
        self.assertEqual(self.supa.removed, ["gone.wav"])

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

    def test_reel_errors_keep_up_to_600_chars(self):
        fake = mock.Mock()
        fake.render_reel.side_effect = JobError("e" * 1000)
        with mock.patch.dict("sys.modules", {"reel_render": fake}):
            self.rr.run_step({"step": "render", "reel": make_reel(), "scene": None})
        self.assertEqual(len(self.supa.of("reels")[-1][2]["error"]), 600)

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
        self.assertEqual(self.supa.rpc_args[-1], {"p_no_comfy": True, "p_music": True})
        self.assertNotIn("claim_next_voice_sample", self.supa.rpcs)        # no samples without ComfyUI
        self.run_.renderer = FakeRenderer()
        self.run_.tick()
        self.assertEqual(self.supa.rpc_args[-2], {"p_no_comfy": False, "p_music": True})
        self.assertEqual(self.supa.rpcs[-1], "claim_next_voice_sample")    # nothing for the reels: a sample

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

    def test_old_render_folders_are_pruned_at_start(self):
        old, new, other = (os.path.join(self.root, n) for n in ("reel-render-a", "reel-render-b", "keep-me"))
        for d in (old, new, other):
            os.makedirs(d)
        now = os.path.getmtime(new)
        os.utime(old, (now - 2 * 86400, now - 2 * 86400))
        os.utime(other, (now - 2 * 86400, now - 2 * 86400))
        jobs.prune_render_temps(self.root, now=now)
        self.assertEqual((os.path.exists(old), os.path.exists(new), os.path.exists(other)), (False, True, True))

    def test_pre_006_database_claims_without_music_and_no_samples(self):
        self.supa.music_rpc_error = SupaError('POST /rest/v1/rpc/claim_next_reel_step -> HTTP 404 {"code":"PGRST202"}')
        step = {"step": "timing", "reel": make_reel(), "scene": None}
        self.supa.reel_steps.append(step)
        self.assertTrue(self.run_.tick())
        self.reels.run_step.assert_called_once_with(step)
        self.assertEqual(self.supa.rpc_args[-1], {"p_no_comfy": False})
        self.assertFalse(self.run_.tick())                                   # no reel step, no samples asked
        self.assertNotIn("claim_next_voice_sample", self.supa.rpcs)
        self.assertEqual(len([a for a in self.supa.rpc_args if a and "p_music" in a]), 1)   # re-checked later
        self.assertEqual(len([m for m in self.logs if "006_reel_voices" in m]), 1)
        self.assertNotIn("005_reels", " ".join(self.logs))
        self.run_.music_off_until = 0                                         # 10 minutes later: still missing
        self.assertFalse(self.run_.tick())
        self.assertEqual(len([m for m in self.logs if "006_reel_voices" in m]), 1)   # logged once per switch
        self.run_.music_off_until = 0                                         # the owner ran 006
        self.supa.music_rpc_error = None
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpc_args[-2], {"p_no_comfy": False, "p_music": True})
        self.assertEqual(len([m for m in self.logs if "are on (006 found)" in m]), 1)
        self.assertFalse(self.run_.tick())
        self.assertEqual(len([m for m in self.logs if "are on (006 found)" in m]), 1)

    def test_a_404_that_is_not_a_missing_function_is_not_a_fallback(self):
        self.supa.music_rpc_error = SupaError("POST /rest/v1/rpc/claim_next_reel_step -> HTTP 404 page not found")
        self.assertFalse(self.run_.tick())                                   # 005's handling, not a music switch
        self.assertEqual(self.run_.music_off_until, 0.0)
        self.assertEqual(len([a for a in self.supa.rpc_args if a and "p_music" in a]), 1)   # no 2nd call without music
        self.assertFalse([m for m in self.logs if "006_reel_voices" in m])

    def test_voice_sample_runs_when_no_reel_step(self):
        job = {"voice": {"id": "kore", "version": 2}}
        self.supa.sample_jobs.append(job)
        self.assertTrue(self.run_.tick())
        self.reels.run_sample.assert_called_once_with(job)
        self.reels.run_step.assert_not_called()

    def test_without_a_reel_runner_cards_behave_as_before(self):
        self.run_.reels = None
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["requeue_stuck_cards", "claim_next_card"])


if __name__ == "__main__":
    unittest.main()
