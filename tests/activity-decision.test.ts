import { describe, expect, it } from "vitest";
import { decideLoad } from "@/lib/status/activity-decision";

describe("decideLoad", () => {
  it("query error changes nothing and keeps lastActive", () => {
    expect(decideLoad({ seq: 3, latestSeq: 3, errored: true, lastActive: "p1", generatingPostId: null }))
      .toEqual({ apply: false, finished: null, nextLastActive: "p1" });
  });
  it("stale sequence is ignored", () => {
    expect(decideLoad({ seq: 2, latestSeq: 3, errored: false, lastActive: "p1", generatingPostId: null }).apply).toBe(false);
  });
  it("a generating post becomes the active one", () => {
    expect(decideLoad({ seq: 1, latestSeq: 1, errored: false, lastActive: null, generatingPostId: "p1" }))
      .toEqual({ apply: true, finished: null, nextLastActive: "p1" });
  });
  it("generating then none reports finished exactly once", () => {
    const first = decideLoad({ seq: 2, latestSeq: 2, errored: false, lastActive: "p1", generatingPostId: null });
    expect(first).toEqual({ apply: true, finished: "p1", nextLastActive: null });
    const again = decideLoad({ seq: 3, latestSeq: 3, errored: false, lastActive: first.nextLastActive, generatingPostId: null });
    expect(again.finished).toBeNull();
  });
});
