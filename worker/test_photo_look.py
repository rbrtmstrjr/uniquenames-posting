# The card photo look (2.7.2): Camera Raw-style vibrance + texture on new card photos only. No ComfyUI.
import io
import os
import shutil
import tempfile
import unittest
from unittest import mock

import numpy as np
from PIL import Image

import jobs
import pages
import photo_look
import reels
from test_jobs import FakeRenderer, FakeSupa, job

N = 544  # half the real 1088 px, so the texture sigmas scale down too


def patch_img(rgb, size=(N, N)):
    return Image.new("RGB", size, rgb)


def sat(img):
    """Mean HSV saturation (0-255)."""
    return float(np.asarray(img.convert("HSV"), dtype=np.float64)[..., 1].mean())


def luma(img):
    a = np.asarray(img, dtype=np.float64)
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def stripes(size=N, period=10, amp=18, base=(120, 120, 120)):
    """A knit-like texture: vertical stripes a few pixels wide (medium frequency at 544 px)."""
    x = np.arange(size)
    wave = amp * np.sin(2 * np.pi * x / period)
    a = np.empty((size, size, 3))
    for c in range(3):
        a[..., c] = base[c] + wave[None, :]
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8), "RGB")


class VibranceTest(unittest.TestCase):
    def test_zero_zero_returns_an_identical_copy(self):
        img = stripes(base=(140, 90, 200))
        out = photo_look.apply_look(img, vibrance=0, texture=0)
        self.assertIsNot(out, img)
        self.assertEqual(out.tobytes(), img.tobytes())

    def test_size_and_mode_are_kept(self):
        for size in ((N, N), (300, 533)):
            out = photo_look.apply_look(patch_img((100, 150, 200), size))
            self.assertEqual((out.size, out.mode), (size, "RGB"))

    def test_non_rgb_input_comes_back_rgb(self):
        out = photo_look.apply_look(Image.new("RGBA", (64, 64), (100, 150, 200, 255)))
        self.assertEqual(out.mode, "RGB")

    def test_neutral_greys_stay_neutral(self):
        ramp = np.repeat(np.linspace(0, 255, N)[None, :], N, axis=0)
        noise = np.random.default_rng(1).normal(0, 6, (N, N))
        grey = np.clip(np.rint(ramp + noise), 0, 255).astype(np.uint8)
        img = Image.fromarray(np.stack([grey] * 3, axis=-1), "RGB")
        out = np.asarray(photo_look.apply_look(img), dtype=np.int16)
        spread = out.max(axis=-1) - out.min(axis=-1)
        self.assertLessEqual(int(spread.max()), 1)

    def test_muted_colour_gains_more_than_a_saturated_one(self):
        muted, vivid = patch_img((130, 150, 170)), patch_img((30, 90, 230))
        gain_muted = sat(photo_look.apply_look(muted, texture=0)) - sat(muted)
        gain_vivid = sat(photo_look.apply_look(vivid, texture=0)) - sat(vivid)
        self.assertGreater(gain_muted, 4)                     # a noticeable lift
        self.assertGreater(gain_muted, 2 * gain_vivid)
        self.assertGreaterEqual(gain_vivid, 0)

    def test_skin_gains_much_less_than_pastels(self):
        def gain(rgb):
            p = patch_img(rgb)
            return sat(photo_look.apply_look(p, texture=0)) - sat(p)
        skin = max(gain(rgb) for rgb in ((224, 172, 140), (198, 134, 96), (241, 194, 167)))
        for pastel in ((170, 200, 230), (170, 220, 180)):
            self.assertLess(skin, 0.4 * gain(pastel), pastel)

    def test_plus_20_is_tasteful_not_cartoonish(self):
        p = patch_img((150, 170, 190))
        s0, s1 = sat(p), sat(photo_look.apply_look(p, texture=0))
        self.assertLess(s1 / s0, 1.3)

    def test_hue_is_kept(self):
        p = patch_img((90, 140, 200))
        h0 = np.asarray(p.convert("HSV"))[0, 0, 0]
        h1 = np.asarray(photo_look.apply_look(p, texture=0).convert("HSV"))[0, 0, 0]
        self.assertLessEqual(abs(int(h0) - int(h1)), 2)


