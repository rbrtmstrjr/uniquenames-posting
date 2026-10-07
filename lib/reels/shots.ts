import { REEL_SHOT_SIZES, REEL_SUBJECTS, type ReelShotSize, type ReelSubject } from "@/lib/db/types";

// The shot list of a reel (playbook v2, "Shot-list rules"): every line's shot size + who is in it. Gemini proposes one,
// repairShotList() makes it obey the rules below and shotListIssues() names what is still wrong. Pure and deterministic.
//
//   1. Line 1 shows a face (mom / baby / both) in a close-up or medium shot (readable as a thumbnail).
//   2. Never the same shot size AND the same subject on two lines in a row.
//   3. At most 2 face shots in a row (a face shot = mom / baby / both in a medium, close or POV shot).
//   4. At least one face-free shot in every 4 lines (subject object / none, or a detail / B-roll insert).
//   5. An establishing wide at line 2 or 3 (never line 1).
//   6. Mix per 10 lines ≈ 2 wide / 3 medium / 2 close / 2 detail / 1 POV-or-B-roll (± max(1, n/10) per bucket;
//      the mirrored last line is not counted).
//   7. The last line mirrors line 1 (same size + subject; the script copies line 1's setting) so the reel loops.

export { REEL_SHOT_SIZES, REEL_SUBJECTS };
export type { ReelShotSize, ReelSubject };

export interface Shot { shot_size: ReelShotSize; subject: ReelSubject }

const SIZE_ALIASES: Record<string, ReelShotSize> = {
  "wide": "wide", "wide-shot": "wide", "establishing": "wide", "long": "wide", "full": "wide",
  "medium": "medium", "mid": "medium", "medium-shot": "medium", "medium-close": "medium",
  "close": "close", "close-up": "close", "closeup": "close", "cu": "close", "extreme-close-up": "close",
  "detail": "detail", "insert": "detail", "macro": "detail", "detail-insert": "detail",
  "pov": "pov", "point-of-view": "pov", "first-person": "pov",
  "broll": "broll", "b-roll": "broll", "b_roll": "broll", "cutaway": "broll",
};
const SUBJECT_ALIASES: Record<string, ReelSubject> = {
  mom: "mom", mother: "mom", mama: "mom", dad: "mom", father: "mom", papa: "mom", parent: "mom", adult: "mom",
  baby: "baby", child: "baby", kid: "baby", toddler: "baby", newborn: "baby", infant: "baby", preschooler: "baby",
  both: "both", together: "both", "mom-and-baby": "both", "parent-and-child": "both",
  object: "object", objects: "object", thing: "object", prop: "object",
  none: "none", nobody: "none", place: "none", setting: "none", empty: "none",
};

/** "Close-up" / "B-roll" / "POV" → the shot size, or null. */
export function sizeOf(x: unknown): ReelShotSize | null {
  if (typeof x !== "string") return null;
  const k = x.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return SIZE_ALIASES[k] ?? SIZE_ALIASES[k.replace(/-shot$/, "")] ?? null;
}
/** "Mother" / "dad" → mom, "toddler" → baby, … or null. */
export function subjectOf(x: unknown): ReelSubject | null {
  if (typeof x !== "string") return null;
  const k = x.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return SUBJECT_ALIASES[k] ?? null;
}

/** mom / baby / both: a person (with a face) is the subject. */
export const hasFace = (s: ReelSubject) => s === "mom" || s === "baby" || s === "both";
/** No face in the picture: an object / empty place, or a detail / B-roll insert (hands at most). */
export const isFaceFree = (x: Shot) => !hasFace(x.subject) || x.shot_size === "detail" || x.shot_size === "broll";
/** A portrait-like shot: a person in a medium, close-up or POV shot (a wide is neither this nor face-free). */
export const isFaceShot = (x: Shot) => hasFace(x.subject) && (x.shot_size === "medium" || x.shot_size === "close" || x.shot_size === "pov");

