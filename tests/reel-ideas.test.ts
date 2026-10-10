import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextFormat, REEL_FORMATS } from "@/lib/reels/formats";
import { REEL_TOPICS, topicById } from "@/lib/reels/topics";
import {
  BANK_IDEAS, EXCLUDE_MAX, FRESH_IDEAS, formatSpread, IDEA_COUNT, ideaKey, pickBankIdeas, TEMPLATE_WHY, templateHook,
} from "@/lib/reels/topic-ideas";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { buildIdeas, hookProblem, ideasPrompt, methodNames, reusesBankMethod, sameIdea, suggestTopicIdeas, topicProblem, whyProblem, BANK_ASK, FRESH_ASK } = await import("@/lib/ai/reel-ideas");

beforeEach(() => { generateJson.mockReset(); });
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe("formatSpread", () => {
  it("starts with the rotated format and spreads 5 different ones", () => {
    expect(formatSpread([], 5)).toEqual(["named_method", "say_this", "lola_science", "scene_lesson", "problem_fix"]);
    const recent = ["say_this", "named_method", "problem_fix"];
    const s = formatSpread(recent, 5);
    expect(s[0]).toBe(nextFormat(recent));
    expect(new Set(s).size).toBe(5);
  });
});

describe("pickBankIdeas", () => {
  it("never picks a recent topic or one already shown; formats spread, first = the rotated format", () => {
    const recentIds = REEL_TOPICS.slice(0, 15).map((t) => t.id);
    const exclude = REEL_TOPICS.slice(15, 25).map((t) => t.topic);
    for (let k = 0; k < 20; k++) {
      const picks = pickBankIdeas(["named_method"], recentIds, exclude, 5);
      expect(picks).toHaveLength(5);
      expect(new Set(picks.map((t) => t.id)).size).toBe(5);
      for (const t of picks) { expect(recentIds).not.toContain(t.id); expect(exclude).not.toContain(t.topic); }
      expect(picks[0].format).toBe(nextFormat(["named_method"]));
      expect(new Set(picks.map((t) => t.format)).size).toBe(5);
    }
  });

  it("is deterministic for a given rng and matches shown topics loosely (case, punctuation)", () => {
    const a = pickBankIdeas([], [], [], 3, seq(0.1, 0.5, 0.9));
    expect(pickBankIdeas([], [], [], 3, seq(0.1, 0.5, 0.9))).toEqual(a);
    const shown = pickBankIdeas([], [], [`  ${a[0].topic.toUpperCase()}!! `], 3, seq(0.1, 0.5, 0.9));
    expect(shown.map((t) => t.id)).not.toContain(a[0].id);
  });

  it("still returns n when every topic was used or shown", () => {
    const all = REEL_TOPICS.map((t) => t.topic);
    expect(pickBankIdeas([], REEL_TOPICS.map((t) => t.id), all, 5)).toHaveLength(5);
  });
});

describe("hook / why / topic rules", () => {
  it("templates pass the rules for every bank topic", () => {
    for (const t of REEL_TOPICS) {
      const h = templateHook(t);
      expect(hookProblem(h), `${t.id}: ${h}`).toBeNull();
    }
    for (const f of REEL_FORMATS) expect(whyProblem(TEMPLATE_WHY[f])).toBeNull();
    expect(templateHook(topicById("honey-for-babies")!)).toBe("Your grandma said a little honey is fine for babies. Here's what doctors say.".split(" ").length <= 12
      ? "Your grandma said a little honey is fine for babies. Here's what doctors say." : "You grew up with the old rule. Here's what experts say now.");
    expect(templateHook(topicById("two-choice-rule")!)).toBe("Try The 2-Choice Rule with your toddler tonight.");
  });

  it("hooks: at most 12 words, no greeting / CTA / outro / reassurance / I-we / Tagalog / jargon / hype", () => {
    expect(hookProblem("Stop saying \"calm down\". Try the 5-Word Rule instead.")).toBeNull();
    expect(hookProblem("We all say \"stop crying\". Here's what to say instead.")).toBeNull();
    expect(hookProblem("one two three four five six seven eight nine ten eleven twelve thirteen")).toMatch(/12 words/);
    expect(hookProblem("Hey moms, your toddler hits?")).toMatch(/greeting/);
    expect(hookProblem("Follow for more toddler tips that work")).toMatch(/call to action/);
    expect(hookProblem("Don't worry, your toddler is fine.")).toMatch(/reassures/);
    expect(hookProblem("I tried this with my son and wow.")).toMatch(/I \/ we/);
    expect(hookProblem("Your anak hits when he's mad?")).toMatch(/Tagalog/);
    expect(hookProblem("Co-regulation calms your toddler fast.")).toMatch(/jargon/);
    expect(hookProblem("This trick damages your child forever.")).toMatch(/hype/);
    expect(hookProblem("Cold baths bring the fever down fast.")).toMatch(/body/);
  });

  it("why: at most 15 words, plain; topic: at most 90 characters, early years, plain, health stays general", () => {
    expect(whyProblem("What to say when he hits, and why it works")).toBeNull();
    expect(whyProblem(Array(16).fill("word").join(" "))).toMatch(/15 words/);
    expect(whyProblem("How to build executive function at home")).toMatch(/jargon/);
    expect(topicProblem("Your toddler bites at daycare: what to say right away", false)).toBeNull();
    expect(topicProblem("x".repeat(91), false)).toMatch(/90/);
    expect(topicProblem("Helping your teenager with homework", false)).toMatch(/early years/);
    expect(topicProblem("Merienda fights with your preschooler", false)).toMatch(/Tagalog/);
    expect(topicProblem("The right paracetamol dose for a toddler fever", true)).toMatch(/medicine/);
    expect(topicProblem("A sick toddler who won't drink: comfort ideas", true)).toBeNull();
  });

  it("a fresh topic may not reuse a bank method's name (number words count as digits)", () => {
    expect(methodNames("Your toddler won't wait: the Two-Choice Rule for bedtime")).toEqual(["2 choice rule"]);
    expect(reusesBankMethod("The Two-Choice Rule for bedtime fights")).toBe(true);
    expect(reusesBankMethod("Try the Whisper Trick at the store")).toBe(true);
    expect(reusesBankMethod("The Goodbye Hug Rule for drop-off tears")).toBe(false);
  });

  it("sameIdea: the same words or most content words", () => {
    expect(sameIdea("The 5-Word Rule for tantrums", "the 5 word rule for TANTRUMS!")).toBe(true);
    expect(sameIdea("Why your toddler saves meltdowns for you", "Your child saves the worst meltdowns for you")).toBe(true);
    expect(sameIdea("Bedtime stalling: the last three things routine", "Picky eating at dinner")).toBe(false);
  });
});

