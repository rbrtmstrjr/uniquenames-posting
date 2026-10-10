# Unique Names card rendering: ComfyUI makes a TEXT-FREE photo, Pillow stamps
# the exact name, meaning and handle. Pure helpers + ComfyRenderer. No HTTP server.
import collections
import datetime
import hmac
import io
import itertools
import json
import math
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

import fonts

HERE = os.path.dirname(os.path.abspath(__file__))

NAME_MAX = 40
MEANING_MAX = 80
PROMPT_MAX = 4000
INDEX_MAX = 30
SIZE_MIN, SIZE_MAX = 512, 2048
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z \-]{0,23}$")
# Letters (any language), spaces, hyphens, apostrophes and periods only.
NAME_RE = re.compile(r"^[^\W\d_]+(?:[ '\-.][^\W\d_]+)*$", re.UNICODE)

# Text layout rules shared with the website's Settings preview (lib/text/layout.ts reads the same file).
with open(os.path.join(HERE, "..", "lib", "text", "layout.json"), encoding="utf-8") as _fh:
    LAYOUT = json.load(_fh)
# Auto position: text bands as fractions of the image height: (top, bottom).
BANDS = {k: tuple(v) for k, v in LAYOUT["autoBands"].items()}
# The sample posts put the name at the top most of the time, so top wins ties.
BAND_BIAS = LAYOUT["autoBandBias"]

# The card text settings (settings row; the columns arrive with migration 002).
TextStyle = collections.namedtuple("TextStyle", "title_font meaning_font mark_font title_size meaning_size mark_size position")
TEXT_DEFAULTS = {
    "title_font": fonts.FALLBACK, "meaning_font": fonts.FALLBACK, "mark_font": fonts.FALLBACK,
    "title_size": LAYOUT["sizes"]["title"]["default"], "meaning_size": LAYOUT["sizes"]["meaning"]["default"],
    "mark_size": LAYOUT["sizes"]["mark"]["default"], "text_position": "auto",
}


class CardError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------- config

def load_env(path):
    cfg = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
                if m and not line.lstrip().startswith("#"):
                    cfg[m.group(1)] = m.group(2)
    return cfg


def default_output_root():
    # The owner's Pictures folder lives in OneDrive, so cards also sync to the phone.
    for p in (os.path.join(os.path.expanduser("~"), "OneDrive", "Pictures"),
              os.path.join(os.path.expanduser("~"), "Pictures")):
        if os.path.isdir(p):
            return os.path.join(p, "Unique Names")
    return os.path.join(os.path.expanduser("~"), "Unique Names")


# ---------------------------------------------------------------- pure helpers

def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return s or "card"


def card_filename(index, name):
    return "%02d-%s.jpg" % (int(index), slugify(name))


def folder_name(date, label):
    """'2026-10-05' or '2026-10-05 Boy': a label keeps a boy and a girl post apart on the same day."""
    label = " ".join(str(label or "").split())
    if not label:
        return date
    if not LABEL_RE.match(label):
        raise CardError(400, "label must be 1 to 24 letters, spaces or hyphens")
    return date + " " + label


