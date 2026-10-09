import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { reelCaptionPrompt, reelCaptionProblem, writeReelCaption, REEL_CAPTION_SYSTEM, REEL_CAPTION_MAX } = await import("@/lib/ai/reel-caption");
const { hasBait } = await import("@/lib/ai/caption-core");

const input = {
  title: "The Quiet Hour", topic: "bedtime", stage: "toddler", hook: "Nobody warned you",
  lines: ["Line one is soft.", "Line two lands the point."],
  recent: ["Sound familiar? What helps you?"], recentTags: ["#toddlertantrums"],
};
const ok = (caption: string, tags: string[] = ["#bedtime", "#toddlersleep", "#momtips"]) => ({ ok: true, data: { caption, tags } });

beforeEach(() => generateJson.mockReset());

describe("reel caption prompt", () => {
  it("carries the title, topic, stage, hook, script, recent captions + openers and recent tags", () => {
    const p = reelCaptionPrompt(input);
    for (const want of ["Reel title: The Quiet Hour", "Topic: bedtime", "Child's stage: toddler", "Hook card on screen: Nobody warned you",
      "Script (the narration): Line one is soft. Line two lands the point.", "1. Sound familiar? What helps you?", "Do not start with any of these words: sound.", "#toddlertantrums"]) {
      expect(p).toContain(want);
    }
  });
  it("the format and the key phrase (the first exact words in quotes) when the reel has them", () => {
    const p = reelCaptionPrompt({ ...input, format: "say_this", keyPhrase: "Walking feet, please." });
    expect(p).toContain("Format: Say this, not that");
    expect(p).toContain("Key phrase (the exact words the reel teaches): Walking feet, please.");
    const none = reelCaptionPrompt({ ...input, format: "junk" });
    expect(none).not.toContain("Format:");
    expect(none).not.toContain("Key phrase");
  });
  it("system rules: repeat the key phrase or the method's name so the post is worth saving", () => {
    expect(REEL_CAPTION_SYSTEM).toMatch(/key phrase/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/method's name/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/worth saving/);
  });
  it("a very long script is shortened at a word", () => {
    const p = reelCaptionPrompt({ ...input, lines: Array.from({ length: 400 }, (_, i) => `word${i}`) });
    expect(p.length).toBeLessThan(3200);
    expect(p).toMatch(/word\d+ …/);
  });
  it("system rules: hook echo, one takeaway, one genuine question, no bait / follow, topic hashtags", () => {
    expect(REEL_CAPTION_SYSTEM).toMatch(/echo the reel's hook/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/one concrete, useful takeaway/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/Exactly one question/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/follow for more/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/3 to 5 hashtags about this reel's specific topic/);
  });
  it("system rules: a brand page speaking to the mom in second person, never claiming its own experience", () => {
    expect(REEL_CAPTION_SYSTEM).toMatch(/second person/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/your little one/);
    expect(REEL_CAPTION_SYSTEM).toMatch(/I, me, my, we, us or our/);
    expect(REEL_CAPTION_SYSTEM).not.toMatch(/mom friend/);
  });
});

describe("reelCaptionProblem / bait", () => {
  it("must end on its one question (an emoji after it is fine)", () => {
    expect(reelCaptionProblem("Bedtime is hard. Breathe first.")).toMatch(/end with one genuine question/);
    expect(reelCaptionProblem("Bedtime is hard? Breathe first. What helps you?")).toMatch(/more than one question/);
    expect(reelCaptionProblem("Bedtime is hard. Breathe first. What helps you? 🌙")).toBeNull();
  });
  it("first-person experience claims are a problem (whole words only, any case, contractions too)", () => {
    for (const bad of ["I really felt that! What helps you?", "Keeping wake windows short truly helped us. What helps you?", "Our evenings got calmer. What helps you?",
      "We're all tired. What helps you?", "Trust me, it passes. What helps you?", "Short naps, my friend. What helps you?", "I'm with you. What helps you?", "WE tried it. What helps you?"]) {
      expect(reelCaptionProblem(bad), bad).toMatch(/first person/);
    }
    for (const fine of ["Useful music trusts your little one's rhythm. What helps you?", "Busy evenings? Your toddler feels them too. What helps you most?".replace("? Your", ". Your"),
      "Your menu and your mood matter. What calms your home?", "Weaning is a journey for your little one. What did you try first?"]) {
      expect(reelCaptionProblem(fine), fine).toBeNull();
    }
  });
  it("exactly one question: none or two or more is a problem", () => {
    expect(reelCaptionProblem("Bedtime is hard. Breathe first.")).toMatch(/question/);
    expect(reelCaptionProblem("Hard? Tired? What helps you?")).toMatch(/more than one question/);
  });
  it("lists every broken rule", () => {
    const p = reelCaptionProblem("Sound asleep, we hope. Breathe.", ["Sound familiar?"]);
    expect(p).toMatch(/first person/);
    expect(p).toMatch(/starts with "sound"/);
    expect(p).toMatch(/question/);
  });
  it("a recent opener is a problem", () => {
    expect(reelCaptionProblem("Sound asleep at last. What helps you?", ["Sound familiar?"])).toMatch(/starts with "sound"/);
  });
  it("bait phrases are caught; ordinary words are not", () => {
    for (const bait of ["Comment YES if this is you", "Tag a mom who needs this", "Share if you agree", "Follow for more tips", "Like if you relate", "Tell me in the comments", "Drop a heart"]) {
      expect(hasBait(bait), bait).toBe(true);
    }
    for (const fine of ["What would you tag as the hardest hour?", "Follow your gut tonight. What helps you?", "Which bedtime do you like best?", "Share the load with your partner. What helps?"]) {
      expect(hasBait(fine), fine).toBe(false);
    }
  });
});

describe("writeReelCaption", () => {
  it("returns the cleaned caption + tags", async () => {
    generateJson.mockResolvedValueOnce(ok("Nobody warned you about the quiet hour. One slow breath first helps. What calms your evenings? #bedtime"));
    expect(await writeReelCaption(input)).toEqual({ line: "Nobody warned you about the quiet hour. One slow breath first helps. What calms your evenings?", tags: ["#bedtime", "#toddlersleep", "#momtips"] });
    expect(generateJson.mock.calls[0][0].schema.properties.tags.maxItems).toBe(5);
  });
  it("retries when it does not end on a question; bait is never kept", async () => {
    generateJson.mockResolvedValueOnce(ok("Nobody warned you. Breathe first.")).mockResolvedValueOnce(ok("Nobody warned you. Breathe first. What helps you?"));
    expect((await writeReelCaption(input))?.line).toBe("Nobody warned you. Breathe first. What helps you?");
    generateJson.mockReset();
    generateJson.mockResolvedValue(ok("Nobody warned you. Follow for more. What helps you?"));
    expect(await writeReelCaption(input)).toBeNull();
  });
  it("retries up to twice (3 attempts) and keeps the first clean one", async () => {
    generateJson.mockResolvedValueOnce(ok("I loved this tip. What helps you?"))
      .mockResolvedValueOnce(ok("Bedtime is hard? Breathe first. What helps you?"))
      .mockResolvedValueOnce(ok("Bedtime is hard. Breathe first with your little one. What helps you?"))
      .mockResolvedValueOnce(ok("never asked for"));
    expect((await writeReelCaption(input))?.line).toBe("Bedtime is hard. Breathe first with your little one. What helps you?");
    expect(generateJson).toHaveBeenCalledTimes(3);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/first person/);
  });
  it("all 3 attempts break a rule: keeps the one breaking the fewest, preferring no first person over one question", async () => {
    generateJson.mockResolvedValueOnce(ok("We tried it? It helped us? Breathe."))
      .mockResolvedValueOnce(ok("Our nights got calmer. What helps you?"))
      .mockResolvedValueOnce(ok("Bedtime is hard. Breathe first."));
    expect((await writeReelCaption(input))?.line).toBe("Bedtime is hard. Breathe first.");
    generateJson.mockReset();
    generateJson.mockResolvedValueOnce(ok("Our nights got calmer. Breathe."))
      .mockResolvedValueOnce(ok("Our nights got calmer. What helps you?"))
      .mockResolvedValueOnce(ok("We tried it. Breathe. Rest?? Sleep?"));
    expect((await writeReelCaption(input))?.line).toBe("Our nights got calmer. What helps you?");
  });
  it("is capped in length", async () => {
    generateJson.mockResolvedValueOnce(ok(`${"Bedtime takes patience and a plan. ".repeat(15)}What helps you?`));
    const r = await writeReelCaption(input);
    expect(r!.line.length).toBeLessThanOrEqual(REEL_CAPTION_MAX);
  });
});
