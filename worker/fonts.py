# The card font catalog on the PC. The list itself lives in ../lib/fonts/catalog.json,
# shared with the website's Settings page, so both always offer the same fonts.
# Files come from github.com/google/fonts (OFL) and are cached in worker/fonts/.
import functools
import json
import os
import urllib.parse
import urllib.request

from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.join(HERE, "fonts")
CATALOG_PATH = os.path.join(HERE, "..", "lib", "fonts", "catalog.json")
RAW_BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

with open(CATALOG_PATH, encoding="utf-8") as _fh:
    _CATALOG = json.load(_fh)
FALLBACK = _CATALOG["fallback"]
_BY_ID = {f["id"]: f for f in _CATALOG["fonts"]}


def ids():
    return [f["id"] for f in _CATALOG["fonts"]]


def resolve(font_id):
    """The catalog entry for an id; anything unknown (or not a string) is Poppins."""
    return _BY_ID.get(font_id) if isinstance(font_id, str) and font_id in _BY_ID else _BY_ID[FALLBACK]


def caps(font_id):
    return bool(resolve(font_id).get("caps", True))


def file_url(folder, filename):
    return RAW_BASE + folder + "/" + urllib.parse.quote(filename)


def _download(url, dest):
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "unique-names-worker"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        f.write(r.read())
    if os.path.getsize(tmp) < 10000:
        os.remove(tmp)
        raise RuntimeError("font download too small: " + url)
    os.replace(tmp, dest)


def _pick_file(entry, weight):
    """(filename, is_variable) for a weight: the variable file, or the closest static weight."""
    if entry.get("var"):
        return entry["var"], True
    files = entry["files"]
    best = min(files, key=lambda w: abs(int(w) - int(weight)))
    return files[best], False


def font_file(font_id, weight):
    """Local path of the file for this font + weight, downloading it once if needed."""
    entry = resolve(font_id)
    name, _var = _pick_file(entry, weight)
    dest = os.path.join(FONTS_DIR, name)
    if not os.path.exists(dest):
        os.makedirs(FONTS_DIR, exist_ok=True)
        _download(file_url(entry["dir"], name), dest)
    return dest


@functools.lru_cache(maxsize=256)
def _load_path(path, weight, size):
    f = ImageFont.truetype(path, int(size))
    try:
        axes = f.get_variation_axes()
    except Exception:  # a static font has no axes
        return f
    values = []
    for a in axes:
        name = a.get("name")
        name = name.decode("utf-8", "replace") if isinstance(name, bytes) else str(name)
        if name.lower() == "weight":
            values.append(max(a["minimum"], min(a["maximum"], int(weight))))
        else:
            values.append(a["default"])
    f.set_variation_by_axes(values)
    return f


def load(font_id, weight, size):
    """A Pillow font for this catalog id at `size` px, with the weight applied."""
    return _load_path(font_file(font_id, weight), int(weight), int(size))


def load_safe(font_id, weight, size, log=print):
    """Like load(), but a font that cannot be fetched (offline, file moved) never fails a
    card: it is logged and the card is stamped in Poppins instead."""
    try:
        return load(font_id, weight, size)
    except Exception as e:
        log("font %r could not be loaded (%s); using %s" % (font_id, e, FALLBACK))
        return load(FALLBACK, weight, size)
