# Reels voices + music (006): the ACE-Step graph, the mix filter, the voice helpers (resolution, speed,
# sample key, ComfyUI input names) and a real ffmpeg mix when imageio-ffmpeg is installed.
import io
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import wave
from unittest import mock

import music
import reel_render as rr
import voice
from render import JobError

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # pragma: no cover
    FFMPEG = None


def tone_wav(seconds, rate=24000):
    import math
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(rate * seconds)):
            v = int(8000 * math.sin(2 * math.pi * 220 * i / rate))
            frames += v.to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))
    return buf.getvalue()


class AceStepGraphTest(unittest.TestCase):
    def test_graph_matches_the_spike(self):
        g = music.ace_step_graph(12.5, 77)
        self.assertEqual(sorted(g, key=int), [str(i) for i in range(1, 11)])
        self.assertEqual(g["1"]["inputs"]["unet_name"], "acestep_v1.5_turbo.safetensors")
        self.assertEqual(g["2"]["inputs"], {"clip_name1": "qwen_0.6b_ace15.safetensors",
                                            "clip_name2": "qwen_1.7b_ace15.safetensors", "type": "ace"})
        self.assertEqual(g["3"]["inputs"]["vae_name"], "ace_1.5_vae.safetensors")
        enc = g["5"]
        self.assertEqual(enc["class_type"], "TextEncodeAceStepAudio1.5")
        self.assertEqual(enc["inputs"]["tags"], "heartwarming, soft piano, gentle strings, warm lullaby, slow, instrumental, no vocals")
        self.assertEqual(enc["inputs"]["lyrics"], "[Instrumental]")
        self.assertEqual((enc["inputs"]["duration"], enc["inputs"]["seed"]), (12.5, 77))
        self.assertEqual(g["7"], {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"seconds": 12.5, "batch_size": 1}})
        ks = g["8"]["inputs"]
        self.assertEqual((ks["seed"], ks["steps"], ks["cfg"], ks["sampler_name"], ks["scheduler"]), (77, 8, 1.0, "euler", "simple"))
        self.assertEqual((ks["positive"], ks["negative"], ks["latent_image"], ks["model"]), (["5", 0], ["6", 0], ["7", 0], ["4", 0]))
        self.assertEqual(g["10"]["class_type"], "SaveAudioAdvanced")
        self.assertEqual((g["10"]["inputs"]["audio"], g["10"]["inputs"]["format"]), (["9", 0], "flac"))

    def test_bed_length_and_seed(self):
        self.assertEqual(music.music_seconds(10.0), 18.0)                      # asked for voice + 8 s ...
        self.assertEqual(music.music_seconds(41.234), 49.23)
        self.assertEqual(music.music_seconds(235.0), music.MAX_SECONDS)        # ... at most 240 s
        self.assertEqual(music.music_seconds(999), music.MAX_SECONDS)
        self.assertEqual(music.EXTRA_SECONDS, 2.0)                             # ... the reel keeps voice + 2 s
        seeds = {music.random_seed() for _ in range(20)}
        self.assertGreater(len(seeds), 15)
        self.assertTrue(all(0 <= s < 2 ** 32 for s in seeds))


class ComfyAudioTest(unittest.TestCase):
    def run_it(self, history, timeout=60, beat=None):
        calls = []

        def fake_http(url, body=None, timeout=30):
            calls.append(url)
            if url.endswith("/prompt"):
                self.assertEqual(body["prompt"]["10"]["class_type"], "SaveAudioAdvanced")
                return {"prompt_id": "p1"}
            return history(len([c for c in calls if "/history/" in c]))

        view = mock.MagicMock()
        view.__enter__.return_value.read.return_value = b"fLaC"
        clock = [0.0]
        with mock.patch.object(music, "http_json", side_effect=fake_http), \
                mock.patch.object(music.time, "time", side_effect=lambda: clock[0]), \
                mock.patch.object(music.urllib.request, "urlopen", return_value=view) as uo:
            out = music.comfy_audio("http://x", music.ace_step_graph(5, 1), "10", timeout, "music", beat,
                                    sleep=lambda s: clock.__setitem__(0, clock[0] + 10))
        return out, uo

    def test_polls_beats_and_downloads(self):
        beats = []
        done = {"p1": {"status": {"status_str": "success", "completed": True},
                       "outputs": {"10": {"audio": [{"filename": "m.flac", "subfolder": "unique-names", "type": "output"}]}}}}
        out, uo = self.run_it(lambda n: done if n >= 4 else {}, beat=lambda: beats.append(1))
        self.assertEqual(out, b"fLaC")
        self.assertIn("filename=m.flac", uo.call_args[0][0])
        self.assertGreaterEqual(len(beats), 1)

    def test_error_and_timeout(self):
        with self.assertRaises(JobError) as cm:
            self.run_it(lambda n: {"p1": {"status": {"status_str": "error", "messages": ["no node"]}}})
        self.assertIn("failed while making the music", str(cm.exception))
        with self.assertRaises(JobError) as cm:
            self.run_it(lambda n: {}, timeout=30)
        self.assertIn("did not finish the music within 30 seconds", str(cm.exception))

    def test_comfy_down(self):
        with mock.patch.object(music, "http_json", side_effect=OSError("refused")):
            with self.assertRaises(JobError) as cm:
                music.make_bed("http://x", 5, 1, 30)
        self.assertEqual(str(cm.exception), music.COMFY_CLOSED)