/** The mix buckets: POV and B-roll share one. */
export type MixBucket = "wide" | "medium" | "close" | "detail" | "povBroll";
export const bucketOf = (s: ReelShotSize): MixBucket => (s === "pov" || s === "broll" ? "povBroll" : s);
/** Per 10 lines (playbook "Shot-size mix per 10"). */
export const MIX_PER_10: Record<MixBucket, number> = { wide: 2, medium: 3, close: 2, detail: 2, povBroll: 1 };
const BUCKETS = Object.keys(MIX_PER_10) as MixBucket[];

/** The allowed count per bucket for n lines: target ± max(1, round(n / 10)). */
export function mixRange(n: number): Record<MixBucket, { target: number; lo: number; hi: number }> {
  const tol = Math.max(1, Math.round(n / 10));
  return Object.fromEntries(BUCKETS.map((b) => {
    const target = (n * MIX_PER_10[b]) / 10;
    return [b, { target, lo: Math.max(0, Math.ceil(target - tol)), hi: Math.floor(target + tol) }];
  })) as Record<MixBucket, { target: number; lo: number; hi: number }>;
}

const SIZE_FOR: Record<MixBucket, (subject: ReelSubject) => ReelShotSize> = {
  wide: () => "wide", medium: () => "medium", close: () => "close", detail: () => "detail",
  // a person seen through the parent's eyes, or a quiet cutaway of an object / the place
  povBroll: (subject) => (hasFace(subject) ? "pov" : "broll"),
};

/**
 * The shot size a picture idea's own wording implies ("looking down at…" = POV, "close-up of…" = close, "tiny hands" =
 * detail, "the whole room" = wide), or null. The repair never overrides it, so the shot never contradicts the idea.
 */
export function impliedSize(idea: string): ReelShotSize | null {
  const t = (idea ?? "").toLowerCase();
  if (/\b(?:looking down at|through (?:her|his|my|your|the mom's|the parent's) eyes|point of view|pov\b|seen from (?:her|his|my|your) eyes)/.test(t)) return "pov";
  if (/\b(?:extreme close-?up|macro|tiny (?:hands?|fingers?|feet|toes?|socks?)|small (?:hands?|fingers?|feet|toes?)|fingers? (?:curl|wrap|grip|touch|hold)|close-?up (?:of|on) (?:her|his|their|the|a)?\s*(?:hands?|fingers?|feet|toes?))/.test(t)) return "detail";
  if (/\b(?:close-?up|close up)\b/.test(t)) return "close";
  if (/\b(?:wide view|the whole (?:room|house|street|sala|kitchen|park)|seen from across)\b/.test(t)) return "wide";
  return null;
}

/** The mirror rule applies from 3 lines on (2 lines would repeat the same shot back to back). */
const mirrors = (n: number) => n >= 3;

/**
 * Every rule a shot list breaks, in words (empty = it follows them all). `settings` (one per line, optional) also
 * checks that the last line is set where line 1 is.
 */
