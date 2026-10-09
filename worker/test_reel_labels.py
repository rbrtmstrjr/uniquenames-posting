# On-screen step labels (reel storylines plan, Task 4): a scene's `on_screen` text drawn in the hook card's top band
# while that line is spoken, never over the first 3.5 s hook card, never in the bottom 35 %, off with
# settings.reel_labels = false; a database before 014 (no on_screen / reel_labels) renders exactly as before.
import os
import shutil
import tempfile
import unittest
from unittest import mock

from PIL import Image, ImageDraw

import fonts
import reel_frames as rf
import reel_render as rr
import reels

from test_reel_render import FFMPEG, FakeSupa, RID, WORDS, jpeg, wav

SAFE_BOTTOM = int(rf.HEIGHT * 0.65)          # 1248: nothing of the label below this


def ink_box(img, thresh=40):
    return img.getchannel("A").point(lambda v: 255 if v > thresh else 0).getbbox()


class LabelCardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font, cls.weight = fonts.reel_caption_font(log=lambda m: None)

    def card(self, text, band=rf.HOOK_BANDS[0]):
        img = rf.label_card(text, self.font, band, self.weight)
        self.assertIsNotNone(img)
        return img, rf.label_xy(img, band)

    def test_sits_in_the_top_band_and_never_in_the_bottom_35_percent(self):
        for band in rf.HOOK_BANDS:
            for text in ("1/3 · “You're mad. Tower fell down.”", "Instead: “Walking feet, please.”", "Name it"):
                img, (x, y) = self.card(text, band)
                box = ink_box(img)
                top, bottom = y + box[1], y + box[3]
                self.assertGreaterEqual(top, band[0] - 2, text)          # the white card starts at the band's top
                self.assertLessEqual(bottom, band[1] + 20, text)         # (+ its soft shadow)
                self.assertLess(bottom, SAFE_BOTTOM, text)
                self.assertGreaterEqual(x + box[0], (rf.WIDTH - rf.LABEL_MAX_W) // 2 - 16)
                self.assertLessEqual(x + box[2], (rf.WIDTH + rf.LABEL_MAX_W) // 2 + 16)

    def test_size_60_to_72_and_long_text_wraps_to_two_lines_within_870(self):
        f = lambda s: rf._font(self.font, self.weight, s)  # noqa: E731
        size, lines, w, h = rf.label_layout("Name it", f)
        self.assertEqual((size, len(lines)), (rf.LABEL_SIZE, 1))
        self.assertTrue(60 <= rf.LABEL_SIZE <= 72)
        size, lines, w, h = rf.label_layout("1/3 · “You're mad. Tower fell down.”", f)
        self.assertGreaterEqual(size, 60)
        self.assertLessEqual(len(lines), 2)
        long = "Instead of shouting “stop running” try “walking feet please” and point at the floor slowly"
        size, lines, w, h = rf.label_layout(long, f)
        self.assertLessEqual(len(lines), 2)
        self.assertLessEqual(w, rf.LABEL_MAX_W)
        self.assertLessEqual(rf.LABEL_MAX_W, 870)
        font = f(size)
        self.assertTrue(all(font.getlength(l) <= rf.LABEL_MAX_W - 2 * rf.LABEL_PAD[0] for l in lines))
        self.assertEqual(" ".join(lines).split(), long.split())            # every word kept, in order
        img, _ = self.card(long)
        self.assertLessEqual(img.width, rf.LABEL_MAX_W + 2 * rf.LABEL_SHADOW)
        absurd = "W" * 60 + " " + "word " * 40                              # beyond the 80-char contract: still 2 lines
        size, lines, w, h = rf.label_layout(absurd, f)
        self.assertLessEqual(len(lines), 2)
        self.assertLessEqual(w, rf.LABEL_MAX_W)

    def test_two_lines_are_balanced(self):
        f = lambda s: rf._font(self.font, self.weight, s)  # noqa: E731
        size, lines, w, h = rf.label_layout("Instead: “Walking feet, please, and slow hands.”", f)
        if len(lines) == 2:
            a, b = (f(size).getlength(l) for l in lines)
            self.assertLess(abs(a - b), max(a, b) * 0.6)                   # no lonely last word

    def test_empty_text_has_no_card(self):
        for t in (None, "", "   "):
            self.assertIsNone(rf.label_card(t, self.font, rf.HOOK_BANDS[0], self.weight))

    def test_curly_quotes_and_middle_dot_are_in_the_font(self):
        f = rf._font(self.font, self.weight, 72)

        def glyph(c):
            im = Image.new("L", (140, 140))
            ImageDraw.Draw(im).text((30, 20), c, font=f, fill=255)
            return im.tobytes()
        missing = glyph("")                                          # a private-use char: the font's notdef box
        for c in "“”‘’·":
            self.assertNotEqual(glyph(c), missing, repr(c))
            self.assertIsNotNone(Image.frombytes("L", (140, 140), glyph(c)).getbbox(), repr(c))


class LabelTimingTest(unittest.TestCase):
    def test_spans_start_after_the_hook_card_and_cut_at_the_end(self):
        items = [{"text": "early", "start": 1.0, "end": 3.0},           # wholly under the hook card: dropped
                 {"text": "straddles", "start": 2.0, "end": 6.0},       # starts at 3.5 instead
                 {"text": "later", "start": 6.0, "end": 9.0},
                 {"text": "", "start": 9.0, "end": 12.0},               # empty: none
                 {"text": "blip", "start": 12.0, "end": 12.1}]          # too short to read: none
        self.assertEqual(rf.label_spans(items), [(rf.HOOK_END_S, 6.0, "straddles"), (6.0, 9.0, "later")])

    def test_at_shows_a_label_only_inside_its_span_with_a_short_pop(self):
        labels = rf.Labels([{"text": "Step one", "start": 2.0, "end": 6.0}])
        for t in (0.0, 2.0, 3.0, 3.49, 6.0, 7.0):
            self.assertIsNone(labels.at(t), t)
        first = labels.at(3.5)
        self.assertIsNotNone(first)
        settled = labels.at(3.5 + 0.2)                                     # pop done within 200 ms
        self.assertEqual(settled[0].size, labels.cards[0].size)
        self.assertLess(first[0].width, settled[0].width)
        self.assertEqual(labels.at(5.99)[0].size, settled[0].size)       # full strength to the cut (no fade)
        self.assertEqual(labels.at(5.99)[0].getchannel("A").getextrema()[1],
                         settled[0].getchannel("A").getextrema()[1])

    def test_no_labels(self):
        self.assertIsNone(rf.Labels([]).at(5.0))


class RenderLabelsTest(unittest.TestCase):
    scenes = [
        {"position": 1, "start_s": 0.0, "end_s": 3.0, "narration": "a", "on_screen": "never on line one"},
        {"position": 2, "start_s": 3.2, "end_s": 7.5, "narration": "b", "on_screen": "  1/3 · “Name it.”  "},
        {"position": 3, "start_s": 8.0, "end_s": 11.0, "narration": "c", "on_screen": None},
        {"position": 4, "start_s": 11.0, "end_s": 14.0, "narration": "d", "on_screen": "Instead: “Walking feet.”"},
    ]

    def test_items_follow_the_lines_and_cut_on_the_next_line(self):
        items = rr.reel_labels({"reel_labels": True}, self.scenes, 15.0)
        self.assertEqual([(i["text"], i["start"], i["end"]) for i in items], [
            ("never on line one", 0.0, 3.2), ("1/3 · “Name it.”", 3.2, 8.0), ("Instead: “Walking feet.”", 11.0, 14.0)])
        spans = rf.label_spans(items)
        self.assertEqual([s[2] for s in spans], ["1/3 · “Name it.”", "Instead: “Walking feet.”"])
        self.assertEqual(spans[0][0], rf.HOOK_END_S)

    def test_setting_off_or_before_014_means_no_labels(self):
        self.assertEqual(rr.reel_labels({"reel_labels": False}, self.scenes, 15.0), [])
        self.assertEqual(len(rr.reel_labels({}, self.scenes, 15.0)), 3)         # setting missing: on
        self.assertEqual(len(rr.reel_labels(None, self.scenes, 15.0)), 3)
        old = [{k: v for k, v in s.items() if k != "on_screen"} for s in self.scenes]
        self.assertEqual(rr.reel_labels({"reel_labels": True}, old, 15.0), [])  # no on_screen column: none

    def test_lines_without_times_are_placed_by_word_count(self):
        scenes = [{"position": 1, "narration": "one two", "on_screen": None},
                  {"position": 2, "narration": "three four", "on_screen": "Step"}]
        self.assertEqual(rr.reel_labels({}, scenes, 10.0), [{"text": "Step", "start": 5.0, "end": 10.0}])


class FramesWithLabelsTest(unittest.TestCase):
    def test_label_drawn_only_in_its_span_and_never_with_the_hook_card(self):
        src = Image.new("RGB", (2160, 3840), (20, 20, 20))
        shots = rf.build_shots([{"image": "a", "duration": 6.0}], [])
        hook = rf.Hook("Hello world")
        labels = rf.Labels([{"text": "Step one", "start": 1.0, "end": 5.0}], band=hook.band)
        out = list(rf.frames(shots, lambda s: src, None, hook, labels=labels, threads=2))
        img = lambda f: Image.frombytes("RGB", (1080, 1920), out[f])  # noqa: E731
        y = hook.band[0] + 30
        white = lambda f: all(v > 235 for v in img(f).getpixel((540, y)))  # noqa: E731
        self.assertTrue(white(0))                                    # the hook card
        self.assertFalse(white(102))                                 # 3.4 s: the hook card fading out, no label on it yet
        self.assertTrue(white(int(4.0 * 30)))                        # the label
        self.assertFalse(white(int(5.2 * 30)))                       # cut at its end
        for f in (int(4.0 * 30),):                                   # nothing drawn in the bottom 35 %
            self.assertEqual(img(f).crop((0, SAFE_BOTTOM, 1080, 1920)).getextrema(), ((20, 20),) * 3)


@unittest.skipIf(FFMPEG is None, "imageio-ffmpeg is not installed")
class RenderWithLabelsTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.store = {RID + "/voice-v4.wav": wav(5.0), RID + "/scenes/01-v1.jpg": jpeg((200, 60, 40)),
                      RID + "/scenes/02-v1.jpg": jpeg((40, 90, 200))}
        self.supa = FakeSupa(self.store)
        self.logs = []
        self.runner = reels.ReelRunner(self.supa, None, log=self.logs.append, sleep=lambda s: None, output_root=self.root)
        self.reel = {"id": RID, "title": "Labels", "version": 4, "status": "rendering",
                     "voice_path": RID + "/voice-v4.wav", "words": WORDS, "preview_path": None}
        self.scenes = [
            {"id": "s1", "position": 1, "status": "done", "photo_path": RID + "/scenes/01-v1.jpg", "start_s": 0.0,
             "narration": "a"},
            {"id": "s2", "position": 2, "status": "done", "photo_path": RID + "/scenes/02-v1.jpg", "start_s": 3.0,
             "end_s": 5.0, "narration": "b", "on_screen": "Step one"},
        ]

    def render(self):
        with mock.patch.object(rr.fonts, "reel_caption_font", return_value=(None, 800)):
            rr.render_reel(self.runner, self.reel, self.scenes)

    def test_render_logs_the_labels_and_the_switch_turns_them_off(self):
        self.render()
        self.assertTrue(any("1 label" in m for m in self.logs), self.logs)
        self.logs.clear()
        self.supa.select = lambda table, q: [{"id": 1, "reel_labels": False}]
        self.render()
        self.assertFalse(any("label" in m for m in self.logs), self.logs)
        self.assertEqual([u for u in self.supa.updates if "status" in u[2]][-1][2]["status"], "ready")


if __name__ == "__main__":
    unittest.main()
