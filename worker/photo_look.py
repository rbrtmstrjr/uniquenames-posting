# The card photo look (2.7.2): a light Camera Raw-style finish on every NEW card photo (post, closing and preview
# cards), applied once right after Z-Image and before the photo is stored and stamped, so a restamp (which reuses the
# stored photo) never applies it twice. Reels never get it (reels.py does not use this module).
#
#   Vibrance: a non-linear saturation lift around each pixel's own luminance. Muted colours get the most, already
#   strong colours almost nothing, greys/whites/blacks none (no colour cast) and skin tones (warm orange/red hues,
#   moderate saturation) only a fifth, so babies never turn orange. The lift is capped per pixel at the sRGB gamut
#   edge, so hue never shifts from clipping.
#   Texture: medium-frequency detail (knits, wood grain, hair) from a luminance band-pass (difference of Gaussians,
#   sigma 1.2 vs 5 px at 1088 px, scaled with the photo), soft-clamped with tanh so hard edges barely move (no halos)
#   and added equally to R, G and B: chroma untouched, mean brightness kept.
#
# Settings: PHOTO_VIBRANCE / PHOTO_TEXTURE (0-100, defaults 20 / 15; 0 = that part off) in a page's pages/<id>.env,
# else worker.env. Pure numpy, no per-pixel Python loops.
import math

import numpy as np
from PIL import Image

DEFAULTS = (20, 15)
KEYS = ("PHOTO_VIBRANCE", "PHOTO_TEXTURE")

VIB_K = 1.2           # +100 vibrance = up to +120% chroma on a near-grey colour
SKIN_KEEP = 0.2       # a skin tone gets this share of the lift
TEX_K = 2.5           # +100 texture = 2.5x the (clamped) band-pass added back
TEX_CLAMP = 10.0      # soft clamp of the band-pass, in 0-255 levels (hard edges move at most TEX_K*amt*this)
SIGMA_FINE, SIGMA_COARSE = 1.2, 5.0
REF_SIDE = 1088.0


def _ramp(x, a, b):
    """0 at a, 1 at b, linear between (a < b)."""
    return np.clip((x - a) / (b - a), 0.0, 1.0)


def _vibrance(rgb, amount):
    """rgb: float32 HxWx3 in 0..1. amount: vibrance / 100."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    chroma = mx - mn
    s = np.where(mx > 1e-6, chroma / np.maximum(mx, 1e-6), 0.0)
    # hue in degrees, vectorised (0 = red, 30 = orange)
    c = np.maximum(chroma, 1e-6)
    h = np.where(mx == r, ((g - b) / c) % 6.0, np.where(mx == g, (b - r) / c + 2.0, (r - g) / c + 4.0)) * 60.0
    h = np.where(h > 300.0, h - 360.0, h)                         # reds just below 360 count as slightly negative
    skin = (_ramp(h, -15.0, 0.0) * (1.0 - _ramp(h, 45.0, 60.0))
            * _ramp(s, 0.08, 0.15) * (1.0 - _ramp(s, 0.6, 0.8)))
    muted = (1.0 - s) * np.sqrt(1.0 - s)                          # (1 - s)^1.5: the lift falls fast as saturation rises
    gain = 1.0 + amount * VIB_K * muted * (1.0 - (1.0 - SKIN_KEEP) * skin)
    # never push a channel past 0 or 1: the cap is where the first channel would clip (keeps the hue exact)
    d = rgb - lum[..., None]
    with np.errstate(divide="ignore", invalid="ignore"):
        room = np.where(d > 1e-6, (1.0 - lum[..., None]) / d, np.where(d < -1e-6, lum[..., None] / -d, np.inf))
    gain = np.minimum(gain, np.maximum(room.min(axis=-1), 1.0))
    return lum[..., None] + d * gain[..., None]


def _blur_1d(a, sigma, axis):
    radius = max(1, int(math.ceil(3.0 * sigma)))
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2).astype(np.float32)
    k /= k.sum()
    pad = [(0, 0), (0, 0)]
    pad[axis] = (radius, radius)
    p = np.pad(a, pad, mode="reflect")
    n = a.shape[axis]
    out = np.zeros_like(a)
    for i, w in enumerate(k):  # a loop over the kernel taps, each one a whole-image multiply-add
        out += w * (p[:, i:i + n] if axis == 1 else p[i:i + n, :])
    return out


def _blur(a, sigma):
    return _blur_1d(_blur_1d(a, sigma, 1), sigma, 0)


def _texture(rgb255, amount):
    """rgb255: float32 HxWx3 in 0..255. amount: texture / 100. Adds clamped mid-band luminance detail."""
    lum = 0.299 * rgb255[..., 0] + 0.587 * rgb255[..., 1] + 0.114 * rgb255[..., 2]
    scale = min(rgb255.shape[0], rgb255.shape[1]) / REF_SIDE
    s1, s2 = max(0.5, SIGMA_FINE * scale), max(1.5, SIGMA_COARSE * scale)
    band = _blur(lum, s1) - _blur(lum, s2)
    delta = (amount * TEX_K * TEX_CLAMP) * np.tanh(band / TEX_CLAMP)
    return rgb255 + delta[..., None]


def apply_look(img, vibrance=DEFAULTS[0], texture=DEFAULTS[1]):
    """The finished photo (RGB, same size). vibrance / texture 0-100; 0 = that part off; 0/0 = an identical copy."""
    img = img if img.mode == "RGB" else img.convert("RGB")
    if not vibrance and not texture:
        return img.copy()
    a = np.asarray(img, dtype=np.float32)
    if vibrance:
        a = _vibrance(a / 255.0, vibrance / 100.0) * 255.0
    if texture:
        a = _texture(a, texture / 100.0)
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8), "RGB")


def settings(*cfgs, log=None):
    """(vibrance, texture) from the first config that sets each key (a page's env, then worker.env), else the
    defaults. Not a number: the default; outside 0-100: clamped. Any problem is logged in one line."""
    out, problems = [], []
    for key, default in zip(KEYS, DEFAULTS):
        raw = next((str(c[key]).strip() for c in cfgs if c and str(c.get(key) or "").strip()), None)
        if raw is None:
            out.append(default)
            continue
        try:
            v = int(round(float(raw)))
        except ValueError:
            problems.append("%s=%r is not a number, using %d" % (key, raw, default))
            out.append(default)
            continue
        if not 0 <= v <= 100:
            problems.append("%s=%s is outside 0-100, using %d" % (key, raw, min(100, max(0, v))))
        out.append(min(100, max(0, v)))
    if problems and log:
        log("photo look: " + "; ".join(problems))
    return tuple(out)


def describe(look):
    v, t = look
    if not v and not t:
        return "photo look: off"
    return "photo look: vibrance +%d, texture +%d" % (v, t)
