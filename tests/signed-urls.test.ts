import { describe, expect, it } from "vitest";
import { RESIGN_INTERVAL_MS, RESIGN_RETRY_MS, RESIGN_WINDOW_MS, nextResignDelay, pathsNeedingSignature } from "@/lib/realtime/signed-urls";

describe("signed URL refresh", () => {
  const now = 1_000_000_000;
  const HOUR = 3_600_000;
  it("re-signs missing paths and ones expiring within ~5 minutes", () => {
    const cache = new Map([
      ["fresh", { exp: now + 30 * 60_000 }],
      ["soon", { exp: now + 4 * 60_000 }],
      ["expired", { exp: now - 1 }],
    ]);
    expect(pathsNeedingSignature(["fresh", "soon", "expired", "new"], cache, now)).toEqual(["soon", "expired", "new"]);
    expect(RESIGN_WINDOW_MS).toBe(5 * 60_000);
  });
  it("runs the refresh timer every ~50 min for freshly signed URLs", () => {
    expect(RESIGN_INTERVAL_MS).toBe(50 * 60_000);
    expect(nextResignDelay(["p"], new Map([["p", { exp: now + HOUR }]]), now)).toBe(RESIGN_INTERVAL_MS);
  });
  it("fires earlier when a cached URL enters the re-sign window sooner, and that tick re-signs it", () => {
    const cache = new Map([["a", { exp: now + HOUR }], ["b", { exp: now + 20 * 60_000 }]]);
    const delay = nextResignDelay(["a", "b"], cache, now);
    expect(delay).toBe(15 * 60_000);
    expect(pathsNeedingSignature(["a", "b"], cache, now + delay)).toEqual(["b"]);
  });
  it("retries soon (not in a tight loop) when something is missing or already due", () => {
    expect(nextResignDelay(["x"], new Map(), now)).toBe(RESIGN_RETRY_MS);
    expect(nextResignDelay(["p"], new Map([["p", { exp: now - 1 }]]), now)).toBe(RESIGN_RETRY_MS);
  });
});
