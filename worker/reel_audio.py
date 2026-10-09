# The reel's sound (playbook v2): the narration, the music bed ducked under it, three small sound effects made
# here with ffmpeg (no licensing), and a broadcast-style master.
#   1. voice  -> 48 kHz stereo, high-pass 80 Hz, gain to VOICE_LUFS, light compression        (voice48.wav)
#                (measured again: a small trim in the mix puts it back on VOICE_LUFS)
#   2. mix    -> voice + bed (VOICE - 18 LU at the default 18% volume, sidechain duck ~9 dB, 50/400 ms)
#                + SFX (whoosh at 0, pop when the hook card appears, a soft impact on the turn's punch-in),
#                each SFX peaking SFX_UNDER_DB under the voice's peak                         (premix.wav)
#   3. master -> loudnorm I=-14 : TP=-1.5 : LRA=11, two-pass (measured, then linear)           (audio.wav)
import array
import json
import math
import re
import subprocess
import wave

from render import JobError

RATE = 48000
FMT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
VOICE_LUFS = -16.0
VOICE_CHAIN = "highpass=f=80,acompressor=threshold=-16dB:ratio=2:attack=15:release=200:makeup=1,alimiter=limit=0.95:level=0"
MUSIC_UNDER_LU = 18.0              # the bed sits this far under the voice at the default volume ...
MUSIC_DEFAULT_VOLUME = 0.18        # ... (settings.reel_music_volume 18%); 36% = 6 dB louder, 9% = 6 dB softer
DUCK = {"threshold": 0.045, "ratio": 3, "attack": 50, "release": 400}   # ~9 dB under speech at VOICE_LUFS (measured)
MUSIC_FADE_IN, MUSIC_FADE_OUT = 0.05, 2.0
SFX_UNDER_DB = 8.0                 # SFX peaks this far under the voice's peak (playbook 6-10 dB)
TURN = 0.70                        # the emotional turn: the first punch-in after 70% of the voice gets the impact
MASTER = {"I": -14.0, "TP": -1.5, "LRA": 11.0}
SAFETY_LIMIT = "alimiter=limit=0.794:level=0:latency=1"   # -2 dBFS after the master: AAC adds ~0.3 dB of peak
MEASURE_TIMEOUT = 120
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Generated sound effects: name -> (seconds, filter graph ending in [out])
SFX = {
    # a soft rising whoosh: filtered pink noise swelling in, then gone
    "whoosh": (0.7, "anoisesrc=color=pink:sample_rate=48000:amplitude=0.9:duration=0.7:seed=11,"
                    "highpass=f=350,lowpass=f=5000,afade=t=in:st=0:d=0.45:curve=exp,"
                    "afade=t=out:st=0.45:d=0.25:curve=tri[out]"),
    # a soft pop: a short sine blip falling in pitch
    "pop": (0.09, "aevalsrc=exprs='0.9*sin(2*PI*(560*t-1600*t*t))*exp(-50*t)':s=48000:d=0.09,"
                  "afade=t=in:st=0:d=0.004[out]"),
    # a gentle impact: a low thump (audible on phones: 110/220 Hz) with a short soft noise attack
    "impact": (0.8, "aevalsrc=exprs='0.75*sin(2*PI*110*t*(1-0.25*t))*exp(-6*t)+0.3*sin(2*PI*220*t)*exp(-11*t)'"
                    ":s=48000:d=0.8[a];anoisesrc=color=pink:sample_rate=48000:amplitude=0.6:duration=0.8:seed=5,"
                    "lowpass=f=900,afade=t=out:st=0:d=0.12[b];[a][b]amix=inputs=2:normalize=0,"
                    "afade=t=in:st=0:d=0.004,afade=t=out:st=0.55:d=0.25[out]"),
}


# ---------------------------------------------------------------- pure pieces
def sfx_events(has_hook, punch_times, voice_seconds, reel_seconds=None):
    """[(name, seconds)]: a whoosh at 0, a pop when the hook card appears (frame 0), and a soft impact on the
    first punch-in after TURN of the voice that leaves room for the whole impact before the reel ends
    (reel_seconds; none if there is no such punch: it is never cut off)."""
    ev = [("whoosh", 0.0)]
    if has_hook:
        ev.append(("pop", 0.0))
    end = float("inf") if reel_seconds is None else float(reel_seconds)
    turn = [t for t in sorted(punch_times or []) if t >= TURN * float(voice_seconds) and t + SFX["impact"][0] <= end]
    if turn:
        ev.append(("impact", round(turn[0], 3)))
    return ev


