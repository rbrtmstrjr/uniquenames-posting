import { describe, expect, it } from "vitest";
import { REEL_MOTIONS } from "@/lib/db/types";
import { assignMotion, capKeys, fixShots, isHookLine, REEL_EMOTIONS, REEL_SHOTS, shotOf, type MotionScene } from "@/lib/reels/motion";

const line = (emotion: string, o: Partial<MotionScene> = {}): MotionScene => ({ beat: "build", emotion, key: false, ...o });
const noRepeats = (m: string[]) => m.every((x, i) => i === 0 || x !== m[i - 1]);

describe("assignMotion", () => {
  it("the opening line punches; hook lines 2-3 alternate punch / push_in", () => {
    expect(assignMotion([line("surprised", { beat: "hook" }), line("worried", { beat: "hook" }), line("teary", { beat: "hook" })]))
      .toEqual(["punch", "push_in", "punch"]);
    // line 1 is always a hook line, whatever its beat; a 4th hook-beat line is not
    expect(isHookLine(line("tender"), 0)).toBe(true);
    expect(isHookLine(line("tender", { beat: "hook" }), 3)).toBe(false);
    expect(isHookLine(line("tender"), 1)).toBe(false);
  });

  it("other lines follow their feeling", () => {
    const m = (e: string) => assignMotion([line("tender", { beat: "hook" }), line("tender", { beat: "build" }), line(e)])[2];
    // line 2 (tender) is push_in, so line 3 is compared after a push_in
    expect(m("relieved")).toBe("pull_out");
    expect(m("proud")).toBe("pull_out");
    expect(m("curious")).toBe("pan_right");
    expect(m("playful")).toBe("pan_left");
    expect(m("determined")).toBe("tilt_up");
    expect(m("worried")).toBe("tilt_down");
    expect(m("exhausted")).toBe("tilt_down");
    const after = (e: string) => assignMotion([line("x"), line("relieved"), line(e)])[2];   // after pull_out
    expect(after("teary")).toBe("push_in");
    expect(after("cuddly")).toBe("push_in");
    expect(after("tender")).toBe("push_in");
  });

  it("never the same move twice in a row (falls to the next move for that feeling)", () => {
    expect(assignMotion([line("x"), line("teary"), line("teary"), line("teary")])).toEqual(["punch", "push_in", "tilt_down", "push_in"]);
    expect(assignMotion([line("x"), line("relieved"), line("proud")])).toEqual(["punch", "pull_out", "tilt_up"]);
  });

  it("key lines punch (push_in right after a punch); at most 3 count", () => {
    const keys = [line("x"), line("tender", { key: true }), line("proud", { key: true }), line("curious"),
      line("teary", { key: true }), line("worried", { key: true }), line("cuddly")];
    // line 2 is key but follows the opening punch → push_in; line 3 → punch; line 5 → punch; line 6's key is over the cap
    expect(assignMotion(keys)).toEqual(["punch", "push_in", "punch", "pan_right", "punch", "tilt_down", "push_in"]);
    expect(capKeys(keys)).toEqual([false, true, true, false, true, false, false]);
  });

  it("is deterministic, uses only the 7 presets and never repeats across every feeling pair", () => {
    const lines: MotionScene[] = [line("x", { beat: "hook" })];
    for (const a of REEL_EMOTIONS) for (const b of REEL_EMOTIONS) lines.push(line(a), line(b));
    lines.push(line("tender", { key: true }), line("tender", { key: true }));
    const m = assignMotion(lines);
    expect(m).toEqual(assignMotion(lines));
    expect(m).toHaveLength(lines.length);
    expect(m.every((x) => (REEL_MOTIONS as readonly string[]).includes(x))).toBe(true);
    expect(noRepeats(m)).toBe(true);
    // 'punch' is kept for hook and key lines
    expect(m.filter((x) => x === "punch").length).toBeLessThanOrEqual(1 + 3);
  });

  it("unknown or missing feelings cycle the calm moves; empty in, empty out", () => {
    const m = assignMotion([line("x"), line("?"), line(""), { beat: "build" }, line("nope"), line("nope"), line("nope"), line("nope")]);
    expect(noRepeats(m)).toBe(true);
    expect(m.slice(1).every((x) => x !== "punch")).toBe(true);
    expect(assignMotion([])).toEqual([]);
  });
});

describe("fixShots", () => {
  it("keeps valid shots, normalises spelling, never repeats, fills unknowns", () => {
    expect(shotOf("Over the shoulder")).toBe("over-the-shoulder");
    expect(shotOf("HANDS_DETAIL")).toBe("hands-detail");
    expect(shotOf("close-up")).toBeNull();
    const out = fixShots(["wide", "wide", "wide", null, "medium", "medium", "x"]);
    expect(out[0]).toBe("wide");
    expect(out[4]).toBe("medium");
    out.forEach((s, i) => { expect(REEL_SHOTS).toContain(s); if (i) expect(s, `${i}`).not.toBe(out[i - 1]); });
    // a filled shot also differs from the next line's own choice
    const f = fixShots(["medium", "?", "wide"]);
    expect(f[1]).not.toBe("medium");
    expect(f[1]).not.toBe("wide");
    expect(fixShots([])).toEqual([]);
  });
});
