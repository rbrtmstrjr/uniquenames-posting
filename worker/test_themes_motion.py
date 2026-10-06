# 007 on the PC: theme previews, grayscale themes, voice tightening, camera moves and caption pop.
import io
import math
import os
import re
import shutil
import struct
import tempfile
import unittest
import wave
from unittest import mock

from PIL import Image

import jobs
import reel_render as rr
import reels
import themes
import voice
from render import JobError
from supa import SupaError
from test_reels import FakeRenderer, FakeSupa, make_reel, make_scene

RATE = voice.RATE


# ---------------------------------------------------------------- camera moves
def evaluate(expr, on, zoom=1.0, iw=2160.0, ih=3840.0):
    """Evaluate a zoompan expression the way ffmpeg does (if/lt, on, zoom, iw, ih)."""
    py = expr.replace("if(", "_if(").replace("lt(", "_lt(")
    return float(eval(py, {"_if": lambda c, a, b: a if c else b, "_lt": lambda a, b: a < b},
                      {"on": float(on), "zoom": zoom, "iw": iw, "ih": ih}))


def track(move, n):
    """[(z, x, y)] per output frame."""
    z, x, y = rr.move_expr(move, n)
    out = []
    for on in range(n):
        zv = evaluate(z, on)
        out.append((zv, evaluate(x, on, zv), evaluate(y, on, zv)))
    return out


class MoveExprTest(unittest.TestCase):
    def test_every_move_stays_inside_the_picture_and_moves_smoothly(self):
        for move in rr.MOVES:
            for n in (24, 43, 150):                                       # 24 frames = the shortest scene (0.8 s)
                with self.subTest(move=move, n=n):
                    t = track(move, n)
                    for z, x, y in t:
                        self.assertGreaterEqual(z, 1.0 - 1e-9)
                        self.assertGreaterEqual(x, -1e-6)
                        self.assertGreaterEqual(y, -1e-6)
                        self.assertLessEqual(x, 2160 - 2160 / z + 1e-6)     # the crop never leaves the picture
                        self.assertLessEqual(y, 3840 - 3840 / z + 1e-6)
                    # continuity: no jump between frames. Zoom moves change at most 0.05 a frame (the punch snap is
                    # the fastest, ~0.04); pans/tilts never move faster than 1.5x their average speed (smoothstep)
                    span_x = max(p[1] for p in t) - min(p[1] for p in t)
                    span_y = max(p[2] for p in t) - min(p[2] for p in t)
                    for (z0, x0, y0), (z1, x1, y1) in zip(t, t[1:]):
                        self.assertLess(abs(z1 - z0), 0.05)
                        if move.startswith(("pan", "tilt")):
                            self.assertLessEqual(abs(x1 - x0), 1.5 * span_x / (n - 1) + 1e-6)
                            self.assertLessEqual(abs(y1 - y0), 1.5 * span_y / (n - 1) + 1e-6)
                    if move.startswith("pan"):
                        self.assertTrue(all(abs(p[2] - (3840 - 3840 / 1.15) / 2) < 1e-6 for p in t))   # level
                    if move.startswith("tilt"):
                        self.assertTrue(all(abs(p[1] - (2160 - 2160 / 1.15) / 2) < 1e-6 for p in t))   # straight

    def test_start_and_end_of_each_move(self):
        n = 43
        t = {m: track(m, n) for m in rr.MOVES}
        self.assertAlmostEqual(t["push_in"][0][0], 1.0)
        self.assertAlmostEqual(t["push_in"][-1][0], 1.1)
        self.assertAlmostEqual(t["pull_out"][0][0], 1.1)
        self.assertAlmostEqual(t["pull_out"][-1][0], 1.0)
        spare_x, spare_y = 2160 - 2160 / 1.15, 3840 - 3840 / 1.15
        self.assertAlmostEqual(t["pan_left"][0][1], spare_x, places=3)    # the view travels left
        self.assertAlmostEqual(t["pan_left"][-1][1], 0.0, places=3)
        self.assertAlmostEqual(t["pan_right"][0][1], 0.0, places=3)
        self.assertAlmostEqual(t["pan_right"][-1][1], spare_x, places=3)
        self.assertAlmostEqual(t["tilt_up"][0][2], spare_y, places=3)     # the view travels up
        self.assertAlmostEqual(t["tilt_up"][-1][2], 0.0, places=3)
        self.assertAlmostEqual(t["tilt_down"][-1][2], spare_y, places=3)
        punch = [z for z, _x, _y in t["punch"]]
        self.assertAlmostEqual(punch[0], 1.0)
        self.assertAlmostEqual(punch[9], 1.18)                            # snapped in 0.3 s
        self.assertAlmostEqual(punch[18], 1.12)                           # settled 0.3 s later
        self.assertAlmostEqual(punch[-1], 1.14, places=3)                 # then a slow creep
        self.assertEqual(max(punch), punch[9])

    def test_spike_expressions_verbatim(self):
        self.assertEqual(rr.move_expr("pan_left", 43),
                         ("1.150", "(iw-iw/zoom)*(1-((on/42)*(on/42)*(3-2*(on/42))))", "ih/2-(ih/zoom/2)"))
        self.assertEqual(rr.move_expr("punch", 43)[0],
                         "if(lt(on,9),1+0.180*(on/9)*(2-(on/9)),if(lt(on,18),1.180-0.060*((on-9)/9),1.120+0.020*(on-18)/24))")
        with self.assertRaises(ValueError):
            rr.move_expr("ai", 10)

    def test_rotation_never_repeats_a_move(self):
        self.assertEqual(rr.scene_moves([{}] * 7),
                         ["push_in", "pan_right", "pull_out", "tilt_up", "pan_left", "tilt_down", "push_in"])
        given = [{"motion": "punch"}, {"motion": "punch"}, {"motion": "tilt_up"}, {"motion": None, "key_moment": True},
                 {"motion": "ai"}, {"motion": "pan_left"}, {"motion": "pan_left"}]
        moves = rr.scene_moves(given)
        self.assertEqual(moves[0], "punch")
        self.assertEqual(moves[2], "tilt_up")
        self.assertEqual(moves[3], "punch")                               # a key moment with no motion punches
        self.assertIn(moves[4], rr.MOVES)                                 # unknown -> the rotation
        for a, b in zip(moves, moves[1:]):
            self.assertNotEqual(a, b)
        for n in range(1, 30):                                            # rotation alone, any length
            m = rr.scene_moves([{}] * n)
            self.assertTrue(all(a != b for a, b in zip(m, m[1:])))

    def test_ffmpeg_args_use_each_scenes_move(self):
        items = [{"image": "%d.jpg" % i, "duration": 1.4, "motion": m} for i, m in enumerate(rr.MOVES)]
        args = rr.ffmpeg_args("ffmpeg", items, "voice.wav", "c.ass", "out.mp4")
        graph = args[args.index("-filter_complex") + 1]
        frames = rr.frame_counts([1.4] * 7)
        for i, (m, n) in enumerate(zip(rr.MOVES, frames)):
            z, x, y = rr.move_expr(m, n)
            self.assertIn("[%d:v]scale=2160:3840" % i, graph)
            self.assertIn("zoompan=z='%s':x='%s':y='%s':d=%d:s=1080x1920:fps=30" % (z, x, y, n), graph)
        self.assertNotIn("fade", graph)