describe("ideasPrompt", () => {
  it("lists the bank ids, the fresh count + formats, recent titles, shown topics and the hook rules", () => {
    const bank = [topicById("two-choice-rule")!, topicById("honey-for-babies")!];
    const p = ideasPrompt({ bank, fresh: 3, freshFormats: ["scene_lesson", "problem_fix"], recent: ["The Quiet Hour"], exclude: ["Shown topic A"] });
    expect(p).toContain("id: two-choice-rule | format: Named method");
    expect(p).toContain("id: honey-for-babies");
    expect(p).toContain("3 FRESH IDEAS");
    expect(p).toContain("one each, in this order: scene_lesson, problem_fix, scene_lesson");
    expect(p).toContain("ALREADY IN THE TOPIC BANK");
    expect(p).toContain("- Grandma said: feed a cold, starve a fever");
    expect(p).not.toContain("- The 2-Choice Rule");
    expect(p).toContain("- The Quiet Hour");
    expect(p).toContain("- Shown topic A");
    expect(p).toMatch(/At most 12 words/);
    expect(p).toMatch(/at most 15 words/);
  });
});

describe("buildIdeas", () => {
  const bank = [topicById("two-choice-rule")!, topicById("tantrum-phrases")!, topicById("sweat-out-fever")!, topicById("mommy-poop")!, topicById("second-wind")!];
  const freshOk = (o: Record<string, unknown> = {}) => ({ topic: "Your toddler bites at daycare: what to say right away", format: "problem_fix", hook: "Your toddler bites at daycare? Here's what to say.", why: "Two calm steps that help biting stop", health: false, ...o });

  it("3 bank + 2 fresh, interleaved; AI hooks used when they pass, else the template", () => {
    const raw = {
      bank: [
        { id: "two-choice-rule", hook: "Power struggles at every meal? Try the 2-Choice Rule.", why: "How two small choices end the fight." },
        { id: "tantrum-phrases", hook: "Hey moms, follow for more!", why: "x" },
      ],
      fresh: [freshOk(), freshOk({ topic: "The Goodbye Hug Rule for daycare drop-off tears", format: "named_method", hook: "Drop-off tears every morning? Try the Goodbye Hug Rule.", why: "A short goodbye your child can count on" })],
    };
    const ideas = buildIdeas(raw, { bank, avoid: [] });
    expect(ideas).toHaveLength(IDEA_COUNT);
    expect(ideas.map((i) => i.source)).toEqual(["bank", "fresh", "bank", "fresh", "bank"]);
    expect(ideas[0]).toMatchObject({ topicId: "two-choice-rule", format: "named_method", hook: "Power struggles at every meal? Try the 2-Choice Rule.", why: "How two small choices end the fight", health: false });
    expect(ideas[2]).toMatchObject({ topicId: "tantrum-phrases", hook: templateHook(bank[1]), why: TEMPLATE_WHY.say_this.replace(/\.$/, "") });
    expect(ideas[4]).toMatchObject({ topicId: "sweat-out-fever", health: true, hook: templateHook(bank[2]) });
    expect(ideas[1]).toMatchObject({ source: "fresh", format: "problem_fix", health: false });
    expect(ideas[1].topicId).toBeUndefined();
  });

  it("drops fresh ideas that break a rule or repeat, and fills with bank backups", () => {
    const raw = {
      bank: [],
      fresh: [
        freshOk({ topic: "Lola's old rule about bathing at night" }),               // Tagalog
        freshOk({ format: "storytime" }),                                           // unknown format
        freshOk({ hook: "Hello mama! Today let's talk about biting at daycare" }),  // greeting
        freshOk({ topic: "The Quiet Hour for toddlers who fight sleep" }),          // repeats a recent title
        freshOk({ topic: "Grandma said: bundle up a fever and sweat it out" }),     // repeats a bank topic
        freshOk({ topic: "The 5-Word Rule for tantrums at daycare pickup" }),     // shown already
      ],
    };
    const ideas = buildIdeas(raw, { bank, avoid: ["The Quiet Hour for toddlers who fight sleep", "The 5-Word Rule for tantrums at daycare pickup"] });
    expect(ideas).toHaveLength(IDEA_COUNT);
    expect(ideas.every((i) => i.source === "bank")).toBe(true);
    expect(ideas.map((i) => i.topicId)).toEqual(bank.map((t) => t.id));
  });

  it("a fresh health idea is flagged (AI flag or health words); one naming a medicine is dropped", () => {
    const raw = {
      bank: [],
      fresh: [
        freshOk({ topic: "Your toddler has a cough at night: comfort ideas that help", format: "problem_fix", health: false }),
        freshOk({ topic: "Sleepy but wired at 7 p.m.: the wind-down walk", format: "named_method", hook: "Wired at bedtime? Try the wind-down walk tonight.", health: true }),
        freshOk({ topic: "Which medicine to give a teething baby", health: true }),
      ],
    };
    const ideas = buildIdeas(raw, { bank, avoid: [] }).filter((i) => i.source === "fresh");
    expect(ideas.map((i) => i.health)).toEqual([true, true]);
    expect(ideas.some((i) => /medicine/.test(i.topic))).toBe(false);
  });

  it("no AI answer: bank-only with template hooks", () => {
    const ideas = buildIdeas(null, { bank, avoid: [] });
    expect(ideas.map((i) => i.hook)).toEqual(bank.map(templateHook));
    expect(ideas.every((i) => i.source === "bank" && !!i.topicId)).toBe(true);
  });
});

