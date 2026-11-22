# The front card (migration 023, worker 2.10.0): the post's title stamped big at its stored place (top or bottom), a
# smaller second line under it, the handle as on every card.
#   python -m unittest test_cover -v
import unittest

from PIL import Image

import render as w

W = H = 1080
QUIET = lambda m: None  # noqa: E731


def photo(rgb=(70, 110, 170)):
    return Image.new("RGB", (W, H), rgb)


def brightest(img, box):
    return img.crop(box).convert("L").getextrema()[1]


def as_stamped(text):
    return text.upper() if w.fonts.caps(w.text_style({}).title_font) else text


class CoverLayoutTest(unittest.TestCase):
    def lay(self, title="'S' Names", second="for baby boy", place="top", style=None):
        return w.layout_cover((W, H), title, second, "@unique_names", style or w.text_style({}), place, log=QUIET)

    def test_top_and_bottom(self):
        top, bottom = self.lay(place="top"), self.lay(place="bottom")
        self.assertAlmostEqual(top["block"][1], H * w.LAYOUT["padTop"], delta=1)
        self.assertGreater(bottom["block"][1], H / 2)
        self.assertLess(bottom["block"][3], bottom["mark"]["box"][1])
        self.assertEqual((top["band"], bottom["band"]), ("top", "bottom"))
        self.assertEqual((w.cover_place("middle"), w.cover_place(None), w.cover_place("bottom")), ("top", "top", "bottom"))

    def test_the_title_is_bigger_than_a_name_and_the_second_line_sits_under_it(self):
        lay = self.lay()
        name = w.layout_text((W, H), "Sabina", "from sabine", "@unique_names", w.text_style({}), log=QUIET)
        self.assertGreater(lay["title"][0]["font"].size, name["title"][0]["font"].size)
        self.assertEqual([p["text"] for p in lay["title"]], [as_stamped("'S' Names")])
        self.assertEqual([p["text"] for p in lay["second"]], ["for baby boy"])
        self.assertGreater(lay["second"][0]["box"][1], lay["title"][-1]["box"][3])
        self.assertLess(lay["second"][0]["font"].size, lay["title"][0]["font"].size)

    def test_no_second_line(self):
        lay = self.lay(title="Baby Boy Names", second="")
        self.assertEqual(lay["second"], [])
        self.assertEqual(" ".join(p["text"] for p in lay["title"]), as_stamped("Baby Boy Names"))

    def test_long_titles_fit(self):
        long = "Heavenly stars and the softest morning sky over the quiet sea Names"
        margin = W * (1 - w.COVER_MAX_WIDTH) / 2
        for place in ("top", "bottom"):
            lay = self.lay(title=long, second="part 1 · for baby girl", place=place)
            self.assertLessEqual(len(lay["title"]), w.COVER_MAX_LINES)
            self.assertEqual(" ".join(p["text"] for p in lay["title"]), as_stamped(long))
            for p in lay["title"] + lay["second"]:
                self.assertGreaterEqual(p["box"][0], margin - 2)
                self.assertLessEqual(p["box"][2], W - margin + 2)
            self.assertGreaterEqual(lay["block"][1], H * w.LAYOUT["padTop"] - 1)
            self.assertLess(lay["block"][3], lay["mark"]["box"][1])


class ComposeCoverTest(unittest.TestCase):
    def test_a_top_title_is_drawn_at_the_top(self):
        out = w.compose_cover(photo(), "'S' Names", "for baby boy", "@unique_names", place="top", log=QUIET)
        self.assertGreater(brightest(out, (100, 100, 980, 400)), 240)
        self.assertLess(brightest(out, (100, 650, 800, 1000)), 200)

    def test_a_bottom_title_is_drawn_at_the_bottom(self):
        out = w.compose_cover(photo(), "'S' Names", "for baby boy", "@unique_names", place="bottom", log=QUIET)
        self.assertLess(brightest(out, (100, 100, 980, 400)), 200)
        self.assertGreater(brightest(out, (100, 650, 800, 1000)), 240)

    def test_name_nest_layout_stamps_too(self):
        out = w.compose_cover(photo(), "Baby Girl Names", "", "@namenest", place="top", log=QUIET, layout=w.NEST_LAYOUT)
        self.assertEqual(out.size, (W, H))

    def test_the_renderer_method(self):
        r = w.ComfyRenderer("http://127.0.0.1:1", 5, log=QUIET)
        out = r.compose_cover(photo(), "'S' Names", "for baby boy", "@unique_names", w.text_style({}), place="bottom")
        self.assertGreater(brightest(out, (100, 650, 800, 1000)), 240)


if __name__ == "__main__":
    unittest.main()
