# Unique Names card rendering: ComfyUI makes a TEXT-FREE photo, Pillow stamps
# the exact name, meaning and handle. Pure helpers + ComfyRenderer. No HTTP server.
import datetime
import hmac
import io
import json
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

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.join(HERE, "fonts")
FONT_URLS = {
    "Poppins-SemiBold.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-SemiBold.ttf",
    "Poppins-Regular.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf",
}

NAME_MAX = 40
MEANING_MAX = 80
PROMPT_MAX = 4000
INDEX_MAX = 30
SIZE_MIN, SIZE_MAX = 512, 2048
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z \-]{0,23}$")
# Letters (any language), spaces, hyphens, apostrophes and periods only.
NAME_RE = re.compile(r"^[^\W\d_]+(?:[ '\-.][^\W\d_]+)*$", re.UNICODE)

# Text bands as fractions of the image height: (top, bottom).
BANDS = {"top": (0.07, 0.33), "middle": (0.37, 0.63), "bottom": (0.64, 0.88)}
# The sample posts put the name at the top most of the time, so top wins ties.
BAND_BIAS = {"top": 0.80, "middle": 1.0, "bottom": 0.95}


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


def comfy_graph(prompt, seed, width, height, prefix):
    # Z-Image Turbo, the same graph as the "Text to Image (Z-Image-Turbo)" template.
    # The latent must be a multiple of 16; the card is resized to the exact size later.
    lw, lh = max(16, width // 16 * 16), max(16, height // 16 * 16)
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"}},
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


def _font(path, size):
    return ImageFont.truetype(path, size)


def fit_font(path, text, start, max_width, min_size=24):
    size = start
    while size > min_size:
        f = _font(path, size)
        if f.getbbox(text)[2] - f.getbbox(text)[0] <= max_width:
            return f
        size -= 2
    return _font(path, min_size)


def _text_w(font, text):
    b = font.getbbox(text)
    return b[2] - b[0]


def compose_card(photo, name, meaning, handle, fonts, band=None):
    """Stamp NAME / meaning / handle on the photo. Returns (image, band, scores)."""
    img = photo.convert("RGB")
    W, H = img.size
    scores = {}
    if band is None:
        band, scores = pick_band(img)
    title = name.upper()
    name_font = fit_font(fonts["semibold"], title, int(W * 0.088), int(W * 0.84))
    mean_font = fit_font(fonts["regular"], meaning, int(W * 0.034), int(W * 0.80))
    mark_font = _font(fonts["regular"], max(14, int(W * 0.019)))

    nb = name_font.getbbox(title)
    mb = mean_font.getbbox(meaning)
    name_h, mean_h = nb[3] - nb[1], mb[3] - mb[1]
    gap = int(W * 0.024)
    block_h = name_h + gap + mean_h
    a, b = BANDS[band]
    top = int(H * a + (H * (b - a) - block_h) / 2)
    name_xy = ((W - _text_w(name_font, title)) / 2 - nb[0], top - nb[1])
    mean_xy = ((W - _text_w(mean_font, meaning)) / 2 - mb[0], top + name_h + gap - mb[1])
    mark_xy = (W - _text_w(mark_font, handle) - int(W * 0.035), H - int(H * 0.045) - mark_font.getbbox(handle)[3])

    # White text with a soft dark shadow on darker backdrops; warm dark-brown text with a
    # soft light glow on bright ones (pale mint, cream, ivory), where white would wash out.
    block = (int(W * 0.08), max(0, top - gap), int(W * 0.92), min(H, top + block_h + gap))
    mark_box = (int(mark_xy[0]) - 4, int(mark_xy[1]) - 4, W, H)
    title_ink, title_halo = text_colors(img, block)
    mark_ink, mark_halo = text_colors(img, mark_box)

    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(halo)
    off = max(2, W // 400)
    sd.text((name_xy[0], name_xy[1] + off), title, font=name_font, fill=title_halo)
    sd.text((mean_xy[0], mean_xy[1] + off), meaning, font=mean_font, fill=title_halo)
    sd.text((mark_xy[0], mark_xy[1] + 1), handle, font=mark_font, fill=mark_halo)
    out = Image.alpha_composite(img.convert("RGBA"), halo.filter(ImageFilter.GaussianBlur(max(3, W // 220))))
    d = ImageDraw.Draw(out)
    d.text(name_xy, title, font=name_font, fill=title_ink + (255,))
    d.text(mean_xy, meaning, font=mean_font, fill=title_ink + (240,))
    d.text(mark_xy, handle, font=mark_font, fill=mark_ink + (200,))
    return out.convert("RGB"), band, scores


LIGHT_BACKDROP = 175  # mean luminance (0-255) above which white text stops reading well
DARK_INK = (59, 42, 32)  # the brand's warm dark brown


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

def ensure_fonts():
    os.makedirs(FONTS_DIR, exist_ok=True)
    paths = {}
    for name, url in FONT_URLS.items():
        dest = os.path.join(FONTS_DIR, name)
        if not os.path.exists(dest):
            tmp = dest + ".part"
            req = urllib.request.Request(url, headers={"User-Agent": "unique-names-worker"})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                f.write(r.read())
            if os.path.getsize(tmp) < 10000:
                os.remove(tmp)
                raise RuntimeError("font download too small: " + url)
            os.replace(tmp, dest)
        paths[name] = dest
    return {"semibold": paths["Poppins-SemiBold.ttf"], "regular": paths["Poppins-Regular.ttf"]}


def http_json(url, body=None, timeout=30):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class JobError(Exception):
    """A failure whose message is written for the owner and shown on the card."""


class ComfyRenderer:
    def __init__(self, comfy_url, timeout, fonts):
        self.comfy = comfy_url.rstrip("/")
        self.timeout = int(timeout)
        self.fonts = fonts

    def health(self):
        try:
            stats = http_json(self.comfy + "/system_stats", timeout=5)
            dev = (stats.get("devices") or [{}])[0]
            return {"ok": True, "gpu": dev.get("name"), "error": None}
        except Exception:
            return {"ok": False, "gpu": None, "error": "ComfyUI is not reachable at %s" % self.comfy}

    def generate_photo(self, prompt, seed, width, height):
        graph = comfy_graph(prompt, seed, width, height, "unique-names/raw")
        try:
            sub = http_json(self.comfy + "/prompt", {"prompt": graph, "client_id": "unique-names-worker"}, timeout=30)
        except urllib.error.HTTPError as e:
            raise JobError("ComfyUI refused the job: %s" % e.read().decode("utf-8", "replace")[:300])
        except Exception:
            raise JobError("ComfyUI is closed. Open ComfyUI Desktop on your PC, then press Retry.")
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

    def compose(self, photo, name, meaning, handle):
        img, _band, _scores = compose_card(photo, name, meaning, handle, self.fonts)
        return img