# ---------------------------------------------------------------- caption pop
class CaptionPopTest(unittest.TestCase):
    def test_spoken_word_pops_and_the_rest_resets(self):
        words = [{"word": "Stop", "start": 0.0, "end": 0.25}, {"word": "doing", "start": 0.25, "end": 0.5},
                 {"word": "this.", "start": 0.5, "end": 0.9}]
        events = [l for l in rr.ass_captions(words).splitlines() if l.startswith("Dialogue:")]
        self.assertEqual(rr.POP, "{\\fscx80\\fscy80\\t(0,70,\\fscx110\\fscy110)\\t(70,120,\\fscx100\\fscy100)}")
        self.assertEqual(len(events), 3)
        for j, e in enumerate(events):
            self.assertEqual(e.count("\\t("), 2)                          # only the spoken word animates
            text = e.split(",,", 1)[1].split(",,")[-1]
            words_out = re.sub(r"\{[^}]*\}", "", text).split()
            self.assertEqual(words_out, ["STOP", "DOING", "THIS"])
            spoken = ["STOP", "DOING", "THIS"][j]
            self.assertIn("{\\1c&H0000E6FF&}" + rr.POP + spoken + "{\\1c&H00FFFFFF&\\fscx100\\fscy100}", e)
        self.assertTrue(events[1].startswith("Dialogue: 0,0:00:00.25,0:00:00.50,"))  # the pop starts on the word
        self.assertIn("Alignment", rr.ass_captions(words))
        self.assertEqual(rr.CAPTION_STYLE["align"], 2)                    # still bottom-centre


