# Card layouts (migration 015, worker 2.7.1): 'classic' = the Unique Names stamp, byte for byte as before;
# 'name-nest' = Name Nest's brand stamp (berry red + cream, a "#38 in the US · Greek" chip, a red watermark pill).
#   python -m unittest test_card_layout -v
import hashlib
import os
import shutil
import tempfile
import unittest
from unittest import mock

from PIL import Image, ImageDraw

import jobs
import render as w
from supa import SupaError
from test_jobs import FakeRenderer, FakeSupa, job


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


def near(img, rgb, box=None, tol=18):
    """How many pixels of img (in box) are within tol of the colour rgb."""
    data = (img.crop(box) if box else img).convert("RGB").tobytes()
    return sum(1 for i in range(0, len(data), 3) if all(abs(data[i + j] - rgb[j]) <= tol for j in range(3)))


NEST = "name-nest"
DOT = "·"


class DetailLineTest(unittest.TestCase):
    def test_rank_and_origin(self):
        self.assertEqual(w.detail_line(38, "Greek"), "#38 in the US %s Greek" % DOT)
        self.assertEqual(w.detail_line(1, None), "#1 in the US")
        self.assertEqual(w.detail_line(None, "  Old   English "), "Old English")
        self.assertIsNone(w.detail_line(None, None))
        self.assertIsNone(w.detail_line(0, ""))
        self.assertIsNone(w.detail_line(True, "  "))
        self.assertEqual(w.detail_line("12", "Hebrew"), "#12 in the US %s Hebrew" % DOT)

    def test_layout_setting(self):
        self.assertEqual(w.card_layout({"card_layout": NEST}), NEST)
        for v in ({}, None, {"card_layout": None}, {"card_layout": "fancy"}, {"card_layout": "classic"}):
            self.assertEqual(w.card_layout(v), "classic")


class NestStampTest(unittest.TestCase):
    def test_chip_sits_under_the_meaning_inside_the_card(self):
        detail = "#3 in the US %s Latin" % DOT
        lay = w.layout_text((1080, 1080), "Olivia", "olive tree", "@namenest", w.text_style({}), "top", detail=detail, pill=True)
        chip = lay["chip"]
        self.assertEqual(chip["text"], detail)
        self.assertGreater(chip["box"][1], lay["meaning"][-1]["box"][3])
        self.assertLess(chip["box"][3], lay["mark"]["pill"][1])
        self.assertLessEqual(lay["block"][3], chip["box"][3])
        self.assertTrue(0 <= chip["box"][0] and chip["box"][2] <= 1080)
        self.assertAlmostEqual((chip["box"][0] + chip["box"][2]) / 2, 540, delta=3)   # centred like the name

    def test_without_a_detail_there_is_no_chip(self):
        lay = w.layout_text((1080, 1080), "Olivia", "olive tree", "@namenest", w.text_style({}), "top", pill=True)
        self.assertIsNone(lay["chip"])
        classic = w.layout_text((1080, 1080), "Olivia", "olive tree", "@namenest", w.text_style({}), "top")
        self.assertNotIn("pill", classic["mark"])
        self.assertNotIn("chip", classic)

    def test_every_position_keeps_the_chip_clear_of_the_watermark(self):
        for pos in w.LAYOUT["positions"]:
            lay = w.layout_text((1080, 1350), "Charlotte", "free woman of the land", "@namenest",
                                w.text_style({"text_position": pos}), "bottom", detail="#7 in the US %s French" % DOT, pill=True)
            c, m = lay["chip"]["box"], lay["mark"]["pill"]
            overlap = not (c[2] <= m[0] or m[2] <= c[0] or c[3] <= m[1] or m[3] <= c[1])
            self.assertFalse(overlap, pos)
            self.assertTrue(0 <= m[0] and m[2] <= 1080 and m[3] <= 1350, pos)

    def test_brand_colours_on_a_dark_photo(self):
        img, _band, _ = w.compose_card(photo(*DARK), "Olivia", "olive tree", "@namenest", layout=NEST, detail="#3 in the US")
        self.assertGreater(near(img, w.NEST_RED), 2000)                          # the chip + the watermark pill
        self.assertGreater(near(img, w.NEST_CREAM, (0, 0, 1080, 540)), 1500)     # cream name + meaning on the dark top
        classic, _b, _ = w.compose_card(photo(*DARK), "Olivia", "olive tree", "@namenest")
        self.assertLess(near(classic, w.NEST_RED), 50)

    def test_deep_red_name_on_a_light_photo(self):
        img, _band, _ = w.compose_card(photo(*LIGHT), "Amelia", "work of the lord", "@namenest", layout=NEST)
        self.assertGreater(near(img, w.NEST_DEEP, (0, 0, 1080, 540), tol=24), 1500)
        self.assertGreater(near(img, w.NEST_RED, (700, 950, 1080, 1080)), 500)   # the watermark pill, bottom right

    def test_closing_card_gets_the_pill_and_brand_ink(self):
        img = w.compose_cta(photo(*LIGHT), "New names every day. / Pull up a chair.", "@namenest", layout=NEST)
        self.assertGreater(near(img, w.NEST_RED, (700, 950, 1080, 1080)), 500)
        self.assertGreater(near(img, w.NEST_DEEP, (0, 150, 1080, 500), tol=24), 1000)

    def test_renderer_passes_the_layout(self):
        r = w.ComfyRenderer("http://127.0.0.1:1", 5, log=lambda m: None)
        a = r.compose(photo(*DARK), "Olivia", "olive tree", "@namenest", None, layout=NEST, detail="#3 in the US")
        b = r.compose(photo(*DARK), "Olivia", "olive tree", "@namenest", None)
        self.assertNotEqual(digest(a), digest(b))
        self.assertGreater(near(r.compose_cta(photo(*DARK), "Hi / there", "@namenest", None, layout=NEST), w.NEST_RED), 500)


