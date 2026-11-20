import { describe, expect, it } from "vitest";
import {
  AFTERNOON, MORNING, addDays, dayLabel, firstDay, labelText, lastFacebook, manilaDay, nextLabel, planProblems, planRun,
} from "@/lib/autopilot/plan";
import { seededRandom } from "@/lib/planner/random";

const THEMES = ["Unique and modern", "Biblical"];
const minuteOfDay = (iso: string) => { const d = new Date(Date.parse(iso) + 8 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

describe("the name flow", () => {
  it("goes A..Z, then the name themes in order, then back to A", () => {
    expect(nextLabel(null, THEMES)).toEqual({ letter: "A", nameTheme: null });
    expect(nextLabel({ letter: "R", nameTheme: null }, THEMES)).toEqual({ letter: "S", nameTheme: null });
    expect(nextLabel({ letter: "Z", nameTheme: null }, THEMES)).toEqual({ letter: null, nameTheme: "Unique and modern" });
    expect(nextLabel({ letter: null, nameTheme: "unique and MODERN" }, THEMES)).toEqual({ letter: null, nameTheme: "Biblical" });
    expect(nextLabel({ letter: null, nameTheme: "Biblical" }, THEMES)).toEqual({ letter: "A", nameTheme: null });
    expect(nextLabel({ letter: null, nameTheme: "Removed theme" }, THEMES)).toEqual({ letter: null, nameTheme: "Unique and modern" });
    expect(nextLabel({ letter: "Z", nameTheme: null }, [])).toEqual({ letter: "A", nameTheme: null });
  });
});

describe("days", () => {
  const now = Date.parse("2026-11-20T03:00:00Z"); // Fri Nov 20, 11 AM Manila
  it("starts the day after the last Facebook post, never before tomorrow", () => {
    expect(manilaDay(now)).toBe("2026-11-20");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(firstDay(null, now)).toBe("2026-11-21");
    expect(firstDay("2026-11-19T05:29:00Z", now)).toBe("2026-11-21");
    expect(firstDay("2026-11-24T05:29:00Z", now)).toBe("2026-11-25");
    expect(firstDay("2026-11-24T17:30:00Z", now)).toBe("2026-11-26"); // 1:30 AM Nov 25 in Manila
    expect(dayLabel("2026-11-21")).toBe("Sat, Nov 21");
  });
  it("finds the last Facebook time and the last letter or theme", () => {
    const posts = [
      { fb_state: "scheduled", fb_scheduled_for: "2026-11-19T05:29:00Z", posted_at: "2026-11-19T05:29:00Z", letter: "R", name_theme: null },
      { fb_state: "published", fb_scheduled_for: null, posted_at: "2026-11-18T01:30:00Z", letter: "Q", name_theme: null },
      { fb_state: "failed", fb_scheduled_for: null, posted_at: "2026-11-25T01:30:00Z", letter: "Z", name_theme: null },
      { fb_state: "published", fb_scheduled_for: null, posted_at: "2026-11-20T01:00:00Z", letter: null, name_theme: null },
    ] as const;
    expect(lastFacebook([...posts])).toEqual({ at: "2026-11-20T01:00:00Z", label: { letter: "R", nameTheme: null } });
    expect(lastFacebook([])).toEqual({ at: null, label: null });
  });
});

describe("planRun", () => {
  const plan = (rng = seededRandom(7)) => planRun({ firstDay: "2026-11-21", days: 7, last: { letter: "R", nameTheme: null }, themes: THEMES, minImages: 6, maxImages: 26, rng });
  it("two posts a day, one boy and one girl, letters S..Y", () => {
    const items = plan();
    expect(items).toHaveLength(14);
    for (let d = 0; d < 7; d++) {
      const day = items.filter((i) => i.day === addDays("2026-11-21", d));
      expect(day.map((i) => i.slot)).toEqual(["morning", "afternoon"]);
      expect(day.map((i) => i.gender).sort()).toEqual(["boy", "girl"]);
      expect(new Set(day.map((i) => i.letter)).size).toBe(1);
    }
    expect([...new Set(items.map((i) => i.letter))]).toEqual(["S", "T", "U", "V", "W", "X", "Y"]);
  });
  it("random minutes inside the windows, different from day to day, and random morning gender", () => {
    const items = plan();
    const mornings = items.filter((i) => i.slot === "morning").map((i) => minuteOfDay(i.scheduledFor));
    const afternoons = items.filter((i) => i.slot === "afternoon").map((i) => minuteOfDay(i.scheduledFor));
    expect(mornings.every((m) => m >= MORNING.from && m <= MORNING.to)).toBe(true);
    expect(afternoons.every((m) => m >= AFTERNOON.from && m <= AFTERNOON.to)).toBe(true);
    expect(new Set(mornings).size).toBeGreaterThan(3);
    expect(new Set(items.filter((i) => i.slot === "morning").map((i) => i.gender)).size).toBe(2);
    expect(items.every((i) => i.nameCount >= 10 && i.nameCount <= 15)).toBe(true);
  });
  it("keeps the name count inside the settings min/max", () => {
    const items = planRun({ firstDay: "2026-11-21", days: 1, last: null, themes: [], minImages: 6, maxImages: 9, rng: () => 0.99 });
    expect(items.every((i) => i.nameCount === 9)).toBe(true);
  });
});

describe("planProblems", () => {
  it("says when a gender runs out of photoshoot themes, and from which day", () => {
    const items = planRun({ firstDay: "2026-11-21", days: 3, last: null, themes: [], minImages: 6, maxImages: 26, rng: seededRandom(1) });
    expect(planProblems(items, { boy: 3, girl: 3 })).toEqual([]);
    expect(planProblems(items, { boy: 3, girl: 1 })).toEqual(["Only 1 girl photoshoot theme is left: the girl posts from Sun, Nov 22 will be held. Add girl themes first."]);
    expect(labelText({ letter: "S" })).toBe("Letter S");
    expect(labelText({ letter: null, nameTheme: "Biblical" })).toBe("Biblical names");
  });
});