class TextureTest(unittest.TestCase):
    def test_texture_lifts_mid_detail_and_leaves_flat_areas(self):
        tex = stripes()
        flat = patch_img((120, 120, 120))
        both = Image.new("RGB", (N, N))
        both.paste(tex.crop((0, 0, N // 2, N)), (0, 0))
        both.paste(flat.crop((0, 0, N // 2, N)), (N // 2, 0))
        out = photo_look.apply_look(both, vibrance=0, texture=15)
        y0, y1 = luma(both), luma(out)
        m = 40  # away from the seam
        before, after = y0[:, m:N // 2 - m].std(), y1[:, m:N // 2 - m].std()
        self.assertGreater(after, before * 1.04)              # local contrast up
        self.assertLess(after, before * 1.6)                  # but subtle at +15
        self.assertTrue(np.array_equal(np.asarray(out)[:, N // 2 + m:], np.asarray(both)[:, N // 2 + m:]))
        self.assertLess(abs(y1.mean() - y0.mean()), 1.5)

    def test_texture_keeps_mean_brightness_on_a_busy_photo(self):
        rng = np.random.default_rng(3)
        a = rng.integers(30, 225, (N // 8, N // 8, 3)).astype(np.uint8)
        img = Image.fromarray(a, "RGB").resize((N, N), Image.BICUBIC)
        out = photo_look.apply_look(img)
        self.assertLess(abs(luma(out).mean() - luma(img).mean()), 1.5)

    def test_texture_leaves_chroma_alone(self):
        tex = stripes(base=(150, 110, 90))
        out = np.asarray(photo_look.apply_look(tex, vibrance=0, texture=15), dtype=np.int16)
        a = np.asarray(tex, dtype=np.int16)
        # luminance-only: the R-G and G-B differences move by rounding at most
        self.assertLessEqual(int(np.abs((out[..., 0] - out[..., 1]) - (a[..., 0] - a[..., 1])).max()), 1)
        self.assertLessEqual(int(np.abs((out[..., 1] - out[..., 2]) - (a[..., 1] - a[..., 2])).max()), 1)

    def test_strong_edges_get_no_big_halo(self):
        a = np.full((N, N, 3), 40, np.uint8)
        a[:, N // 2:] = 220
        img = Image.fromarray(a, "RGB")
        out = np.asarray(photo_look.apply_look(img, vibrance=0, texture=15), dtype=np.int16)
        diff = np.abs(out - a.astype(np.int16))
        self.assertLessEqual(int(diff.max()), 6)              # soft clamp: a hard edge moves only a little


class SettingsTest(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(photo_look.settings({}), (20, 15))

    def test_first_config_with_a_value_wins(self):
        self.assertEqual(photo_look.settings({"PHOTO_VIBRANCE": "0"}, {"PHOTO_VIBRANCE": "30", "PHOTO_TEXTURE": "5"}), (0, 5))

    def test_bad_values_use_the_default_and_say_so(self):
        logs = []
        self.assertEqual(photo_look.settings({"PHOTO_VIBRANCE": "lots", "PHOTO_TEXTURE": "500"}, log=logs.append), (20, 100))
        self.assertEqual(len(logs), 1)

    def test_describe(self):
        self.assertEqual(photo_look.describe((20, 15)), "photo look: vibrance +20, texture +15")
        self.assertEqual(photo_look.describe((0, 0)), "photo look: off")


class HookTest(unittest.TestCase):
    """The look is applied once to a new card photo, before it is saved and stamped; never on restamps or reels."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.supa = FakeSupa()
        self.r = FakeRenderer()
        self.run_ = jobs.Runner(self.supa, self.r, os.path.join(self.root, "out"), os.path.join(self.root, "cache"),
                                log=lambda m: None, look=(20, 15))
        p = mock.patch("jobs.time.sleep")
        p.start()
        self.addCleanup(p.stop)
        self.spy = mock.Mock(side_effect=lambda img, vibrance, texture: Image.new("RGB", img.size, (1, 2, 3)))
        p2 = mock.patch.object(photo_look, "apply_look", self.spy)
        p2.start()
        self.addCleanup(p2.stop)

    def stored_photo(self, path):
        return Image.open(io.BytesIO(self.supa.uploads[path])).getpixel((5, 5))

    def test_generate_applies_it_once_before_saving_and_stamping(self):
        stamped = []
        self.r.compose = lambda photo, *a, **k: stamped.append(photo.getpixel((0, 0))) or photo
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertEqual(self.spy.call_count, 1)
        self.assertEqual(self.spy.call_args.kwargs, {"vibrance": 20, "texture": 15})
        self.assertEqual(stamped, [(1, 2, 3)])                                  # the stamp got the looked photo
        self.assertLessEqual(max(abs(a - b) for a, b in zip(self.stored_photo("photos/c1/v1.jpg"), (1, 2, 3))), 3)

    def test_closing_and_preview_cards_get_it_too(self):
        self.supa.jobs += [job(kind="cta", name="Follow / us", meaning=""), job(kind="preview")]
        self.run_.tick()
        self.run_.tick()
        self.assertEqual(self.spy.call_count, 2)

    def test_restamp_never_applies_it_again(self):
        b = io.BytesIO()
        Image.new("RGB", (1080, 1080), (10, 10, 10)).save(b, "JPEG")
        self.supa.uploads["photos/c1/v1.jpg"] = b.getvalue()
        self.supa.jobs.append(job("restamp", photo_path="photos/c1/v1.jpg"))
        self.run_.tick()
        self.assertIn("cards/c1/v1.jpg", self.supa.uploads)
        self.assertEqual(self.spy.call_count, 0)

    def test_off_is_off(self):
        self.run_.look = (0, 0)
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertEqual(self.spy.call_count, 0)

    def test_a_runner_without_a_look_leaves_photos_alone(self):
        run_ = jobs.Runner(self.supa, self.r, os.path.join(self.root, "out"), os.path.join(self.root, "cache"), log=lambda m: None)
        self.supa.jobs.append(job())
        run_.tick()
        self.assertEqual(self.spy.call_count, 0)

    def test_reel_scene_images_and_reel_theme_previews_never_get_it(self):
        from test_reels import FakeRenderer as ReelRenderer, FakeSupa as ReelSupa, make_reel, make_scene
        rr = reels.ReelRunner(ReelSupa(), ReelRenderer(), log=lambda m: None, sleep=lambda s: None)
        rr.run_step({"step": "image", "reel": make_reel(status="imaging", words=[]), "scene": make_scene(1)})
        rr.run_theme_preview({"theme": {"id": "watercolor", "version": 1, "style": "Soft watercolor."}})
        self.assertEqual(len(rr.renderer.calls), 2)                              # both pictures were made
        self.assertEqual(self.spy.call_count, 0)


class BuildRunnerLookTest(unittest.TestCase):
    def setUp(self):
        self.here = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.here, True)

    def test_defaults(self):
        base = {"SUPABASE_URL": "https://un.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"}
        (p,), _ = pages.discover_pages(self.here, dict(base))
        logs = []
        r = pages.build_runner(p, dict(base), logs.append)
        self.assertEqual(r.look, (20, 15))
        self.assertEqual(logs, [])                                            # main.py logs the look once at start

    def test_main_logs_the_look_once_per_page_at_start(self):
        import main
        with open(main.__file__, encoding="utf-8") as fh:
            src = fh.read()
        self.assertEqual(src.count("photo_look.describe("), 1)

    def test_page_file_wins_then_worker_env(self):
        os.makedirs(os.path.join(self.here, "pages"))
        with open(os.path.join(self.here, "pages", "name-nest.env"), "w") as fh:
            fh.write("PAGE_ID=name-nest\nSUPABASE_URL=https://nn.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\nPHOTO_TEXTURE=0\n")
        base = {"SUPABASE_URL": "https://un.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k", "PHOTO_VIBRANCE": "10"}
        found, _ = pages.discover_pages(self.here, dict(base))
        looks = {p.id: pages.build_runner(p, dict(base), lambda m: None).look for p in found}
        self.assertEqual(looks, {"name-nest": (10, 0), "unique-names": (10, 15)})


if __name__ == "__main__":
    unittest.main()