def validate_card(body):
    if not isinstance(body, dict):
        raise CardError(400, "body must be a JSON object")
    out = {}
    date = str(body.get("date", "")).strip()
    if not DATE_RE.match(date):
        raise CardError(400, "date must be YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        raise CardError(400, "date is not a real calendar date")
    out["date"] = date
    out["folder"] = folder_name(date, body.get("label"))
    try:
        index = int(body.get("index"))
    except (TypeError, ValueError):
        raise CardError(400, "index must be a whole number")
    if not 1 <= index <= INDEX_MAX:
        raise CardError(400, "index must be 1 to %d" % INDEX_MAX)
    out["index"] = index
    name = " ".join(str(body.get("name", "")).split())
    if not name or len(name) > NAME_MAX or not NAME_RE.match(name):
        raise CardError(400, "name must be 1 to %d letters (spaces, hyphens and apostrophes allowed): %r"
                        % (NAME_MAX, name))
    out["name"] = name
    meaning = " ".join(str(body.get("meaning", "")).split())
    if not meaning or len(meaning) > MEANING_MAX:
        raise CardError(400, "meaning must be 1 to %d characters" % MEANING_MAX)
    out["meaning"] = meaning
    prompt = str(body.get("prompt", "")).strip()
    if not prompt or len(prompt) > PROMPT_MAX:
        raise CardError(400, "prompt must be 1 to %d characters" % PROMPT_MAX)
    out["prompt"] = prompt
    for k in ("width", "height"):
        try:
            v = int(body.get(k, 1080))
        except (TypeError, ValueError):
            raise CardError(400, "%s must be a whole number" % k)
        if not SIZE_MIN <= v <= SIZE_MAX:
            raise CardError(400, "%s must be %d to %d" % (k, SIZE_MIN, SIZE_MAX))
        out[k] = v
    seed = body.get("seed")
    out["seed"] = int(seed) if isinstance(seed, (int, float)) or (isinstance(seed, str) and seed.isdigit()) \
        else random.randint(1, 2 ** 48)
    out["handle"] = str(body.get("handle") or "@unique_names")[:40]
    out["force"] = bool(body.get("force"))
    return out


# Setup B (2026-10-10 A/B, .superpowers/sdd/2026-10-10-fast-images): the fp8 text encoder + fp8 weights look the
# same as the bf16 files and are 15-30% faster. A ComfyUI without the fp8 encoder file gets the old files (SAFE_*).
FAST_CLIP, FAST_DTYPE = "qwen_3_4b_fp8_mixed.safetensors", "fp8_e4m3fn"
SAFE_CLIP, SAFE_DTYPE = "qwen_3_4b.safetensors", "default"


def comfy_graph(prompt, seed, width, height, prefix, fast=True):
    # Z-Image Turbo, the same graph as the "Text to Image (Z-Image-Turbo)" template.
    # The latent must be a multiple of 16; the card is resized to the exact size later.
    lw, lh = max(16, width // 16 * 16), max(16, height // 16 * 16)
    clip, dtype = (FAST_CLIP, FAST_DTYPE) if fast else (SAFE_CLIP, SAFE_DTYPE)
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": dtype}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip, "type": "lumina2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": lw, "height": lh, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
                                                   "latent_image": ["7", 0], "seed": int(seed), "steps": 8, "cfg": 1,
                                                   "sampler_name": "res_multistep", "scheduler": "simple", "denoise": 1}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": prefix}},
    }


def band_busyness(img):
    """Mean edge strength per text band: lower = calmer = better for text."""
    g = img.convert("L").resize((270, 270)).filter(ImageFilter.FIND_EDGES)
    W, H = g.size
    scores = {}
    for band, (a, b) in BANDS.items():
        crop = g.crop((int(W * 0.08), int(H * a), int(W * 0.92), int(H * b)))
        scores[band] = ImageStat.Stat(crop).mean[0]
    return scores


def pick_band(img):
    scores = band_busyness(img)
    return min(scores, key=lambda k: scores[k] * BAND_BIAS[k]), scores


def _px(v):
    """Round half up, like the website's Math.round, so both sides pick the same size."""
    return int(math.floor(v + 0.5))


def text_style(settings):
    """A clean TextStyle from a settings row. Missing or bad values get the defaults:
    the row has none of these columns until migration 002 runs."""
    s = settings or {}

    def font(k):
        v = s.get(k)
        return fonts.resolve(v)["id"] if v is not None else TEXT_DEFAULTS[k]

    def size(k, key):
        rng = LAYOUT["sizes"][key]
        v = s.get(k)
        if isinstance(v, bool):
            return rng["default"]
        try:
            v = int(v)
        except (TypeError, ValueError):
            return rng["default"]
        return max(rng["min"], min(rng["max"], v))

    pos = s.get("text_position")
    return TextStyle(font("title_font"), font("meaning_font"), font("mark_font"),
                     size("title_size", "title"), size("meaning_size", "meaning"), size("mark_size", "mark"),
                     pos if pos in LAYOUT["positions"] else "auto")


