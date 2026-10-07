import { describe, expect, it } from "vitest";
import { REEL_MOTIONS, REEL_MOTIONS_V2 } from "@/lib/db/types";
import { assignMotion, REEL_SHOTS, shotOf } from "@/lib/reels/motion";

const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
const noRepeats = (m: string[]) => m.every((x, i) => i === 0 || x !== m[i - 1]);

describe("assignMotion v2 (push_in / pull_out / hold)", () => {
  it("alternates push_in / pull_out, holds every 5th line and the payoff line", () => {
    expect(assignMotion(lines(12))).toEqual([
      "push_in", "pull_out", "push_in", "pull_out", "hold",
      "push_in", "pull_out", "push_in", "pull_out", "hold",
      "push_in", "hold",
    ]);
  });

  it("the line before the payoff never holds (no hold twice in a row)", () => {
    expect(assignMotion(lines(6))).toEqual(["push_in", "pull_out", "push_in", "pull_out", "push_in", "hold"]);
    expect(assignMotion(lines(5))).toEqual(["push_in", "pull_out", "push_in", "pull_out", "hold"]);
    expect(assignMotion(lines(2))).toEqual(["push_in", "hold"]);
    expect(assignMotion(lines(1))).toEqual(["push_in"]);
    expect(assignMotion([])).toEqual([]);
  });

  it("for any length: only the v2 moves, never the same twice in a row, ~1 hold in 5, deterministic", () => {
    for (let n = 1; n <= 40; n++) {
      const m = assignMotion(lines(n));
      expect(m).toHaveLength(n);
      expect(m.every((x) => (REEL_MOTIONS_V2 as readonly string[]).includes(x)), `${n}`).toBe(true);
      expect(noRepeats(m), `${n}`).toBe(true);
      expect(m.filter((x) => x === "hold").length).toBeLessThanOrEqual(Math.floor(n / 5) + 1);
      if (n >= 2) expect(m[n - 1]).toBe("hold");
      expect(m[0]).toBe("push_in");
      expect(assignMotion(lines(n))).toEqual(m);
    }
  });

  it("the DB keeps the old moves valid (older rows) and adds hold", () => {
    expect([...REEL_MOTIONS]).toEqual(["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "punch", "hold"]);
    expect([...REEL_MOTIONS_V2]).toEqual(["push_in", "pull_out", "hold"]);
  });
});

describe("007 framings stay readable (older lines)", () => {
  it("normalises spelling", () => {
    expect(shotOf("Over the shoulder")).toBe("over-the-shoulder");
    expect(shotOf("HANDS_DETAIL")).toBe("hands-detail");
    expect(shotOf("close-up")).toBeNull();
    expect(REEL_SHOTS).toHaveLength(6);
  });
});
