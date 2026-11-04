import { describe, expect, it } from "vitest";
import {
  STALE_PUBLISHING_MS, defaultScheduleTime, facebookView, fromManilaInput, manilaInputValue, manilaLabel, scheduleBounds, scheduleProblem,
} from "@/lib/facebook/schedule";

describe("Manila time for the schedule picker", () => {
  it("reads and writes datetime-local values in Manila (UTC+8)", () => {
    expect(fromManilaInput("2026-11-05T19:00")!.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    expect(manilaInputValue(new Date("2026-11-05T11:00:00Z"))).toBe("2026-11-05T19:00");
    expect(fromManilaInput("")).toBeNull();
    expect(fromManilaInput("tomorrow")).toBeNull();
    expect(manilaLabel("2026-11-05T11:00:00Z")).toBe("Thu, Nov 5, 7:00 PM");
  });

  it("suggests 7 PM today, or tomorrow when today's is less than 15 minutes away", () => {
    expect(defaultScheduleTime(new Date("2026-11-05T02:00:00Z")).toISOString()).toBe("2026-11-05T11:00:00.000Z"); // 10 AM Manila
    expect(defaultScheduleTime(new Date("2026-11-05T10:50:00Z")).toISOString()).toBe("2026-11-06T11:00:00.000Z"); // 6:50 PM Manila
  });

  it("keeps the picked time inside 15 minutes to 29 days", () => {
    const now = new Date("2026-11-05T02:00:00Z");
    expect(scheduleBounds(now)).toEqual({ min: "2026-11-05T10:15", max: "2026-12-04T10:00" });
    expect(scheduleProblem(null, now)).toBe("Pick a date and time.");
    expect(scheduleProblem(new Date(now.getTime() + 10 * 60_000), now)).toMatch(/at least 15 minutes/);
    expect(scheduleProblem(new Date(now.getTime() + 30 * 24 * 3600_000), now)).toMatch(/29 days/);
    expect(scheduleProblem(new Date(now.getTime() + 3600_000), now)).toBeNull();
  });
});

describe("facebookView", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const base = { fb_state: null, fb_permalink: null, fb_scheduled_for: null, fb_attempt_at: null, fb_error: null };
  it("shows each state, and a scheduled post as posted once its time has passed", () => {
    expect(facebookView(base, now)).toEqual({ kind: "ready" });
    expect(facebookView({ ...base, fb_state: "published", fb_permalink: "https://fb/p" }, now)).toEqual({ kind: "published", link: "https://fb/p" });
    expect(facebookView({ ...base, fb_state: "scheduled", fb_scheduled_for: "2026-11-05T13:00:00Z" }, now)).toEqual({ kind: "scheduled", at: "2026-11-05T13:00:00Z" });
    expect(facebookView({ ...base, fb_state: "scheduled", fb_scheduled_for: "2026-11-05T11:00:00Z" }, now)).toMatchObject({ kind: "scheduled-done" });
    expect(facebookView({ ...base, fb_state: "failed", fb_error: "Facebook refused: x" }, now)).toEqual({ kind: "failed", error: "Facebook refused: x" });
    expect(facebookView({ ...base, fb_state: "unsure" }, now)).toEqual({ kind: "unsure" });
  });
  it("a 'publishing' cut off more than 10 minutes ago shows as unsure, never as ready", () => {
    expect(facebookView({ ...base, fb_state: "publishing", fb_attempt_at: new Date(now - 60_000).toISOString() }, now)).toEqual({ kind: "sending" });
    expect(facebookView({ ...base, fb_state: "publishing", fb_attempt_at: new Date(now - STALE_PUBLISHING_MS - 1000).toISOString() }, now)).toEqual({ kind: "unsure" });
  });
});
