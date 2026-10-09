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
# Tuned on a real Red Thread reel (2026-10-09): the thread's core is hue within ±4 of pure red with saturation >= 200,
# while the leaks were mouths / lips / blush (pinker, less saturated) and brown hair (orange side, low saturation).
# Full red within RED_HUE_FULL of pure red, fading out by RED_HUE_EDGE (about 8 and 14 degrees) on either side; full
# from SAT_FULL saturation, none below SAT_EDGE; dark ink-like reds below VAL_EDGE turn grey.
RED_HUE_FULL, RED_HUE_EDGE = 6, 10
CRIMSON_FULL, CRIMSON_EDGE = 6, 10
SAT_FULL, SAT_EDGE = 185, 150
VAL_FULL, VAL_EDGE = 100, 60
# Shape rule: the thread is long, a crying mouth or a lip is a small separate spot. A red patch survives only if it
# spans at least MIN_SPAN of the picture's width (its bounding-box diagonal) after nearby pieces are joined (a thread
# hidden behind an arm is still one thread); smaller separate spots turn grey.
MIN_SPAN = 0.12
_CELL = 4      # the shape rule runs on a 4×4-pixel grid (fast in pure Python)
_JOIN = 2      # grid cells: pieces this close (≈ 8 px) count as one


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


def thread_only(mask):
    """Keep only the long red patches of an L mask (the thread); small separate spots (a mouth, lips) become 0."""
    w, h = mask.size
    gw, gh = -(-w // _CELL), -(-h // _CELL)
    # any red in a cell marks it; nearby pieces are joined by growing the marks _JOIN cells
    small = mask.point(lambda x: 255 if x >= 64 else 0).resize((gw, gh), Image.Resampling.BOX).point(lambda x: 255 if x else 0)
    grown = small.filter(ImageFilter.MaxFilter(2 * _JOIN + 1)) if _JOIN else small
    on = grown.load()
    seen = bytearray(gw * gh)
    keep = Image.new("L", (gw, gh), 0)
    kp = keep.load()
    need = MIN_SPAN * w
    for y0 in range(gh):
        for x0 in range(gw):
            if not on[x0, y0] or seen[y0 * gw + x0]:
                continue
            seen[y0 * gw + x0] = 1
            stack, cells = [(x0, y0)], []
            x1 = x2 = x0
            y1 = y2 = y0
            while stack:
                x, y = stack.pop()
                cells.append((x, y))
                x1, x2, y1, y2 = min(x1, x), max(x2, x), min(y1, y), max(y2, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < gw and 0 <= ny < gh and on[nx, ny] and not seen[ny * gw + nx]:
                        seen[ny * gw + nx] = 1
                        stack.append((nx, ny))
            if ((x2 - x1 + 1) ** 2 + (y2 - y1 + 1) ** 2) ** 0.5 * _CELL >= need:
                for c in cells:
                    kp[c] = 255
    keep = keep.resize((gw * _CELL, gh * _CELL), Image.Resampling.NEAREST).crop((0, 0, w, h))
    return ImageChops.multiply(mask, keep)


def to_red_only(img):
    """Selective desaturation (Red Thread): the thread's strong, pure red keeps its colour, everything else becomes its
    grayscale value, including small separate red spots (a crying mouth, lips). The mask is grown by a pixel and
    softened so the thread's anti-aliased edge blends into the grey instead of leaving a coloured fringe. Always RGB."""
    rgb = img.convert("RGB")
    mask = thread_only(red_mask(rgb)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    return Image.composite(rgb, to_gray(rgb), mask)