export function shotListIssues(shots: readonly Shot[], settings?: readonly (string | null | undefined)[]): string[] {
  const n = shots.length;
  const out: string[] = [];
  if (!n) return out;
  const L = (i: number) => `Line ${i + 1}`;
  if (!hasFace(shots[0].subject)) out.push("Line 1 needs a face (mom, baby or both).");
  if (shots[0].shot_size !== "close" && shots[0].shot_size !== "medium") out.push("Line 1 needs a close-up or medium shot.");
  for (let i = 1; i < n; i++) {
    if (shots[i].shot_size === shots[i - 1].shot_size && shots[i].subject === shots[i - 1].subject) out.push(`${L(i)} repeats line ${i}'s shot size and subject.`);
  }
  for (let i = 2; i < n; i++) {
    if (isFaceShot(shots[i - 2]) && isFaceShot(shots[i - 1]) && isFaceShot(shots[i])) out.push(`Lines ${i - 1}-${i + 1} are 3 face shots in a row.`);
  }
  for (let i = 3; i < n; i++) {
    if (!shots.slice(i - 3, i + 1).some(isFaceFree)) out.push(`Lines ${i - 2}-${i + 1} have no face-free shot.`);
  }
  if (n >= 3 && shots[1].shot_size !== "wide" && shots[2].shot_size !== "wide") out.push("Line 2 or 3 needs an establishing wide shot.");
  if (n >= 2 && n < 3 && shots[1].shot_size !== "wide") out.push("Line 2 needs an establishing wide shot.");
  const mixed = mirrors(n) ? shots.slice(0, n - 1) : shots;
  const range = mixRange(mixed.length);
  for (const b of BUCKETS) {
    const c = mixed.filter((x) => bucketOf(x.shot_size) === b).length;
    if (c < range[b].lo || c > range[b].hi) out.push(`${c} ${b} shots (aim ${range[b].lo}-${range[b].hi}).`);
  }
  if (mirrors(n)) {
    const a = shots[0], z = shots[n - 1];
    if (a.subject !== z.subject || a.shot_size !== z.shot_size) out.push("The last line does not mirror line 1's shot.");
    const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
    if (settings && norm(settings[0]) && norm(settings[0]) !== norm(settings[n - 1])) out.push("The last line is not set where line 1 is.");
  }
  return out;
}

/**
 * Make Gemini's shot list follow the rules. A size the line's idea implies (impliedSize) is never overridden, even
 * when that leaves a rule broken: the picture must match its words. Subjects stay as written (they match the picture idea) except line 1
 * (no face → both) and the last line (it takes line 1's subject). Shot sizes are kept where they fit and reassigned
 * where Gemini drifted: line 1 close/medium, an establishing wide at line 2 (when neither 2 nor 3 is wide), the last
 * line = line 1's size, then left to right each line keeps its size if that breaks no rule and its bucket is not full,
 * else takes the most-needed size that fits (a detail or B-roll insert always fits); finally buckets still short take
 * over lines from buckets above target where nothing breaks.
 */
