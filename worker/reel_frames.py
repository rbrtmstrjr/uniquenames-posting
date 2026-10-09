# The reel's pictures, frame by frame (playbook v2, docs/superpowers/plans/2026-10-07-reels-playbook.md Task 2).
# Every frame is cut out of a 2x (2160x3840) copy of its scene picture with a SUB-PIXEL box (Pillow resize with a
# float box), so slow zooms glide instead of stepping a whole pixel at a time the way ffmpeg's zoompan does
# (measured in the playbook plan's Task 2: ~20x less frame-to-frame jerk than 4x zoompan). Moves: push_in / pull_out / hold only (no pans or tilts),
# eased with smoothstep, alternating; a punch-in is an instant +15% jump on the scene's stressed word, held to the
# end of the shot (plus automatic reframes: 2-3 visual changes in line 1, and a split of any shot over 3.5 s);
# hard cuts, with a 0.4 s dissolve only into a time_jump scene. The hook card and the word
# captions are drawn here too (Pillow, Montserrat ExtraBold), inside the platform safe zone.
import collections
import concurrent.futures
import os
import re

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FPS = 30
WIDTH, HEIGHT = 1080, 1920
SRC_SCALE = 2                      # pictures are cut from a 2160x3840 copy (sharper sub-pixel sampling)
FOCUS = (0.5, 0.45)                # zooms aim a little above the middle (faces sit in the upper half)
MOVES = ("push_in", "pull_out", "hold")
ZOOM_RATE = 0.03                   # zoom travel per second of shot ...
ZOOM_MIN, ZOOM_MAX = 0.04, 0.10    # ... kept to 1.04-1.10 per shot
PAYOFF_MAX = 0.15                  # the last (payoff) shot may travel up to 1.15
PUNCH = 0.15                       # a punch-in: instant +15% (playbook 12-18%)
MAX_PUNCHES = 4
PUNCH_LEAD_S = 0.30                # no punch in a shot's first 0.3 s (the cut is the accent there) ...
PUNCH_TAIL_S = 0.35                # ... nor in its last 0.35 s (it would only flash)
# Automatic reframes (instant scale jumps that are not script punch-ins and don't count toward MAX_PUNCHES):
OPEN_REFRAME = 0.12                # line 1: 2-3 visual changes in the first 3 s ...
OPEN_WINDOWS = ((0.8, 1.6, 1.2), (2.0, 2.8, 2.4))   # ... on the longest word in each window (else its fallback
OPEN_SECOND_AFTER_S = 3.0          #     time); the second only when line 1 lasts over 3 s
LONG_SHOT_S = 3.5                  # a longer shot without a punch-in is split by a reframe at its middle ...
LONG_REFRAME = 0.10
SNAP_S = 0.4                       # ... snapped to a word start this close to the middle
REFRAME_GAP_S = 0.5                # never this close to another jump
DISSOLVE_S = 0.4                   # only into a time_jump scene
THREADS = max(1, min(6, (os.cpu_count() or 2) - 2))
LOOKAHEAD = 12                     # frames in flight

# ---- captions (1-3 words, <= 18 characters, the spoken word yellow with a 110% pop)
CAPTION_SIZE = 68
CAPTION_MIN_SIZE = 12               # a freak long word keeps shrinking rather than leave the frame
CAPTION_BASELINE = 1180
CAPTION_MAX_CHARS = 18
CAPTION_MAX_W = 870                # centred: x 105-975, inside the shared safe box
CAPTION_STRIP = (1000, 1248)       # the strip captions are drawn in: never in the bottom 35% (y >= 1248)
SAFE_BOTTOM = 1248
WHITE, BLACK, YELLOW = (255, 255, 255), (0, 0, 0), (255, 214, 10)   # YELLOW = #FFD60A
OUTLINE = 4
SHADOW = (0, 4, 5, 150)            # dx, dy, blur radius, alpha
POP = 0.10                         # the spoken word starts at 110% ...
POP_S = 0.12                       # ... and settles to 100% over 120 ms
LINGER_S = 0.6                     # a group stays up into a pause this short

# ---- hook card (reels.hook_text, 008): top safe band, or a little lower when the top is busy (a face)
HOOK_SIZE, HOOK_MIN_SIZE = 80, 52   # 80 px on one line; two lines shrink to fit 170 px (~72 px); a longer hook
                                     # goes to three lines (<= 240 px tall). Words are never dropped.
HOOK_BANDS = ((280, 450), (600, 770))  # the card's top edge sits at a band's top: the calmer band of the first
                                     # picture is used (fewest edges), so the card avoids faces where it can