describe("suggestTopicIdeas", () => {
  it("one small AI call; avoids recent ids; prompt carries recent titles and the shown topics", async () => {
    generateJson.mockResolvedValue({ ok: true, data: { bank: [], fresh: [
      { topic: "Your toddler bites at daycare: what to say right away", format: "problem_fix", hook: "Your toddler bites at daycare? Here's what to say.", why: "Two calm steps that help biting stop", health: false },
      { topic: "The Goodbye Hug Rule for daycare drop-off tears", format: "named_method", hook: "Drop-off tears every morning? Try the Goodbye Hug Rule.", why: "A short goodbye your child can count on", health: false },
    ] } });
    const recentIds = REEL_TOPICS.slice(0, 15).map((t) => t.id);
    const r = await suggestTopicIdeas({ recentFormats: ["say_this"], recentIds, recentTitles: ["The Quiet Hour", "bedtime battles"], exclude: ["Shown A"] });
    expect(generateJson).toHaveBeenCalledTimes(1);
    const call = generateJson.mock.calls[0][0];
    expect(call.prompt).toContain("- The Quiet Hour");
    expect(call.prompt).toContain("- Shown A");
    expect(call.prompt).toContain(`${FRESH_ASK} FRESH IDEAS`);
    expect(call.prompt.match(/^- id: /gm)).toHaveLength(BANK_ASK);
    expect(r.aiError).toBeUndefined();
    expect(r.ideas).toHaveLength(IDEA_COUNT);
    expect(r.ideas.filter((i) => i.source === "bank")).toHaveLength(BANK_IDEAS);
    expect(r.ideas.filter((i) => i.source === "fresh")).toHaveLength(FRESH_IDEAS);
    for (const i of r.ideas) if (i.topicId) expect(recentIds).not.toContain(i.topicId);
    expect(r.ideas[0].format).toBe(nextFormat(["say_this"]));
  });

  it("an AI failure never fails the batch: 5 bank ideas with template hooks", async () => {
    generateJson.mockResolvedValue({ ok: false, error: "Gemini timed out." });
    const r = await suggestTopicIdeas({ recentFormats: [], recentIds: [], recentTitles: [], exclude: [] });
    expect(r.aiError).toBe("Gemini timed out.");
    expect(r.ideas).toHaveLength(IDEA_COUNT);
    expect(r.ideas.every((i) => i.source === "bank" && i.hook === templateHook(topicById(i.topicId)!))).toBe(true);
  });

  it("a throwing AI call never fails the batch either", async () => {
    generateJson.mockImplementation(async () => { throw new Error("boom"); });
    const t = await suggestTopicIdeas({ recentFormats: [], recentIds: [], recentTitles: [], exclude: [] });
    expect(t.ideas).toHaveLength(IDEA_COUNT);
    expect(t.aiError).toBe("boom");
  });

  it("exclude keys match loosely; EXCLUDE_MAX is generous", () => {
    expect(ideaKey("  The 5-Word Rule! ")).toBe("the 5 word rule");
    expect(EXCLUDE_MAX).toBeGreaterThanOrEqual(30);
  });
});