export function repairShotList(raw: readonly { shot_size?: unknown; subject?: unknown; idea?: string | null }[]): Shot[] {
  const n = raw.length;
  if (!n) return [];
  // a size the idea's own wording implies is locked (line 1 keeps its close/medium rule)
  const locked = raw.map((r, i) => {
    const l = impliedSize(r.idea ?? "");
    return l && (i > 0 || l === "close" || l === "medium") ? l : null;
  });
  const want = raw.map((r, i) => locked[i] ?? sizeOf(r.shot_size));
  const subj: ReelSubject[] = raw.map((r, i) => subjectOf(r.subject) ?? (want[i] === "broll" ? "none" : "both"));
  if (!hasFace(subj[0])) subj[0] = "both";
  if (mirrors(n)) subj[n - 1] = subj[0];

  const size: (ReelShotSize | null)[] = new Array(n).fill(null);
  const fixed = new Array<boolean>(n).fill(false);
  // the mirrored last line is not part of the mix
  const counted = (i: number) => !(mirrors(n) && i === n - 1);
  const range = mixRange(mirrors(n) ? n - 1 : n);
  const count = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<MixBucket, number>;
  const put = (i: number, s: ReelShotSize, fix = false) => {
    if (size[i] && counted(i)) count[bucketOf(size[i]!)]--;
    size[i] = s;
    if (counted(i)) count[bucketOf(s)]++;
    if (fix) fixed[i] = true;
  };

  // 1. line 1: Gemini's close/medium, else the one the mix needs more
  const first: ReelShotSize = want[0] === "close" || want[0] === "medium" ? want[0]
    : range.medium.target - count.medium >= range.close.target - count.close ? "medium" : "close";
  put(0, first, true);
  // locked sizes (the idea says so) stay as written
  for (let i = 1; i < n; i++) if (locked[i]) put(i, locked[i]!, true);
  // 7. the last line mirrors line 1 (its size only when the idea implies none)
  if (mirrors(n) && !locked[n - 1]) put(n - 1, first, true);
  // 5. the establishing wide: Gemini's at line 2 or 3 (when that line is not the mirrored last), else line 2, else 3
  if (n >= 2) {
    const at = want[1] === "wide" ? 1 : n > 3 && want[2] === "wide" ? 2 : !fixed[1] ? 1 : 2;
    if (at < n && !fixed[at]) put(at, "wide", true);
  }

  const shotAt = (i: number): Shot | null => (size[i] ? { shot_size: size[i]!, subject: subj[i] } : null);
  /** Would line i with size s break a local rule (with every assigned neighbour)? */
  const fits = (i: number, s: ReelShotSize): boolean => {
    if (i === 0 && s !== "close" && s !== "medium") return false;
    const me: Shot = { shot_size: s, subject: subj[i] };
    const at = (j: number) => (j === i ? me : shotAt(j));
    for (const j of [i - 1, i + 1]) {
      const o = j >= 0 && j < n ? at(j) : null;
      if (o && o.shot_size === s && o.subject === subj[i]) return false;
    }
    for (let a = i - 2; a <= i; a++) {
      if (a < 0 || a + 2 >= n) continue;
      const w = [at(a), at(a + 1), at(a + 2)];
      if (w.every((x) => x && isFaceShot(x))) return false;
    }
    for (let a = i - 3; a <= i; a++) {
      if (a < 0 || a + 3 >= n) continue;
      const w = [at(a), at(a + 1), at(a + 2), at(a + 3)];
      if (w.every((x) => x !== null) && !w.some((x) => isFaceFree(x!))) return false;
    }
    return true;
  };
  const roomIn = (s: ReelShotSize) => count[bucketOf(s)] < range[bucketOf(s)].hi;
  /** Sizes in the order the mix needs them most (most below target first). */
  const needed = (i: number): ReelShotSize[] => [...BUCKETS]
    .sort((a, b) => (count[a] - range[a].target) - (count[b] - range[b].target) || BUCKETS.indexOf(a) - BUCKETS.indexOf(b))
    .map((b) => SIZE_FOR[b](subj[i]));

  // left to right: keep Gemini's size when it fits and its bucket has room, else the most-needed size that fits
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    const w = want[i];
    const pick = w && fits(i, w) && roomIn(w) ? w
      : needed(i).find((s) => fits(i, s) && roomIn(s))
        ?? (["detail", "broll", "pov", "medium", "close", "wide"] as ReelShotSize[]).find((s) => fits(i, s))!;
    put(i, pick);
  }

  // rebalance: a bucket below its range takes a line from a bucket above target, a bucket above its range gives a
  // line to a bucket below target, wherever no rule breaks
  const tryMove = (i: number, s: ReelShotSize) => {
    const old = size[i]!;
    size[i] = null;
    const ok = fits(i, s);
    size[i] = old;
    if (ok) put(i, s);
    return ok;
  };
  for (let guard = 0; guard < 4 * n; guard++) {
    const short = BUCKETS.find((b) => count[b] < range[b].lo);
    const over = BUCKETS.find((b) => count[b] > range[b].hi);
    if (!short && !over) break;
    let moved = false;
    for (let i = 1; i < n && !moved; i++) {
      if (fixed[i]) continue;
      const from = bucketOf(size[i]!);
      if (short) {
        if (from === short || count[from] - 1 < range[from].lo || count[from] <= range[from].target) continue;
        moved = tryMove(i, SIZE_FOR[short](subj[i]));
      } else if (from === over) {
        moved = BUCKETS.filter((b) => b !== over && count[b] < range[b].target && count[b] < range[b].hi)
          .some((b) => tryMove(i, SIZE_FOR[b](subj[i])));
      }
    }
    if (!moved) break;
  }
  const result = size.map((s, i) => ({ shot_size: s!, subject: subj[i] }));
  return shotListIssues(result).length ? search(result, fixed, want) : result;
}

