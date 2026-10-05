# Line timing from Whisper words, and the Chatterbox graph / chunking (no ComfyUI, no Whisper model needed).
import io
import sys
import types
import unittest
import wave
from unittest import mock

import timing
import voice
from render import JobError


def heard(text, t0=0.0, per_word=0.25, gap=0.0):
    """Synthetic Whisper words: each word lasts per_word seconds, optional gap between."""
    out, t = [], t0
    for w in text.split():
        out.append({"word": w, "start": round(t, 3), "end": round(t + per_word, 3)})
        t += per_word + gap
    return out


class AssignLinesTest(unittest.TestCase):
    def check_shape(self, spans, n, end):
        self.assertEqual(len(spans), n)
        self.assertEqual(spans[0][0], 0.0)
        self.assertAlmostEqual(spans[-1][1], end, places=3)
        for (s, e), (s2, _e2) in zip(spans, spans[1:]):
            self.assertLessEqual(s, e)
            self.assertEqual(e, s2)  # gapless

    def test_exact_match(self):
        lines = ["Before your baby turns one,", "they don't need flashcards.", "They need your voice."]
        words = heard("Before your baby turns one, they don't need flashcards. They need your voice.")
        spans = timing.assign_lines(words, lines, duration=3.5)
        self.check_shape(spans, 3, 3.5)
        self.assertAlmostEqual(spans[1][0], 5 * 0.25, places=2)   # "they" is word 6
        self.assertAlmostEqual(spans[2][0], 9 * 0.25, places=2)   # "They" is word 10

    def test_last_line_ends_at_last_word_without_duration(self):
        words = heard("one two three four")
        spans = timing.assign_lines(words, ["one two", "three four"])
        self.check_shape(spans, 2, 1.0)

    def test_merged_and_split_words_and_punctuation(self):
        lines = ["A well-known lullaby helps.", "Hold them close tonight."]
        # Whisper splits "well-known" and merges "lullaby helps." oddly, adds punctuation
        words = [{"word": "A", "start": 0.0, "end": 0.1}, {"word": "well", "start": 0.1, "end": 0.3},
                 {"word": "-known", "start": 0.3, "end": 0.5}, {"word": "lulla", "start": 0.5, "end": 0.7},
                 {"word": "by,", "start": 0.7, "end": 0.8}, {"word": "helps...", "start": 0.8, "end": 1.1},
                 {"word": "Hold", "start": 1.4, "end": 1.6}, {"word": "them", "start": 1.6, "end": 1.8},
                 {"word": "close-tonight!", "start": 1.8, "end": 2.4}]
        spans = timing.assign_lines(words, lines, duration=2.6)
        self.check_shape(spans, 2, 2.6)
        self.assertAlmostEqual(spans[1][0], 1.4, places=2)

    def test_skipped_line_is_interpolated(self):
        lines = ["first line goes here", "Whisper never heard this", "third line goes here"]
        words = heard("first line goes here", 0.0) + heard("third line goes here", 3.0)
        spans = timing.assign_lines(words, lines, duration=4.0)
        self.check_shape(spans, 3, 4.0)
        self.assertGreater(spans[1][0], 1.0)   # after line 1's words
        self.assertLess(spans[1][0], 3.0)      # before line 3 starts
        self.assertAlmostEqual(spans[2][0], 3.0, places=2)

    def test_first_line_starts_at_zero_after_leading_silence(self):
        spans = timing.assign_lines(heard("hello there friend", 0.8), ["hello there", "friend"], duration=2.0)
        self.assertEqual(spans[0][0], 0.0)
        self.assertAlmostEqual(spans[1][0], 1.3, places=2)

    def test_numbers_and_unmatched_start_still_monotonic(self):
        lines = ["Babies sleep 16 hours a day.", "Sixteen! That's a lot.", "Rest when they rest."]
        words = heard("Babies sleep sixteen hours a day. Sixteen! That's a lot. Rest when they rest.")
        spans = timing.assign_lines(words, lines)
        self.check_shape(spans, 3, words[-1]["end"])

    def test_no_words_spreads_by_length(self):
        spans = timing.assign_lines([], ["aaaa", "bbbb"], duration=2.0)
        self.assertEqual(spans, [(0.0, 1.0), (1.0, 2.0)])

    def test_empty_lines(self):
        self.assertEqual(timing.assign_lines(heard("x"), []), [])

    def test_long_reel_is_fast_and_sane(self):
        lines = ["line number %d says something about tiny babies and sleep" % i for i in range(40)]
        words = heard(" ".join(lines))
        spans = timing.assign_lines(words, lines)
        self.check_shape(spans, 40, words[-1]["end"])
        for i, (s, _e) in enumerate(spans[1:], 1):
            self.assertAlmostEqual(s, i * 10 * 0.25, places=1)


class TranscribeTest(unittest.TestCase):
    def test_transcribe_uses_decoded_audio_and_returns_word_dicts(self):
        W = types.SimpleNamespace
        seg = W(words=[W(word=" Hello,", start=0.0, end=0.4), W(word=" world.", start=0.4, end=0.9), W(word=" ", start=1, end=1)])
        model = mock.Mock()
        model.transcribe.return_value = ([seg], None)
        with mock.patch.object(timing, "_get_model", return_value=model), \
                mock.patch.object(timing, "load_16k", return_value="PCM") as load:
            out = timing.transcribe("voice.wav")
        load.assert_called_once_with("voice.wav")
        self.assertEqual(model.transcribe.call_args[0][0], "PCM")   # never a file path (PyAV bug)
        self.assertTrue(model.transcribe.call_args[1]["word_timestamps"])
        self.assertEqual(out, [{"word": "Hello,", "start": 0.0, "end": 0.4}, {"word": "world.", "start": 0.4, "end": 0.9}])

    def test_card_only_import_does_not_load_whisper(self):
        import jobs, reels  # noqa: F401  (what the worker imports at start)
        self.assertIsNone(timing._model)
        self.assertNotIn("faster_whisper", sys.modules)
        self.assertNotIn("imageio_ffmpeg", sys.modules)


