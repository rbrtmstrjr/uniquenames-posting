# The font catalog: every id loads (files cached under worker/fonts/, downloaded once if
# missing), weights apply to variable fonts, unknown ids fall back to Poppins.
import shutil
import tempfile
import unittest
from unittest import mock

import fonts


class Catalog(unittest.TestCase):
    def test_catalog_has_the_verified_list(self):
        self.assertEqual(fonts.ids(), ["poppins", "montserrat", "playfair", "fraunces", "dmserif", "quicksand", "nunito", "lora",
                                       "cormorant", "josefin", "comfortaa", "greatvibes", "dancing", "pacifico", "parisienne"])

    def test_unknown_id_falls_back_to_poppins(self):
        for bad in ("comic-sans", "", None, 7):
            self.assertEqual(fonts.resolve(bad)["id"], "poppins")
        self.assertEqual(fonts.resolve("lora")["id"], "lora")

    def test_url_escapes_brackets(self):
        self.assertEqual(fonts.file_url("montserrat", "Montserrat[wght].ttf"),
                         "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf")

    def test_caps(self):
        self.assertTrue(fonts.caps("poppins"))
        self.assertFalse(fonts.caps("greatvibes"))
        self.assertTrue(fonts.caps("nope"))  # poppins


class Load(unittest.TestCase):
    def test_every_font_loads_and_draws_in_both_weights(self):
        for fid in fonts.ids():
            for weight in (400, 600):
                f = fonts.load(fid, weight, 60)
                box = f.getbbox("Arlo Zenith")
                self.assertGreater(box[2] - box[0], 100, (fid, weight))
                self.assertEqual(f.size, 60)

    def test_variable_weight_changes_the_glyphs(self):
        regular = fonts.load("montserrat", 400, 80).getbbox("WWWW")
        semibold = fonts.load("montserrat", 600, 80).getbbox("WWWW")
        self.assertNotEqual(regular, semibold)

    def test_static_single_weight_uses_its_only_file(self):
        self.assertEqual(fonts.font_file("greatvibes", 600), fonts.font_file("greatvibes", 400))
        self.assertNotEqual(fonts.font_file("poppins", 600), fonts.font_file("poppins", 400))

    def test_unknown_font_loads_poppins(self):
        self.assertEqual(fonts.font_file("nope", 600), fonts.font_file("poppins", 600))

    def test_failed_download_falls_back_to_poppins_and_logs(self):
        poppins = fonts.font_file("poppins", 400)
        real = fonts.font_file
        logs = []

        def flaky(fid, weight):
            if fid == "lora":
                raise OSError("offline")
            return real(fid, weight)

        with mock.patch("fonts.font_file", side_effect=flaky):
            f = fonts.load_safe("lora", 400, 40, log=logs.append)
        self.assertEqual(f.path, poppins)
        self.assertTrue(logs and "lora" in logs[0])


class Downloads(unittest.TestCase):
    """Against an empty temp fonts folder, with the network mocked."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        patches = [mock.patch("fonts.FONTS_DIR", self.dir), mock.patch.dict(fonts._failed, clear=True)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_a_failed_download_is_not_retried_for_every_size(self):
        with mock.patch("fonts._download", side_effect=OSError("offline")) as dl:
            for _ in range(5):
                with self.assertRaises(Exception):
                    fonts.font_file("lora", 400)
        self.assertEqual(dl.call_count, 1)

    def test_retried_after_the_cooldown(self):
        with mock.patch("fonts._download", side_effect=OSError("offline")) as dl:
            with self.assertRaises(Exception):
                fonts.font_file("lora", 400)
            fonts._failed["Lora[wght].ttf"] -= fonts.FAILED_RETRY_S + 1
            with self.assertRaises(Exception):
                fonts.font_file("lora", 400)
        self.assertEqual(dl.call_count, 2)

    def test_prefetch_fetches_every_file_best_effort_with_a_short_timeout(self):
        calls, logs = [], []

        def fake(url, dest, timeout=60):
            calls.append((url, timeout))
            if "lora" in url:
                raise OSError("offline")
            with open(dest, "wb") as f:
                f.write(b"x" * 20000)

        with mock.patch("fonts._download", side_effect=fake):
            missing = fonts.prefetch(timeout=15, log=logs.append)
        self.assertEqual(len(calls), 16)  # 15 fonts, Poppins has two files
        self.assertTrue(all(t == 15 for _u, t in calls))
        self.assertEqual(missing, 1)
        self.assertTrue(logs and "Lora" in logs[0])
        self.assertIn("Lora[wght].ttf", fonts._failed)
        with mock.patch("fonts._download") as dl:  # a second run only tries what is still missing
            fonts.prefetch(log=lambda m: None)
        self.assertEqual([c.args[0].rsplit("/", 1)[1] for c in dl.call_args_list], ["Lora%5Bwght%5D.ttf"])


if __name__ == "__main__":
    unittest.main()