HOOK_MAX_H = 170                   # one or two lines
HOOK_MAX_H3 = 240                  # three lines (280 + 240 and 600 + 240 both stay clear of the captions at 1000)
HOOK_MAX_W = 870
HOOK_PAD = (34, 12)
HOOK_LINE = 1.0                    # line height / font size
HOOK_RADIUS = 26
HOOK_LINES = 3
HOOK_END_S = 3.5
HOOK_OUT_S = 0.15                  # a quick fade at the end (the start is instant: frame 0, no fade)
HOOK_POP = ((0.0, 0.86), (0.12, 1.04), (0.18, 1.0))   # pop-in done in 180 ms
HOOK_MAX_WORDS = 24                # (the web allows 10 words / 80 characters)
HOOK_INK = (17, 17, 17)

# ---- on-screen step labels (reel_scenes.on_screen, 014): a smaller card of the same family in the hook card's band,
# shown while its line is spoken (never during the hook card), popped in like the hook card and cut at the line's end
LABEL_SIZE, LABEL_MIN_SIZE = 72, 24  # 72 px when it fits; two lines shrink to fit (>= 60 px for an 8-word label)
LABEL_MAX_W = 870
LABEL_PAD = (28, 10)
LABEL_LINES = 2
LABEL_RADIUS = 22
LABEL_SHADOW = 12
LABEL_MIN_S = 0.4                  # a label that would be up for less than this is not drawn (it would only flash)
LABEL_MAX_CHARS = 120              # the web keeps them to 80; anything longer is cut with an ellipsis


# ---------------------------------------------------------------- easing + moves
def smoothstep(p):
    p = min(1.0, max(0.0, float(p)))
    return p * p * (3 - 2 * p)


def scene_moves(scenes):
    """One move per shown scene: its `motion` when it is push_in / pull_out / hold, else (an old row: pan, tilt,
    punch, nothing) the push/pull that alternates with the last one. Push and pull always alternate (a repeat
    flips), and two holds never follow each other."""
    out, last_dir = [], None
    for s in scenes:
        m = (s or {}).get("motion")
        if m not in MOVES or (m == "hold" and out and out[-1] == "hold"):
            m = None
        if m is None or (m != "hold" and m == last_dir):
            m = "pull_out" if last_dir == "push_in" else "push_in"
        out.append(m)
        if m != "hold":
            last_dir = m
    return out


def zoom_amount(seconds, payoff=False):
    """Zoom travel for a shot: ~3% a second, 4-10% (up to 15% on the payoff shot)."""
    return round(min(PAYOFF_MAX if payoff else ZOOM_MAX, max(ZOOM_MIN, ZOOM_RATE * float(seconds))), 4)


def base_zoom(move, p, amount):
    if move == "push_in":
        return 1.0 + amount * smoothstep(p)
    if move == "pull_out":
        return 1.0 + amount * (1.0 - smoothstep(p))
    if move == "hold":
        return 1.0
    raise ValueError("unknown move: %r" % (move,))


def crop_box(z, sw, sh, focus=FOCUS):
    """The float box (left, top, right, bottom) of a sw x sh source shown at zoom z, aimed at `focus` and kept
    inside the picture."""
    z = max(1.0, float(z))
    bw, bh = sw / z, sh / z
    x0 = min(max(0.0, focus[0] * sw - bw / 2), sw - bw)
    y0 = min(max(0.0, focus[1] * sh - bh / 2), sh - bh)
    return (x0, y0, x0 + bw, y0 + bh)


def frame_counts(durations, fps=FPS):
    """Whole frames per scene; rounding the running total keeps the video exactly as long as the audio."""
    out, acc, done = [], 0.0, 0
    for d in durations:
        acc += d
        edge = int(round(acc * fps))
        out.append(max(1, edge - done))
        done += out[-1]
    return out


# ---------------------------------------------------------------- punch-ins
def norm_word(w):
    return re.sub(r"[^a-z0-9]", "", str(w or "").lower().replace("’", "'"))


