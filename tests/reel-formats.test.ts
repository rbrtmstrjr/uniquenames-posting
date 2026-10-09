import { describe, expect, it } from "vitest";
import { FORMAT_SPECS, nextFormat, REEL_FORMATS, isReelFormat } from "@/lib/reels/formats";
import { pickTopic, REEL_TOPICS } from "@/lib/reels/topics";

describe("REEL_FORMATS / FORMAT_SPECS", () => {
  it("five formats, each with a label, its beats and the quotes it needs", () => {
    expect(REEL_FORMATS).toEqual(["named_method", "say_this", "lola_science", "scene_lesson", "problem_fix"]);
    for (const f of REEL_FORMATS) {
      const s = FORMAT_SPECS[f];
      expect(s.id).toBe(f);
      expect(s.label.length).toBeGreaterThan(3);
      expect(s.beats.length).toBeGreaterThanOrEqual(4);
      expect(s.minQuotes).toBeGreaterThanOrEqual(1);
    }
    expect(FORMAT_SPECS.named_method.minQuotes).toBeGreaterThanOrEqual(3);
    expect(FORMAT_SPECS.say_this.minQuotes).toBeGreaterThanOrEqual(3);
    expect(FORMAT_SPECS.lola_science.beats.join(" ")).toMatch(/lola/i);
    expect(isReelFormat("say_this")).toBe(true);
    expect(isReelFormat("pov")).toBe(false);
    expect(isReelFormat(null)).toBe(false);
  });
});

describe("nextFormat", () => {
  it("no history: the first format", () => {
    expect(nextFormat([])).toBe("named_method");
    expect(nextFormat([null, undefined, "nope"])).toBe("named_method");
  });

  it("never the same as the newest reel", () => {
    for (const f of REEL_FORMATS) expect(nextFormat([f])).not.toBe(f);
    expect(nextFormat(["named_method"])).toBe("say_this");
  });

  it("least recently used among the last 5; never-used formats first, in list order", () => {
    expect(nextFormat(["say_this", "named_method"])).toBe("lola_science");
    expect(nextFormat(["problem_fix", "scene_lesson", "lola_science", "say_this", "named_method"])).toBe("named_method");
    expect(nextFormat(["named_method", "problem_fix", "scene_lesson", "lola_science", "say_this"])).toBe("say_this");
    // only the last 5 count: an older use does not make a format "recent"
    expect(nextFormat(["say_this", "lola_science", "scene_lesson", "problem_fix", "say_this", "named_method"])).toBe("named_method");
  });

  it("ignores unknown and null values (old reels without a format)", () => {
    expect(nextFormat([null, "say_this", "pov", undefined])).toBe("named_method");
    expect(nextFormat(["junk", "named_method"])).toBe("say_this");
  });
});

describe("REEL_TOPICS", () => {
  it("the researched bank: at least 50 ideas, unique kebab-case ids, every format used", () => {
    expect(REEL_TOPICS.length).toBeGreaterThanOrEqual(50);
    const ids = REEL_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of REEL_TOPICS) {
      expect(t.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(t.topic.length).toBeGreaterThan(10);
      expect(t.topic.length).toBeLessThanOrEqual(120);
      expect(REEL_FORMATS).toContain(t.format);
    }
    for (const f of REEL_FORMATS) expect(REEL_TOPICS.some((t) => t.format === f), f).toBe(true);
  });

  it("fever, sleep and feeding ideas are health topics; tantrum scripts are not", () => {
    const health = (re: RegExp) => REEL_TOPICS.filter((t) => re.test(t.topic));
    for (const re of [/fever/i, /sick child/i, /wet hair/i, /bedtime/i, /picky|bite|tries/i]) {
      const hits = health(re);
      expect(hits.length, String(re)).toBeGreaterThan(0);
      for (const t of hits) expect(t.health, t.id).toBe(true);
    }
    expect(REEL_TOPICS.find((t) => /tantrum/i.test(t.topic))!.health).toBe(false);
  });
});

describe("pickTopic", () => {
  const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

  it("prefers a topic of the rotated format that was not used lately", () => {
    for (const f of REEL_FORMATS) {
      const t = pickTopic(f, [], seq(0.5));
      expect(t.format).toBe(f);
    }
  });

  it("skips the recent ids; deterministic with the same rng", () => {
    const say = REEL_TOPICS.filter((t) => t.format === "say_this");
    const recent = say.slice(0, say.length - 1).map((t) => t.id);
    expect(pickTopic("say_this", recent, seq(0.99)).id).toBe(say[say.length - 1].id);
    expect(pickTopic("named_method", [], seq(0.3)).id).toBe(pickTopic("named_method", [], seq(0.3)).id);
  });

  it("every topic of the format used lately: any other topic not used lately; all used: any topic", () => {
    const lola = REEL_TOPICS.filter((t) => t.format === "lola_science").map((t) => t.id);
    const t = pickTopic("lola_science", lola, seq(0));
    expect(lola).not.toContain(t.id);
    const all = REEL_TOPICS.map((x) => x.id);
    expect(all).toContain(pickTopic("problem_fix", all, seq(0.42)).id);
  });
});
