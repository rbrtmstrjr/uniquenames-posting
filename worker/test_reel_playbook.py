# Playbook v2 render: eased push/pull/hold moves, punch-ins, dissolves, captions + hook card in the safe zone,
# generated SFX and the loudness chain.
import io
import os
import shutil
import subprocess
import tempfile
import unittest
import wave
from unittest import mock

from PIL import Image

import fonts
import reel_audio as ra
import reel_frames as rf
import reel_render as rr

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = None


def words_of(text, start=0.0, step=0.3):
    return [{"word": w, "start": round(start + i * step, 3), "end": round(start + i * step + step * 0.9, 3)}
            for i, w in enumerate(text.split())]


# ---------------------------------------------------------------- motion
class EasingTest(unittest.TestCase):
    def test_smoothstep(self):
        self.assertEqual([rf.smoothstep(p) for p in (-1, 0, 0.5, 1, 2)], [0.0, 0.0, 0.5, 1.0, 1.0])
        self.assertAlmostEqual(rf.smoothstep(0.25), 0.15625)

    def test_zoom_amount_is_4_to_10_percent_and_up_to_15_on_the_payoff(self):
        self.assertEqual(rf.zoom_amount(0.8), 0.04)
        self.assertEqual(rf.zoom_amount(2.5), 0.075)
        self.assertEqual(rf.zoom_amount(9.0), 0.10)
        self.assertEqual(rf.zoom_amount(9.0, payoff=True), 0.15)

    def test_push_pull_hold_ease_in_and_out(self):
        for move in ("push_in", "pull_out"):
            n, amt = 75, 0.08
            z = [rf.base_zoom(move, k / (n - 1.0), amt) for k in range(n)]
            ends = (1.0, 1.08) if move == "push_in" else (1.08, 1.0)
            self.assertAlmostEqual(z[0], ends[0])
            self.assertAlmostEqual(z[-1], ends[1])
            steps = [abs(b - a) for a, b in zip(z, z[1:])]
            self.assertLess(steps[0], steps[n // 2] / 10)          # starts and stops gently (no linear start/stop)
            self.assertLess(steps[-1], steps[n // 2] / 10)
            self.assertLessEqual(max(steps), 1.5 * amt / (n - 1) + 1e-9)   # never faster than 1.5x the average
            self.assertTrue(all(b >= a for a, b in zip(z, z[1:])) or all(b <= a for a, b in zip(z, z[1:])))
        self.assertEqual({rf.base_zoom("hold", p / 10.0, 0.08) for p in range(11)}, {1.0})
        with self.assertRaises(ValueError):
            rf.base_zoom("pan_left", 0.5, 0.1)

    def test_crop_box_is_sub_pixel_and_inside(self):
        for z in (1.0, 1.0001, 1.04, 1.1, 1.265):
            x0, y0, x1, y1 = rf.crop_box(z, 2160, 3840)
            self.assertGreaterEqual(x0, 0)
            self.assertGreaterEqual(y0, 0)
            self.assertLessEqual(x1, 2160 + 1e-9)
            self.assertLessEqual(y1, 3840 + 1e-9)
            self.assertAlmostEqual(x1 - x0, 2160 / z)
            self.assertAlmostEqual((x0 + x1) / 2, 1080)            # centred across ...
        self.assertAlmostEqual(sum(rf.crop_box(1.3, 2160, 3840)[1::2]) / 2, 0.45 * 3840)   # ... a bit above the middle
        self.assertEqual(rf.crop_box(1.1, 2160, 3840)[1], 0.0)    # (kept inside the picture)
        a, b = rf.crop_box(1.0400, 2160, 3840), rf.crop_box(1.0401, 2160, 3840)
        self.assertNotEqual(int(a[0]), a[0])                       # not whole pixels
        self.assertLess(abs(a[0] - b[0]), 0.2)                     # a tiny zoom step moves the box a tiny amount


class MovesTest(unittest.TestCase):
    def test_only_push_pull_hold_and_old_rows_become_push_pull(self):
        old = [{"motion": m} for m in ("pan_left", "tilt_up", "punch", "pan_right", "tilt_down", None, "ai")] + [{}]
        moves = rf.scene_moves(old)
        self.assertEqual(moves, ["push_in", "pull_out"] * 4)
        new = [{"motion": "push_in"}, {"motion": "pull_out"}, {"motion": "hold"}, {"motion": "push_in"},
               {"motion": "pull_out"}, {"motion": "hold"}, {"motion": "hold"}, {"motion": "push_in"}]
        moves = rf.scene_moves(new)
        self.assertEqual(moves[:6], ["push_in", "pull_out", "hold", "push_in", "pull_out", "hold"])
        self.assertNotEqual(moves[6], "hold")                      # never two holds in a row
        for n in range(1, 25):
            m = rf.scene_moves([{"motion": "push_in"}] * n)
            dirs = [x for x in m if x != "hold"]
            self.assertTrue(all(a != b for a, b in zip(dirs, dirs[1:])))   # push and pull alternate
            self.assertTrue(set(m) <= set(rf.MOVES))


class PunchTest(unittest.TestCase):
    W = words_of("You will never get this day back. Don't blink, mama.", start=1.0)

    def test_matches_by_normalized_word_or_phrase(self):
        self.assertEqual(rf.punch_time("never", self.W, 0, 10), 1.6)
        self.assertEqual(rf.punch_time("NEVER!", self.W, 0, 10), 1.6)
        self.assertEqual(rf.punch_time("this day", self.W, 0, 10), 2.2)
        self.assertEqual(rf.punch_time("don’t blink", self.W, 0, 10), 3.1)      # curly apostrophe
        self.assertEqual(rf.punch_time("day forever", self.W, 0, 10), 2.5)           # phrase not found: its first word
        self.assertIsNone(rf.punch_time("tomorrow", self.W, 0, 10))
        self.assertIsNone(rf.punch_time("never", self.W, 2.0, 10))                   # outside the line's window
        self.assertIsNone(rf.punch_time("", self.W, 0, 10))
        self.assertIsNone(rf.punch_time(None, self.W, 0, 10))
        rep = words_of("your face and your arms", start=3.0)       # "your" at 3.0 (the cut) and 3.9
        self.assertEqual(rf.punch_time("your", rep, 3.0, 5.0), 3.0)
        self.assertEqual(rf.punch_time("your", rep, 3.0, 5.0, earliest=3.3), 3.9)  # a later one that can land
        self.assertIsNone(rf.punch_time("your", rep, 3.0, 5.0, earliest=3.3, latest=3.5))

    def test_a_repeated_word_lands_on_the_occurrence_that_fits(self):
        words = words_of("your face and your arms here", start=2.0, step=0.4)
        items = [{"image": "a", "duration": 2.0}, {"image": "b", "duration": 2.4, "punch": "your", "start_s": 2.0}]
        self.assertEqual(rf.punch_times(rf.build_shots(items, words)), [3.2])

    def test_punch_frame_math(self):
        words = words_of("one two three four five six seven eight nine ten", start=0.0, step=0.5)
        items = [{"image": "a", "duration": 2.0}, {"image": "b", "duration": 3.0, "punch": "six", "start_s": 2.0,
                  "end_s": 5.0}]
        shots = rf.build_shots(items, words)
        s = shots[1]
        self.assertEqual(s["f0"], 60)
        self.assertEqual(s["punch_k"], 15)                         # "six" at 2.5 s = 0.5 s into the shot
        z = [rf.shot_zoom(s, k) for k in range(s["n"])]
        jump = z[15] / z[14]
        self.assertGreater(jump, 1.0 + 0.12)                       # instant +12-18% ...
        self.assertLess(jump, 1.0 + 0.18 + 0.01)
        for k in range(16, s["n"]):                                # ... and held to the end of the shot
            self.assertAlmostEqual(z[k], rf.base_zoom(s["move"], k / (s["n"] - 1.0), s["amount"]) * 1.15)
        self.assertEqual(rf.punch_times(shots), [2.5])

    def test_punch_not_at_the_cut_nor_at_the_very_end(self):
        words = words_of("one two three four five six seven eight nine ten", start=0.0, step=0.5)
        for word in ("five", "ten"):                               # 2.0 s = the cut; 4.5 s = 0.15 s before the end
            items = [{"image": "a", "duration": 2.0}, {"image": "b", "duration": 2.65, "punch": word}]
            self.assertIsNone(rf.build_shots(items, words)[1]["punch_k"], word)

    def test_at_most_four_punches(self):
        words = words_of(" ".join("w%d" % i for i in range(40)), step=0.5)
        items = [{"image": str(i), "duration": 2.0, "punch": "w%d" % (i * 4 + 2)} for i in range(8)]
        shots = rf.build_shots(items, words)
        self.assertEqual(len(rf.punch_times(shots)), rf.MAX_PUNCHES)
        self.assertEqual([s["punch_k"] is not None for s in shots], [True] * 4 + [False] * 4)


class CutsTest(unittest.TestCase):
    def test_hard_cuts_and_a_dissolve_only_into_time_jump_scenes(self):
        items = [{"image": "a", "duration": 2.0}, {"image": "b", "duration": 2.0, "time_jump": True},
                 {"image": "c", "duration": 2.0}, {"image": "d", "duration": 2.0, "time_jump": False}]
        items[0]["time_jump"] = True                               # the first scene has nothing to dissolve from
        shots = rf.build_shots(items, [])
        self.assertEqual([s["dissolve"] for s in shots], [False, True, False, False])
        self.assertEqual(rf.frame_layers(shots, 119), [(1, 59, 1.0)])     # hard cut b -> c
        self.assertEqual(rf.frame_layers(shots, 120), [(2, 0, 1.0)])
        mixed = [f for f in range(240) if len(rf.frame_layers(shots, f)) == 2]
        self.assertEqual(mixed, list(range(54, 66)))               # 0.4 s = 12 frames, centred on the cut at 60
        weights = [rf.frame_layers(shots, f)[1][2] for f in mixed]
        self.assertTrue(all(0 < w < 1 for w in weights))
        self.assertTrue(all(b > a for a, b in zip(weights, weights[1:])))
        self.assertAlmostEqual(weights[0] + weights[-1], 1.0)
        self.assertEqual(rf.frame_layers(shots, 54)[0][:2], (0, 54))      # the old shot keeps going ...
        self.assertEqual(rf.frame_layers(shots, 54)[1][:2], (1, -6))      # ... the new one starts early (move held)

    def test_dissolve_shrinks_for_very_short_shots(self):
        items = [{"image": "a", "duration": 0.2}, {"image": "b", "duration": 2.0, "time_jump": True}]
        shots = rf.build_shots(items, [])
        self.assertEqual(sum(1 for f in range(66) if len(rf.frame_layers(shots, f)) == 2), 6)

    def test_frame_counts_add_up(self):
        d = [1.234, 2.345, 3.456]
        self.assertEqual(sum(rf.frame_counts(d, 30)), round(sum(d) * 30))
        shots = rf.build_shots([{"image": str(i), "duration": x} for i, x in enumerate(d)], [])
        self.assertEqual(shots[-1]["f0"] + shots[-1]["n"], round(sum(d) * 30))


# ---------------------------------------------------------------- captions
class CaptionChunkTest(unittest.TestCase):
    def test_one_to_three_words_and_at_most_18_characters(self):
        w = words_of("you will hold them a little longer tonight because every single day matters extraordinarily")
        chunks = rf.chunk_words(w)
        for c in chunks:
            line = " ".join(x["text"] for x in c)
            self.assertTrue(1 <= len(c) <= 3)
            self.assertTrue(len(line) <= 18 or len(c) == 1, line)
        self.assertEqual([" ".join(x["text"] for x in c) for c in chunks][:3], ["YOU WILL HOLD", "THEM A LITTLE", "LONGER TONIGHT"])

    def test_punctuation_and_pauses_break_chunks(self):
        w = [{"word": "Stop,", "start": 0.0, "end": 0.3}, {"word": "breathe.", "start": 0.4, "end": 0.8},
             {"word": "Then", "start": 0.9, "end": 1.1}, {"word": "smile", "start": 2.2, "end": 2.6}]
        self.assertEqual([[x["text"] for x in c] for c in rf.chunk_words(w)], [["STOP"], ["BREATHE"], ["THEN"], ["SMILE"]])
        self.assertEqual(rf.caption_text("why?"), "WHY?")
        self.assertEqual(rf.caption_text("day..."), "DAY")

    def test_events_bridge_short_gaps_only(self):
        chunks = rf.chunk_words([{"word": "Hold", "start": 0.0, "end": 0.3}, {"word": "them,", "start": 0.3, "end": 0.6},
                                 {"word": "now", "start": 0.9, "end": 1.2}, {"word": "later", "start": 3.0, "end": 3.3}])
        ev = rf.caption_events(chunks)
        self.assertEqual([(round(a, 2), round(b, 2), c, j) for a, b, c, j in ev],
                         [(0.0, 0.3, 0, 0), (0.3, 0.9, 0, 1), (0.9, 1.2, 1, 0), (3.0, 3.3, 2, 0)])

    def test_pop_is_110_percent_settling_in_120_ms(self):
        self.assertAlmostEqual(rf.pop_scale(0.0), 1.10)
        self.assertEqual(rf.pop_scale(0.12), 1.0)
        self.assertEqual(rf.pop_scale(-0.01), 1.0)
        s = [rf.pop_scale(k / 1000.0) for k in range(0, 121, 10)]
        self.assertTrue(all(b <= a for a, b in zip(s, s[1:])))


def ink_box(img, thresh=40):
    """Bounding box of clearly visible pixels (alpha > thresh) in an RGBA image."""
    return img.getchannel("A").point(lambda v: 255 if v > thresh else 0).getbbox()


class CaptionDrawTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font, cls.weight = fonts.reel_caption_font(log=lambda m: None)

    def test_font_is_montserrat_extrabold(self):
        self.assertTrue(os.path.basename(self.font).startswith("Montserrat"))
        self.assertEqual(self.weight, 800)

    def test_captions_sit_in_the_safe_zone(self):
        for text in ("Hold them close", "EXTRAORDINARILY", "wow", "every single day", "mmmmmmmmmmmmmmmmmm"):
            cap = rf.Captions(words_of(text), self.font, self.weight)
            for ci in range(len(cap.chunks)):
                for scale in (1.0, 1.10):
                    strip = cap.draw(ci, 0, scale)
                    x0, y0, x1, y1 = ink_box(strip)
                    top = rf.CAPTION_STRIP[0]
                    with self.subTest(text=text, scale=scale):
                        self.assertGreaterEqual(x0, 65)
                        self.assertLessEqual(x1, 1015)
                        self.assertLessEqual(x1 - x0, rf.CAPTION_MAX_W + 12)        # popped too (+ the soft shadow)
                        self.assertLess(top + y1, rf.SAFE_BOTTOM)                    # never in the bottom 35%
                        self.assertGreater(top + y0, 1080)
        cap = rf.Captions(words_of("Hold them close"), self.font, self.weight)
        size, items = cap.layout(0)
        self.assertEqual(size, 68)
        a = cap.draw(0, 0, 1.0).getchannel("A")
        rows = [y for y in range(a.height) if a.crop((0, y, a.width, y + 1)).getextrema()[1] > 200]
        self.assertAlmostEqual(rf.CAPTION_STRIP[0] + rows[-1], 1180, delta=8)       # baseline ~ y 1180

    def test_long_chunk_shrinks_to_870(self):
        cap = rf.Captions(words_of("WWWWWWWWWWWWWWWWWW"), self.font, self.weight)
        size, items = cap.layout(0)
        self.assertLess(size, 68)
        self.assertLessEqual(items[-1][1] + items[-1][2] - items[0][1] + 2 * rf.OUTLINE, rf.CAPTION_MAX_W + 2)

    def test_spoken_word_is_yellow_and_pops(self):
        cap = rf.Captions(words_of("Hold them close"), self.font, self.weight)
        strip = cap.draw(0, 1, 1.0).convert("RGB")
        _size, items = cap.layout(0)
        def yellow_in(x0, x1):
            raw = strip.crop((int(x0), 0, int(x1), strip.height)).tobytes()
            px = zip(raw[0::3], raw[1::3], raw[2::3])
            return sum(1 for r, g, b in px if r > 230 and 190 < g < 235 and b < 60)
        self.assertGreater(yellow_in(items[1][1], items[1][1] + items[1][2]), 200)   # THEM
        self.assertEqual(yellow_in(items[0][1], items[0][1] + items[0][2]), 0)        # HOLD stays white
        big, small = ink_box(cap.draw(0, 1, 1.10)), ink_box(cap.draw(0, 1, 1.0))
        self.assertLess(big[1], small[1])                                             # the popped word is taller
        _s, popped = cap.layout(0, 1, 1.10)
        for (_t, x0, w0), (_t2, x1, _w1) in zip(popped, popped[1:]):
            self.assertGreater(x1 - (x0 + w0), 10)                                    # ... and never touches its neighbours
        self.assertGreater(popped[1][2], items[1][2] * 1.05)
        self.assertIsNotNone(cap.at(0.31))
        self.assertIs(cap.at(0.31), cap.at(0.31))                                     # cached
        self.assertIsNone(cap.at(5.0))


class HookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font, cls.weight = fonts.reel_caption_font(log=lambda m: None)

    def test_card_fits_the_band(self):
        for text in ("Nobody tells you this part", "The last time you carry them, you won't know it",
                     "Why?", "  one  two   three  four five six seven eight nine ten eleven twelve thirteen "):
            card, (x, y) = rf.hook_card(text, self.font, self.weight)
            with self.subTest(text=text):
                box = ink_box(card, 200)                              # the white card itself
                self.assertGreaterEqual(y + box[1], 350)
                self.assertLessEqual(y + box[3], 650)
                self.assertLessEqual(box[2] - box[0], rf.HOOK_MAX_W)
                self.assertAlmostEqual(x + (box[0] + box[2]) / 2.0, 540, delta=2)
        size, lines, _w, _h = rf.hook_layout("Nobody tells you this part", lambda s: rf._font(self.font, 800, s))
        self.assertEqual(size, 92)
        self.assertLessEqual(len(lines), 3)
        self.assertIsNone(rf.hook_card("", self.font))
        self.assertIsNone(rf.hook_card(None, self.font))
        self.assertEqual(rf.hook_words('"Hold   them"'), ["Hold", "them"])

    def test_on_frame_0_pops_in_under_200_ms_and_goes_at_3_5_s(self):
        self.assertEqual(rf.hook_alpha(0.0), 1.0)                     # no fade-in: visible on frame 0
        self.assertAlmostEqual(rf.hook_scale(0.0), 0.86)
        self.assertGreater(rf.hook_scale(0.12), 1.0)
        self.assertEqual(rf.hook_scale(0.2), 1.0)
        self.assertEqual(rf.hook_scale(0.18), 1.0)
        self.assertEqual(rf.hook_alpha(3.5), 0.0)
        self.assertEqual(rf.hook_alpha(3.2), 1.0)
        self.assertTrue(0 < rf.hook_alpha(3.42) < 1)
        h = rf.Hook("Nobody tells you this part", self.font, self.weight)
        self.assertIsNotNone(h.at(0.0))
        self.assertIsNone(h.at(3.6))
        self.assertIsNone(rf.Hook(None).at(0.0))


# ---------------------------------------------------------------- frames
class FramesTest(unittest.TestCase):
    def test_frames_dissolve_punch_and_overlays(self):
        def solid(c):
            return Image.new("RGB", (2160, 3840), c)
        srcs = {"a": solid((200, 0, 0)), "b": solid((0, 0, 200))}
        items = [{"image": "a", "duration": 1.0}, {"image": "b", "duration": 1.0, "time_jump": True}]
        shots = rf.build_shots(items, [])
        cap = rf.Captions(words_of("hi there", start=0.0), None)
        out = list(rf.frames(shots, lambda s: srcs[s["image"]], cap, rf.Hook("Hello world"), threads=2))
        self.assertEqual(len(out), 60)
        self.assertTrue(all(len(b) == 1080 * 1920 * 3 for b in out))
        img = lambda b: Image.frombytes("RGB", (1080, 1920), b)  # noqa: E731
        self.assertEqual(img(out[10]).getpixel((5, 5)), (200, 0, 0))
        r, g, b = img(out[30]).getpixel((5, 5))                     # mid-dissolve: half and half
        self.assertTrue(80 < r < 120 and 80 < b < 120, (r, g, b))
        self.assertEqual(img(out[50]).getpixel((5, 5)), (0, 0, 200))
        self.assertTrue(all(v > 235 for v in img(out[0]).getpixel((540, 500))))   # the white hook card on frame 0

    def test_a_failing_picture_stops_cleanly(self):
        items = [{"image": "a", "duration": 1.0}, {"image": "b", "duration": 1.0}]
        shots = rf.build_shots(items, [])

        def opener(s):
            if s["image"] == "b":
                raise ValueError("broken")
            return Image.new("RGB", (2160, 3840))
        with self.assertRaises(ValueError):
            list(rf.frames(shots, opener, threads=2))


class SceneItemTest(unittest.TestCase):
    def test_reads_008_columns_defensively(self):
        before = rr.scene_item({"position": 2, "motion": "pan_left", "start_s": 1.0}, "img.jpg", 2.0)
        self.assertEqual((before["punch"], before["time_jump"], before["motion"]), (None, False, "pan_left"))
        after = rr.scene_item({"position": 2, "motion": "hold", "punch": "  never ", "time_jump": True}, "i", 2.0)
        self.assertEqual((after["punch"], after["time_jump"], after["motion"]), ("never", True, "hold"))
        self.assertIsNone(rr.scene_item({"punch": ""}, "i", 1)["punch"])


class FontFallbackTest(unittest.TestCase):
    def test_montserrat_then_poppins_bold(self):
        logs = []
        real = fonts.font_file

        def no_montserrat(fid, w):
            if fid == "montserrat":
                raise RuntimeError("offline")
            return real(fid, w)
        with mock.patch.object(fonts, "font_file", side_effect=no_montserrat):
            path, weight = fonts.reel_caption_font(log=logs.append)
        self.assertEqual((os.path.basename(path), weight), ("Poppins-Bold.ttf", 700))
        self.assertTrue(any("Montserrat" in m for m in logs))

    def test_a_worker_with_the_old_fonts_module_still_finds_montserrat(self):
        with mock.patch.object(rr, "fonts", mock.Mock(spec=["font_file"], font_file=fonts.font_file)):
            path, weight = rr.caption_font(log=lambda m: None)
        self.assertEqual((os.path.basename(path), weight), ("Montserrat[wght].ttf", 800))


# ---------------------------------------------------------------- audio
LOUDNORM_ERR = """[Parsed_loudnorm_0 @ 000001]
{
\t"input_i" : "-23.41",
\t"input_tp" : "-4.02",
\t"input_lra" : "6.10",
\t"input_thresh" : "-33.80",
\t"output_i" : "-14.20",
\t"output_tp" : "-1.50",
\t"output_lra" : "5.00",
\t"output_thresh" : "-24.50",
\t"normalization_type" : "dynamic",
\t"target_offset" : "0.20"
}
"""


class AudioPureTest(unittest.TestCase):
    def test_sfx_timeline(self):
        self.assertEqual(ra.sfx_events(False, [], 40.0), [("whoosh", 0.0)])
        self.assertEqual(ra.sfx_events(True, [3.0, 29.0, 33.5, 36.0], 40.0),
                         [("whoosh", 0.0), ("pop", 0.0), ("impact", 29.0)])   # first punch after 70% (28 s)
        self.assertEqual(ra.sfx_events(True, [3.0, 10.0], 40.0), [("whoosh", 0.0), ("pop", 0.0)])
        self.assertLessEqual(len(ra.sfx_events(True, [30, 31, 32], 40)), 5)

    def test_parse_loudnorm(self):
        m = ra.parse_loudnorm("noise\n" + LOUDNORM_ERR)
        self.assertEqual((m["input_i"], m["input_tp"], m["input_lra"], m["input_thresh"], m["target_offset"]),
                         (-23.41, -4.02, 6.10, -33.80, 0.20))
        silent = ra.parse_loudnorm(LOUDNORM_ERR.replace('"-23.41"', '"-inf"'))
        self.assertEqual(silent["input_i"], float("-inf"))
        with self.assertRaises(Exception):
            ra.parse_loudnorm("no json here")

    def test_levels(self):
        self.assertEqual(ra.voice_gain_db(-23.0), 7.0)                 # to -16 LUFS
        self.assertEqual(ra.voice_gain_db(float("-inf")), 0.0)
        self.assertEqual(ra.music_gain_db(-12.0, -16.0, 0.18), -22.0)  # bed at -34 = 18 LU under the voice
        self.assertEqual(ra.music_gain_db(-12.0, -16.0, 0.36), -15.98)  # the owner's volume: 36% = +6 dB
        self.assertEqual(ra.music_gain_db(float("-inf"), -16.0, 0.18), 0.0)
        self.assertEqual(ra.sfx_gain_db(-3.0, -1.0), -10.0)            # SFX peak 8 dB under the voice's peak
        self.assertEqual(ra.sfx_gain_db(float("-inf"), -1.0), -13.0)

    def test_master_and_measure_args(self):
        m = ra.parse_loudnorm(LOUDNORM_ERR)
        f = ra.master_filter(m)
        self.assertTrue(f.startswith("loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.41:measured_TP=-4.02:"
                                     "measured_LRA=6.10:measured_thresh=-33.80:offset=0.20:linear=true"))
        self.assertTrue(f.endswith(",aresample=48000,alimiter=limit=0.794:level=0:latency=1"))
        self.assertIsNone(ra.master_filter(dict(m, input_i=float("-inf"))))
        args = ra.measure_args("ff", "x.wav")
        self.assertIn("loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", args)

    def test_mix_graph(self):
        g = ra.mix_graph(20.0, True, -21.5, [(0.0, -9.0), (0.0, -11.0), (14.25, -8.0)])
        self.assertIn("[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.00dB,apad,"
                      "atrim=0:20.000", g)
        self.assertIn("stereo,volume=2.30dB,apad", ra.mix_graph(20.0, True, -21.5, [], 2.3))   # the voice trim
        self.assertIn("asplit=2[voice][key]", g)
        self.assertIn("volume=-21.50dB,afade=t=in:st=0:d=0.05,afade=t=out:st=18.000:d=2.0[bed]", g)
        self.assertIn("[bed][key]sidechaincompress=threshold=0.045:ratio=3:attack=50:release=400:makeup=1[ducked]", g)
        self.assertIn("[2:a]", g)
        self.assertIn("[4:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=-8.00dB,"
                      "adelay=14250:all=1", g)
        self.assertTrue(g.endswith("[voice][ducked][s0][s1][s2]amix=inputs=5:duration=first:normalize=0,atrim=0:20.000[mix]"))
        plain = ra.mix_graph(3.0, False, 0, [])
        self.assertEqual(plain, "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.00dB,"
                                "apad,atrim=0:3.000,asetpts=PTS-STARTPTS[mix]")
        self.assertIn("[1:a]", ra.mix_graph(3.0, False, 0, [(0.0, -9)]))   # without music the SFX start at input 1


def tone_wav(seconds, rate=24000, amp=9000, freq=220):
    import math
    import struct
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * freq * i / rate)))
                               for i in range(int(rate * seconds))))
    return buf.getvalue()