def wav_bytes(seconds, rate=24000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(rate * seconds))
    return buf.getvalue()


class VoiceTest(unittest.TestCase):
    def test_chatterbox_graph_shape(self):
        g = voice.chatterbox_graph("Hello there.", 42)
        self.assertEqual(g["1"]["class_type"], "FL_ChatterboxTTS")
        self.assertEqual(g["1"]["inputs"]["text"], "Hello there.")
        self.assertEqual(g["1"]["inputs"]["seed"], 42)
        self.assertFalse(g["1"]["inputs"]["keep_model_loaded"])
        self.assertFalse(g["1"]["inputs"]["use_cpu"])
        self.assertNotIn("audio_prompt", g["1"]["inputs"])
        self.assertEqual(g["2"]["class_type"], "SaveAudioAdvanced")
        self.assertEqual(g["2"]["inputs"]["audio"], ["1", 0])
        self.assertEqual(g["2"]["inputs"]["format"], "flac")
        self.assertNotIn("3", g)

    def test_chatterbox_graph_with_reference_voice(self):
        g = voice.chatterbox_graph("Hi.", 1, "unique-names/reel-voice.wav")
        self.assertEqual(g["3"], {"class_type": "LoadAudio", "inputs": {"audio": "unique-names/reel-voice.wav"}})
        self.assertEqual(g["1"]["inputs"]["audio_prompt"], ["3", 0])

    def test_chunks_keep_whole_lines_under_the_cap(self):
        lines = ["one two three four five six seven eight nine ten"] * 25   # 250 words
        chunks = voice.chunk_lines(lines)
        self.assertEqual(sum(len(c.split()) for c in chunks), 250)
        self.assertTrue(all(len(c.split()) <= 100 for c in chunks))
        self.assertEqual(len(chunks), 3)
        self.assertEqual(voice.chunk_lines(["", "  hi  "]), ["hi"])
        self.assertEqual(voice.chunk_lines(["a b c", "d e"], max_words=3), ["a b c", "d e"])

    def test_concat_adds_pauses(self):
        out = voice.concat_wavs([wav_bytes(1.0), wav_bytes(2.0)], pause_s=0.5)
        with wave.open(io.BytesIO(out), "rb") as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, 24000))
            self.assertAlmostEqual(w.getnframes() / 24000, 3.5, places=3)

    def test_missing_node_asks_for_a_comfyui_restart(self):
        with mock.patch.object(voice, "http_json", return_value={}):
            with self.assertRaises(JobError) as cm:
                voice.synthesize("http://x", "hi", 1, None, 5)
        self.assertEqual(str(cm.exception), "Restart ComfyUI so it loads the Chatterbox voice node.")

    def test_comfy_down(self):
        with mock.patch.object(voice, "http_json", side_effect=OSError("refused")):
            with self.assertRaises(JobError) as cm:
                voice.ensure_node("http://x")
        self.assertIn("ComfyUI is closed", str(cm.exception))

    def test_synthesize_polls_history_and_returns_wav(self):
        calls = []

        def fake_http(url, body=None, timeout=30):
            calls.append(url)
            if "/object_info/" in url:
                return {"FL_ChatterboxTTS": {}}
            if url.endswith("/prompt"):
                self.assertEqual(body["prompt"]["1"]["inputs"]["text"], "Hello.")
                return {"prompt_id": "p1"}
            if len([c for c in calls if "/history/" in c]) < 2:
                return {}
            return {"p1": {"status": {"status_str": "success", "completed": True},
                           "outputs": {"2": {"audio": [{"filename": "v.flac", "subfolder": "unique-names", "type": "output"}]}}}}

        view = mock.MagicMock()
        view.__enter__.return_value.read.return_value = b"FLAC"
        with mock.patch.object(voice, "http_json", side_effect=fake_http), \
                mock.patch.object(voice.time, "sleep"), \
                mock.patch.object(voice.urllib.request, "urlopen", return_value=view) as uo, \
                mock.patch.object(voice, "flac_to_pcm", return_value=b"\x00\x00" * 2400) as dec:
            out = voice.synthesize("http://x", "Hello.", 7, None, 60)
        dec.assert_called_once_with(b"FLAC")
        self.assertIn("filename=v.flac", uo.call_args[0][0])
        with wave.open(io.BytesIO(out), "rb") as w:
            self.assertEqual(w.getnframes(), 2400)

    def test_synthesize_error_status(self):
        def fake_http(url, body=None, timeout=30):
            if "/object_info/" in url:
                return {"FL_ChatterboxTTS": {}}
            if url.endswith("/prompt"):
                return {"prompt_id": "p1"}
            return {"p1": {"status": {"status_str": "error", "messages": ["oom"]}}}
        with mock.patch.object(voice, "http_json", side_effect=fake_http), mock.patch.object(voice.time, "sleep"):
            with self.assertRaises(JobError) as cm:
                voice.synthesize("http://x", "Hello.", 7, None, 60)
        self.assertIn("failed while making the voice", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
