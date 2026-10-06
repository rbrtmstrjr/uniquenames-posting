# Reel visual themes (migration 007): the preview picture each theme gets (one fixed mom-and-baby moment, so
# the themes compare fairly) and the grayscale rule (sketch: Z-Image colours the clothes from the cast text, so
# the worker turns the picture grey afterwards). Wording from docs/reference/reel-themes-motion-spike.md §5:
# positive-only, never "camera"; NO_TEXT is the only "no".
import re

from PIL import ImageOps

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
    """The Z-Image prompt for a theme's preview: the fixed moment, the theme's style block and a simple cast
    (dolls for knitted). The same moment is used for every theme, knitted included: the spike's no-lift rule is
    for script lines (a doll lift there added a second baby), and this one preview moment passed for knitted in
    spike r1, so it is kept as is."""
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
