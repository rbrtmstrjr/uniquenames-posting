# 012 on the PC: the two guide styles. Red Thread keeps only strong reds (the thread) and turns the rest grey; both
# styles' previews use the prompt saved on the theme row (the guide's example scene), verbatim.
import io
import unittest

from PIL import Image, ImageDraw

import reels
import themes
from test_reels import FakeRenderer, make_reel, make_scene
from test_themes_motion import ThemeSupa, is_gray

GREY_BG = (205, 203, 200)


def is_grey_px(p, tol=3):
    r, g, b = p[:3]
    return abs(r - g) <= tol and abs(g - b) <= tol and abs(r - b) <= tol


def is_red_px(p):
    r, g, b = p[:3]
    return r > 120 and r > 2 * g and r > 2 * b


class RedOnlyTest(unittest.TestCase):
    def swatch(self, rgb):
        return themes.to_red_only(Image.new("RGB", (8, 8), rgb)).getpixel((4, 4))

    def test_strong_reds_stay_red(self):
        for rgb in [(220, 30, 30), (200, 20, 40), (235, 45, 25), (150, 20, 25), (190, 15, 70)]:
            with self.subTest(rgb=rgb):
                self.assertEqual(self.swatch(rgb), rgb)

    def test_everything_else_turns_grey(self):
        for rgb in [(230, 140, 40),    # orange
                    (210, 160, 130),   # skin
                    (196, 150, 120),   # tan skin
                    (240, 200, 210),   # pale pink (low saturation)
                    (40, 90, 200),     # blue
                    (40, 160, 70),     # green
                    (220, 200, 40),    # yellow / mustard
                    (25, 5, 5),        # near-black red: reads as black ink
                    GREY_BG]:
            with self.subTest(rgb=rgb):
                self.assertTrue(is_grey_px(self.swatch(rgb)), self.swatch(rgb))

    def test_a_red_thread_on_a_grey_picture(self):
        img = Image.new("RGB", (200, 120), GREY_BG)
        d = ImageDraw.Draw(img)
        d.rectangle((10, 10, 60, 60), fill=(40, 160, 70))          # a stray green object
        d.rectangle((120, 10, 170, 60), fill=(210, 160, 130))      # skin
        d.line((0, 90, 199, 95), fill=(215, 30, 35), width=4)      # the thread
        out = themes.to_red_only(img)
        self.assertEqual(out.size, img.size)
        self.assertEqual(out.mode, "RGB")
        self.assertTrue(is_red_px(out.getpixel((100, 92))))         # the thread keeps its colour
        self.assertTrue(is_grey_px(out.getpixel((35, 35))))         # the green turned grey
        self.assertTrue(is_grey_px(out.getpixel((145, 35))))        # the skin turned grey
        self.assertTrue(is_grey_px(out.getpixel((100, 40))))        # the background stays grey
        # the thread's soft edge is never left with a coloured halo of a different hue
        for y in range(84, 102):
            p = out.getpixel((100, y))
            self.assertTrue(is_grey_px(p, 6) or p[0] >= max(p[1], p[2]), (y, p))

    def test_rgba_and_l_inputs(self):
        self.assertEqual(themes.to_red_only(Image.new("RGBA", (4, 4), (220, 30, 30, 255))).mode, "RGB")
        self.assertEqual(themes.to_red_only(Image.new("L", (4, 4), 128)).getpixel((1, 1)), (128, 128, 128))


class PreviewPromptTest(unittest.TestCase):
    def test_a_saved_preview_prompt_is_used_verbatim(self):
        p = "The red thread is the only color in the image. A clean black and white ink line illustration.\n\nScene."
        self.assertEqual(themes.preview_prompt({"id": "redthread", "style": "x", "preview_prompt": p}), p)
        self.assertEqual(themes.preview_prompt({"id": "crayon", "style": "x", "preview_prompt": "  Crayon prompt.  "}), "Crayon prompt.")

    def test_old_themes_keep_the_fixed_moment(self):
        for row in ({"id": "clay", "style": "Clay."}, {"id": "clay", "style": "Clay.", "preview_prompt": None},
                    {"id": "clay", "style": "Clay.", "preview_prompt": "   "}):
            self.assertIn("Moment: " + themes.MOMENT, themes.preview_prompt(row))

    def test_colour_mode(self):
        self.assertEqual(themes.colour_mode({"keep_red": True, "grayscale": False}), "red")
        self.assertEqual(themes.colour_mode({"keep_red": True, "grayscale": True}), "red")
        self.assertEqual(themes.colour_mode({"grayscale": True}), "gray")
        self.assertIsNone(themes.colour_mode({"grayscale": False}))
        self.assertIsNone(themes.colour_mode({}))
        self.assertIsNone(themes.colour_mode(None))


class RedRenderer(FakeRenderer):
    """A colourful picture with a red thread across it."""
    def generate_photo(self, prompt, seed, width, height):
        self.calls.append((prompt, seed, width, height))
        img = Image.new("RGB", (width, height), (40, 160, 70))
        ImageDraw.Draw(img).rectangle((0, 1200, width, 1300), fill=(220, 30, 30))
        return img


def px(jpeg_bytes, xy):
    return Image.open(io.BytesIO(jpeg_bytes)).convert("RGB").getpixel(xy)


class RedThreadJobsTest(unittest.TestCase):
    def setUp(self):
        self.supa = ThemeSupa()
        self.supa.themes = [{"id": "redthread", "grayscale": False, "keep_red": True}, {"id": "crayon", "grayscale": False, "keep_red": False},
                            {"id": "sketch", "grayscale": True}]
        self.r = RedRenderer()
        self.rr = reels.ReelRunner(self.supa, self.r, log=lambda m: None, sleep=lambda s: None)

    def image(self, theme_id):
        self.supa.settings = [{"id": 1, "reel_theme_id": "crayon"}]
        reel = make_reel(theme_id=theme_id)
        self.rr.run_step({"step": "image", "reel": reel, "scene": make_scene(1)})
        return self.supa.uploads["%s/scenes/01-v2.jpg" % reel["id"]][1]

    def test_red_thread_pictures_keep_only_the_thread(self):
        data = self.image("redthread")
        self.assertTrue(is_gray(data))                     # the green background (centre) turned grey
        self.assertTrue(is_red_px(px(data, (540, 1250))))   # the thread stayed red
        # the theme row is read with select=* (keep_red is missing on a database before 012)
        self.assertTrue(any(t == "reel_themes" and "select=*" in q for t, q in self.supa.selects))

    def test_crayon_stays_in_colour_and_sketch_stays_grey(self):
        self.assertFalse(is_gray(self.image("crayon")))
        sketch = self.image("sketch")
        self.assertTrue(is_gray(sketch))
        self.assertTrue(is_grey_px(px(sketch, (540, 1250)), 4))   # sketch: even the red turns grey

    def test_red_thread_preview(self):
        prompt = "The red thread is the only color in the image. Guide prompt."
        self.rr.run_theme_preview({"theme": {"id": "redthread", "style": "x", "keep_red": True, "grayscale": False, "version": 1,
                                             "preview_prompt": prompt, "preview_status": "making"}})
        self.assertEqual(self.r.calls[0][0], prompt)
        self.assertEqual(self.r.calls[0][1:], (themes.PREVIEW_SEED, 1088, 1920))
        data = self.supa.uploads["themes/redthread/preview-v1.jpg"][1]
        self.assertTrue(is_gray(data))
        self.assertTrue(is_red_px(px(data, (540, 1250))))


if __name__ == "__main__":
    unittest.main()
