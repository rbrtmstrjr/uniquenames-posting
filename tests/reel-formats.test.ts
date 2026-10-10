import { describe, expect, it } from "vitest";
import { FORMAT_SPECS, keyPhrase, nextFormat, REEL_FORMATS, isReelFormat } from "@/lib/reels/formats";
import { isHealthTopic, pickTopic, REEL_TOPICS, topicById } from "@/lib/reels/topics";

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
    // 60-90 s reels: more substance per format, so more exact words to say
    expect(FORMAT_SPECS.named_method.minQuotes).toBeGreaterThanOrEqual(4);
    expect(FORMAT_SPECS.say_this.minQuotes).toBeGreaterThanOrEqual(4);
    for (const x of ["lola_science", "scene_lesson", "problem_fix"] as const) expect(FORMAT_SPECS[x].minQuotes).toBeGreaterThanOrEqual(2);
    expect(FORMAT_SPECS.named_method.beats.join(" ")).toMatch(/STEPS 1-5.*4-5 steps/);
    expect(FORMAT_SPECS.say_this.beats.join(" ")).toMatch(/SWAPS 1-5.*4-5 swaps/);
    expect(FORMAT_SPECS.lola_science.beats.join(" ")).toMatch(/WHY LOLA BELIEVED IT/);
    expect(FORMAT_SPECS.lola_science.beats.join(" ")).toMatch(/DO THIS INSTEAD: 3-4/);
    expect(FORMAT_SPECS.scene_lesson.beats.join(" ")).toMatch(/SCENE: 2-3 short lines/);
    expect(FORMAT_SPECS.scene_lesson.beats.join(" ")).toMatch(/WHEN IT DOESN'T WORK/);
    expect(FORMAT_SPECS.problem_fix.beats.join(" ")).toMatch(/FIX 2/);
    expect(FORMAT_SPECS.problem_fix.beats.join(" ")).toMatch(/IF THAT DOESN'T WORK/);
    // every format re-hooks the viewer at least once mid-reel
    for (const x of REEL_FORMATS) expect(FORMAT_SPECS[x].beats.join(" "), x).toMatch(/RE-HOOK/);
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

describe("isHealthTopic / topicById", () => {
  it("a typed topic about fever, coughs, vomiting, rashes, sleep safety, choking, allergies or medicine is a health topic", () => {
    for (const t of ["Baby has a fever at night", "Toddler cough that won't stop", "When your baby vomits after milk", "Diaper rash", "Safe sleep for newborns",
      "Choking on grapes", "Peanut allergy first taste", "Giving medicine to a toddler"]) expect(isHealthTopic(t), t).toBe(true);
    for (const t of ["Sharing toys with a cousin", "Bedtime stalling", "", null]) expect(isHealthTopic(t), String(t)).toBe(false);
  });
  it("finds a bank topic by id", () => {
    expect(topicById("kulob-fever")?.health).toBe(true);
    expect(topicById("nope")).toBeNull();
    expect(topicById(null)).toBeNull();
  });
});

describe("keyPhrase", () => {
  it("the first quoted words to say; a phrase to stop saying is skipped; null without quotes", () => {
    expect(keyPhrase(['Stop saying "calm down." Try this.', `Get low: "You're mad. Tower fell."`])).toBe("You're mad. Tower fell.");
    expect(keyPhrase([`Instead of "Don't run," say "Walking feet, please."`])).toBe("Walking feet, please.");
    // only a phrase to stop saying: it is still the reel's phrase
    expect(keyPhrase(["Instead of “Good job!”"])).toBe("Good job!");
    expect(keyPhrase(["No quotes at all."])).toBeNull();
  });
});

describe("vetted facts, safety lines and anchors", () => {
  it("every health topic has 3-5 vetted facts and a short safety line naming the doctor; other topics have none", () => {
    for (const t of REEL_TOPICS) {
      if (t.health) {
        expect(t.facts?.length, t.id).toBeGreaterThanOrEqual(3);
        expect(t.facts!.length, t.id).toBeLessThanOrEqual(5);
        expect(t.safety, t.id).toMatch(/\b(doctor|pediatrician)\b/i);
        expect(t.safety!.split(/\s+/).length, t.id).toBeLessThanOrEqual(15);
      } else {
        expect(t.facts, t.id).toBeUndefined();
        expect(t.safety, t.id).toBeUndefined();
      }
    }
    // the fever myth never claims a bath lowers a fever
    expect(topicById("bathe-sick-child")!.facts!.join(" ")).not.toMatch(/(lower|bring|cool).*(fever|temperature)/i);
  });

  it("anchors are a verified term and who uses it", () => {
    const anchored = REEL_TOPICS.filter((t) => t.anchor);
    expect(anchored.length).toBeGreaterThan(5);
    for (const t of anchored) expect(t.anchor, t.id).toMatch(/^.+ — .+$/);
    expect(topicById("labeled-praise")!.anchor).toMatch(/^labeled praise — Parent-Child Interaction Therapy/);
    expect(topicById("second-wind")!.anchor).toBeUndefined();
  });
});