class MixTest(unittest.TestCase):
    def test_mix_filter(self):
        f = music.mix_filter("3:a", "4:a", 0.18, 20.0)
        chains = f.split(";\n")
        self.assertEqual(len(chains), 4)
        self.assertTrue(chains[0].startswith("[3:a]aformat="))
        self.assertIn(",apad,asplit=2[voice][key]", chains[0])                  # voice + key never end early
        self.assertTrue(chains[1].startswith("[4:a]aformat="))
        self.assertIn("apad,atrim=0:20.000,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,volume=0.18", chains[1])
        self.assertIn("afade=t=in:st=0:d=0.05,afade=t=out:st=18.000:d=2[bed]", chains[1])
        self.assertEqual(chains[2], "[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1[ducked]")
        self.assertEqual(chains[3], "[voice][ducked]amix=inputs=2:duration=shortest:normalize=0,atrim=0:20.000[aout]")
        self.assertIn("afade=t=out:st=0.000", music.mix_filter("0:a", "1:a", 0.1, 1.0))  # a very short reel

    def test_volume_and_choice(self):
        self.assertEqual([music.clamp_volume(v) for v in (18, 2, 99, "25", None, "x")], [18, 5, 40, 25, 18, 18])
        on = {"reel_music": True, "reel_music_volume": 25}
        self.assertEqual(rr.music_choice(on, {"music_path": "r/music-v2.flac"}), ("r/music-v2.flac", 0.25))
        self.assertEqual(rr.music_choice(on, {"music_path": ""}), (None, 0.0))           # the music step failed
        self.assertEqual(rr.music_choice(on, {"music_path": None}), (None, 0.0))
        self.assertEqual(rr.music_choice(dict(on, reel_music=False), {"music_path": "m.flac"}), (None, 0.0))
        self.assertEqual(rr.music_choice({}, {"music_path": "m.flac"}), (None, 0.0))      # no 006 settings
        self.assertEqual(rr.music_choice({"reel_music": True}, {"music_path": "m"})[1], 0.18)

    def test_ffmpeg_args_with_and_without_music(self):
        scenes = [{"image": "a.jpg", "duration": 1.0}, {"image": "b.jpg", "duration": 1.5}]
        plain = rr.ffmpeg_args("ff", scenes, "voice.wav", "c.ass", "out.mp4")
        self.assertEqual(plain[plain.index("[vout]") + 2], "2:a")
        self.assertNotIn("music.flac", plain)
        mixed = rr.ffmpeg_args("ff", scenes, "voice.wav", "c.ass", "out.mp4", music="music.flac", music_volume=0.2)
        self.assertEqual(mixed[mixed.index("music.flac") - 1], "-i")
        self.assertEqual(mixed.index("music.flac"), mixed.index("voice.wav") + 2)        # input 3, after the voice
        self.assertEqual(mixed[mixed.index("[vout]") + 2], "[aout]")
        graph = mixed[mixed.index("-filter_complex") + 1]
        self.assertIn("[2:a]aformat", graph)
        self.assertIn("[3:a]aformat", graph)
        self.assertIn("volume=0.20", graph)
        self.assertIn("atrim=0:2.500", graph)                                          # = the video's frames / fps
        self.assertIn("-shortest", mixed)


