# The font catalog: every id loads (files cached under worker/fonts/, downloaded once if
# missing), weights apply to variable fonts, unknown ids fall back to Poppins.
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


if __name__ == "__main__":
    unittest.main()
