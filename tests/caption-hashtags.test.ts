import { describe, expect, it } from "vitest";
import {
  cleanTag, fitsGender, HASHTAG_POOL_DEFAULT, HASHTAGS_ALWAYS_DEFAULT, legacyPool, MAX_TAGS, parseTags, pickPostTags, pickReelTags,
  rotatePool, setKey, splitCaption, tagProblem, tagSettings, validateTagList,
} from "@/lib/captions/hashtags";

const POOL = parseTags(HASHTAG_POOL_DEFAULT);
const ALWAYS = ["#uniquenames"];

describe("hashtag validation", () => {
  it("normalises case and the # and accepts letters/digits up to 24 chars", () => {
    expect(cleanTag("BabyNames")).toBe("#babynames");
    expect(cleanTag("  #MomLife ")).toBe("#momlife");
    expect(cleanTag("#baby2026")).toBe("#baby2026");
    expect(cleanTag(`#${"a".repeat(23)}`)).toBe(`#${"a".repeat(23)}`);
  });

  it("rejects symbols, spaces, long tags and empty input", () => {
    for (const bad of ["#baby-names", "#baby_names", "#fypシ", "#bébé", `#${"a".repeat(24)}`, "#", "", "   "]) expect(cleanTag(bad), bad).toBeNull();
    expect(tagProblem("#baby-names")).toMatch(/letters and numbers/);
    expect(tagProblem(`#${"a".repeat(24)}`)).toMatch(/24 characters/);
  });

  it("rejects engagement-bait tags (#fyp, #follow…, #like4like, #viral, #highlights)", () => {
    for (const bait of ["#fyp", "#foryou", "#foryoupage", "#follower", "#followers", "#followme", "#like4like", "#likeforlike", "#f4f", "#viral", "#viralvideo", "#highlights", "#tagafriend"]) {
      expect(cleanTag(bait), bait).toBeNull();
      expect(tagProblem(bait), bait).toMatch(/bait/);
    }
  });

  it("rejects other platforms' tags (#momsoftiktok, #instagood, #reelsfb)", () => {
    for (const t of ["#momsoftiktokph", "#tiktokmom", "#instagood", "#reelsfb", "#youtubeshorts"]) {
      expect(cleanTag(t), t).toBeNull();
      expect(tagProblem(t), t).toMatch(/another platform/);
    }
    expect(cleanTag("#bedtimestories")).toBe("#bedtimestories");
  });

  it("parseTags splits on spaces/commas, drops invalid ones and repeats", () => {
    expect(parseTags("#A, #b  c #a #fyp #bad-tag")).toEqual(["#a", "#b", "#c"]);
    expect(parseTags(null)).toEqual([]);
  });

  it("validateTagList names the first bad tag and checks the count", () => {
    expect(validateTagList("#ok #no-way", "Always", 0, 2)).toMatch(/#no-way/);
    expect(validateTagList("#a #b #c", "Always", 0, 2)).toMatch(/at most 2/);
    expect(validateTagList("#a", "Pool", 3, 30)).toMatch(/at least 3/);
    expect(validateTagList("#a #b #c", "Pool", 3, 30)).toBeNull();
    expect(validateTagList("", "Always", 0, 2)).toBeNull();
  });

  it("gender filter: no boy tags on girl posts, no girl tags on boy posts, neither on reels", () => {
    expect(fitsGender("#babyboynames", "girl")).toBe(false);
    expect(fitsGender("#babygirlnames", "girl")).toBe(true);
    expect(fitsGender("#babygirlnames", "boy")).toBe(false);
    expect(fitsGender("#momlife", "boy")).toBe(true);
    expect(fitsGender("#babyboynames", null)).toBe(false);
    expect(fitsGender("#momlife", null)).toBe(true);
  });

  it("setKey ignores order and case", () => {
    expect(setKey(["#B", "#a"])).toBe(setKey(["#a", "#b"]));
  });

  it("splitCaption separates the words from the hashtags", () => {
    expect(splitCaption("Soft light and tiny boots. Which one?\n\n#uniquenames #babynames")).toEqual({ text: "Soft light and tiny boots. Which one?", tags: ["#uniquenames", "#babynames"] });
    expect(splitCaption("No tags here.")).toEqual({ text: "No tags here.", tags: [] });
  });
});

describe("settings: always + pool (with the pre-009 fallback)", () => {
  it("defaults", () => {
    expect(HASHTAGS_ALWAYS_DEFAULT).toBe("#uniquenames");
    expect(POOL).toHaveLength(10);
  });

  it("legacyPool = the default pool + the owner's old tags minus bait / always / repeats", () => {
    expect(legacyPool("#parenting #uniquenames #fypシ #highlights #follower")).toBe(`${HASHTAG_POOL_DEFAULT} #parenting`);
    expect(legacyPool("#babynames #Toddler, #viral")).toBe(`${HASHTAG_POOL_DEFAULT} #toddler`);
    expect(legacyPool("")).toBe(HASHTAG_POOL_DEFAULT);
  });

  it("tagSettings reads the 009 columns, else derives them from the old hashtags", () => {
    expect(tagSettings({ hashtags_always: "#a #b #c", hashtag_pool: "#x #y" })).toEqual({ always: ["#a", "#b"], pool: ["#x", "#y"] });
    const legacy = tagSettings({ hashtags: "#parenting #uniquenames #fypシ" });
    expect(legacy.always).toEqual(["#uniquenames"]);
    expect(legacy.pool.at(-1)).toBe("#parenting");
  });
});

describe("rotatePool (least recently used first, gender-appropriate)", () => {
  it("never-used tags come first in pool order, then the oldest used", () => {
    const history = [["#uniquenames", "#babynames"], ["#uniquenames", "#momlife"]];
    const r = rotatePool(["#babynames", "#momlife", "#newmom", "#pregnancy"], history, new Set(), "girl");
    expect(r).toEqual(["#newmom", "#pregnancy", "#momlife", "#babynames"]);
  });

  it("skips excluded and wrong-gender tags", () => {
    expect(rotatePool(POOL, [], new Set(["#babynames"]), "girl")).not.toContain("#babyboynames");
    expect(rotatePool(POOL, [], new Set(["#babynames"]), "girl")).not.toContain("#babynames");
  });
});

describe("pickPostTags", () => {
  it("always + 1–2 theme tags + 1 pool tag, ≤ 4", () => {
    const tags = pickPostTags({ always: ALWAYS, themeTags: ["#autumnbaby", "#pumpkinpatch", "#cozy"], pool: POOL, gender: "girl", history: [] });
    expect(tags).toEqual(["#uniquenames", "#autumnbaby", "#pumpkinpatch", "#babynames"]);
    expect(tags.length).toBeLessThanOrEqual(MAX_TAGS);
  });

  it("drops invalid, bait, repeated and wrong-gender theme tags", () => {
    const tags = pickPostTags({ always: ALWAYS, themeTags: ["#fyp", "#babyboy", "#Uniquenames", "#Fall Baby", "#seaside"], pool: POOL, gender: "girl", history: [] });
    expect(tags).toEqual(["#uniquenames", "#seaside", "#babynames"]);
  });

  it("theme tags never repeat a pool / always tag or a near-repeat of one (#babyboyname ~ #babyboynames)", () => {
    const tags = pickPostTags({ always: ALWAYS, themeTags: ["#babyboynames", "#babyboyname", "#uniquename", "#pilotbaby", "#pilotbabys"], pool: POOL, gender: "boy", history: [] });
    expect(tags).toEqual(["#uniquenames", "#pilotbaby", "#babynames"]);
  });

  it("rotates the pool tag (least recently used) and never repeats a set from the last 10", () => {
    const history = [["#uniquenames", "#seaside", "#babynames"]];
    const tags = pickPostTags({ always: ALWAYS, themeTags: ["#seaside"], pool: POOL, gender: "boy", history });
    expect(tags).toEqual(["#uniquenames", "#seaside", "#babyboynames"]);
  });

  it("swaps the pool tag when the exact set (any order) is among the last 10", () => {
    const pool = ["#babynames", "#momlife"];
    const history = [["#momlife", "#seaside", "#uniquenames"], ["#uniquenames", "#seaside", "#babynames"]];
    // LRU would pick #babynames (used longest ago) — but that set is taken, and so is #momlife's: drop to fewer theme tags.
    const tags = pickPostTags({ always: ALWAYS, themeTags: ["#seaside"], pool, gender: "boy", history });
    const recent = new Set(history.map(setKey));
    expect(recent.has(setKey(tags))).toBe(false);
    expect(tags.length).toBeLessThanOrEqual(MAX_TAGS);
  });

  it("only the last 10 sets count", () => {
    const old = ["#uniquenames", "#seaside", "#babynames"];
    const history = [...Array.from({ length: 10 }, (_, i) => ["#uniquenames", `#t${i}`, "#momlife"]), old];
    expect(pickPostTags({ always: ALWAYS, themeTags: ["#seaside"], pool: ["#babynames"], gender: "boy", history })).toEqual(old);
  });

  it("fallback: always + 2 rotated pool tags, still deduped", () => {
    const first = pickPostTags({ always: ALWAYS, themeTags: [], pool: POOL, gender: "girl", history: [], poolCount: 2 });
    expect(first).toEqual(["#uniquenames", "#babynames", "#babygirlnames"]);
    const second = pickPostTags({ always: ALWAYS, themeTags: [], pool: POOL, gender: "girl", history: [first], poolCount: 2 });
    expect(second).toEqual(["#uniquenames", "#uniquebabynames", "#namemeaning"]);
  });

  it("20 posts in a row: every set differs from the 10 before it and never exceeds 4 tags", () => {
    const history: string[][] = [];
    for (let i = 0; i < 20; i++) {
      const gender = i % 2 ? "boy" : "girl";
      const tags = pickPostTags({ always: ALWAYS, themeTags: ["#cozybaby"], pool: POOL, gender, history });
      expect(history.slice(0, 10).map(setKey)).not.toContain(setKey(tags));
      expect(tags.length).toBeLessThanOrEqual(4);
      if (gender === "girl") expect(tags).not.toContain("#babyboynames");
      history.unshift(tags);
    }
  });

  it("two always-tags leave room for 1 theme + 1 pool tag", () => {
    const tags = pickPostTags({ always: ["#uniquenames", "#babynames"], themeTags: ["#a1", "#a2"], pool: POOL, gender: "girl", history: [] });
    expect(tags).toEqual(["#uniquenames", "#babynames", "#a1", "#babygirlnames"]);
  });
});

describe("pickReelTags", () => {
  it("always + 2–3 topic tags, ≤ 4, no names-pool tags", () => {
    expect(pickReelTags({ always: ALWAYS, topicTags: ["#toddlertantrums", "#gentleparenting", "#momtips", "#extra"], pool: POOL, history: [] }))
      .toEqual(["#uniquenames", "#toddlertantrums", "#gentleparenting", "#momtips"]);
  });

  it("never the exact same set as one of the last 10 reels: swaps in another topic tag", () => {
    const history = [["#uniquenames", "#toddlertantrums", "#gentleparenting", "#momtips"]];
    const tags = pickReelTags({ always: ALWAYS, topicTags: ["#toddlertantrums", "#gentleparenting", "#momtips", "#bigfeelings"], pool: POOL, history });
    expect(tags).toEqual(["#uniquenames", "#toddlertantrums", "#gentleparenting", "#bigfeelings"]);
  });

  it("with no spare topic tag, a neutral pool tag is swapped in (never #babyboynames / #babygirlnames)", () => {
    const history = [["#uniquenames", "#sleep", "#naps", "#bedtime"]];
    const tags = pickReelTags({ always: ALWAYS, topicTags: ["#sleep", "#naps", "#bedtime"], pool: ["#babyboynames", "#momlife"], history });
    expect(tags).toEqual(["#uniquenames", "#sleep", "#naps", "#momlife"]);
  });

  it("validates topic tags", () => {
    expect(pickReelTags({ always: ALWAYS, topicTags: ["#fyp", "#Toddler Life", "#sleep"], pool: [], history: [] })).toEqual(["#uniquenames", "#sleep"]);
  });
});
