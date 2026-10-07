import { describe, expect, it } from "vitest";
import {
  bucketOf, hasFace, isFaceFree, isFaceShot, mixRange, repairShotList, REEL_SHOT_SIZES, REEL_SUBJECTS, shotListIssues, sizeOf, subjectOf,
  type Shot, type ReelShotSize, type ReelSubject,
} from "@/lib/reels/shots";

const sh = (shot_size: ReelShotSize, subject: ReelSubject): Shot => ({ shot_size, subject });
/** A list that follows every rule (10 lines: 2 wide / 3 medium / 2 close / 2 detail / 1 pov). */
const GOOD: Shot[] = [
  sh("close", "both"), sh("wide", "both"), sh("detail", "object"), sh("medium", "mom"), sh("close", "baby"),
  sh("detail", "mom"), sh("medium", "both"), sh("wide", "baby"), sh("pov", "baby"), sh("close", "both"),
];
const GOOD_FIXED: Shot[] = [...GOOD.slice(0, 7), sh("broll", "none"), sh("medium", "baby"), sh("close", "both")];

/** Seeded random (mulberry32) so the fuzz test is deterministic. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("shot sizes and subjects", () => {
  it("normalises Gemini's spelling", () => {
    expect(sizeOf("Close-up")).toBe("close");
    expect(sizeOf("B-roll")).toBe("broll");
    expect(sizeOf("POV")).toBe("pov");
    expect(sizeOf("medium shot")).toBe("medium");
    expect(sizeOf("macro")).toBe("detail");
    expect(sizeOf("hands-detail")).toBeNull();
    expect(sizeOf(3)).toBeNull();
    expect(subjectOf("Mother")).toBe("mom");
    expect(subjectOf("dad")).toBe("mom");
    expect(subjectOf("toddler")).toBe("baby");
    expect(subjectOf("BOTH")).toBe("both");
    expect(subjectOf("cat")).toBeNull();
    expect([...REEL_SHOT_SIZES]).toEqual(["wide", "medium", "close", "detail", "pov", "broll"]);
    expect([...REEL_SUBJECTS]).toEqual(["mom", "baby", "both", "object", "none"]);
  });

  it("face shot vs face-free: a wide is neither; detail / B-roll / object / none are face-free", () => {
    expect(hasFace("both") && hasFace("mom") && hasFace("baby")).toBe(true);
    expect(hasFace("object") || hasFace("none")).toBe(false);
    expect(isFaceShot(sh("close", "mom"))).toBe(true);
    expect(isFaceShot(sh("pov", "baby"))).toBe(true);
    expect(isFaceShot(sh("wide", "both"))).toBe(false);
    expect(isFaceFree(sh("wide", "both"))).toBe(false);
    expect(isFaceFree(sh("detail", "mom"))).toBe(true);
    expect(isFaceFree(sh("broll", "both"))).toBe(true);
    expect(isFaceFree(sh("medium", "object"))).toBe(true);
    expect(bucketOf("pov")).toBe("povBroll");
    expect(bucketOf("broll")).toBe("povBroll");
  });

  it("mix per 10 ≈ 2 wide / 3 medium / 2 close / 2 detail / 1 pov-or-broll, ± max(1, n/10)", () => {
    expect(mixRange(10)).toEqual({
      wide: { target: 2, lo: 1, hi: 3 }, medium: { target: 3, lo: 2, hi: 4 }, close: { target: 2, lo: 1, hi: 3 },
      detail: { target: 2, lo: 1, hi: 3 }, povBroll: { target: 1, lo: 0, hi: 2 },
    });
    expect(mixRange(30).medium).toEqual({ target: 9, lo: 6, hi: 12 });
  });
});

describe("shotListIssues", () => {
  it("a list that follows every rule has no issues", () => {
    expect(shotListIssues(GOOD_FIXED)).toEqual([]);
  });

  it("names each broken rule", () => {
    const has = (shots: Shot[], re: RegExp) => expect(shotListIssues(shots).some((x) => re.test(x)), String(re)).toBe(true);
    has([sh("detail", "object"), ...GOOD_FIXED.slice(1, 9), sh("detail", "object")], /Line 1 needs a face/);
    has([sh("wide", "both"), ...GOOD_FIXED.slice(1)], /Line 1 needs a close-up or medium/);
    has([GOOD_FIXED[0], sh("wide", "both"), sh("wide", "both"), ...GOOD_FIXED.slice(3)], /Line 3 repeats line 2/);
    has([GOOD_FIXED[0], sh("wide", "both"), sh("medium", "mom"), sh("close", "baby"), sh("pov", "both"), ...GOOD_FIXED.slice(5)], /3 face shots in a row/);
    has([GOOD_FIXED[0], sh("wide", "both"), sh("medium", "mom"), sh("wide", "baby"), sh("close", "both"), ...GOOD_FIXED.slice(5)], /no face-free shot/);
    has([GOOD_FIXED[0], sh("medium", "mom"), sh("detail", "object"), ...GOOD_FIXED.slice(3)], /Line 2 or 3 needs an establishing wide/);
    has(GOOD_FIXED.map((x, i) => (i > 0 && i < 9 && i % 2 ? sh("wide", x.subject) : x)), /wide shots/);
    has([...GOOD_FIXED.slice(0, 9), sh("close", "mom")], /does not mirror line 1/);
    const settings = GOOD_FIXED.map((_, i) => (i === 9 ? "the kitchen at noon" : "the nursery at 3 a.m."));
    expect(shotListIssues(GOOD_FIXED, settings)).toEqual(["The last line is not set where line 1 is."]);
  });
});

describe("repairShotList", () => {
  it("keeps a list that already follows the rules", () => {
    expect(repairShotList(GOOD_FIXED)).toEqual(GOOD_FIXED);
  });

  it("the owner's complaint: 10 × 'mom holding baby' becomes a varied list that follows every rule", () => {
    const same = Array.from({ length: 10 }, () => ({ shot_size: "medium", subject: "both" }));
    const out = repairShotList(same);
    expect(shotListIssues(out)).toEqual([]);
    expect(new Set(out.map((x) => x.shot_size)).size).toBeGreaterThanOrEqual(4);
    expect(out.filter((x) => x.subject === "both")).toHaveLength(10);   // subjects stay: they match the picture idea
  });

  it("line 1 gets a face and a close/medium size; the last line mirrors it; line 2 becomes the establishing wide", () => {
    const out = repairShotList([{ shot_size: "wide", subject: "object" }, { shot_size: "medium", subject: "mom" },
      { shot_size: "detail", subject: "object" }, { shot_size: "close", subject: "baby" }, { shot_size: "wide", subject: "none" }]);
    expect(out[0].subject).toBe("both");
    expect(["close", "medium"]).toContain(out[0].shot_size);
    expect(out[1].shot_size).toBe("wide");
    expect(out[4]).toEqual(out[0]);
    expect(shotListIssues(out)).toEqual([]);
  });

  it("Gemini's wide at line 3 is kept as the establishing wide", () => {
    const raw = GOOD_FIXED.map((x) => ({ ...x }));
    raw[1] = { shot_size: "detail", subject: "object" };
    raw[2] = { shot_size: "wide", subject: "both" };
    const out = repairShotList(raw);
    expect(out[2].shot_size).toBe("wide");
    expect(out[1].shot_size).not.toBe("wide");
    expect(shotListIssues(out)).toEqual([]);
  });

  it("unknown sizes / subjects are filled (B-roll defaults to nobody in frame)", () => {
    const out = repairShotList([{}, { shot_size: "??" }, { shot_size: "broll" }, { subject: "cat" }, {}, {}]);
    expect(out[2]).toEqual({ shot_size: "broll", subject: "none" });
    expect(shotListIssues(out)).toEqual([]);
    expect(repairShotList([])).toEqual([]);
  });

  it("fuzz: any list of 2-40 lines comes out following every rule, deterministically", () => {
    const r = rng(42);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let k = 0; k < 1500; k++) {
      const n = 2 + Math.floor(r() * 39);
      // biased like Gemini's drift: mostly medium / both, sometimes junk; every 3rd list has one subject throughout
      const only = k % 3 === 0 ? pick(REEL_SUBJECTS) : null;
      const raw = Array.from({ length: n }, () => ({
        shot_size: r() < 0.5 ? "medium" : r() < 0.1 ? "junk" : pick(REEL_SHOT_SIZES),
        subject: only ?? (r() < 0.6 ? "both" : r() < 0.1 ? undefined : pick(REEL_SUBJECTS)),
      }));
      const out = repairShotList(raw);
      expect(out).toHaveLength(n);
      expect(shotListIssues(out), JSON.stringify(raw)).toEqual([]);
      expect(repairShotList(raw)).toEqual(out);
    }
  });
});

describe("punch-ins", () => {
  it("punchIn: verbatim from the line (case / punctuation tolerant), ≤ 3 words, else null", async () => {
    const { punchIn } = await import("@/lib/reels/shots");
    expect(punchIn("It goes by so FAST, mama.", "fast")).toBe("FAST");
    expect(punchIn("You'll carry them for the last time.", "the last time")).toBe("the last time");
    expect(punchIn("You'll carry them for the last time.", "  \"last time.\" ")).toBe("last time");
    expect(punchIn("You'll carry them for the last time.", "You'll")).toBe("You'll");
    expect(punchIn("You will carry them.", "forever")).toBeNull();
    expect(punchIn("You will carry them for the very last time.", "the very last time")).toBeNull();
    expect(punchIn("fastest", "fast")).toBeNull();
    expect(punchIn("x", "")).toBeNull();
    expect(punchIn("x", null)).toBeNull();
  });

  it("capPunches: at most 4, keeping one in the last 30 % when there is one", async () => {
    const { capPunches } = await import("@/lib/reels/shots");
    const ten = ["a", null, "b", "c", null, "d", "e", null, "f", null];
    expect(capPunches(ten)).toEqual(["a", null, "b", "c", null, null, null, null, "f", null]);
    const early = ["a", "b", "c", "d", "e", null, null, null, null, null];
    expect(capPunches(early)).toEqual(["a", "b", "c", "d", null, null, null, null, null, null]);
    expect(capPunches([null, "a", null])).toEqual([null, "a", null]);
  });
});