# ---------------------------------------------------------------- voice tightening
def tone_pcm(seconds, amp=8000):
    n = int(round(RATE * seconds))
    return b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * 220 * i / RATE))) for i in range(n))


def silence_pcm(seconds, noise=0):
    n = int(round(RATE * seconds))
    if not noise:
        return b"\x00\x00" * n
    return b"".join(struct.pack("<h", noise if i % 2 else -noise) for i in range(n))


def secs(pcm):
    return len(pcm) / 2.0 / RATE


class TightenTest(unittest.TestCase):
    def test_trims_edges_and_squeezes_long_pauses(self):
        pcm = (silence_pcm(0.5) + tone_pcm(1.0) + silence_pcm(0.6) + tone_pcm(1.0) + silence_pcm(0.2) + tone_pcm(0.5)
               + silence_pcm(0.8))
        out = voice.tighten_pcm(pcm)
        # 0.07 pad + 1.0 + 0.6 -> 0.25 + 1.0 + 0.2 (kept: <= 0.35) + 0.5 + 0.07 pad
        self.assertAlmostEqual(secs(out), 0.07 + 1.0 + 0.25 + 1.0 + 0.2 + 0.5 + 0.07, delta=0.021)

    def test_quiet_room_noise_counts_as_silence(self):
        pcm = silence_pcm(0.4, noise=40) + tone_pcm(0.8) + silence_pcm(1.0, noise=40) + tone_pcm(0.8) + silence_pcm(0.4, noise=40)
        self.assertAlmostEqual(secs(voice.tighten_pcm(pcm)), 0.07 + 0.8 + 0.25 + 0.8 + 0.07, delta=0.021)

    def test_a_soft_word_tail_after_loud_speech_survives(self):
        loud = tone_pcm(0.8, amp=20000)                       # near full scale
        tail = tone_pcm(0.08, amp=int(32768 * 10 ** (-40 / 20.0) * math.sqrt(2)))   # -40 dBFS RMS, 80 ms
        out = voice.tighten_pcm(silence_pcm(0.5) + loud + tail + silence_pcm(0.6))
        self.assertAlmostEqual(secs(out), 0.07 + 0.8 + 0.08 + 0.07, delta=0.021)   # the tail counts as speech
        x = [struct.unpack_from("<h", out, 2 * i)[0] for i in range(len(out) // 2)]
        start = int(RATE * (0.07 + 0.8))
        tail_out = x[start + 100:start + int(RATE * 0.08) - 100]
        self.assertGreater(max(abs(v) for v in tail_out), 300)                       # still there, not faded

    def test_a_breathy_onset_survives(self):
        h = silence_pcm(0.06, noise=int(32768 * 10 ** (-50 / 20.0)))  # an "h" at -50 dBFS: below the threshold
        out = voice.tighten_pcm(silence_pcm(0.5) + h + tone_pcm(0.8))
        self.assertGreaterEqual(secs(out), 0.06 + 0.8)
        x = [struct.unpack_from("<h", out, 2 * i)[0] for i in range(len(out) // 2)]
        lead = len(x) - int(RATE * 0.8)
        h_out = x[lead - int(RATE * 0.06) + 200:lead]
        self.assertTrue(h_out and max(abs(v) for v in h_out) >= int(32768 * 10 ** (-50 / 20.0)) - 1)

    def test_every_cut_fades(self):
        pcm = silence_pcm(0.5, noise=30) + tone_pcm(0.5) + silence_pcm(0.8, noise=30) + tone_pcm(0.5) + silence_pcm(0.5, noise=30)
        out = voice.tighten_pcm(pcm)
        x = [struct.unpack_from("<h", out, 2 * i)[0] for i in range(len(out) // 2)]
        self.assertEqual(x[0], 0)                                                     # faded in at the front cut
        self.assertLessEqual(abs(x[-1]), 1)                                           # faded out at the end cut
        mid = int(RATE * (0.07 + 0.5 + 0.125))                                        # the inner cut
        self.assertTrue(any(abs(v) <= 1 for v in x[mid - 3:mid + 3]))

    def test_short_pauses_and_tight_speech_are_kept(self):
        pcm = tone_pcm(0.7) + silence_pcm(0.3) + tone_pcm(0.7)
        self.assertAlmostEqual(secs(voice.tighten_pcm(pcm)), 1.7, delta=0.011)

    def test_audio_without_speech_is_unchanged(self):
        pcm = silence_pcm(1.0)
        self.assertEqual(voice.tighten_pcm(pcm), pcm)
        self.assertEqual(voice.tighten_pcm(b""), b"")

    def test_wav_round_trip_and_the_gap(self):
        wav = voice.pcm_to_wav(silence_pcm(0.3) + tone_pcm(1.0) + silence_pcm(0.3))
        out = voice.concat_wavs([voice.tighten(wav), voice.tighten(wav)])
        with wave.open(io.BytesIO(out), "rb") as w:
            self.assertAlmostEqual(w.getnframes() / float(RATE), 2 * 1.14 + 0.10, delta=0.03)
        self.assertEqual(voice.PAUSE_SECONDS, 0.10)

    def test_the_reel_voice_is_tightened_before_the_speed_up(self):
        supa = FakeSupa()
        rr_ = reels.ReelRunner(supa, FakeRenderer(), log=lambda m: None, sleep=lambda s: None)
        spoken = voice.pcm_to_wav(silence_pcm(0.5) + tone_pcm(1.0) + silence_pcm(0.5))
        seen = []
        with mock.patch.object(reels.voice, "ensure_node"), \
                mock.patch.object(reels.voice, "synthesize", return_value=spoken), \
                mock.patch.object(reels.voice, "chunk_lines", return_value=["one", "two"]), \
                mock.patch.object(reels.voice, "speed_up", side_effect=lambda w, s: seen.append(w) or w):
            rr_.run_step({"step": "voice", "reel": make_reel(), "scene": None})
        with wave.open(io.BytesIO(seen[0]), "rb") as w:
            self.assertAlmostEqual(w.getnframes() / float(RATE), 2 * 1.14 + 0.10, delta=0.03)


# ---------------------------------------------------------------- themes
STYLE = "Soft watercolour wash style."


class ThemeSupa(FakeSupa):
    def __init__(self):
        super().__init__()
        self.themes = []
        self.preview_jobs = []
        self.preview_missing = False

    def select(self, table, query):
        if table == "reel_themes":
            self.selects.append((table, query))
            return [dict(t) for t in self.themes if "id=eq.%s&" % t["id"] in query + "&"]
        return super().select(table, query)

    def rpc(self, fn, args=None):
        if fn == "claim_next_theme_preview":
            self.rpcs.append(fn)
            self.rpc_args.append(args)
            if self.preview_missing:
                raise SupaError('POST /rest/v1/rpc/claim_next_theme_preview -> HTTP 404 {"code":"PGRST202"}')
            return self.preview_jobs.pop(0) if self.preview_jobs else None
        return super().rpc(fn, args)


class ColourRenderer(FakeRenderer):
    def generate_photo(self, prompt, seed, width, height):
        self.calls.append((prompt, seed, width, height))
        if self.boom:
            raise self.boom
        return Image.new("RGB", (width, height), (200, 60, 20))


def is_gray(jpeg_bytes):
    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    r, g, b = img.getpixel((540, 960))
    return abs(r - g) <= 2 and abs(g - b) <= 2


class ThemeHelpersTest(unittest.TestCase):
    def test_theme_resolution(self):
        self.assertIsNone(themes.theme_id_for({"id": "r"}, {"id": 1}))                       # before 007
        self.assertEqual(themes.theme_id_for({"theme_id": None}, {"reel_theme_id": "sketch"}), "sketch")
        self.assertEqual(themes.theme_id_for({"theme_id": "clay"}, {"reel_theme_id": "sketch"}), "clay")
        self.assertEqual(themes.theme_id_for({"theme_id": None}, {}), "knitted")
        self.assertEqual(themes.theme_id_for({"theme_id": "x&id=eq.y"}, {}), "knitted")      # never a query injection

    def test_preview_prompt_and_path(self):
        p = themes.preview_prompt({"id": "watercolor", "style": STYLE})
        self.assertIn("Moment: a mother gently lifting her laughing baby up toward the warm window light.", p)
        self.assertIn(STYLE + " Characters (the same two people in every picture): the mother:", p)
        self.assertTrue(p.endswith(themes.NO_TEXT))
        self.assertNotIn("camera", p.lower())
        k = themes.preview_prompt({"id": "knitted", "style": STYLE})
        self.assertIn("(the same two dolls in every picture): the mom doll:", k)
        self.assertEqual(themes.preview_path("sketch", 3), "themes/sketch/preview-v3.jpg")

    def test_to_gray(self):
        g = themes.to_gray(Image.new("RGB", (4, 4), (200, 60, 20)))
        self.assertEqual(g.mode, "RGB")
        r, gg, b = g.getpixel((0, 0))
        self.assertEqual((r, r), (gg, b))


class ThemePreviewJobTest(unittest.TestCase):
    def setUp(self):
        self.supa = ThemeSupa()
        self.r = ColourRenderer()
        self.logs = []
        self.rr = reels.ReelRunner(self.supa, self.r, log=self.logs.append, sleep=lambda s: None)

    def job(self, **kw):
        t = {"id": "sketch", "style": STYLE, "grayscale": True, "version": 4, "preview_status": "making",
             "preview_path": "themes/sketch/preview-v3.jpg"}
        t.update(kw)
        return {"theme": t}

    def test_makes_uploads_saves_and_tidies(self):
        self.supa.listing = {"themes/sketch": [{"name": "preview-v3.jpg", "id": "a"}, {"name": "preview-v4.jpg", "id": "b"},
                                               {"name": "other.png", "id": "c"}]}
        self.rr.run_theme_preview(self.job())
        prompt, seed, w, h = self.r.calls[0]
        self.assertEqual((seed, w, h), (1234, 1088, 1920))
        self.assertIn(STYLE, prompt)
        bucket, data, ctype = self.supa.uploads["themes/sketch/preview-v4.jpg"]
        self.assertEqual((bucket, ctype), ("reels", "image/jpeg"))
        self.assertEqual(Image.open(io.BytesIO(data)).size, (1080, 1920))
        self.assertTrue(is_gray(data))                                   # grayscale theme
        t, match, body = self.supa.of("reel_themes")[-1]
        self.assertEqual(match, "id=eq.sketch&version=eq.4")
        self.assertEqual(body, {"preview_status": "ready", "preview_path": "themes/sketch/preview-v4.jpg", "error": None,
                                "claimed_at": None})
        self.assertEqual(self.supa.removed, ["themes/sketch/preview-v3.jpg"])

    def test_colour_themes_stay_in_colour(self):
        self.rr.run_theme_preview(self.job(id="clay", grayscale=False, version=1))
        self.assertFalse(is_gray(self.supa.uploads["themes/clay/preview-v1.jpg"][1]))

    def test_stale_preview_is_dropped(self):
        self.supa.stale.add("reel_themes")
        self.rr.run_theme_preview(self.job())
        self.assertEqual(self.supa.removed, ["themes/sketch/preview-v4.jpg"])
        self.assertIn(reels.STALE, self.logs)

    def test_failure_is_saved_with_its_reason(self):
        self.r.boom = JobError("ComfyUI failed while making the picture: OOM")
        self.rr.run_theme_preview(self.job())
        _t, match, body = self.supa.of("reel_themes")[-1]
        self.assertEqual(match, "id=eq.sketch&version=eq.4")
        self.assertEqual(body, {"preview_status": "failed", "error": "ComfyUI failed while making the picture: OOM",
                                "claimed_at": None})
        self.assertEqual(self.supa.uploads, {})

    def test_comfy_closed_puts_it_back_in_line(self):
        self.r.ok = False
        self.rr.run_theme_preview(self.job())
        self.assertEqual(self.supa.of("reel_themes")[-1][2], {"preview_status": "queued", "claimed_at": None})
        self.assertEqual(self.r.calls, [])

    def test_bad_id_fails_with_a_message(self):
        self.rr.run_theme_preview({"theme": {"id": "../x", "version": 1}})
        _t, match, body = self.supa.of("reel_themes")[-1]
        self.assertEqual(match, "id=eq." + "..%2Fx" + "&version=eq.1")   # url-encoded, never a raw filter
        self.assertEqual(body, {"preview_status": "failed", "error": reels.BAD_THEME, "claimed_at": None})
        self.assertEqual(self.r.calls, [])
        self.assertEqual(self.supa.uploads, {})
        self.assertTrue(any("bad theme id" in m for m in self.logs))


class GrayscaleSceneTest(unittest.TestCase):
    def setUp(self):
        self.supa = ThemeSupa()
        self.supa.themes = [{"id": "sketch", "grayscale": True}, {"id": "knitted", "grayscale": False}]
        self.rr = reels.ReelRunner(self.supa, ColourRenderer(), log=lambda m: None, sleep=lambda s: None)

    def image(self, reel, settings):
        self.supa.settings = [settings]
        self.rr.run_step({"step": "image", "reel": reel, "scene": make_scene(1)})
        return self.supa.uploads["%s/scenes/01-v2.jpg" % reel["id"]][1]

    def test_sketch_reel_pictures_turn_grey(self):
        self.assertTrue(is_gray(self.image(make_reel(theme_id="sketch"), {"id": 1, "reel_theme_id": "knitted"})))

    def test_default_theme_from_settings(self):
        self.assertTrue(is_gray(self.image(make_reel(theme_id=None), {"id": 1, "reel_theme_id": "sketch"})))
        self.assertFalse(is_gray(self.image(make_reel(theme_id=None), {"id": 1, "reel_theme_id": "knitted"})))

    def test_before_007_nothing_is_looked_up(self):
        self.assertFalse(is_gray(self.image(make_reel(), {"id": 1})))
        self.assertFalse([q for q in self.supa.selects if q[0] == "reel_themes"])

    def test_a_failed_theme_lookup_puts_the_image_back_without_an_attempt(self):
        for failing in ("reel_themes", "settings"):
            with self.subTest(failing=failing):
                self.setUp()
                self.supa.settings = [{"id": 1, "reel_theme_id": "sketch"}]

                def boom(table, query, failing=failing):
                    if table == failing:
                        raise SupaError("GET x -> network error: down")
                    return ThemeSupa.select(self.supa, table, query)
                self.supa.select = boom
                self.rr.run_step({"step": "image", "reel": make_reel(theme_id="sketch"), "scene": make_scene(1, attempts=2)})
                self.assertEqual(self.supa.uploads, {})
                self.assertEqual(self.rr.renderer.calls, [])                    # no picture made in the wrong colours
                _t, _m, body = self.supa.of("reel_scenes")[-1]
                self.assertEqual(body, {"status": "queued", "attempts": 1, "error": None, "claimed_at": None})
                self.assertEqual(self.supa.of("reels")[-1][2], {"claimed_at": None})


class PreviewTickTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.supa = ThemeSupa()
        self.reels = mock.Mock()
        self.logs = []
        self.run_ = jobs.Runner(self.supa, FakeRenderer(), os.path.join(self.root, "out"), os.path.join(self.root, "c"),
                                log=self.logs.append, reels=self.reels)

    def test_preview_after_samples_when_nothing_else(self):
        job = {"theme": {"id": "anime", "version": 2}}
        self.supa.preview_jobs.append(job)
        self.assertTrue(self.run_.tick())
        self.assertEqual(self.supa.rpcs[-2:], ["claim_next_voice_sample", "claim_next_theme_preview"])
        self.reels.run_theme_preview.assert_called_once_with(job)

    def test_a_sample_goes_before_a_preview(self):
        self.supa.sample_jobs.append({"voice": {"id": "kore", "version": 1}})
        self.supa.preview_jobs.append({"theme": {"id": "anime", "version": 2}})
        self.assertTrue(self.run_.tick())
        self.assertNotIn("claim_next_theme_preview", self.supa.rpcs)
        self.reels.run_theme_preview.assert_not_called()

    def test_no_preview_without_comfy(self):
        self.run_.renderer = FakeRenderer(ok=False)
        self.assertFalse(self.run_.tick())
        self.assertNotIn("claim_next_theme_preview", self.supa.rpcs)

    def test_pre_007_previews_go_quiet_and_come_back(self):
        self.supa.preview_missing = True
        self.assertFalse(self.run_.tick())
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs.count("claim_next_theme_preview"), 1)       # rechecked in 10 minutes
        self.assertEqual(len([m for m in self.logs if "007_reel_themes" in m]), 1)
        self.run_.themes_off_until = 0
        self.assertFalse(self.run_.tick())
        self.assertEqual(len([m for m in self.logs if "007_reel_themes" in m]), 1)   # logged once per switch
        self.run_.themes_off_until = 0
        self.supa.preview_missing = False
        self.assertFalse(self.run_.tick())
        self.assertEqual(len([m for m in self.logs if "(007 found)" in m]), 1)

    def test_other_errors_reach_the_loop(self):
        self.supa.rpc = mock.Mock(side_effect=lambda fn, args=None: (_ for _ in ()).throw(SupaError("network down"))
                                  if fn == "claim_next_theme_preview" else (0 if fn != "claim_next_card" else None))
        with self.assertRaises(SupaError):
            self.run_.tick()


if __name__ == "__main__":
    unittest.main()