def _text_w(font, text):
    b = font.getbbox(text)
    return b[2] - b[0]


def _largest(fits, lo, hi):
    """The largest whole size in [lo, hi] for which fits(size) is true (text width grows
    with size, so a binary search is enough), or None if even `lo` does not fit."""
    lo, hi = int(lo), int(hi)
    if hi < lo or not fits(lo):
        return None
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo


def fit_title(font_id, text, px, max_w, log=print):
    """The name never wraps: it shrinks until it fits max_w."""
    load = lambda s: fonts.load_safe(font_id, LAYOUT["titleWeight"], s, log)
    size = _largest(lambda s: _text_w(load(s), text) <= max_w, LAYOUT["minPx"], _px(px))
    return load(size or LAYOUT["minPx"])


def balanced_lines(font, words, n):
    """`words` split into n lines whose widest line is as narrow as possible."""
    if n <= 1:
        return [" ".join(words)]
    widths = {}

    def width(i, j):  # each run of words is measured once
        if (i, j) not in widths:
            widths[(i, j)] = _text_w(font, " ".join(words[i:j]))
        return widths[(i, j)]

    best = None
    for cuts in itertools.combinations(range(1, len(words)), n - 1):
        bounds = (0,) + cuts + (len(words),)
        widest = max(width(bounds[i], bounds[i + 1]) for i in range(n))
        if best is None or widest < best[0]:
            best = (widest, bounds)
    b = best[1]
    return [" ".join(words[b[i]:b[i + 1]]) for i in range(n)]


def fit_meaning(font_id, text, px, max_w, log=print):
    """(font, lines): one line, shrinking to meaningShrinkFirst of the size; then 2, then up
    to meaningMaxLines balanced lines in that size range; then smaller on the most lines."""
    load = lambda s: fonts.load_safe(font_id, LAYOUT["bodyWeight"], s, log)
    words = text.split()
    start = _px(px)
    floor = max(LAYOUT["minPx"], _px(px * LAYOUT["meaningShrinkFirst"]))
    most = max(1, min(LAYOUT["meaningMaxLines"], len(words)))

    def fits(n):
        return lambda s: max(_text_w(load(s), ln) for ln in balanced_lines(load(s), words, n)) <= max_w

    for n in range(1, most + 1):
        size = _largest(fits(n), floor, start)
        if size:
            return load(size), balanced_lines(load(size), words, n)
    size = _largest(fits(most), LAYOUT["minPx"], floor - 1) or LAYOUT["minPx"]
    return load(size), balanced_lines(load(size), words, most)


def _mark_and_room(W, H, handle, style, mark_left, log=print):
    """The watermark ({text, font, xy, box}) and the vertical room (lo, bottom) a text block may use."""
    k = W / LAYOUT["baseWidth"]
    mk = fonts.load_safe(style.mark_font, LAYOUT["bodyWeight"], max(1, _px(style.mark_size * k)), log)
    mb = mk.getbbox(handle)
    # The watermark sits bottom-right, out of the text's way; bottom-right text pushes it left.
    mx = W * LAYOUT["markInsetX"] - mb[0] if mark_left else W - W * LAYOUT["markInsetX"] - mb[2]
    my = H - H * LAYOUT["markInsetBottom"] - mb[3]
    mark = {"text": handle, "font": mk, "xy": (mx, my), "box": (mx + mb[0], my + mb[1], mx + mb[2], my + mb[3])}

    # The text block lives between the top padding and the bottom padding, and never reaches
    # the watermark row (on a short, wide card 10% of the height is less than a big watermark).
    lo = H * LAYOUT["padTop"]
    bottom = min(H - H * LAYOUT["padBottom"], mark["box"][1] - W * LAYOUT["gap"] / 2)
    return mark, lo, bottom