def punch_time(punch, words, t0, t1, earliest=None, latest=None):
    """Start (s) of the punch word/phrase among the Whisper words spoken in [t0, t1), matched by normalized text:
    the first place the whole phrase is said, else the first place its first word is said. With earliest/latest
    only matches starting inside [earliest, latest] count (a word repeated in the line can still land). None if
    absent."""
    tokens = [norm_word(t) for t in str(punch or "").split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return None
    inside = [w for w in (words or []) if t0 - 0.05 <= float(w.get("start", -1)) < t1]
    normed = [norm_word(w.get("word")) for w in inside]
    lo = float("-inf") if earliest is None else earliest
    hi = float("inf") if latest is None else latest
    phrase, first = None, None
    for i, n in enumerate(normed):
        t = float(inside[i]["start"])
        if n != tokens[0] or not lo <= t <= hi:
            continue
        if phrase is None and normed[i:i + len(tokens)] == tokens:
            phrase = t
        if first is None:
            first = t
    return phrase if phrase is not None else first


# ---------------------------------------------------------------- the shot plan
def build_shots(items, words, fps=FPS):
    """items: [{"image", "duration", "motion"?, "punch"?, "time_jump"?, "start_s"?, "end_s"?}] in order.
    Returns one dict per shot: f0 (first frame), n (frames), move, amount, punch_k (frame within the shot of the
    punch-in, or None), dissolve (a dissolve INTO this shot). At most MAX_PUNCHES punch-ins (the first ones)."""
    frames = frame_counts([i["duration"] for i in items], fps)
    moves = scene_moves(items)
    shots, f0, punches = [], 0, 0
    for i, (it, n, move) in enumerate(zip(items, frames, moves)):
        start, secs = f0 / float(fps), n / float(fps)
        shot = {"index": i, "image": it["image"], "f0": f0, "n": n, "move": move,
                "amount": 0.0 if move == "hold" else zoom_amount(secs, payoff=(i == len(items) - 1 and len(items) > 1)),
                "punch_k": None, "dissolve": bool(it.get("time_jump")) and i > 0}
        if it.get("punch") and punches < MAX_PUNCHES:
            lo = it.get("start_s") if it.get("start_s") is not None else start
            hi = it.get("end_s") if it.get("end_s") is not None else start + secs
            t = punch_time(it["punch"], words, float(lo), float(hi) + 0.05, earliest=start + PUNCH_LEAD_S,
                           latest=start + secs - PUNCH_TAIL_S)
            if t is not None:
                shot["punch_k"] = int(round((t - start) * fps))
                punches += 1
        shot["reframes"] = auto_reframes(shot, i, words, fps)
        shots.append(shot)
        f0 += n
    return shots


def _longest_word(words, lo, hi):
    """Start of the longest word (the likeliest stressed one) starting in [lo, hi], or None."""
    best = None
    for w in words or []:
        t = float(w.get("start", -1))
        if lo <= t <= hi:
            n = len(norm_word(w.get("word")))
            if best is None or n > best[0]:
                best = (n, t)
    return best[1] if best else None


def _nearest_word(words, t, within):
    near = [float(w["start"]) for w in words or [] if abs(float(w.get("start", -99)) - t) <= within]
    return min(near, key=lambda s: abs(s - t)) if near else None


def auto_reframes(shot, i, words, fps=FPS):
    """[(frame within the shot, scale factor)] of automatic instant reframes:
    - the first shot (line 1): +12% on the longest word starting 0.8-1.6 s (else at 1.2 s), and another +12% on
      the longest word 2.0-2.8 s (else 2.4 s) when the shot lasts over 3 s, so the hook has 2-3 visual changes;
    - any other shot over 3.5 s without a script punch-in: +10% at its middle (snapped to a nearby word start).
    Never within REFRAME_GAP_S of the punch-in or another reframe, nor in the shot's last PUNCH_TAIL_S."""
    start, secs = shot["f0"] / float(fps), shot["n"] / float(fps)
    taken = [shot["punch_k"] / float(fps)] if shot["punch_k"] is not None else []
    want = []
    if i == 0:
        for k, (lo, hi, fallback) in enumerate(OPEN_WINDOWS):
            if k == 1 and secs <= OPEN_SECOND_AFTER_S:
                break
            t = _longest_word(words, start + lo, start + hi)
            want.append(((t - start) if t is not None else fallback, OPEN_REFRAME))
    elif secs > LONG_SHOT_S and shot["punch_k"] is None:
        mid = secs / 2.0
        t = _nearest_word(words, start + mid, SNAP_S)
        want.append(((t - start) if t is not None else mid, LONG_REFRAME))
    out = []
    for rel, factor in want:
        if rel < PUNCH_LEAD_S or rel > secs - PUNCH_TAIL_S:
            continue
        if any(abs(rel - o) < REFRAME_GAP_S for o in taken):
            continue
        taken.append(rel)
        out.append((int(round(rel * fps)), factor))
    return sorted(out)


def punch_times(shots, fps=FPS):
    return [(s["f0"] + s["punch_k"]) / float(fps) for s in shots if s["punch_k"] is not None]


def shot_zoom(shot, k):
    """The zoom of `shot` at its frame k (k may fall outside the shot during a dissolve: the move holds its end)."""
    p = k / float(max(1, shot["n"] - 1))
    z = base_zoom(shot["move"], p, shot["amount"])
    if shot["punch_k"] is not None and k >= shot["punch_k"]:
        z *= 1.0 + PUNCH
    for rk, factor in shot.get("reframes") or ():
        if k >= rk:
            z *= 1.0 + factor
    return z


def frame_layers(shots, f, fps=FPS):
    """[(shot index, frame within that shot, weight)] for output frame f: one layer, or two during a dissolve
    (centred on the cut into a time_jump shot, DISSOLVE_S long, shortened for very short shots)."""
    lo, hi = 0, len(shots) - 1
    while lo < hi:                                   # the shot that holds frame f
        mid = (lo + hi + 1) // 2
        if shots[mid]["f0"] <= f:
            lo = mid
        else:
            hi = mid - 1
    i = lo
    s = shots[i]

    def half(a, b):
        return min(int(round(DISSOLVE_S * fps / 2)), a["n"] // 2, b["n"] // 2)

    if i + 1 < len(shots) and shots[i + 1]["dissolve"]:
        nxt = shots[i + 1]
        h = half(s, nxt)
        if h > 0 and f >= nxt["f0"] - h:
            a = (f - (nxt["f0"] - h) + 0.5) / (2.0 * h)
            return [(i, f - s["f0"], 1.0 - a), (i + 1, f - nxt["f0"], a)]
    if s["dissolve"] and i > 0:
        prev = shots[i - 1]
        h = half(prev, s)
        if h > 0 and f < s["f0"] + h:
            a = (f - (s["f0"] - h) + 0.5) / (2.0 * h)
            return [(i - 1, f - prev["f0"], 1.0 - a), (i, f - s["f0"], a)]
    return [(i, f - s["f0"], 1.0)]


def load_source(path, scale=SRC_SCALE):
    """A scene picture fitted to the video frame, then enlarged `scale`x (Lanczos) for sub-pixel cutting."""
    with Image.open(path) as im:
        im = ImageOps.fit(im.convert("RGB"), (WIDTH, HEIGHT), Image.LANCZOS)
    return im.resize((WIDTH * scale, HEIGHT * scale), Image.LANCZOS) if scale != 1 else im


# ---------------------------------------------------------------- captions
def caption_text(word):
    """ALL CAPS, no trailing , . ; : (? and ! stay)."""
    w = str(word or "").strip().upper()
    return re.sub(r"[,.;:]+$", "", w).strip() or w


def chunk_words(words, max_words=3, max_chars=CAPTION_MAX_CHARS, gap_s=LINGER_S):
    """Words in on-screen chunks: 1-3 words, at most `max_chars` characters on the line (a longer single word
    stands alone), a new chunk after , ; : . ! ? and after a pause longer than gap_s."""
    chunks, cur = [], []
    for w in words or []:
        text = caption_text(w.get("word"))
        if not text:
            continue
        item = {"text": text, "start": float(w["start"]), "end": float(w["end"])}
        if cur and (len(cur) >= max_words or len(" ".join([c["text"] for c in cur] + [text])) > max_chars
                    or item["start"] - cur[-1]["end"] > gap_s):
            chunks.append(cur)
            cur = []
        cur.append(item)
        if re.search(r"[,;:.!?]$", str(w.get("word") or "").strip()):
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return chunks


def caption_events(chunks, linger=LINGER_S):
    """[(start, end, chunk index, active word index)]: one per spoken word. A chunk stays up until the next one
    starts when that is within `linger` s (no flicker), else until its last word ends."""
    out = []
    for ci, c in enumerate(chunks):
        nxt = chunks[ci + 1][0]["start"] if ci + 1 < len(chunks) else None
        c_end = c[-1]["end"]
        if nxt is not None and nxt - c_end <= linger:
            c_end = nxt
        for j, w in enumerate(c):
            end = c[j + 1]["start"] if j + 1 < len(c) else c_end
            out.append((w["start"], max(end, w["start"] + 0.05), ci, j))
    return out


def pop_scale(dt):
    """The spoken word's scale `dt` s after it starts: 110% -> 100% over POP_S (smoothstep)."""
    if dt < 0 or dt >= POP_S:
        return 1.0
    return 1.0 + POP * (1.0 - smoothstep(dt / POP_S))


def _font(path, weight, size):
    if not path:
        return ImageFont.load_default(size)
    f = ImageFont.truetype(path, int(size))
    try:
        axes = f.get_variation_axes()
    except Exception:  # a static font
        return f
    vals = []
    for a in axes:
        name = a.get("name")
        name = name.decode("utf-8", "replace") if isinstance(name, bytes) else str(name)
        vals.append(max(a["minimum"], min(a["maximum"], int(weight))) if name.lower() == "weight" else a["default"])
    f.set_variation_by_axes(vals)
    return f


class Captions:
    """Pre-renders caption states (chunk, spoken word, pop scale) as RGBA strips, cached."""

    def __init__(self, words, font_path=None, weight=800):
        self.chunks = chunk_words(words)
        self.events = caption_events(self.chunks)
        self.font_path, self.weight = font_path, weight
        self._fonts = {}
        self._cache = collections.OrderedDict()

    def font(self, size):
        size = int(size)
        if size not in self._fonts:
            self._fonts[size] = _font(self.font_path, self.weight, size)
        return self._fonts[size]

    def layout(self, ci, active=-1, scale=1.0):
        """(size, [(text, x_left, width)]) of a chunk, centred, at most CAPTION_MAX_W wide even with the spoken word
        popped. The spoken word (`active`) is laid out at its popped size, so it pushes its neighbours aside
        instead of running into them."""
        texts = [w["text"] for w in self.chunks[ci]]
        size = CAPTION_SIZE
        for _ in range(12):
            f = self.font(size)
            widths = [f.getlength(t) for t in texts]
            total = sum(widths) + f.getlength(" ") * (len(texts) - 1) + 2 * OUTLINE
            need = total + POP * max(widths)                    # room for the spoken word's pop
            if need <= CAPTION_MAX_W or size <= CAPTION_MIN_SIZE:
                break
            size = max(CAPTION_MIN_SIZE, min(size - 1, int(size * CAPTION_MAX_W / need)))
        f = self.font(size)
        space = f.getlength(" ")
        if 0 <= active < len(texts) and scale != 1.0:
            widths[active] = self.font(max(8, int(round(size * scale)))).getlength(texts[active])
        total = sum(widths) + space * (len(texts) - 1)
        x = (WIDTH - total) / 2.0
        out = []
        for t, w in zip(texts, widths):
            out.append((t, x, w))
            x += w + space
        return size, out

    def state(self, ci, active, scale):
        key = (ci, active, round(scale, 3))
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit
        img = self.draw(ci, active, scale)
        self._cache[key] = img
        if len(self._cache) > 64:
            self._cache.popitem(last=False)
        return img

    def draw(self, ci, active, scale=1.0):
        """RGBA strip (WIDTH x CAPTION_STRIP height) to paste at (0, CAPTION_STRIP[0])."""
        top = CAPTION_STRIP[0]
        size, items = self.layout(ci, active, scale)
        base = CAPTION_BASELINE - top
        ink = Image.new("RGBA", (WIDTH, CAPTION_STRIP[1] - top), (0, 0, 0, 0))
        shadow = Image.new("L", ink.size, 0)
        d, ds = ImageDraw.Draw(ink), ImageDraw.Draw(shadow)
        cap_h = self.font(size).getbbox("H", anchor="ls")
        mid = base + (cap_h[1] + cap_h[3]) / 2.0          # the middle of a capital: the pop grows from here
        order = [k for k in range(len(items)) if k != active] + ([active] if 0 <= active < len(items) else [])
        for k in order:
            text, x, w = items[k]
            s = scale if k == active else 1.0
            f = self.font(max(8, int(round(size * s))))
            cx = x + w / 2.0
            y = mid + (base - mid) * s
            fill = YELLOW if k == active else WHITE
            ds.text((cx + SHADOW[0], y + SHADOW[1]), text, font=f, anchor="ms", fill=SHADOW[3],
                    stroke_width=OUTLINE, stroke_fill=SHADOW[3])
            d.text((cx, y), text, font=f, anchor="ms", fill=fill, stroke_width=OUTLINE, stroke_fill=BLACK)
        shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW[2]))
        out = Image.new("RGBA", ink.size, (0, 0, 0, 0))
        out.putalpha(shadow)
        return Image.alpha_composite(out, ink)

    def at(self, t):
        """The strip to show at time t (seconds), or None."""
        for start, end, ci, j in self._active(t):
            return self.state(ci, j, pop_scale(t - start))
        return None

    def _active(self, t):
        # events are in time order; a linear scan from a remembered index keeps this O(1) per frame
        i = getattr(self, "_i", 0)
        ev = self.events
        if i >= len(ev) or (i > 0 and ev[i][0] > t):
            i = 0
        while i < len(ev) and ev[i][1] <= t:
            i += 1
        self._i = i
        if i < len(ev) and ev[i][0] <= t < ev[i][1]:
            return [ev[i]]
        return []