class VoiceHelpersTest(unittest.TestCase):
    def test_resolution(self):
        self.assertEqual(voice.resolve_voice_id({"voice_id": "kore"}, {"reel_voice_id": "gacrux"}), "kore")
        self.assertEqual(voice.resolve_voice_id({"voice_id": None}, {"reel_voice_id": "gacrux"}), "gacrux")
        self.assertEqual(voice.resolve_voice_id({}, {}), "builtin")
        self.assertEqual(voice.resolve_voice_id(None, {"reel_voice_id": "Sulafat "}), "sulafat")

    def test_speed(self):
        self.assertEqual(voice.reel_speed({}), 1.0)                                   # before 006: unchanged
        self.assertEqual(voice.reel_speed({"reel_speed": 1.12}), 1.12)
        self.assertEqual(voice.reel_speed({"reel_speed": "1.2"}), 1.2)
        self.assertEqual(voice.reel_speed({"reel_speed": 3}), 1.25)
        self.assertEqual(voice.reel_speed({"reel_speed": 0.5}), 1.0)
        self.assertEqual(voice.reel_speed({"reel_speed": None}), 1.12)
        self.assertEqual(voice.reel_speed({"reel_speed": "nan"}), 1.12)
        self.assertIsNone(voice.atempo_filter(1.0))
        self.assertIsNone(voice.atempo_filter(1.001))
        self.assertEqual(voice.atempo_filter(1.12), "atempo=1.12")
        self.assertEqual(voice.atempo_filter(2), "atempo=1.25")

    def test_sample_key_and_calm_params(self):
        self.assertEqual(voice.sample_key(1.12), "e0.35-t0.7-c0.5-s1.12-g1")
        self.assertEqual(voice.sample_key(1.0), "e0.35-t0.7-c0.5-s1.00-g1")
        tts = voice.chatterbox_graph("Hi.", 1)["1"]["inputs"]
        self.assertEqual((tts["exaggeration"], tts["temperature"], tts["cfg_weight"]), (0.35, 0.7, 0.5))

    def test_older_reference_versions_leave_comfyui_input(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        sub = os.path.join(d, "unique-names")
        os.makedirs(sub)
        names = ["voices-kore-ref-v1.wav", "voices-kore-ref-v2.wav", "voices-kore-ref-v3.wav",
                 "voices-korean-ref-v1.wav", "voices-gacrux-ref-v1.wav", "reel-voice.wav", "voices-kore-ref-v1.mp3"]
        for n in names:
            open(os.path.join(sub, n), "wb").close()
        self.assertEqual(voice.prune_inputs("http://x", "unique-names/voices-kore-ref-v3.wav", input_dir=d), 2)
        self.assertEqual(sorted(os.listdir(sub)), sorted(names[2:]))
        self.assertEqual(voice.prune_inputs("http://x", "unique-names/odd.wav", input_dir=d), 0)
        argv = {"system": {"argv": ["ComfyUI\\main.py", "--input-directory", d, "--output-directory", "o"]}}
        with mock.patch("render.http_json", return_value=argv):
            self.assertEqual(voice.comfy_input_dir("http://x"), d)
        with mock.patch("render.http_json", return_value={"system": {"argv": ["main.py"]}}):
            self.assertIsNone(voice.comfy_input_dir("http://x"))
            self.assertEqual(voice.prune_inputs("http://x", "unique-names/voices-kore-ref-v9.wav"), 0)

    def test_input_names_are_safe(self):
        self.assertEqual(voice.input_name("voices/gacrux/ref.wav", 3), "voices-gacrux-ref-v3.wav")
        self.assertEqual(voice.input_name("voice/ref.mp3", 0), "voice-ref-v0.mp3")
        for bad in ("../../etc/passwd", "a\\..\\b.wav", "voices/x y/r?.w*v"):
            self.assertRegex(voice.input_name(bad, 1), r"^[A-Za-z0-9_-]+-v1\.[a-z0-9]+$")

    def test_speed_up_at_one_is_a_no_op(self):
        data = tone_wav(0.2)
        self.assertIs(voice.speed_up(data, 1.0), data)


@unittest.skipIf(FFMPEG is None, "imageio-ffmpeg is not installed")
class RealAudioTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)

    def test_atempo_keeps_the_format_and_shortens(self):
        out = voice.speed_up(tone_wav(2.24), 1.12)
        with wave.open(io.BytesIO(out), "rb") as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, 24000))
            self.assertAlmostEqual(w.getnframes() / 24000.0, 2.0, delta=0.03)

    def test_real_mix_is_as_long_as_the_video(self):
        with open(os.path.join(self.d, "voice.wav"), "wb") as fh:
            fh.write(tone_wav(2.0))
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=48000",
                        "-ac", "2", os.path.join(self.d, "music.flac")], check=True)   # shorter than the voice
        f = music.mix_filter("0:a", "1:a", 0.18, 3.0)
        r = subprocess.run([FFMPEG, "-v", "error", "-i", "voice.wav", "-i", "music.flac", "-filter_complex", f,
                            "-map", "[aout]", "-c:a", "pcm_s16le", "out.wav"], cwd=self.d, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace")[-500:])
        with wave.open(os.path.join(self.d, "out.wav"), "rb") as w:
            self.assertEqual((w.getnchannels(), w.getframerate()), (2, 48000))
            self.assertAlmostEqual(w.getnframes() / 48000.0, 3.0, delta=0.05)


if __name__ == "__main__":
    unittest.main()