def layout_text(size, name, meaning, handle, style, band="top", log=print):
    """Where every line goes. Pure geometry (no drawing): {title, meaning: [{text, font, xy,
    box}], mark: {...}, block: ink box of title + meaning, band}. `xy` is the draw origin
    (Pillow's default "la" anchor), `box` the ink box on the image. `band` is only used
    for the auto position."""
    W, H = size
    k = W / LAYOUT["baseWidth"]
    pos = style.position if style.position in LAYOUT["positions"] else "auto"
    vert, horiz = ("auto", "center") if pos == "auto" else pos.split("-")
    max_w = W * (LAYOUT["maxWidthCenter"] if horiz == "center" else LAYOUT["maxWidthSide"])
    left, right = W * LAYOUT["padX"], W - W * LAYOUT["padX"]

    def x_for(bb):
        if horiz == "left":
            return left - bb[0]
        if horiz == "right":
            return right - bb[2]
        return W / 2 - (bb[0] + bb[2]) / 2

    mark, lo, bottom = _mark_and_room(W, H, handle, style, pos == "bottom-right", log)

    title = name.upper() if fonts.caps(style.title_font) else name
    scale = 1.0
    while True:
        # A block taller than the space shrinks (title and meaning together) instead of overflowing.
        tf = fit_title(style.title_font, title, style.title_size * k * scale, max_w, log)
        mf, lines = fit_meaning(style.meaning_font, meaning, style.meaning_size * k * scale, max_w, log)
        parts = []
        tb = tf.getbbox(title)
        parts.append({"text": title, "font": tf, "y": 0, "bb": tb})
        first = mf.getbbox(lines[0])
        pitch = mf.size * (1 + LAYOUT["lineGap"])
        for i, ln in enumerate(lines):
            parts.append({"text": ln, "font": mf, "y": tb[3] + W * LAYOUT["gap"] * scale - first[1] + i * pitch, "bb": mf.getbbox(ln)})
        top = min(p["y"] + p["bb"][1] for p in parts)
        height = max(p["y"] + p["bb"][3] for p in parts) - top
        if height <= bottom - lo or scale < 0.15:
            break
        scale *= 0.9

    hi = bottom - height
    if vert == "top":
        y = lo
    elif vert == "middle":
        y = (H - height) / 2
    elif vert == "bottom":
        y = hi
    else:
        a, b = BANDS.get(band, BANDS["top"])
        y = H * a + (H * (b - a) - height) / 2
    y = max(lo, min(hi, y))
    dy = y - top

    out = []
    for p in parts:
        bb = p["bb"]
        x, py = x_for(bb), p["y"] + dy
        out.append({"text": p["text"], "font": p["font"], "xy": (x, py), "box": (x + bb[0], py + bb[1], x + bb[2], py + bb[3])})

    boxes = [p["box"] for p in out]
    block = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return {"title": out[:1], "meaning": out[1:], "mark": mark, "block": block, "band": band if pos == "auto" else pos}


def compose_card(photo, name, meaning, handle, style=None, band=None, log=print):
    """Stamp the name / meaning / handle on the photo with the owner's text settings.
    Returns (image, band or fixed position, band scores)."""
    img = photo.convert("RGB")
    style = style or text_style({})
    scores = {}
    if style.position == "auto" and band is None:
        band, scores = pick_band(img)
    lay = layout_text(img.size, name, meaning, handle, style, band or "top", log)
    out = _stamp(img, [(p, 255) for p in lay["title"]] + [(p, 240) for p in lay["meaning"]], lay["block"], lay["mark"])
    return out, lay["band"], scores