@unittest.skipIf(FFMPEG is None, "imageio-ffmpeg is not installed")
class AudioRealTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)

    def run_in(self, args, what):
        r = subprocess.run(args, cwd=self.d, capture_output=True)
        self.assertEqual(r.returncode, 0, (what, r.stderr.decode("utf-8", "replace")[-400:]))

    def test_sfx_are_made_and_audible(self):
        for name, (secs, _g) in ra.SFX.items():
            out = "%s.wav" % name
            self.run_in(ra.sfx_args(FFMPEG, name, out), name)
            with wave.open(os.path.join(self.d, out), "rb") as w:
                self.assertEqual((w.getnchannels(), w.getframerate()), (2, 48000))
                self.assertAlmostEqual(w.getnframes() / 48000.0, secs, delta=0.02)
            self.assertGreater(ra.wav_peak_db(os.path.join(self.d, out)), -20, name)

    def test_full_chain_lands_at_minus_14_lufs(self):
        with open(os.path.join(self.d, "voice.wav"), "wb") as fh:
            fh.write(tone_wav(6.0, amp=3000))
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=4:sample_rate=48000",
                        "-ac", "2", os.path.join(self.d, "music.flac")], check=True)   # shorter than the reel
        logs = []
        info = ra.make_audio(FFMPEG, self.d, "voice.wav", 8.0, [("whoosh", 0.0), ("pop", 0.0), ("impact", 5.0)],
                             self.run_in, music="music.flac", volume=0.18, log=logs.append)
        out = os.path.join(self.d, "audio.wav")
        with wave.open(out, "rb") as w:
            self.assertEqual((w.getnchannels(), w.getframerate()), (2, 48000))
            self.assertAlmostEqual(w.getnframes() / 48000.0, 8.0, delta=0.03)
        m = ra.measure(FFMPEG, out)
        self.assertAlmostEqual(m["input_i"], -14.0, delta=1.0)
        self.assertLessEqual(m["input_tp"], -1.0)
        self.assertAlmostEqual(info["voice_lufs"], ra.VOICE_LUFS, delta=0.3)
        self.assertEqual([s[0] for s in info["sfx"]], ["whoosh", "pop", "impact"])
        self.assertTrue(any("reel sound:" in l for l in logs))

    def test_silent_voice_does_not_break(self):
        with open(os.path.join(self.d, "voice.wav"), "wb") as fh:
            fh.write(tone_wav(2.0, amp=0))
        ra.make_audio(FFMPEG, self.d, "voice.wav", 2.0, [("whoosh", 0.0)], self.run_in, log=lambda m: None)
        with wave.open(os.path.join(self.d, "audio.wav"), "rb") as w:
            self.assertAlmostEqual(w.getnframes() / 48000.0, 2.0, delta=0.03)


if __name__ == "__main__":
    unittest.main()
