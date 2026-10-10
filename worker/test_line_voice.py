# 2.6.0: the narration is voiced line by line ("2 - retuned (Gacrux)", the owner's pick in the 2026-10-10 listening
# test): exaggeration 0.6 / cfg 0.3 / temperature 0.8, each line's edge silence trimmed (EDGE_PAD kept, 4 ms fades),
# 0.7 s of room tone after the hook line and 0.4 s between the others, the model kept loaded across a reel's lines.
import io
import unittest
import wave
from unittest import mock

import numpy as np

import jobs
import reels
import voice
from render import JobError
from test_reels import FakeRenderer, FakeSupa, make_reel
from test_themes_motion import silence_pcm, tone_pcm, secs

RATE = voice.RATE


def spoken_wav(speech=1.0, lead=0.3, tail=0.3):
    return voice.pcm_to_wav(silence_pcm(lead) + tone_pcm(speech) + silence_pcm(tail))


def wav_secs(w):
    with wave.open(io.BytesIO(w), "rb") as f:
        return f.getnframes() / float(f.getframerate())


def samples(w):
    return np.frombuffer(voice.wav_pcm(w), dtype="<i2").astype(np.float64)


class DeliveryTest(unittest.TestCase):
    def test_the_retuned_delivery_and_its_sample_key(self):
        self.assertEqual(voice.DELIVERY, {"exaggeration": 0.6, "cfg_weight": 0.3, "temperature": 0.8})
        tts = voice.chatterbox_graph("Hi.", 1)["1"]["inputs"]
        self.assertEqual((tts["exaggeration"], tts["cfg_weight"], tts["temperature"]), (0.6, 0.3, 0.8))
        # a new style mark: every sample made in the old (tightened, chunked) style is re-made
        self.assertEqual(voice.sample_key(1.0), "e0.6-t0.8-c0.3-s1.00-l1")
        self.assertEqual(voice.sample_key(1.12), "e0.6-t0.8-c0.3-s1.12-l1")

    def test_keep_loaded_is_passed_to_the_node(self):
        self.assertFalse(voice.chatterbox_graph("Hi.", 1)["1"]["inputs"]["keep_model_loaded"])
        self.assertTrue(voice.chatterbox_graph("Hi.", 1, keep_loaded=True)["1"]["inputs"]["keep_model_loaded"])

    def test_gaps_and_room_tone_level(self):
        self.assertEqual((voice.LINE_GAP, voice.HOOK_GAP, voice.ROOM_TONE_DBFS), (0.4, 0.7, -60.0))
        self.assertEqual((voice.EDGE_PAD, voice.FADE_SECONDS), (0.07, 0.004))
        self.assertEqual(voice.POLL_SECONDS, 0.5)          # ~4 s lines: a 1.5 s poll wasted ~0.75 s a line

    def test_house_voices(self):
        self.assertEqual(voice.HOUSE_VOICES, ("gacrux", "sulafat", "vindemiatrix", "achernar"))
        self.assertEqual(voice.DEFAULT_VOICE, "gacrux")

    def test_worker_version(self):
        self.assertEqual(jobs.VERSION, "2.6.0")


class TrimEdgesTest(unittest.TestCase):
    def test_only_the_edges_are_trimmed_inner_pauses_stay(self):
        pcm = silence_pcm(0.5) + tone_pcm(1.0) + silence_pcm(0.6) + tone_pcm(1.0) + silence_pcm(0.8)
        out = voice.trim_edges_pcm(pcm)
        self.assertAlmostEqual(secs(out), 0.07 + 1.0 + 0.6 + 1.0 + 0.07, delta=0.021)

    def test_both_ends_fade_to_silence(self):
        out = np.frombuffer(voice.trim_edges_pcm(tone_pcm(1.0, amp=20000)), dtype="<i2")
        self.assertEqual(int(out[0]), 0)
        self.assertLess(abs(int(out[-1])), 200)
        k = int(RATE * voice.FADE_SECONDS)
        self.assertGreater(np.abs(out[k: k + 200]).max(), 10000)       # past the fade: full level

    def test_no_speech_is_returned_unchanged(self):
        self.assertEqual(voice.trim_edges_pcm(silence_pcm(0.4)), silence_pcm(0.4))
        self.assertEqual(voice.trim_edges_pcm(b""), b"")
        self.assertFalse(voice.has_speech(silence_pcm(0.4)))
        self.assertFalse(voice.has_speech(b""))
        self.assertTrue(voice.has_speech(silence_pcm(0.2) + tone_pcm(0.5)))


class RoomToneTest(unittest.TestCase):
    def test_quiet_noise_not_digital_silence(self):
        x = np.frombuffer(voice.room_tone_pcm(0.4), dtype="<i2").astype(np.float64)
        self.assertEqual(len(x), int(RATE * 0.4))
        rms_db = 20 * np.log10(np.sqrt(np.mean(x ** 2)) / 32768)
        self.assertAlmostEqual(rms_db, -60.0, delta=1.5)
        self.assertLess(np.abs(x).max(), 32768 * 10 ** (-40 / 20))        # never louder than -40 dBFS peaks
        self.assertEqual(voice.room_tone_pcm(0.4), voice.room_tone_pcm(0.4))  # the same every time
        self.assertEqual(voice.room_tone_pcm(0), b"")


