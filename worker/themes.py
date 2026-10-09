# Reel visual themes (migration 007): the preview picture each theme gets (one fixed mom-and-baby moment, so
# the themes compare fairly) and the grayscale rule (sketch: Z-Image colours the clothes from the cast text, so
# the worker turns the picture grey afterwards). Wording from docs/reference/reel-themes-motion-spike.md §5:
# positive-only, never "camera"; NO_TEXT is the only "no".
# Migration 012: the two guide styles (Crayon, Red Thread) carry their whole preview prompt on the row (the guide's
# example scene, used verbatim), and Red Thread keeps only strong reds (its thread) while everything else turns grey.
import re

from PIL import Image, ImageChops, ImageFilter, ImageOps

DEFAULT_THEME = "knitted"
THEME_ID = re.compile(r"^[a-z0-9]+$")
PREVIEW_SEED = 1234
NO_TEXT = "No text, no letters, no words, no logo, no watermark anywhere."
MOMENT = "a mother gently lifting her laughing baby up toward the warm window light"
LENS = "35mm lens at f/4, a warm medium-wide view, the characters sharp"
CAST = ("the mother: a young mother in her early thirties with warm tan skin and dark-brown hair gathered in a low bun, "
        "wearing a mustard-yellow cardigan over a cream dress; the baby: a chubby six-month-old baby with warm tan skin and "
        "a few soft tufts of dark-brown hair, wearing a rust-orange romper with a round cream collar")
DOLL_CAST = ("the mom doll: a crocheted mother doll with chunky dark-brown yarn hair gathered in a low bun, warm tan wool skin, "
             "a mustard-yellow cable-knit cardigan over a cream knitted dress; the baby doll: a small crocheted baby doll about "
             "six months old with a few soft tufts of dark-brown yarn hair, warm tan wool skin, a rust-orange knitted romper "
             "with a round cream collar")
COMPOSITION = ("Composition: the scene fills the whole frame edge to edge; the characters and their action sit in the upper and "
               "middle part of the frame, and the band just below the middle is calm and uncluttered, a soft, simple, evenly lit "
               "stretch of the scene's own floor, blanket or background.")


def preview_prompt(theme):
    """The Z-Image prompt for a theme's preview. A theme with a saved preview prompt (012: Crayon, Red Thread) uses
    it verbatim. Otherwise the fixed moment, the theme's style block and a simple cast (dolls for knitted). The same
    moment is used for every old theme, knitted included: the spike's no-lift rule is for script lines (a doll lift
    there added a second baby), and this one preview moment passed for knitted in spike r1, so it is kept as is."""
    saved = str((theme or {}).get("preview_prompt") or "").strip()
    if saved:
        return saved
    dolls = (theme or {}).get("id") == "knitted"
    who = "the same two dolls in every picture" if dolls else "the same two people in every picture"
    style = str((theme or {}).get("style") or "").strip()
    return "\n".join([
        "A single full-bleed vertical 9:16 picture of one tender moment. Moment: %s. Lens: %s." % (MOMENT, LENS),
        "%s Characters (%s): %s." % (style, who, DOLL_CAST if dolls else CAST),
        COMPOSITION,
        NO_TEXT,
    ])


def preview_path(theme_id, version):
    """themes/<id>/preview-v<version>.jpg in the reels bucket."""
    return "themes/%s/preview-v%d.jpg" % (theme_id, int(version))


def theme_id_for(reel, settings):
    """The reel's theme, matching the web server: a reel row with the theme_id column uses it, and null there
    means knitted (a reel written before the theme was pinned), never the Settings default. Only a reel row
    without the column falls back to settings.reel_theme_id -> knitted. None on a database without 007
    (neither column exists), so nothing theme-related is looked up there."""
    reel, settings = reel or {}, settings or {}
    if "theme_id" not in reel and "reel_theme_id" not in settings:
        return None
    if "theme_id" in reel:
        tid = str(reel.get("theme_id") or DEFAULT_THEME).strip().lower()
    else:
        tid = str(settings.get("reel_theme_id") or DEFAULT_THEME).strip().lower()
    return tid if THEME_ID.match(tid) else DEFAULT_THEME


def to_gray(img):
    """A grayscale copy, still RGB (the JPEG and the video stay 3-channel)."""
    return ImageOps.grayscale(img).convert("RGB")


def colour_mode(theme):
    """What the worker does to a theme's pictures after Z-Image: "red" (012 keep_red: Red Thread), "gray" (sketch)
    or None (keep the colours)."""
    theme = theme or {}
    if theme.get("keep_red"):
        return "red"
    return "gray" if theme.get("grayscale") else None


def apply_colour(img, mode):
    if mode == "red":
        return to_red_only(img)
    if mode == "gray":
        return to_gray(img)
    return img


# Red Thread's colour guarantee, in PIL HSV units (hue 0-255 around the circle, 0 = red; saturation and value 0-255).
# Full red within RED_HUE_FULL of pure red, fading out by RED_HUE_EDGE (about 11 and 18 degrees: orange and skin
# tones stay grey); full from SAT_FULL saturation, none below SAT_EDGE (pale pinks and tan skin turn grey); dark
# ink-like reds below VAL_EDGE turn grey.
RED_HUE_FULL, RED_HUE_EDGE = 8, 13
# on the crimson / magenta side a red stays red a little further (a crimson thread); pinks are pale (low saturation)
CRIMSON_FULL, CRIMSON_EDGE = 16, 22
SAT_FULL, SAT_EDGE = 130, 95
VAL_FULL, VAL_EDGE = 70, 40


def _ramp(lo, hi):
    """A 0-255 lookup: 0 at or below lo, 255 at or above hi, linear between."""
    return [0 if x <= lo else 255 if x >= hi else int(round(255.0 * (x - lo) / (hi - lo))) for x in range(256)]


def _hue_lut():
    out = []
    for x in range(256):
        # distance from pure red around the circle, toward orange (x < 128) or toward crimson / magenta
        d, full, edge = (x, RED_HUE_FULL, RED_HUE_EDGE) if x < 128 else (256 - x, CRIMSON_FULL, CRIMSON_EDGE)
        out.append(255 if d <= full else 0 if d >= edge else int(round(255.0 * (edge - d) / (edge - full))))
    return out


def red_mask(img):
    """L mask: 255 where the picture is a strong red, 0 elsewhere, soft in between."""
    h, s, v = img.convert("RGB").convert("HSV").split()
    m = ImageChops.multiply(h.point(_hue_lut()), s.point(_ramp(SAT_EDGE, SAT_FULL)))
    return ImageChops.multiply(m, v.point(_ramp(VAL_EDGE, VAL_FULL)))


def to_red_only(img):
    """Selective desaturation (Red Thread): strongly saturated reds keep their colour, everything else becomes its
    grayscale value. The mask is grown by a pixel and softened so the thread's anti-aliased edge blends into the grey
    instead of leaving a coloured fringe. Always RGB."""
    rgb = img.convert("RGB")
    mask = red_mask(rgb).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    return Image.composite(rgb, to_gray(rgb), mask)