# ---------------------------------------------------------------- hook card
def hook_words(text, limit=HOOK_MAX_WORDS):
    t = re.sub(r"\s+", " ", str(text or "")).strip().strip("\"'“”").strip()
    return t.split(" ")[:limit] if t else []


def break_word(word, font, max_w):
    """A word wider than max_w split into hyphenated pieces that each fit (never cut off at the card's edge)."""
    pieces, rest = [], word
    while font.getlength(rest) > max_w and len(rest) > 1:
        k = len(rest) - 1
        while k > 1 and font.getlength(rest[:k] + "-") > max_w:
            k -= 1
        pieces.append(rest[:k] + "-")
        rest = rest[k:]
    return pieces + [rest]


def wrap(words, font, max_w):
    lines, cur = [], []
    for word in words:
        for w in (break_word(word, font, max_w) if font.getlength(word) > max_w else [word]):
            if cur and font.getlength(" ".join(cur + [w])) > max_w:
                lines.append(" ".join(cur))
                cur = []
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines


def hook_layout(text, font_for_size):
    """(size, lines, box w, box h) for the hook card. Every word is kept: one or two lines from HOOK_SIZE down to
    HOOK_MIN_SIZE within HOOK_MAX_H, else three lines within HOOK_MAX_H3, else (an extreme hook) as many lines as it
    takes at HOOK_MIN_SIZE; a word too wide for the card is hyphen-broken."""
    words = hook_words(text)
    if not words:
        return None
    max_text_w = HOOK_MAX_W - 2 * HOOK_PAD[0]

    def measure(size):
        f = font_for_size(size)
        lines = wrap(words, f, max_text_w)
        w = int(max(f.getlength(l) for l in lines)) + 2 * HOOK_PAD[0]
        h = int(round(size * HOOK_LINE)) * len(lines) + 2 * HOOK_PAD[1]
        return size, lines, min(w, HOOK_MAX_W), h

    for max_lines, max_h in ((2, HOOK_MAX_H), (3, HOOK_MAX_H3)):
        for size in range(HOOK_SIZE, HOOK_MIN_SIZE - 1, -2):
            lay = measure(size)
            if len(lay[1]) <= max_lines and lay[3] <= max_h:
                return lay
    return measure(HOOK_MIN_SIZE)