class NamesSupa(FakeSupa):
    def __init__(self, layout, names=None, boom=None):
        super().__init__()
        self.settings = [{"handle": "@namenest", "width": 1080, "height": 1080, "card_layout": layout}]
        self.names, self.boom = names or {}, boom

    def select(self, table, query):
        if table != "names":
            return super().select(table, query)
        self.selects.append((table, query))
        if self.boom:
            raise self.boom
        nid = query.split("id=eq.")[1].split("&")[0]
        return [self.names[nid]] if nid in self.names else []


class LayoutRenderer(FakeRenderer):
    def __init__(self):
        super().__init__()
        self.kwargs = []

    def compose(self, photo, name, meaning, handle, style=None, **kw):
        self.kwargs.append(kw)
        return FakeRenderer.compose(self, photo, name, meaning, handle, style)

    def compose_cta(self, photo, message, handle, style=None, **kw):
        self.kwargs.append(kw)
        return FakeRenderer.compose_cta(self, photo, message, handle, style)


class RunnerLayoutTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        p = mock.patch("jobs.time.sleep")
        p.start()
        self.addCleanup(p.stop)
        self.logs = []

    def run_one(self, supa, card_job):
        r = LayoutRenderer()
        run = jobs.Runner(supa, r, os.path.join(self.root, "out"), os.path.join(self.root, "cache"), log=self.logs.append)
        supa.jobs.append(card_job)
        run.tick()
        return r

    def test_classic_calls_the_renderer_exactly_as_before_and_reads_no_names(self):
        for layout in (None, "classic"):
            s = NamesSupa(layout, {"n1": {"name": "Arlo Zenith", "origin": "Greek", "us_rank": 5, "us_year": 2024}})
            r = self.run_one(s, job(name_id="n1"))
            self.assertEqual(r.kwargs, [{}])
            self.assertFalse([q for q in s.selects if q[0] == "names"])

    def test_name_nest_card_gets_its_rank_and_origin(self):
        s = NamesSupa(NEST, {"n1": {"name": "olivia", "origin": "Latin", "us_rank": 3, "us_year": 2024}})
        r = self.run_one(s, job(name_id="n1", name="Olivia", meaning="olive tree"))
        self.assertEqual(r.kwargs, [{"layout": NEST, "detail": "#3 in the US %s Latin" % DOT}])
        self.assertEqual([q for q in s.selects if q[0] == "names"], [("names", "id=eq.n1&select=name,origin,us_rank,us_year")])

    def test_initials_pair_gets_its_origins_only_and_a_reused_name_no_line(self):
        # A post by initials (017): a fresh two-word name has no US rank, only its parts' origins ("English · Latin");
        # a name used before has no name_id on its new card, so no line at all.
        s = NamesSupa(NEST, {"n2": {"name": "Hazel June", "origin": "English %s Latin" % DOT, "us_rank": None, "us_year": None}})
        r = self.run_one(s, job(name_id="n2", name="Hazel June", meaning="the hazel tree born in june"))
        self.assertEqual(r.kwargs, [{"layout": NEST, "detail": "English %s Latin" % DOT}])
        self.assertEqual(self.run_one(NamesSupa(NEST), job(name="Amos Rhett")).kwargs, [{"layout": NEST, "detail": None}])

    def test_a_renamed_card_or_a_missing_name_gets_no_line(self):
        s = NamesSupa(NEST, {"n1": {"name": "Olive", "origin": "Latin", "us_rank": 3, "us_year": 2024}})
        self.assertEqual(self.run_one(s, job(name_id="n1", name="Olivia")).kwargs, [{"layout": NEST, "detail": None}])
        self.assertEqual(self.run_one(NamesSupa(NEST), job(name_id="n9", name="Olivia")).kwargs, [{"layout": NEST, "detail": None}])
        self.assertEqual(self.run_one(NamesSupa(NEST), job(name="Olivia")).kwargs, [{"layout": NEST, "detail": None}])

    def test_a_names_read_error_never_fails_the_card(self):
        s = NamesSupa(NEST, boom=SupaError("GET x -> HTTP 400 column names.origin does not exist"))
        r = self.run_one(s, job(name_id="n1", name="Olivia"))
        self.assertEqual(r.kwargs, [{"layout": NEST, "detail": None}])
        self.assertEqual([u[2]["status"] for u in s.updates if u[0] == "cards"][-1], "done")
        self.assertTrue(any("rank" in m for m in self.logs))

    def test_name_nest_closing_card(self):
        r = self.run_one(NamesSupa(NEST), job(kind="cta", name="New names every day. / Pull up a chair.", meaning=""))
        self.assertEqual(r.kwargs, [{"layout": NEST}])


if __name__ == "__main__":
    unittest.main()