def sfx_args(ffmpeg, name, out):
    _secs, graph = SFX[name]
    return [ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error", "-filter_complex", graph, "-map", "[out]",
            "-ac", "2", "-ar", str(RATE), "-c:a", "pcm_s16le", out]


def voice_args(ffmpeg, src, out, gain_db):
    return [ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error", "-i", src, "-af",
            "%s,volume=%.2fdB,%s" % (FMT, gain_db, VOICE_CHAIN), "-ar", str(RATE), "-ac", "2", "-c:a", "pcm_s16le", out]


def measure_args(ffmpeg, path):
    return [ffmpeg, "-hide_banner", "-nostdin", "-nostats", "-i", path, "-af",
            "loudnorm=I=%g:TP=%g:LRA=%g:print_format=json" % (MASTER["I"], MASTER["TP"], MASTER["LRA"]),
            "-f", "null", "-"]


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float("-inf")
    return f


def parse_loudnorm(text):
    """The loudnorm JSON block in ffmpeg's stderr as floats (input_i, input_tp, input_lra, input_thresh,
    target_offset); "-inf" stays -inf."""
    blocks = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", text or "")
    if not blocks:
        raise JobError("Couldn't measure the reel's loudness.")
    raw = json.loads(blocks[-1])
    return {k: _num(raw.get(k)) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}


def finite(v):
    return v is not None and not math.isinf(v) and not math.isnan(v) and v > -70


def voice_gain_db(measured_i):
    """dB to bring the raw voice to VOICE_LUFS (0 for silence)."""
    return round(min(30.0, max(-20.0, VOICE_LUFS - measured_i)), 2) if finite(measured_i) else 0.0


def music_gain_db(music_i, voice_i, volume):
    """dB for the bed: MUSIC_UNDER_LU under the (processed) voice at the default volume; the owner's volume
    setting moves it (20*log10(volume / 18%)). A silent voice counts as VOICE_LUFS."""
    if not finite(music_i):
        return 0.0
    v = voice_i if finite(voice_i) else VOICE_LUFS
    rel = 20 * math.log10(max(0.01, float(volume)) / MUSIC_DEFAULT_VOLUME)
    return round(max(-60.0, min(30.0, v - MUSIC_UNDER_LU + rel - music_i)), 2)


def sfx_gain_db(voice_peak_db, sfx_peak_db):
    """dB that puts an SFX peak SFX_UNDER_DB under the voice's peak (a silent voice counts as -6 dBFS)."""
    vp = voice_peak_db if finite(voice_peak_db) else -6.0
    if not finite(sfx_peak_db):
        return 0.0
    return round(vp - SFX_UNDER_DB - sfx_peak_db, 2)


def mix_graph(duration, has_music, music_db, sfx, voice_db=0.0):
    """filter_complex: input 0 = the processed voice (trimmed by voice_db to sit at VOICE_LUFS), 1 = the bed (when
    has_music), then one input per SFX (sfx = [(seconds, gain dB)] in input order) -> [mix], exactly `duration` s."""
    d = max(0.1, float(duration))
    parts, mix = [], ["[voice]"]
    voice = "[0:a]%s,volume=%.2fdB,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS" % (FMT, voice_db, d)
    if has_music:
        parts.append(voice + ",asplit=2[voice][key]")
        parts.append("[1:a]%s,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS,volume=%.2fdB,afade=t=in:st=0:d=%.2f,"
                     "afade=t=out:st=%.3f:d=%.1f[bed]" % (FMT, d, music_db, MUSIC_FADE_IN, max(0.0, d - MUSIC_FADE_OUT),
                                                         MUSIC_FADE_OUT))
        parts.append("[bed][key]sidechaincompress=threshold=%g:ratio=%g:attack=%d:release=%d:makeup=1[ducked]"
                     % (DUCK["threshold"], DUCK["ratio"], DUCK["attack"], DUCK["release"]))
        mix.append("[ducked]")
    else:
        parts.append(voice + "[voice]")
    first = 2 if has_music else 1
    for k, (at, gain) in enumerate(sfx):
        parts.append("[%d:a]%s,volume=%.2fdB,adelay=%d:all=1,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS[s%d]"
                     % (first + k, FMT, gain, int(round(max(0.0, at) * 1000)), d, k))
        mix.append("[s%d]" % k)
    if len(mix) == 1:
        parts[-1] = parts[-1][:-len("[voice]")] + "[mix]"
    else:
        parts.append("%samix=inputs=%d:duration=first:normalize=0,atrim=0:%.3f[mix]" % ("".join(mix), len(mix), d))
    return ";\n".join(parts)