class JoinLinesTest(unittest.TestCase):
    def test_hook_gap_then_line_gaps(self):
        lines = [spoken_wav(1.0), spoken_wav(2.0), spoken_wav(0.5)]
        out = voice.join_lines(lines)
        trimmed = (1.0 + 0.14) + (2.0 + 0.14) + (0.5 + 0.14)
        self.assertAlmostEqual(wav_secs(out), trimmed + voice.HOOK_GAP + voice.LINE_GAP, delta=0.03)
        x = samples(out)
        gap = x[int(RATE * 1.16): int(RATE * 1.8)]                       # inside the hook gap
        self.assertTrue(np.any(gap != 0))                                # room tone, not digital silence
        self.assertLess(np.abs(gap).max(), 400)

    def test_one_line_has_no_gap(self):
        self.assertAlmostEqual(wav_secs(voice.join_lines([spoken_wav(1.0)])), 1.14, delta=0.021)


class NarrateLinesTest(unittest.TestCase):
    def run_lines(self, lines, synth_side=None, unload=None):
        synth = mock.Mock(side_effect=synth_side or (lambda url, text, seed, ref, timeout, keep_loaded=False: spoken_wav(1.0)))
        seen = []
        with mock.patch.object(voice, "synthesize", synth), \
                mock.patch.object(voice, "unload_model", unload or mock.Mock()) as un:
            out = voice.narrate_lines("http://c", lines, 77, "unique-names/ref.wav", 300,
                                      on_line=lambda i, n, text: seen.append((i, n, text)))
        return out, synth, un, seen

    def test_one_call_per_line_model_kept_loaded_until_the_last(self):
        out, synth, un, seen = self.run_lines(["Hook line.", "  ", "Two.", "Three."])
        self.assertEqual([c[0][1] for c in synth.call_args_list], ["Hook line.", "Two.", "Three."])
        self.assertEqual([c[1]["keep_loaded"] for c in synth.call_args_list], [True, True, False])
        self.assertEqual({c[0][2] for c in synth.call_args_list}, {77})            # one seed for the whole reel
        self.assertEqual({c[0][3] for c in synth.call_args_list}, {"unique-names/ref.wav"})
        self.assertEqual(seen, [(0, 3, "Hook line."), (1, 3, "Two."), (2, 3, "Three.")])
        un.assert_not_called()                                                      # the last line unloaded it
        self.assertAlmostEqual(wav_secs(out), 3 * 1.14 + voice.HOOK_GAP + voice.LINE_GAP, delta=0.03)

    def test_a_single_line_never_keeps_the_model(self):
        _out, synth, un, _seen = self.run_lines(["Only line."])
        self.assertFalse(synth.call_args[1]["keep_loaded"])
        un.assert_not_called()

    def test_a_failure_mid_reel_unloads_the_model(self):
        def side(url, text, seed, ref, timeout, keep_loaded=False):
            if text == "Two.":
                raise JobError("ComfyUI failed while making the voice: boom")
            return spoken_wav(1.0)
        with self.assertRaises(JobError):
            self.run_lines(["One.", "Two.", "Three."], synth_side=side)
        un = mock.Mock()
        with self.assertRaises(JobError):
            self.run_lines(["One.", "Two.", "Three."], synth_side=side, unload=un)
        un.assert_called_once_with("http://c", "unique-names/ref.wav", 300)

    def test_a_line_with_no_speech_fails_clearly(self):
        def side(url, text, seed, ref, timeout, keep_loaded=False):
            return voice.pcm_to_wav(silence_pcm(0.01)) if text == "Two." else spoken_wav(1.0)
        un = mock.Mock()
        with self.assertRaises(JobError) as cm:
            self.run_lines(["One.", "Two.", "Three."], synth_side=side, unload=un)
        self.assertIn("line 2", str(cm.exception))
        un.assert_called_once()

    def test_no_lines(self):
        with self.assertRaises(JobError):
            self.run_lines(["", "  "])

    def test_on_line_errors_also_unload(self):
        synth = mock.Mock(return_value=spoken_wav(1.0))
        with mock.patch.object(voice, "synthesize", synth), mock.patch.object(voice, "unload_model") as un:
            def stop(i, n, text):
                if i == 1:
                    raise RuntimeError("stale")
            with self.assertRaises(RuntimeError):
                voice.narrate_lines("http://c", ["One.", "Two."], 1, None, 300, on_line=stop)
        un.assert_called_once()

    def test_unload_model_runs_a_tiny_line_without_keeping_it_and_never_raises(self):
        with mock.patch.object(voice, "synthesize", return_value=spoken_wav(0.3)) as s:
            voice.unload_model("http://c", "unique-names/ref.wav", 60)
        self.assertFalse(s.call_args[1]["keep_loaded"])
        with mock.patch.object(voice, "synthesize", side_effect=JobError("closed")):
            voice.unload_model("http://c", None, 60)                              # swallowed


