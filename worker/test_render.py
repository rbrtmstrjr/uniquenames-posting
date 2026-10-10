# Offline tests for the card worker: no ComfyUI. Fonts are cached in worker/fonts/
# (downloaded once from github.com/google/fonts if missing).
#   python -m unittest test_render -v
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

from PIL import Image, ImageDraw

import render as w

POSITIONS = w.LAYOUT["positions"]
MAX = w.text_style({"title_size": 180, "meaning_size": 90, "mark_size": 48})


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

    def test_fast_setup_by_default(self):
        # Setup B (2026-10-10 A/B): fp8 text encoder + fp8 weights, same look, 15-30% faster
        g = w.comfy_graph("p", 5, 1088, 1920, "x")
        self.assertEqual(g["2"]["inputs"]["clip_name"], "qwen_3_4b_fp8_mixed.safetensors")
        self.assertEqual(g["1"]["inputs"]["weight_dtype"], "fp8_e4m3fn")
        self.assertEqual(g["1"]["inputs"]["unet_name"], "z_image_turbo_bf16.safetensors")

    def test_safe_setup_uses_the_old_files(self):
        g = w.comfy_graph("p", 5, 1088, 1920, "x", fast=False)
        self.assertEqual(g["2"]["inputs"]["clip_name"], "qwen_3_4b.safetensors")
        self.assertEqual(g["1"]["inputs"]["weight_dtype"], "default")


def clip_info(*names):
    return {"CLIPLoader": {"input": {"required": {"clip_name": [list(names)], "type": [["lumina2"]]}}}}


