# Offline tests for the card worker: no ComfyUI, no network (fonts must exist;
# run worker.py once or `python -c "import worker; worker.ensure_fonts()"`).
#   python -m unittest test_worker -v
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from PIL import Image, ImageDraw

import render as w

FONTS = w.ensure_fonts()


def body(**kw):
    b = {"date": "2026-10-05", "index": 1, "name": "Arlo Zenith", "meaning": "peak strength with calm",
         "prompt": "baby photoshoot", "seed": 7}
    b.update(kw)
    return b


def busy_image(busy_band):
    """Flat brown image with heavy stripes in one band, so the other bands are calm."""
    img = Image.new("RGB", (1080, 1080), (90, 60, 40))
    d = ImageDraw.Draw(img)
    a, b = w.BANDS[busy_band]
    for x in range(0, 1080, 12):
        d.line([(x, int(1080 * a)), (x, int(1080 * b))], fill=(240, 230, 200), width=5)
    return img


class Validate(unittest.TestCase):
    def test_good(self):
        c = w.validate_card(body())
        self.assertEqual((c["name"], c["index"], c["width"], c["height"], c["seed"]), ("Arlo Zenith", 1, 1080, 1080, 7))

    def test_collapses_whitespace(self):
        self.assertEqual(w.validate_card(body(name="  Arlo   Zenith "))["name"], "Arlo Zenith")

    def test_accepts_accents_hyphen_apostrophe(self):
        for n in ("Zoë", "Anne-Marie", "D'Angelo", "Renée Skye"):
            self.assertEqual(w.validate_card(body(name=n))["name"], n)

    def test_rejects_bad(self):
        bad = [dict(date="2026-13-01"), dict(date="05-10-2026"), dict(index=0), dict(index=31), dict(index="x"),
               dict(name=""), dict(name="Arlo2"), dict(name="<b>Arlo</b>"), dict(name="A" * 41),
               dict(meaning=""), dict(meaning="m" * 81), dict(prompt=""), dict(width=100), dict(height=5000)]
        for kw in bad:
            with self.assertRaises(w.CardError, msg=kw) as cm:
                w.validate_card(body(**kw))
            self.assertEqual(cm.exception.status, 400)

    def test_random_seed_when_missing(self):
        b = body(); del b["seed"]
        self.assertGreater(w.validate_card(b)["seed"], 0)


class Names(unittest.TestCase):
    def test_filename(self):
        self.assertEqual(w.card_filename(3, "Arlo Zenith"), "03-arlo-zenith.jpg")
        self.assertEqual(w.card_filename(12, "D'Angelo"), "12-d-angelo.jpg")
        self.assertEqual(w.card_filename(1, "Zoë"), "01-zo.jpg")


class Graph(unittest.TestCase):
    def test_graph_shape(self):
        g = w.comfy_graph("p", 5, 1080, 1080, "x")
        self.assertEqual(g["7"]["inputs"]["width"], 1072)   # multiple of 16
        self.assertEqual(g["8"]["inputs"]["seed"], 5)
        self.assertEqual(g["2"]["inputs"]["type"], "lumina2")
        self.assertEqual(g["5"]["inputs"]["text"], "p")


class Layout(unittest.TestCase):
    def test_picks_calm_band(self):
        self.assertNotEqual(w.pick_band(busy_image("top"))[0], "top")
        self.assertEqual(w.pick_band(busy_image("middle"))[0], "top")
        self.assertEqual(w.pick_band(busy_image("bottom"))[0], "top")

    def test_top_wins_on_flat(self):
        self.assertEqual(w.pick_band(Image.new("RGB", (1080, 1080), (90, 60, 40)))[0], "top")

    def test_long_name_fits(self):
        f = w.fit_font(FONTS["semibold"], "MAXIMILIANA SERAPHINE", int(1080 * 0.088), int(1080 * 0.84))
        self.assertLessEqual(w._text_w(f, "MAXIMILIANA SERAPHINE"), int(1080 * 0.84))

    def test_compose_keeps_size_and_draws(self):
        img = Image.new("RGB", (1080, 1080), (90, 60, 40))
        out, band, _ = w.compose_card(img, "Arlo Zenith", "peak strength with calm", "@unique_names", FONTS)
        self.assertEqual(out.size, (1080, 1080))
        self.assertEqual(band, "top")
        a, b = w.BANDS["top"]
        top_band = out.crop((0, int(1080 * a), 1080, int(1080 * b)))
        self.assertGreater(top_band.getextrema()[0][1], 240)  # white text landed in the top band
        mid = out.crop((0, int(1080 * 0.40), 1080, int(1080 * 0.60)))
        self.assertLess(mid.getextrema()[0][1], 100)          # nothing drawn mid-frame

    def test_text_turns_dark_on_bright_backdrops(self):
        light = Image.new("RGB", (1080, 1080), (214, 238, 230))  # pale mint
        out, band, _ = w.compose_card(light, "Arlo Zenith", "peak strength with calm", "@unique_names", FONTS)
        a, b = w.BANDS[band]
        lo = out.convert("L").crop((0, int(1080 * a), 1080, int(1080 * b))).getextrema()[0]
        self.assertLess(lo, 80)  # dark ink was drawn
        self.assertEqual(w.text_colors(light, (0, 0, 1080, 1080))[0], w.DARK_INK)
        dark = Image.new("RGB", (1080, 1080), (90, 60, 40))
        self.assertEqual(w.text_colors(dark, (0, 0, 1080, 1080))[0], (255, 255, 255))

    def test_fit_to_size(self):
        self.assertEqual(w.fit_to_size(Image.new("RGB", (1072, 1072)), 1080, 1080).size, (1080, 1080))
        self.assertEqual(w.fit_to_size(Image.new("RGB", (1080, 1344)), 1080, 1080).size, (1080, 1080))


if __name__ == "__main__":
    unittest.main()