def master_filter(measured):
    """Second loudnorm pass (linear, from the first pass's measurement); None when the mix is silent."""
    if not finite(measured.get("input_i")):
        return None
    return ("loudnorm=I=%g:TP=%g:LRA=%g:measured_I=%.2f:measured_TP=%.2f:measured_LRA=%.2f:measured_thresh=%.2f:"
            "offset=%.2f:linear=true,aresample=%d,%s" % (
                MASTER["I"], MASTER["TP"], MASTER["LRA"], measured["input_i"],
                measured["input_tp"] if finite(measured["input_tp"]) else 0.0,
                measured["input_lra"] if finite(measured["input_lra"]) else 0.0,
                measured["input_thresh"] if finite(measured["input_thresh"]) else -70.0,
                measured["target_offset"] if math.isfinite(measured["target_offset"]) else 0.0,
                RATE, SAFETY_LIMIT))


def wav_peak_db(path):
    """Sample peak of a 16-bit WAV in dBFS (-inf for silence)."""
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise JobError("Unexpected audio format.")
        data = array.array("h", w.readframes(w.getnframes()))
    peak = max((abs(v) for v in data), default=0)
    return 20 * math.log10(peak / 32768.0) if peak else float("-inf")


# ---------------------------------------------------------------- running it
def measure(ffmpeg, path, cwd=None):
    try:
        r = subprocess.run(measure_args(ffmpeg, path), cwd=cwd, capture_output=True, timeout=MEASURE_TIMEOUT,
                           creationflags=_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise JobError("ffmpeg took over %d seconds measuring the sound." % MEASURE_TIMEOUT)
    if r.returncode != 0:
        raise JobError("ffmpeg couldn't measure the sound: %s" % r.stderr.decode("utf-8", "replace")[-200:])
    return parse_loudnorm(r.stderr.decode("utf-8", "replace"))


def make_audio(ffmpeg, work, voice, duration, events, run, music=None, volume=MUSIC_DEFAULT_VOLUME, log=print):
    """Build `work`/audio.wav (48 kHz stereo, `duration` s). voice/music are file names in `work`;
    events = sfx_events(...); run(args, what) runs ffmpeg in `work`. Returns a summary dict."""
    import os
    p = lambda name: os.path.join(work, name)  # noqa: E731
    raw = measure(ffmpeg, voice, work)
    vg = voice_gain_db(raw["input_i"])
    run(voice_args(ffmpeg, voice, "voice48.wav", vg), "voice")
    v = measure(ffmpeg, "voice48.wav", work)
    trim = voice_gain_db(v["input_i"])          # the compressor took a little: back to VOICE_LUFS in the mix
    voice_i = v["input_i"] + trim if finite(v["input_i"]) else VOICE_LUFS
    vpeak = wav_peak_db(p("voice48.wav")) + trim
    inputs = ["-i", "voice48.wav"]
    mdb = 0.0
    if music:
        m = measure(ffmpeg, music, work)
        mdb = music_gain_db(m["input_i"], voice_i, volume)
        inputs += ["-i", music]
    sfx = []
    for k, (name, at) in enumerate(events):
        f = "sfx-%d-%s.wav" % (k, name)
        run(sfx_args(ffmpeg, name, f), "sound effect")
        sfx.append((at, sfx_gain_db(vpeak, wav_peak_db(p(f)))))
        inputs += ["-i", f]
    run([ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error"] + inputs +
        ["-filter_complex", mix_graph(duration, bool(music), mdb, sfx, trim), "-map", "[mix]", "-ar", str(RATE),
         "-ac", "2", "-c:a", "pcm_f32le", "premix.wav"], "mix")
    pre = measure(ffmpeg, "premix.wav", work)
    master = master_filter(pre)
    run([ffmpeg, "-y", "-nostdin", "-hide_banner", "-v", "error", "-i", "premix.wav"] +
        (["-af", master] if master else []) +
        ["-ar", str(RATE), "-ac", "2", "-c:a", "pcm_s16le", "audio.wav"], "master")
    info = {"voice_gain_db": round(vg + trim, 2), "voice_lufs": voice_i, "voice_peak_db": round(vpeak, 2), "music_db": mdb,
            "sfx": [(n, at, g) for (n, at), (_a, g) in zip(events, sfx)], "premix_lufs": pre["input_i"]}
    log("reel sound: voice %+.1f dB (%.1f LUFS), music %s, sfx %s, mix %.1f LUFS -> master -14" % (
        vg + trim, voice_i, ("%+.1f dB" % mdb) if music else "off",
        ", ".join("%s@%.2fs %+.1fdB" % s for s in info["sfx"]) or "none", pre["input_i"]))
    return info