class FastSetup(unittest.TestCase):
    """The fp8 text encoder is used when ComfyUI has it; otherwise (or on 'value not in list') the old files."""

    def setUp(self):
        self.logs = []
        self.r = w.ComfyRenderer("http://comfy", 30, log=self.logs.append)

    def test_uses_fp8_when_comfyui_lists_it_and_asks_only_once(self):
        info = clip_info("qwen_3_4b.safetensors", w.FAST_CLIP)
        with mock.patch("render.http_json", return_value=info) as h:
            self.assertTrue(self.r.use_fast())
            self.assertTrue(self.r.use_fast())
        self.assertEqual(h.call_count, 1)
        self.assertIn("/object_info/CLIPLoader", h.call_args[0][0])

    def test_falls_back_when_the_fp8_file_is_missing(self):
        with mock.patch("render.http_json", return_value=clip_info("qwen_3_4b.safetensors")) as h:
            self.assertFalse(self.r.use_fast())
            self.assertFalse(self.r.use_fast())
        self.assertEqual(h.call_count, 1)
        self.assertTrue(any("qwen_3_4b.safetensors" in m for m in self.logs))

    def test_unreachable_comfyui_tries_fast_and_asks_again_later(self):
        with mock.patch("render.http_json", side_effect=OSError("refused")) as h:
            self.assertTrue(self.r.use_fast())
            self.assertTrue(self.r.use_fast())
        self.assertEqual(h.call_count, 2)  # nothing cached: the next picture checks again

    def _comfy(self, refuse_fast):
        """A fake ComfyUI: /prompt refuses the fp8 encoder (400, 'Value not in list') when refuse_fast."""
        import io as _io
        import urllib.error
        sent = []

        def http(url, body=None, timeout=30):
            if "/object_info/" in url:
                return clip_info("qwen_3_4b.safetensors", w.FAST_CLIP)
            if url.endswith("/prompt"):
                sent.append(body["prompt"])
                if refuse_fast and body["prompt"]["2"]["inputs"]["clip_name"] == w.FAST_CLIP:
                    # shaped like ComfyUI's real answer, with the telling words past the first 300 characters
                    err = json.dumps({"error": {"type": "prompt_outputs_failed_validation", "message": "x" * 300},
                                      "node_errors": {"2": {
                        "errors": [{"type": "value_not_in_list", "message": "Value not in list",
                                    "details": "clip_name: 'qwen_3_4b_fp8_mixed.safetensors' not in [...]"}]}}})
                    raise urllib.error.HTTPError(url, 400, "Bad Request", {}, _io.BytesIO(err.encode()))
                return {"prompt_id": "p%d" % len(sent)}
            if "/history/" in url:
                pid = url.rsplit("/", 1)[-1]
                return {pid: {"status": {"completed": True},
                              "outputs": {"10": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}]}}}}
            raise AssertionError(url)

        png = _io.BytesIO()
        Image.new("RGB", (64, 64), (10, 20, 30)).save(png, "PNG")

        class Resp(_io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        patches = [mock.patch("render.http_json", side_effect=http),
                   mock.patch("render.urllib.request.urlopen", side_effect=lambda *a, **k: Resp(png.getvalue())),
                   mock.patch("render.time.sleep")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return sent

    def test_value_not_in_list_retries_with_the_old_files_and_remembers(self):
        sent = self._comfy(refuse_fast=True)
        img = self.r.generate_photo("p", 1, 64, 64)
        self.assertEqual(img.size, (64, 64))
        self.assertEqual([g["2"]["inputs"]["clip_name"] for g in sent], [w.FAST_CLIP, "qwen_3_4b.safetensors"])
        self.assertEqual(sent[1]["1"]["inputs"]["weight_dtype"], "default")
        self.r.generate_photo("p", 2, 64, 64)
        self.assertEqual(sent[2]["2"]["inputs"]["clip_name"], "qwen_3_4b.safetensors")  # no second refusal

    def test_fast_graph_is_sent_when_available(self):
        sent = self._comfy(refuse_fast=False)
        self.r.generate_photo("p", 1, 64, 64)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["1"]["inputs"]["weight_dtype"], "fp8_e4m3fn")

    def test_other_refusals_are_not_retried(self):
        import io as _io
        import urllib.error

        def http(url, body=None, timeout=30):
            if "/object_info/" in url:
                return clip_info(w.FAST_CLIP)
            raise urllib.error.HTTPError(url, 400, "Bad Request", {}, _io.BytesIO(b'{"error": "bad seed"}'))

        with mock.patch("render.http_json", side_effect=http) as h:
            with self.assertRaises(w.JobError) as cm:
                self.r.generate_photo("p", 1, 64, 64)
        self.assertIn("bad seed", str(cm.exception))
        self.assertEqual(sum(1 for c in h.call_args_list if c[0][0].endswith("/prompt")), 1)


class Layout(unittest.TestCase):
    def test_picks_calm_band(self):
        self.assertNotEqual(w.pick_band(busy_image("top"))[0], "top")
        self.assertEqual(w.pick_band(busy_image("middle"))[0], "top")
        self.assertEqual(w.pick_band(busy_image("bottom"))[0], "top")

    def test_top_wins_on_flat(self):
        self.assertEqual(w.pick_band(Image.new("RGB", (1080, 1080), (90, 60, 40)))[0], "top")

    def test_long_name_fits(self):
        f = w.fit_title("poppins", "MAXIMILIANA SERAPHINE", 95, int(1080 * 0.84))
        self.assertLessEqual(w._text_w(f, "MAXIMILIANA SERAPHINE"), int(1080 * 0.84))

    def test_compose_keeps_size_and_draws(self):
        img = Image.new("RGB", (1080, 1080), (90, 60, 40))
        out, band, _ = w.compose_card(img, "Arlo Zenith", "peak strength with calm", "@unique_names")
        self.assertEqual(out.size, (1080, 1080))
        self.assertEqual(band, "top")
        a, b = w.BANDS["top"]
        top_band = out.crop((0, int(1080 * a), 1080, int(1080 * b)))
        self.assertGreater(top_band.getextrema()[0][1], 240)  # white text landed in the top band
        mid = out.crop((0, int(1080 * 0.40), 1080, int(1080 * 0.60)))
        self.assertLess(mid.getextrema()[0][1], 100)          # nothing drawn mid-frame

    def test_text_turns_dark_on_bright_backdrops(self):
        light = Image.new("RGB", (1080, 1080), (214, 238, 230))  # pale mint
        out, band, _ = w.compose_card(light, "Arlo Zenith", "peak strength with calm", "@unique_names")
        a, b = w.BANDS[band]
        lo = out.convert("L").crop((0, int(1080 * a), 1080, int(1080 * b))).getextrema()[0]
        self.assertLess(lo, 80)  # dark ink was drawn
        self.assertEqual(w.text_colors(light, (0, 0, 1080, 1080))[0], w.DARK_INK)
        dark = Image.new("RGB", (1080, 1080), (90, 60, 40))
        self.assertEqual(w.text_colors(dark, (0, 0, 1080, 1080))[0], (255, 255, 255))

    def test_fit_to_size(self):
        self.assertEqual(w.fit_to_size(Image.new("RGB", (1072, 1072)), 1080, 1080).size, (1080, 1080))
        self.assertEqual(w.fit_to_size(Image.new("RGB", (1080, 1344)), 1080, 1080).size, (1080, 1080))


def inside(box, outer):
    return box[0] >= outer[0] - 0.5 and box[1] >= outer[1] - 0.5 and box[2] <= outer[2] + 0.5 and box[3] <= outer[3] + 0.5


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


LONG_NAME = "Anastasia-Evangeline Maximiliana Rosalie"  # 40 characters, the longest allowed
LONG_MEANING = "a gift of grace and light who brings joy, warmth and peace to every home she enters"[:80].strip()


class Style(unittest.TestCase):
    def test_defaults_when_settings_have_no_text_columns(self):
        # Before migration 002 the settings row has none of the new columns.
        s = w.text_style({"handle": "@unique_names", "width": 1080, "height": 1080})
        self.assertEqual(s, w.TextStyle("poppins", "poppins", "poppins", 95, 37, 21, "auto"))

    def test_cleans_bad_values(self):
        s = w.text_style({"title_font": "comic", "meaning_font": None, "mark_font": "lora", "title_size": 999,
                          "meaning_size": "x", "mark_size": 1, "text_position": "upside-down"})
        self.assertEqual(s, w.TextStyle("poppins", "poppins", "lora", 180, 37, 12, "auto"))

    def test_keeps_good_values(self):
        s = w.text_style({"title_font": "playfair", "meaning_font": "lora", "mark_font": "montserrat", "title_size": 120,
                          "meaning_size": 40, "mark_size": 24, "text_position": "bottom-right"})
        self.assertEqual(s, w.TextStyle("playfair", "lora", "montserrat", 120, 40, 24, "bottom-right"))


class Positions(unittest.TestCase):
    def padded(self, W, H):
        L = w.LAYOUT
        return (W * L["padX"], H * L["padTop"], W - W * L["padX"], H - H * L["padBottom"])

    def check(self, W, H, style, name, meaning, band="top"):
        lay = w.layout_text((W, H), name, meaning, "@unique_names", style, band)
        pad = self.padded(W, H)
        for part in lay["title"] + lay["meaning"]:
            self.assertTrue(inside(part["box"], pad), (style.position, part["text"], part["box"], pad))
        self.assertTrue(inside(lay["mark"]["box"], (0, 0, W, H)))
        self.assertFalse(overlaps(lay["block"], lay["mark"]["box"]), (style.position, lay["block"], lay["mark"]["box"]))
        return lay

    def test_every_position_keeps_text_in_the_padded_box_and_off_the_watermark(self):
        for pos in POSITIONS:
            for style in (w.text_style({"text_position": pos}), MAX._replace(position=pos)):
                for (W, H) in ((1080, 1080), (1080, 1350)):
                    for band in ("top", "middle", "bottom"):
                        self.check(W, H, style, "Arlo Zenith", "peak strength with calm", band)
                        self.check(W, H, style, LONG_NAME, LONG_MEANING, band)

    def test_a_block_too_tall_for_a_short_card_shrinks_instead_of_overflowing(self):
        for pos in POSITIONS:
            for name, meaning in (("Luna Mae", LONG_MEANING), ("Luna", "peak")):
                self.check(1080, 608, MAX._replace(position=pos), name, meaning)  # 16:9 at max sizes still fits
                # 2048x512 (the widest allowed card): sizes scale with the width to a block
                # taller than the 512 px card can hold, so title + meaning shrink to fit.
                lay = self.check(2048, 512, MAX._replace(position=pos), name, meaning)
                self.assertLess(lay["title"][0]["font"].size, w._px(180 * 2048 / 1080), pos)
        normal = w.layout_text((1080, 1080), "Luna", "peak", "@u", MAX)
        self.assertEqual(normal["title"][0]["font"].size, 180)  # a block that fits is never shrunk

    def test_every_font_fits_at_max_size(self):
        for fid in w.fonts.ids():
            for pos in ("top-left", "middle-center", "bottom-right", "bottom-center"):
                style = MAX._replace(title_font=fid, meaning_font=fid, mark_font=fid, position=pos)
                self.check(1080, 1080, style, LONG_NAME, LONG_MEANING)

    def test_alignment_follows_the_spot(self):
        W = 1080
        pad = W * w.LAYOUT["padX"]
        left = w.layout_text((W, W), "Arlo Zenith", "peak strength", "@unique_names", w.text_style({"text_position": "top-left"}))
        right = w.layout_text((W, W), "Arlo Zenith", "peak strength", "@unique_names", w.text_style({"text_position": "bottom-right"}))
        mid = w.layout_text((W, W), "Arlo Zenith", "peak strength", "@unique_names", w.text_style({"text_position": "middle-center"}))
        for part in left["title"] + left["meaning"]:
            self.assertAlmostEqual(part["box"][0], pad, delta=1)
        for part in right["title"] + right["meaning"]:
            self.assertAlmostEqual(part["box"][2], W - pad, delta=1)
        for part in mid["title"] + mid["meaning"]:
            self.assertAlmostEqual((part["box"][0] + part["box"][2]) / 2, W / 2, delta=1)
        self.assertAlmostEqual(left["block"][1], W * w.LAYOUT["padTop"], delta=1)
        self.assertAlmostEqual(right["block"][3], W - W * w.LAYOUT["padBottom"], delta=1)
        self.assertAlmostEqual((mid["block"][1] + mid["block"][3]) / 2, W / 2, delta=1)

    def test_watermark_moves_left_only_for_bottom_right(self):
        W = 1080
        for pos in POSITIONS:
            lay = w.layout_text((W, W), "Arlo Zenith", "peak strength", "@unique_names", w.text_style({"text_position": pos}))
            box = lay["mark"]["box"]
            if pos == "bottom-right":
                self.assertLess(box[2], W / 2, pos)
            else:
                self.assertGreater(box[0], W / 2, pos)

    def test_long_names_shrink_to_the_width_for_their_alignment(self):
        W = 1080
        side = w.layout_text((W, W), LONG_NAME, "x", "@u", MAX._replace(position="top-left"))
        center = w.layout_text((W, W), LONG_NAME, "x", "@u", MAX._replace(position="top-center"))
        sw = side["title"][0]["box"][2] - side["title"][0]["box"][0]
        cw = center["title"][0]["box"][2] - center["title"][0]["box"][0]
        self.assertLessEqual(sw, W * w.LAYOUT["maxWidthSide"])
        self.assertLessEqual(cw, W * w.LAYOUT["maxWidthCenter"])
        self.assertGreater(cw, sw)

    def test_long_meaning_wraps_onto_balanced_lines(self):
        lay = w.layout_text((1080, 1080), "Arlo", LONG_MEANING, "@u", MAX._replace(position="middle-left"))
        lines = [p["text"] for p in lay["meaning"]]
        self.assertGreater(len(lines), 1)
        self.assertLessEqual(len(lines), w.LAYOUT["meaningMaxLines"])
        self.assertEqual(" ".join(lines), LONG_MEANING)

    def test_short_meaning_stays_on_one_line_at_its_size(self):
        lay = w.layout_text((1080, 1080), "Arlo", "peak strength", "@u", w.text_style({"text_position": "top-center"}))
        self.assertEqual(len(lay["meaning"]), 1)
        self.assertEqual(lay["meaning"][0]["font"].size, 37)
        self.assertEqual(lay["title"][0]["font"].size, 95)

    def test_sizes_scale_with_the_image_width(self):
        lay = w.layout_text((540, 540), "Arlo", "peak", "@u", w.text_style({}))
        self.assertEqual((lay["title"][0]["font"].size, lay["meaning"][0]["font"].size, lay["mark"]["font"].size), (48, 19, 11))  # half up, like Math.round

    def test_script_fonts_keep_title_case(self):
        caps = w.layout_text((1080, 1080), "Arlo Zenith", "m", "@u", w.text_style({"title_font": "lora"}))
        script = w.layout_text((1080, 1080), "Arlo Zenith", "m", "@u", w.text_style({"title_font": "greatvibes"}))
        self.assertEqual(caps["title"][0]["text"], "ARLO ZENITH")
        self.assertEqual(script["title"][0]["text"], "Arlo Zenith")

    def test_auto_is_centered_in_the_calm_band(self):
        img = busy_image("top")
        _out, band, _ = w.compose_card(img, "Arlo Zenith", "peak strength", "@unique_names", w.text_style({}))
        self.assertNotEqual(band, "top")
        lay = w.layout_text(img.size, "Arlo Zenith", "peak strength", "@unique_names", w.text_style({}), band)
        a, b = w.BANDS[band]
        self.assertAlmostEqual((lay["block"][1] + lay["block"][3]) / 2, 1080 * (a + b) / 2, delta=1)

    def test_fixed_spot_ignores_the_band(self):
        _out, band, _ = w.compose_card(busy_image("bottom"), "Arlo", "peak", "@u", w.text_style({"text_position": "bottom-left"}))
        self.assertEqual(band, "bottom-left")

    def test_drawn_pixels_land_where_the_layout_says(self):
        img = Image.new("RGB", (1080, 1080), (90, 60, 40))
        style = w.text_style({"text_position": "top-left", "title_font": "playfair"})
        out, _band, _ = w.compose_card(img, "Arlo Zenith", "peak strength with calm", "@unique_names", style)
        lay = w.layout_text((1080, 1080), "Arlo Zenith", "peak strength with calm", "@unique_names", style)
        t = lay["title"][0]["box"]
        self.assertGreater(out.crop((int(t[0]), int(t[1]), int(t[2]), int(t[3]))).convert("L").getextrema()[1], 240)
        self.assertLess(out.crop((760, 300, 1000, 900)).convert("L").getextrema()[1], 100)  # nothing mid-right


CTA = "Follow for more / baby name ideas."


class ClosingCard(unittest.TestCase):
    def padded(self, W, H):
        L = w.LAYOUT
        return (W * L["padX"], H * L["padTop"], W - W * L["padX"], H - H * L["padBottom"])

    def check(self, W, H, style, message):
        lay = w.layout_cta((W, H), message, "@unique_names", style)
        for part in lay["lines"]:
            self.assertTrue(inside(part["box"], self.padded(W, H)), (style.position, part["text"], part["box"]))
            self.assertAlmostEqual((part["box"][0] + part["box"][2]) / 2, W / 2, delta=1)  # always centred across
        self.assertFalse(overlaps(lay["block"], lay["mark"]["box"]), style.position)
        self.assertLessEqual(len(lay["lines"]), w.CTA_MAX_LINES)
        return lay

    def test_lines_split_at_slash(self):
        self.assertEqual(w.cta_lines(CTA), ["Follow for more", "baby name ideas."])
        self.assertEqual(w.cta_lines("  one   line "), ["one line"])
        self.assertEqual(w.cta_lines("a / / b"), ["a", "b"])
        self.assertEqual(w.cta_lines("a/b/c/d"), ["a", "b", "c d"])
        self.assertEqual(w.cta_lines(""), [])

    def test_the_owners_lines_in_the_meaning_font_near_the_title_size_no_meaning(self):
        style = w.text_style({"meaning_font": "lora", "title_font": "playfair"})
        lay = self.check(1080, 1080, style, CTA)
        self.assertEqual([p["text"] for p in lay["lines"]], ["Follow for more", "baby name ideas."])
        font = lay["lines"][0]["font"]
        self.assertEqual(font.size, lay["lines"][1]["font"].size)
        self.assertGreaterEqual(font.size, 70)  # about the title size (95), not the meaning size (37)
        self.assertLessEqual(font.size, 95)
        self.assertEqual(font.path, w.fonts.load_safe("lora", w.LAYOUT["bodyWeight"], 20, lambda m: None).path)
        self.assertNotIn("meaning", lay)
        self.assertNotIn("title", lay)

    def test_auto_sits_in_the_upper_middle(self):
        lay = self.check(1080, 1080, w.text_style({}), CTA)
        mid = (lay["block"][1] + lay["block"][3]) / 2
        self.assertAlmostEqual(mid, 1080 * w.CTA_CENTER_Y, delta=2)
        self.assertEqual(lay["band"], "cta")

    def test_every_position_and_font_fits(self):
        long_lines = "Still searching for the perfect name? / Follow us for more unique baby names / every single day of the week"
        for pos in POSITIONS:
            for (W, H) in ((1080, 1080), (1080, 1350), (2048, 512)):
                self.check(W, H, MAX._replace(position=pos), CTA)
                self.check(W, H, MAX._replace(position=pos), long_lines)
        for fid in w.fonts.ids():
            self.check(1080, 1080, MAX._replace(meaning_font=fid, position="auto"), long_lines)

    def test_a_message_without_slash_wraps_onto_balanced_lines(self):
        lay = self.check(1080, 1080, w.text_style({}), "Save this post and follow us for more unique baby name ideas every day")
        self.assertGreater(len(lay["lines"]), 1)
        short = self.check(1080, 1080, w.text_style({}), "Follow along!")
        self.assertEqual([p["text"] for p in short["lines"]], ["Follow along!"])

    def test_position_setting_picks_the_height(self):
        top = w.layout_cta((1080, 1080), CTA, "@u", w.text_style({"text_position": "top-left"}))
        bottom = w.layout_cta((1080, 1080), CTA, "@u", w.text_style({"text_position": "bottom-right"}))
        self.assertAlmostEqual(top["block"][1], 1080 * w.LAYOUT["padTop"], delta=1)
        self.assertGreater(bottom["block"][1], 540)
        # the watermark stays bottom-right (the message is centred, never in its way)
        self.assertGreater(bottom["mark"]["box"][0], 540)

    def test_compose_draws_the_message_and_the_mark(self):
        img = Image.new("RGB", (1080, 1080), (70, 110, 170))
        out = w.compose_cta(img, CTA, "@unique_names", w.text_style({}))
        self.assertEqual(out.size, (1080, 1080))
        lay = w.layout_cta((1080, 1080), CTA, "@unique_names", w.text_style({}))
        b = lay["lines"][0]["box"]
        self.assertGreater(out.crop((int(b[0]), int(b[1]), int(b[2]), int(b[3]))).convert("L").getextrema()[1], 240)  # white ink
        m = lay["mark"]["box"]
        self.assertGreater(out.crop((int(m[0]), int(m[1]), int(m[2]), int(m[3]))).convert("L").getextrema()[1], 150)
        self.assertLess(out.crop((100, 700, 900, 940)).convert("L").getextrema()[1], 140)  # nothing in the lower half


if __name__ == "__main__":
    unittest.main()
