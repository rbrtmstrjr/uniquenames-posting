# Card layouts (migration 015, worker 2.7.1): 'classic' = the Unique Names stamp, byte for byte as before;
# 'name-nest' = Name Nest's brand stamp (berry red + cream, a "#38 in the US · Greek" chip, a red watermark pill).
#   python -m unittest test_card_layout -v
import hashlib
import unittest

from PIL import Image, ImageDraw

import render as w


def photo(bg, stripes):
    img = Image.new("RGB", (1080, 1080), bg)
    d = ImageDraw.Draw(img)
    for x in range(0, 1080, 24):
        d.line([(x, 700), (x + 200, 1080)], fill=stripes, width=7)
    return img


def digest(img):
    return hashlib.sha256(img.tobytes()).hexdigest()[:24]


DARK = ((90, 60, 40), (240, 230, 200))
LIGHT = ((240, 232, 220), (120, 90, 60))
STYLED = w.text_style({"title_font": "playfair", "meaning_font": "quicksand", "mark_font": "montserrat", "title_size": 120,
                       "meaning_size": 44, "mark_size": 24, "text_position": "bottom-right"})


class ClassicGoldenTest(unittest.TestCase):
    """The Unique Names stamp, captured before Name Nest's layout was added (2026-10-10). Never update these to make a
    change pass: a diff here means the live Unique Names cards would change."""

    GOLDEN = {
        "auto-dark": "06bc66d580cceaa892d73c61",
        "auto-light": "17a19fa0cc320f4d42eb8ee8",
        "styled": "56752930c6e320c1d194102e",
        "cta": "d66acc1895f87d4732cb9f31",
    }

    def cases(self):
        return {
            "auto-dark": lambda: w.compose_card(photo(*DARK), "Arlo Zenith", "peak strength with calm", "@unique_names")[0],
            "auto-light": lambda: w.compose_card(photo(*LIGHT), "Isla Marigold", "island of golden flowers", "@unique_names")[0],
            "styled": lambda: w.compose_card(photo((60, 80, 110), (200, 210, 230)), "Wren", "small bird", "@unique_names", STYLED)[0],
            "cta": lambda: w.compose_cta(photo(*LIGHT), "Found a favorite? / Follow for more like it.", "@unique_names"),
        }

    def test_classic_stamp_is_unchanged(self):
        for k, make in self.cases().items():
            self.assertEqual((k, digest(make())), (k, self.GOLDEN[k]))


if __name__ == "__main__":
    unittest.main()