class ResolveVoiceTest(unittest.TestCase):
    def test_house_voices_and_the_gacrux_default(self):
        self.assertEqual(voice.resolve_voice_id({"voice_id": "kore"}, {"reel_voice_id": "gacrux"}), "kore")   # a reel's own pick stays
        self.assertEqual(voice.resolve_voice_id({}, {"reel_voice_id": "Sulafat "}), "sulafat")
        self.assertEqual(voice.resolve_voice_id({}, {"reel_voice_id": "despina"}), "gacrux")   # not a house voice
        self.assertEqual(voice.resolve_voice_id({}, {"reel_voice_id": "builtin"}), "gacrux")
        self.assertEqual(voice.resolve_voice_id(None, {"reel_voice_id": None}), "gacrux")


class ReelVoiceStepTest(unittest.TestCase):
    def setUp(self):
        self.supa = FakeSupa()
        self.logs = []
        self.rr = reels.ReelRunner(self.supa, FakeRenderer(), log=self.logs.append, sleep=lambda s: None)

    def test_the_reel_is_voiced_line_by_line_then_sped_up(self):
        self.supa.settings = [{"id": 1, "reel_voice_path": None, "reel_speed": 1.0}]
        synth = mock.Mock(side_effect=lambda url, text, seed, ref, timeout, keep_loaded=False: spoken_wav(1.0))
        seen = []
        with mock.patch.object(reels.voice, "ensure_node"), mock.patch.object(reels.voice, "synthesize", synth), \
                mock.patch.object(reels.voice, "speed_up", side_effect=lambda w, s: seen.append((w, s)) or w):
            self.rr.run_step({"step": "voice", "reel": make_reel(), "scene": None})
        self.assertEqual([c[0][1] for c in synth.call_args_list],
                         ["Line 1 is spoken here.", "Line 2 is spoken here.", "Line 3 is spoken here."])
        self.assertEqual([c[1]["keep_loaded"] for c in synth.call_args_list], [True, True, False])
        self.assertEqual({c[0][2] for c in synth.call_args_list}, {reels.voice_seed(make_reel()["id"])})
        w, s = seen[0]
        self.assertAlmostEqual(wav_secs(w), 3 * 1.14 + 0.7 + 0.4, delta=0.03)
        heartbeats = [u for u in self.supa.of("reels") if set(u[2]) == {"claimed_at"} and u[2]["claimed_at"]]
        self.assertEqual(len(heartbeats), 3)                              # before each line
        self.assertIn("voice_path", self.supa.of("reels")[-1][2])
        self.assertTrue(any(m.startswith("reel voice 1/3") for m in self.logs))

    def test_a_changed_reel_stops_before_any_line_without_loading_anything(self):
        self.supa.stale.add("reels")
        synth = mock.Mock(return_value=spoken_wav(1.0))
        with mock.patch.object(reels.voice, "ensure_node"), mock.patch.object(reels.voice, "synthesize", synth), \
                mock.patch.object(reels.voice, "unload_model") as un:
            self.rr.run_step({"step": "voice", "reel": make_reel(), "scene": None})
        self.assertEqual(synth.call_count, 0)
        self.assertIn(reels.STALE, self.logs)
        un.assert_not_called()                                            # nothing was loaded yet

    def test_sample_is_one_line_in_the_new_style(self):
        self.supa.settings = [{"id": 1, "reel_voice_id": "gacrux", "reel_speed": 1.0}]
        self.supa.uploads["voices/gacrux/ref.wav"] = ("reels", b"GAC", "audio/wav")
        synth = mock.Mock(return_value=spoken_wav(2.0, lead=0.5, tail=0.6))
        with mock.patch.object(reels.voice, "ensure_node"), mock.patch.object(reels.voice, "synthesize", synth), \
                mock.patch.object(reels.voice, "upload_input", side_effect=lambda u, n, d: "unique-names/" + n), \
                mock.patch.object(reels.voice, "prune_inputs", return_value=0):
            self.rr.run_sample({"voice": {"id": "gacrux", "ref_path": "voices/gacrux/ref.wav", "version": 2}})
        self.assertEqual(synth.call_args[0][1], voice.SAMPLE_TEXT)
        self.assertFalse(synth.call_args[1]["keep_loaded"])
        _b, data, _c = self.supa.uploads["voices/gacrux/sample-v2.wav"]
        self.assertAlmostEqual(wav_secs(data), 2.14, delta=0.021)       # edges trimmed only
        self.assertEqual(self.supa.of("reel_voices")[-1][2]["sample_key"], "e0.6-t0.8-c0.3-s1.00-l1")


if __name__ == "__main__":
    unittest.main()