def _stamp(img, parts, bx, m):
    """Draw text parts [(part, alpha)] whose ink box is `bx`, and the watermark `m`, on the RGB photo."""
    W, H = img.size
    # White text with a soft dark shadow on darker backdrops; warm dark-brown text with a
    # soft light glow on bright ones (pale mint, cream, ivory), where white would wash out.
    pad = W * LAYOUT["gap"]
    block = (max(0, int(bx[0] - pad)), max(0, int(bx[1] - pad)), min(W, int(bx[2] + pad)), min(H, int(bx[3] + pad)))
    mbx = m["box"]
    mark_box = (max(0, int(mbx[0]) - 4), max(0, int(mbx[1]) - 4), min(W, int(mbx[2]) + 4), min(H, int(mbx[3]) + 4))
    title_ink, title_halo = text_colors(img, block)
    mark_ink, mark_halo = text_colors(img, mark_box)

    lines = [(p, title_ink, a, title_halo) for p, a in parts]
    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(halo)
    off = max(2, W // 400)
    for p, _ink, _a, h in lines:
        sd.text((p["xy"][0], p["xy"][1] + off), p["text"], font=p["font"], fill=h)
    sd.text((m["xy"][0], m["xy"][1] + 1), m["text"], font=m["font"], fill=mark_halo)
    out = Image.alpha_composite(img.convert("RGBA"), halo.filter(ImageFilter.GaussianBlur(max(3, W // 220))))
    d = ImageDraw.Draw(out)
    for p, ink, a, _h in lines:
        d.text(p["xy"], p["text"], font=p["font"], fill=ink + (a,))
    d.text(m["xy"], m["text"], font=m["font"], fill=mark_ink + (200,))
    return out.convert("RGB")


# ---------------------------------------------------------------- closing card (migration 010)
CTA_MAX_LINES = 3
# Auto position: the message block is centred at this fraction of the height, the upper-middle
# calm area the closing card's prompt leaves open (the child and props sit in the lower half).
CTA_CENTER_Y = 0.30


def cta_lines(message):
    """The closing card's lines: the message split at "/" (empty pieces dropped). More than
    CTA_MAX_LINES pieces (an older or hand-made row) join onto the last line."""
    parts = [" ".join(p.split()) for p in str(message or "").split("/")]
    parts = [p for p in parts if p]
    if len(parts) > CTA_MAX_LINES:
        parts = parts[:CTA_MAX_LINES - 1] + [" ".join(parts[CTA_MAX_LINES - 1:])]
    return parts


def fit_cta(font_id, lines, px, max_w, log=print):
    """(font, lines) for the message at about `px`: the owner's lines ("/") shrink together until
    the widest fits max_w; a message without "/" may first wrap onto up to CTA_MAX_LINES balanced
    lines (shrinking at most to meaningShrinkFirst of the size on each count), then shrinks."""
    load = lambda s: fonts.load_safe(font_id, LAYOUT["bodyWeight"], s, log)
    start = _px(px)
    widest = lambda f, lns: max(_text_w(f, ln) for ln in lns)
    if len(lines) == 1:
        words = lines[0].split()
        floor = max(LAYOUT["minPx"], _px(px * LAYOUT["meaningShrinkFirst"]))
        most = max(1, min(CTA_MAX_LINES, len(words)))
        for n in range(1, most + 1):
            size = _largest(lambda s: widest(load(s), balanced_lines(load(s), words, n)) <= max_w, floor, start)
            if size:
                return load(size), balanced_lines(load(size), words, n)
        size = _largest(lambda s: widest(load(s), balanced_lines(load(s), words, most)) <= max_w, LAYOUT["minPx"], floor - 1)
        size = size or LAYOUT["minPx"]
        return load(size), balanced_lines(load(size), words, most)
    size = _largest(lambda s: widest(load(s), lines) <= max_w, LAYOUT["minPx"], start) or LAYOUT["minPx"]
    return load(size), lines


def layout_cta(size, message, handle, style, log=print):
    """Where the closing card's message goes: centred lines in the meaning font at about the title
    size, no meaning line, the usual watermark. The text position setting picks the height (auto =
    the upper-middle calm area); the message is always centred across. {lines: [part], mark, block, band}."""
    W, H = size
    k = W / LAYOUT["baseWidth"]
    pos = style.position if style.position in LAYOUT["positions"] else "auto"
    vert = "auto" if pos == "auto" else pos.split("-")[0]
    max_w = W * LAYOUT["maxWidthCenter"]
    mark, lo, bottom = _mark_and_room(W, H, handle, style, False, log)
    lines = cta_lines(message) or [""]

    scale = 1.0
    while True:
        font, rows = fit_cta(style.meaning_font, lines, style.title_size * k * scale, max_w, log)
        pitch = font.size * (1 + LAYOUT["lineGap"])
        parts = [{"text": ln, "font": font, "y": i * pitch, "bb": font.getbbox(ln)} for i, ln in enumerate(rows)]
        top = min(p["y"] + p["bb"][1] for p in parts)
        height = max(p["y"] + p["bb"][3] for p in parts) - top
        if height <= bottom - lo or scale < 0.15:
            break
        scale *= 0.9

    hi = bottom - height
    if vert == "top":
        y = lo
    elif vert == "middle":
        y = (H - height) / 2
    elif vert == "bottom":
        y = hi
    else:
        y = H * CTA_CENTER_Y - height / 2
    y = max(lo, min(hi, y))
    dy = y - top

    out = []
    for p in parts:
        bb = p["bb"]
        x, py = W / 2 - (bb[0] + bb[2]) / 2, p["y"] + dy
        out.append({"text": p["text"], "font": p["font"], "xy": (x, py), "box": (x + bb[0], py + bb[1], x + bb[2], py + bb[3])})
    boxes = [p["box"] for p in out]
    block = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return {"lines": out, "mark": mark, "block": block, "band": "cta" if pos == "auto" else pos}


def compose_cta(photo, message, handle, style=None, log=print):
    """Stamp the closing card: the message lines and the watermark, no meaning."""
    img = photo.convert("RGB")
    style = style or text_style({})
    lay = layout_cta(img.size, message, handle, style, log)
    return _stamp(img, [(p, 255) for p in lay["lines"]], lay["block"], lay["mark"])


LIGHT_BACKDROP = LAYOUT["lightBackdrop"]  # mean luminance (0-255) above which white text stops reading well
DARK_INK = tuple(LAYOUT["darkInk"])  # the brand's warm dark brown


def text_colors(img, box):
    """(ink RGB, halo RGBA) for text placed over `box` of the photo."""
    lum = ImageStat.Stat(img.convert("L").crop(box)).mean[0]
    if lum > LIGHT_BACKDROP:
        return DARK_INK, (255, 255, 255, 110)
    return (255, 255, 255), (0, 0, 0, 120)


def fit_to_size(img, width, height):
    """Center-crop and resize the generated photo to exactly width x height."""
    if img.size == (width, height):
        return img
    src_w, src_h = img.size
    scale = max(width / src_w, height / src_h)
    img = img.resize((max(width, round(src_w * scale)), max(height, round(src_h * scale))), Image.LANCZOS)
    left, top = (img.size[0] - width) // 2, (img.size[1] - height) // 2
    return img.crop((left, top, left + width, top + height))


# ---------------------------------------------------------------- side effects

def ensure_fonts(log=print):
    """At startup: fetch the fallback font (Poppins, required: a card can always be stamped),
    then prefetch the rest of the catalog best effort (short timeout, failures only logged;
    a font still missing downloads on first use or falls back to Poppins)."""
    files = {"semibold": fonts.font_file(fonts.FALLBACK, LAYOUT["titleWeight"]),
             "regular": fonts.font_file(fonts.FALLBACK, LAYOUT["bodyWeight"])}
    fonts.prefetch(timeout=15, log=log)
    return files


def ensure_fonts_in_background(renderer, log=print):
    """Run ensure_fonts() on a daemon thread so startup (heartbeat + claim loop) never waits
    on GitHub. Until it finishes, a card loads its font on demand or falls back to Poppins."""
    def run():
        try:
            renderer.font_files = ensure_fonts(log=log)
        except Exception as e:  # offline: cards fetch on demand later
            log("font download at startup failed: %s" % e)
    t = threading.Thread(target=run, name="font-prefetch", daemon=True)
    t.start()
    return t


def http_json(url, body=None, timeout=30):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class JobError(Exception):
    """A failure whose message is written for the owner and shown on the card."""


class ComfyRenderer:
    def __init__(self, comfy_url, timeout, font_files=None, log=print):
        self.comfy = comfy_url.rstrip("/")
        self.timeout = int(timeout)
        self.font_files = font_files  # the prefetched fallback; other fonts load per card
        self.log = log
        self.fast = None  # fp8 text encoder available? None = not asked yet (asked once per worker start)

    def health(self):
        try:
            stats = http_json(self.comfy + "/system_stats", timeout=5)
            dev = (stats.get("devices") or [{}])[0]
            return {"ok": True, "gpu": dev.get("name"), "error": None}
        except Exception:
            return {"ok": False, "gpu": None, "error": "ComfyUI is not reachable at %s" % self.comfy}

    def use_fast(self):
        """True if ComfyUI lists the fp8 text encoder (asked once and remembered). ComfyUI not answering:
        True for now and asked again next time (a refusal still falls back in generate_photo)."""
        if self.fast is None:
            try:
                info = http_json(self.comfy + "/object_info/CLIPLoader", timeout=15)
                names = info["CLIPLoader"]["input"]["required"]["clip_name"][0]
            except Exception:
                return True
            self.fast = FAST_CLIP in names
            if not self.fast:
                self.log("%s is not in ComfyUI: pictures use %s (slower)" % (FAST_CLIP, SAFE_CLIP))
        return self.fast

    def _submit(self, graph):
        try:
            return http_json(self.comfy + "/prompt", {"prompt": graph, "client_id": "unique-names-worker"}, timeout=30)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            err = JobError("ComfyUI refused the job: %s" % body[:300])
            err.detail = body  # the whole answer: 'Value not in list' can sit past the first 300 characters
            raise err
        except Exception:
            raise JobError("ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry.")

    def generate_photo(self, prompt, seed, width, height):
        fast = self.use_fast()
        try:
            sub = self._submit(comfy_graph(prompt, seed, width, height, "unique-names/raw", fast=fast))
        except JobError as e:
            # the fp8 encoder file went missing since the check: remember, and send the old files once
            if not (fast and "not in list" in getattr(e, "detail", "").lower()):
                raise
            self.fast = False
            self.log("ComfyUI refused %s: pictures use %s from now on" % (FAST_CLIP, SAFE_CLIP))
            sub = self._submit(comfy_graph(prompt, seed, width, height, "unique-names/raw", fast=False))
        pid = sub.get("prompt_id")
        if not pid:
            raise JobError("ComfyUI did not accept the job: %s" % json.dumps(sub)[:300])
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            time.sleep(1.5)
            try:
                entry = http_json(self.comfy + "/history/" + pid, timeout=15).get(pid)
            except Exception:
                raise JobError("ComfyUI stopped answering while making the picture. Is it still open?")
            if not entry:
                continue
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise JobError("ComfyUI failed while making the picture: %s" % json.dumps(status.get("messages"))[:300])
            if status.get("completed"):
                imgs = (entry.get("outputs", {}).get("10", {}) or {}).get("images") or []
                if not imgs:
                    raise JobError("ComfyUI finished without a picture.")
                im = imgs[0]
                q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                with urllib.request.urlopen(self.comfy + "/view?" + q, timeout=60) as r:
                    data = r.read()
                return fit_to_size(Image.open(io.BytesIO(data)).convert("RGB"), width, height)
        raise JobError("ComfyUI did not finish within %d seconds." % self.timeout)

    def compose(self, photo, name, meaning, handle, style=None):
        img, _band, _scores = compose_card(photo, name, meaning, handle, style, log=self.log)
        return img

    def compose_cta(self, photo, message, handle, style=None):
        return compose_cta(photo, message, handle, style, log=self.log)