/**
 * The rare list the greedy pass can't settle (e.g. almost every line the same subject): a deterministic local search
 * over the free lines' sizes — steepest descent on (rules broken, then sizes changed from Gemini's), with seeded
 * random kicks when stuck. Returns the best list found.
 */
function search(start: Shot[], fixed: readonly boolean[], want: readonly (ReelShotSize | null)[]): Shot[] {
  const n = start.length;
  const cost = (xs: Shot[]) => shotListIssues(xs).length * 1000 + xs.reduce((c, x, i) => c + (want[i] && x.shot_size !== want[i] ? 1 : 0), 0);
  let seed = n * 7919 + 17;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const free = start.map((_, i) => i).filter((i) => !fixed[i]);
  let cur = start.map((x) => ({ ...x }));
  let curCost = cost(cur);
  let best = cur, bestCost = curCost;
  for (let iter = 0; iter < 400 && bestCost >= 1000 && free.length; iter++) {
    let move: { i: number; s: ReelShotSize; c: number } | null = null;
    for (const i of free) {
      for (const s of REEL_SHOT_SIZES) {
        if (s === cur[i].shot_size) continue;
        const next = cur.map((x, j) => (j === i ? { ...x, shot_size: s } : x));
        const c = cost(next);
        if (c < curCost && (!move || c < move.c)) move = { i, s, c };
      }
    }
    if (move) {
      cur = cur.map((x, j) => (j === move!.i ? { ...x, shot_size: move!.s } : x));
      curCost = move.c;
    } else {
      // stuck: kick two random free lines to random sizes
      cur = cur.map((x) => ({ ...x }));
      for (let k = 0; k < 2; k++) cur[free[Math.floor(rnd() * free.length)]].shot_size = REEL_SHOT_SIZES[Math.floor(rnd() * REEL_SHOT_SIZES.length)];
      curCost = cost(cur);
    }
    if (curCost < bestCost) { best = cur; bestCost = curCost; }
  }
  return best;
}

// ---------------------------------------------------------------- punch-ins (stressed words)

/** At most this many punch-ins per reel (playbook: 2-4). */
export const PUNCH_MAX = 4;
/** A punch is one stressed word or a short phrase. */
export const PUNCH_MAX_WORDS = 3;
const tokens = (s: string) => s.replace(/[’]/g, "'").split(/\s+/).filter(Boolean);
const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");

/**
 * The punch phrase as it is written in the narration (verbatim words, edge punctuation dropped), or null when it is
 * empty, longer than PUNCH_MAX_WORDS words, or not in the line (matched word by word, case-insensitive).
 */
export function punchIn(narration: string, punch: unknown): string | null {
  if (typeof punch !== "string") return null;
  const want = tokens(punch).map(bare).filter(Boolean);
  if (!want.length || want.length > PUNCH_MAX_WORDS) return null;
  const line = tokens(narration ?? "");
  const words = line.map(bare);
  for (let i = 0; i + want.length <= words.length; i++) {
    if (want.every((w, k) => words[i + k] === w)) {
      return line.slice(i, i + want.length).join(" ").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
    }
  }
  return null;
}

/**
 * At most PUNCH_MAX punches, the first ones kept; when there are too many and none of the kept ones is in the last 30 %
 * (the emotional turn), the first punch there replaces the last kept one (the render plays an impact on it).
 */
export function capPunches(punches: readonly (string | null)[]): (string | null)[] {
  const n = punches.length;
  const at = punches.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (at.length <= PUNCH_MAX) return [...punches];
  const turn = Math.floor(0.7 * n);
  let keep = at.slice(0, PUNCH_MAX);
  if (!keep.some((i) => i >= turn)) {
    const late = at.find((i) => i >= turn);
    if (late !== undefined) keep = [...keep.slice(0, PUNCH_MAX - 1), late];
  }
  return punches.map((p, i) => (keep.includes(i) ? p : null));
}