def band_energy(img, band):
    """Mean edge strength (0-255) of a picture (1080x1920 frame coordinates) inside a y band, over the card's
    x span: busy detail and faces score high, sky / wall / blur low."""
    small = img.convert("L").resize((WIDTH // 4, HEIGHT // 4), Image.BILINEAR)
    edges = small.filter(ImageFilter.FIND_EDGES)
    x0, x1 = (WIDTH - HOOK_MAX_W) // 2 // 4, (WIDTH + HOOK_MAX_W) // 2 // 4
    region = edges.crop((x0 + 1, band[0] // 4, x1 - 1, band[1] // 4))
    data = region.tobytes()
    return sum(data) / float(max(1, len(data)))


def pick_band(img):
    """The calmest hook band of the first picture (ties: the top band); the top band without a picture."""
    if img is None:
        return HOOK_BANDS[0]
    return min(HOOK_BANDS, key=lambda b: (round(band_energy(img, b), 1), HOOK_BANDS.index(b)))


def hook_card(text, font_path=None, weight=800, band=HOOK_BANDS[0]):
    """(RGBA card, (x, y)) with the white card's top edge on band[0], centred across, or None without hook text."""
    fonts = {}

    def font_for(size):
        if size not in fonts:
            fonts[size] = _font(font_path, weight, size)
        return fonts[size]

    lay = hook_layout(text, font_for)
    if not lay:
        return None
    size, lines, w, h = lay
    f = font_for(size)
    line_h = int(round(size * HOOK_LINE))
    sh = 14                                                   # soft drop shadow around the card
    card = Image.new("RGBA", (w + 2 * sh, h + 2 * sh), (0, 0, 0, 0))
    shadow = Image.new("L", card.size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle((sh, sh + 6, sh + w, sh + h + 6), HOOK_RADIUS, fill=110)
    card.putalpha(shadow.filter(ImageFilter.GaussianBlur(9)))
    box = Image.new("RGBA", card.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    d.rounded_rectangle((sh, sh, sh + w, sh + h), HOOK_RADIUS, fill=(255, 255, 255, 246))
    asc = f.getbbox("H", anchor="ls")
    for k, line in enumerate(lines):
        # each line centred; its capitals centred in their line slot
        slot_mid = sh + HOOK_PAD[1] + line_h * k + line_h / 2.0
        d.text((sh + w / 2.0, slot_mid - (asc[1] + asc[3]) / 2.0), line, font=f, anchor="ms", fill=HOOK_INK)
    card = Image.alpha_composite(card, box)
    x = (WIDTH - card.width) // 2
    y = band[0] - sh
    return card, (x, y)


def hook_scale(t):
    """Card scale at t s: 86% on frame 0 -> 104% at 120 ms -> 100% at 180 ms (no fade-in)."""
    (t0, s0), (t1, s1), (t2, s2) = HOOK_POP
    if t >= t2:
        return s2
    if t < t1:
        p = (t - t0) / (t1 - t0)
        return s0 + (s1 - s0) * (1 - (1 - p) ** 3)          # ease-out
    return s1 + (s2 - s1) * smoothstep((t - t1) / (t2 - t1))


def hook_alpha(t):
    if t < 0 or t >= HOOK_END_S:
        return 0.0
    if t > HOOK_END_S - HOOK_OUT_S:
        return (HOOK_END_S - t) / HOOK_OUT_S
    return 1.0


class Hook:
    def __init__(self, text, font_path=None, weight=800, first_picture=None):
        """first_picture: the opening picture (1080x1920 or its 2x copy) to choose the calmer band on."""
        if first_picture is not None and first_picture.size != (WIDTH, HEIGHT):
            first_picture = first_picture.resize((WIDTH, HEIGHT), Image.BILINEAR)
        self.band = pick_band(first_picture)
        made = hook_card(text, font_path, weight, self.band)
        self.card, self.pos = made if made else (None, None)
        self._cache = {}

    def at(self, t):
        """(RGBA, (x, y)) to paste at time t, or None."""
        if self.card is None:
            return None
        a = hook_alpha(t)
        if a <= 0:
            return None
        s = round(hook_scale(t), 3)
        key = (s, round(a, 2))
        hit = self._cache.get(key)
        if hit is None:
            img = self.card
            if s != 1.0:
                img = img.resize((max(1, int(round(img.width * s))), max(1, int(round(img.height * s)))), Image.BICUBIC)
            if a < 1.0:
                img = img.copy()
                img.putalpha(img.getchannel("A").point(lambda v: int(v * a)))
            cx = self.pos[0] + self.card.width / 2.0
            cy = self.pos[1] + self.card.height / 2.0
            hit = (img, (int(round(cx - img.width / 2.0)), int(round(cy - img.height / 2.0))))
            self._cache[key] = hit
        return hit


# ---------------------------------------------------------------- on-screen labels
def label_words(text):
    """The label's words as written (case and quotes kept), whitespace collapsed; [] when empty."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(t) > LABEL_MAX_CHARS:
        t = t[:LABEL_MAX_CHARS - 1].rstrip() + "…"
    return t.split(" ") if t else []


def _two_lines(words, font, max_w):
    """The split of `words` into two lines that keeps the wider line narrowest (no lonely last word), or None if no
    split fits max_w."""
    best = None
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:])
        wide = max(font.getlength(a), font.getlength(b))
        if wide <= max_w and (best is None or wide < best[0]):
            best = (wide, [a, b])
    return best[1] if best else None


def label_layout(text, font_for_size):
    """(size, lines, box w, box h) for a label card: one line at the largest size from LABEL_SIZE down that fits,
    else two balanced lines; never more than two lines, never wider than LABEL_MAX_W. A word too wide for the card is
    hyphen-broken; text that still won't fit two lines at LABEL_MIN_SIZE is cut with an ellipsis."""
    words = label_words(text)
    if not words:
        return None
    max_text_w = LABEL_MAX_W - 2 * LABEL_PAD[0]

    def box(size, lines):
        f = font_for_size(size)
        w = int(max(f.getlength(l) for l in lines)) + 2 * LABEL_PAD[0]
        return size, lines, min(w, LABEL_MAX_W), int(round(size * HOOK_LINE)) * len(lines) + 2 * LABEL_PAD[1]

    for size in range(LABEL_SIZE, LABEL_MIN_SIZE - 1, -2):
        f = font_for_size(size)
        if all(f.getlength(w) <= max_text_w for w in words):
            if f.getlength(" ".join(words)) <= max_text_w:
                return box(size, [" ".join(words)])
            lines = _two_lines(words, f, max_text_w)
            if lines:
                return box(size, lines)
    f = font_for_size(LABEL_MIN_SIZE)
    lines = wrap(words, f, max_text_w)
    if len(lines) > LABEL_LINES:
        last = lines[LABEL_LINES - 1]
        while last and f.getlength(last + "…") > max_text_w:
            last = last[:-1]
        lines = lines[:LABEL_LINES - 1] + [last.rstrip() + "…"]
    return box(LABEL_MIN_SIZE, lines)


def label_card(text, font_path=None, band=HOOK_BANDS[0], weight=800):
    """RGBA label card (white rounded box, dark ink, soft shadow: the hook card's family, smaller), sized to fit
    inside `band`; None without text. Paste it at label_xy(card, band)."""
    fonts = {}

    def font_for(size):
        if size not in fonts:
            fonts[size] = _font(font_path, weight, size)
        return fonts[size]

    lay = label_layout(text, font_for)
    if not lay:
        return None
    size, lines, w, h = lay
    while h > band[1] - band[0] and size > LABEL_MIN_SIZE:   # a narrow band: shrink until the card fits in it
        size -= 2
        f = font_for(size)
        w = min(LABEL_MAX_W, int(max(f.getlength(l) for l in lines)) + 2 * LABEL_PAD[0])
        h = int(round(size * HOOK_LINE)) * len(lines) + 2 * LABEL_PAD[1]
    f = font_for(size)
    line_h = int(round(size * HOOK_LINE))
    sh = LABEL_SHADOW
    card = Image.new("RGBA", (w + 2 * sh, h + 2 * sh), (0, 0, 0, 0))
    shadow = Image.new("L", card.size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle((sh, sh + 5, sh + w, sh + h + 5), LABEL_RADIUS, fill=110)
    card.putalpha(shadow.filter(ImageFilter.GaussianBlur(8)))
    box = Image.new("RGBA", card.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    d.rounded_rectangle((sh, sh, sh + w, sh + h), LABEL_RADIUS, fill=(255, 255, 255, 246))
    asc = f.getbbox("H", anchor="ls")
    for k, line in enumerate(lines):
        slot_mid = sh + LABEL_PAD[1] + line_h * k + line_h / 2.0
        d.text((sh + w / 2.0, slot_mid - (asc[1] + asc[3]) / 2.0), line, font=f, anchor="ms", fill=HOOK_INK)
    return Image.alpha_composite(card, box)


def label_xy(card, band=HOOK_BANDS[0]):
    """Where a label card goes: centred across, its white box's top edge on the band's top (like the hook card)."""
    return (WIDTH - card.width) // 2, band[0] - LABEL_SHADOW


def label_spans(items, hook_end=HOOK_END_S, min_s=LABEL_MIN_S):
    """[(start, end, text)] of the labels to draw: items [{"text", "start", "end"}] in time order, each starting no
    earlier than the end of the hook card; empty text and spans shorter than min_s are dropped."""
    out = []
    for it in items or []:
        text = " ".join(label_words(it.get("text")))
        if not text or it.get("start") is None or it.get("end") is None:
            continue
        start, end = max(float(it["start"]), float(hook_end)), float(it["end"])
        if out:
            start = max(start, out[-1][1])
        if end - start >= min_s:
            out.append((start, end, text))
    return out


class Labels:
    def __init__(self, items, font_path=None, weight=800, band=HOOK_BANDS[0]):
        """items: [{"text", "start", "end"}] (seconds). band: the hook card's band (the labels share its place)."""
        self.band = band
        self.spans, self.cards = [], []
        for start, end, text in label_spans(items):
            card = label_card(text, font_path, band, weight)
            if card is not None:
                self.spans.append((start, end, text))
                self.cards.append(card)
        self._cache = {}

    def at(self, t):
        """(RGBA, (x, y)) to paste at time t, or None. A pop-in like the hook card's (done in 180 ms), full strength
        to the end of the line, then a hard cut."""
        for k, (start, end, _text) in enumerate(self.spans):
            if start <= t < end:
                break
        else:
            return None
        card = self.cards[k]
        s = round(hook_scale(t - start), 3)
        hit = self._cache.get((k, s))
        if hit is None:
            img = card
            if s != 1.0:
                img = card.resize((max(1, int(round(card.width * s))), max(1, int(round(card.height * s)))), Image.BICUBIC)
            x, y = label_xy(card, self.band)
            cx, cy = x + card.width / 2.0, y + card.height / 2.0
            hit = (img, (int(round(cx - img.width / 2.0)), int(round(cy - img.height / 2.0))))
            self._cache[(k, s)] = hit
        return hit


# ---------------------------------------------------------------- frames
def _render(sources, layers, overlays, shots):
    out = None
    for idx, k, wgt in layers:
        src = sources[idx]
        sw, sh = src.size
        im = src.resize((WIDTH, HEIGHT), Image.BICUBIC, box=crop_box(shot_zoom(shots[idx], k), sw, sh))
        out = im if out is None else Image.blend(out, im, wgt)
    for img, (x, y) in overlays:
        out.paste(img, (x, y), img)
    return out.tobytes()


def frames(shots, open_source, captions=None, hook=None, fps=FPS, threads=THREADS, labels=None):
    """RGB24 frame bytes, in order, for the whole video. open_source(shot) -> the 2x picture. Overlays: the hook card,
    the on-screen step labels (Labels; they start after the hook card) and the word captions. Pictures are loaded
    in order as they are needed and dropped once their shot (and any dissolve out of it) is done."""
    total = shots[-1]["f0"] + shots[-1]["n"] if shots else 0
    loaded = {}
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, threads))
    pending = collections.deque()
    try:
        for f in range(total):
            layers = frame_layers(shots, f, fps)
            need = {i for i, _k, _w in layers}
            for i in need:
                if i not in loaded:
                    loaded[i] = open_source(shots[i])
            for i in [i for i in loaded if i < min(need)]:
                del loaded[i]                         # in-flight frames keep their own reference
            t = f / float(fps)
            overlays = []
            if hook is not None:
                h = hook.at(t)
                if h:
                    overlays.append(h)
            if labels is not None:
                lab = labels.at(t)
                if lab:
                    overlays.append(lab)
            if captions is not None:
                c = captions.at(t)
                if c is not None:
                    overlays.append((c, (0, CAPTION_STRIP[0])))
            pending.append(pool.submit(_render, {i: loaded[i] for i in need}, layers, overlays, shots))
            if len(pending) >= LOOKAHEAD:
                yield pending.popleft().result()
        while pending:
            yield pending.popleft().result()
    finally:
        for p in pending:
            p.cancel()
        pool.shutdown(wait=True)
