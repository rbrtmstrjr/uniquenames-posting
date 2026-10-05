import { describe, expect, it } from "vitest";
import {
  AGE_CHOICES, KID_OUTFIT_WORDS, KID_SHOTS, NEWBORN_SHOTS, outfitFor, PROPS_SPECS, SITTER_SHOTS, SUBJECT_AGES, TODDLER_SHOTS, buildMixedShotSpecs, buildPrompt,
  buildShotSpecs, dealAges, isAgeChoice, isPropsOnly, planExtraCard, planPost, seededRandom, sessionFor, sessionShots, shotSpec, subjectKey,
  type AgeChoice, type SubjectAge,
} from "@/lib/planner";
import { validateCreatePost } from "@/lib/actions/helpers";
import type { NameRow, ThemeRow } from "@/lib/db/types";

const now = "2026-10-05T00:00:00Z";
const names: NameRow[] = Array.from({ length: 20 }, (_, i) => ({
  id: `n${i}`, name: `Boy Name${String.fromCharCode(65 + i)}`, meaning: "a meaning", gender: "boy", style: "two-word", status: "available",
  post_id: null, position: null, created_at: now, updated_at: now,
}));
const theme: ThemeRow = {
  id: "t1", title: "Little Gentleman", gender: "boy", backdrop: "smooth seamless sage studio backdrop",
  outfit: "cream shirt romper with a tiny caramel bow tie and suspenders", props: "wooden rocking horse, vintage suitcase",
  lighting: "soft window light", palette: "cream and caramel", status: "available", sort_order: 1, used_on: null, preview_card_id: null,
  created_at: now, updated_at: now,
};
const settings = { caption_template: "x {gender}", hashtags: "", min_images: 9, max_images: 13 };
const req = (age?: AgeChoice | null, count: number | null = 13, postDate = "2026-10-05") =>
  ({ gender: "boy" as const, style: "two-word" as const, count, postDate, age });
const plan = (age?: AgeChoice | null, count: number | null = 13, postDate?: string) => {
  const r = planPost({ request: req(age, count, postDate), names, themes: [theme], settings });
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const subjectLine = (prompt: string) => prompt.split("\n")[1];
const babyCards = (r: ReturnType<typeof plan>) => r.cards.filter((c) => !isPropsOnly(c.shot));
const ALL_SHOTS = [...SITTER_SHOTS, ...NEWBORN_SHOTS, ...TODDLER_SHOTS, ...KID_SHOTS, ...PROPS_SPECS];

describe("age choices", () => {
  it("are random + newborn + 1..7, and only those validate", () => {
    expect(AGE_CHOICES).toEqual(["random", "newborn", "1", "2", "3", "4", "5", "6", "7"]);
    expect(SUBJECT_AGES).toEqual(["newborn", "1", "2", "3", "4", "5", "6", "7"]);
    for (const a of AGE_CHOICES) expect(isAgeChoice(a)).toBe(true);
    for (const bad of ["8", "0", "", "Random", 3, null, undefined, "1 "]) expect(isAgeChoice(bad)).toBe(false);
  });
  it("map to the right shot library", () => {
    expect(sessionFor("newborn")).toBe("newborn");
    expect(sessionFor("1")).toBe("sitter");
    expect(sessionFor("2")).toBe("toddler");
    expect(sessionFor("3")).toBe("toddler");
    for (const a of ["4", "5", "6", "7"] as const) expect(sessionFor(a)).toBe("kid");
  });
  it("validateCreatePost accepts a missing or valid age and names a bad one", () => {
    const ok = { gender: "boy", style: "two-word", count: null, requestId: "11111111-1111-4111-8111-111111111111" };
    expect(validateCreatePost(ok)).toBeNull();
    expect(validateCreatePost({ ...ok, subjectAge: "5" })).toBeNull();
    expect(validateCreatePost({ ...ok, subjectAge: "random" })).toBeNull();
    expect(validateCreatePost({ ...ok, subjectAge: "9" })).toMatch(/child age/i);
  });
});

describe("toddler and kid shot libraries", () => {
  it.each(["toddler", "kid"] as const)("%s: covers every angle, keeps lens + aperture and never says camera", (session) => {
    const lib = sessionShots(session);
    expect(lib.length).toBeGreaterThanOrEqual(10);
    const angles = new Set(lib.map((s) => s.angle));
    for (const a of ["eye", "wide", "high", "closeup", "macro", "low", "profile", "pov"] as const) expect(angles.has(a)).toBe(true);
    for (const s of lib) {
      expect(s.kind).toBe("baby");
      expect(s.camera).toMatch(/\bf\/\d(\.\d)?\b/);
      expect(s.camera).toMatch(/\d+mm (portrait |macro )?lens/);
      expect(`${s.text} ${s.camera}`).not.toMatch(/camera|tripod|\bbaby\b|\bnewborn\b/i);
    }
  });
  it("every shot text is unique across libraries (the card stores the text)", () => {
    expect(new Set(ALL_SHOTS.map((s) => s.text)).size).toBe(ALL_SHOTS.length);
    for (const s of ALL_SHOTS) expect(shotSpec(s.text)).toBe(s);
  });
  it.each(["toddler", "kid"] as const)("%s posts keep the cover first, props spread out, no neighbouring angle repeats", (session) => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const n of [9, 11, 13]) {
        const specs = buildShotSpecs(n, session, seededRandom(seed * 13 + n));
        expect(specs[0]).toBe(sessionShots(session)[0]);
        expect(specs.filter((s) => s.kind === "props")).toHaveLength(n >= 11 ? 4 : 3);
        specs.forEach((s, i) => { if (i > 0) expect(s.angle).not.toBe(specs[i - 1].angle); });
      }
    }
  });
});

describe("dealAges", () => {
  it("deals every bucket before repeating one, deterministically", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = dealAges(10, seededRandom(seed));
      expect(a).toEqual(dealAges(10, seededRandom(seed)));
      expect(new Set(a.slice(0, 8)).size).toBe(8);
      expect(a.every((x) => SUBJECT_AGES.includes(x))).toBe(true);
    }
  });
});

describe("Random age (the default)", () => {
  it("spreads the children across at least 3 age buckets for 8+ baby cards, each card its own child", () => {
    for (let d = 1; d <= 28; d++) {
      const r = plan("random", 13, `2026-11-${String(d).padStart(2, "0")}`);
      const babies = babyCards(r);
      expect(babies.length).toBeGreaterThanOrEqual(8);
      const lines = babies.map((c) => subjectLine(c.prompt));
      const ages = new Set(lines.map((l) => /newborn|(\d)-year-old/.exec(l)![0]));
      expect(ages.size).toBeGreaterThanOrEqual(3);
      for (const l of lines) {
        expect(l).not.toMatch(/same (baby|child|toddler)/);
        expect(l).toMatch(/\bboy\b/);
      }
      // each card's shot comes from the library of its own child's age
      for (const c of babies) {
        const age = /newborn/.test(subjectLine(c.prompt)) ? "newborn" : (/(\d)-year-old/.exec(subjectLine(c.prompt))![1] as SubjectAge);
        expect(sessionShots(sessionFor(age))).toContain(shotSpec(c.shot));
      }
      r.cards.forEach((c, i) => { if (i > 0) expect(shotSpec(c.shot)!.angle).not.toBe(shotSpec(r.cards[i - 1].shot)!.angle); });
    }
  });
  it("is deterministic and is what a post without a choice gets from the action (undefined stays legacy)", () => {
    expect(plan("random")).toEqual(plan("random"));
    expect(new Set(babyCards(plan(undefined)).map((c) => subjectLine(c.prompt))).size).toBe(1); // legacy: one baby
  });
  it("buildMixedShotSpecs keeps the cover first, props slots, and the right number of frames", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ages = dealAges(9, seededRandom(seed));
      const shots = buildMixedShotSpecs(13, ages, seededRandom(seed + 1));
      expect(shots).toHaveLength(13);
      expect(shots[0].kind).toBe("baby");
      expect(shots[0].spec).toBe(sessionShots(sessionFor(shots[0].age!))[0]);
      expect(shots.filter((s) => s.kind === "props")).toHaveLength(4);
      expect(new Set(shots.map((s) => s.spec.text)).size).toBe(13);
    }
  });
});

describe("fixed age", () => {
  it.each(SUBJECT_AGES)("age %s: one child for the whole post, at that age, with that age's shots", (age) => {
    const r = plan(age);
    const lines = new Set(babyCards(r).map((c) => subjectLine(c.prompt)));
    expect(lines.size).toBe(1);
    const line = [...lines][0];
    expect(line).toMatch(/same (baby|toddler|child) in every photo/);
    expect(line).toContain(age === "newborn" ? "newborn" : `${age}-year-old`);
    for (const c of babyCards(r)) expect(sessionShots(sessionFor(age))).toContain(shotSpec(c.shot));
    expect(plan(age)).toEqual(r);
  });
  it("ages 3+ ask for a child-sized outfit, younger ones keep the theme outfit as written", () => {
    const outfitLine = (age: AgeChoice) => babyCards(plan(age))[0].prompt.split("\n").find((l) => l.startsWith("Outfit"))!;
    expect(outfitLine("1")).toBe(`Outfit: ${theme.outfit}.`);
    expect(outfitLine("2")).toBe(`Outfit: ${theme.outfit}.`);
    expect(outfitLine("3")).toMatch(/^Outfit: a toddler-sized version of the cream shirt romper/);
    expect(outfitLine("3")).toMatch(/^Outfit: a toddler-sized version of the cream shirt romper/); // 3 keeps "romper"
    expect(outfitLine("6")).toBe("Outfit: a child-sized version of the cream shirt playsuit with a caramel bow tie and suspenders.");
    expect(outfitLine("6")).not.toContain("tiny");
    // props-only frames are untouched
    const propsLine = plan("6").cards.find((c) => isPropsOnly(c.shot))!.prompt;
    expect(propsLine).toContain(`Outfit (empty, no one wearing it): ${theme.outfit}.`);
  });
  it("outfitFor drops a leading article so it never reads 'the a …'", () => {
    expect(outfitFor("a white knit romper", "3")).toBe("a toddler-sized version of the white knit romper");
    expect(outfitFor("An ivory satin dress", "5")).toBe("a child-sized version of the ivory satin dress");
    expect(outfitFor("the peach tulle dress", "7")).toBe("a child-sized version of the peach tulle dress");
    expect(outfitFor("a white knit romper", "2")).toBe("a white knit romper"); // under 3: as written
    expect(outfitFor("anchor-print romper", "5")).toBe("a child-sized version of the anchor-print playsuit");
  });
  it.each([
    ["white knit romper with a sage collar", "white knit playsuit with a sage collar"],
    ["pastel ivory soft knit onesie", "pastel ivory soft knit outfit"],
    ["soft gray knit sleep suit with a nightcap", "soft gray knit pajamas with a nightcap"],
    ["lilac knit sleepsuit", "lilac knit pajamas"],
    ["cream muslin swaddle", "cream muslin drape"],
    ["seafoam knit mermaid tail wrap with a shell headband", "seafoam knit mermaid tail drape with a shell headband"],
    ["Rompers in rust", "playsuit in rust"],
  ])("ages 4+ map baby-only words: %s", (outfit, kid) => {
    for (const age of ["4", "5", "6", "7"] as const) expect(outfitFor(outfit, age)).toBe(`a child-sized version of the ${kid}`);
    expect(outfitFor(outfit, "3")).toBe(`a toddler-sized version of the ${outfit}`);
    expect(outfitFor(outfit, "1")).toBe(outfit);
    expect(outfitFor(outfit, "newborn")).toBe(outfit);
  });
  it("the kid mapping table stays small and only maps baby-only garments", () => {
    expect(KID_OUTFIT_WORDS).toHaveLength(5);
    expect(outfitFor("pale pink leotard with a soft tulle tutu", "6")).toBe("a child-sized version of the pale pink leotard with a soft tulle tutu");
  });
  it("kid shots never name the light (the model would draw a lamp)", () => {
    for (const s of KID_SHOTS) expect(s.text).not.toMatch(/\blight\b/i);
    expect(KID_SHOTS.some((s) => s.text.includes("gazing off to the side, lost in thought"))).toBe(true);
  });
  it("kid frames say child photography, not baby photography", () => {
    const p = babyCards(plan("5"))[0].prompt;
    expect(p.split("\n")[0]).toMatch(/child/i);
    expect(p).not.toMatch(/\bbaby\b/i);
  });
  it("no prompt ever says camera and every frame names an aperture", () => {
    for (const age of AGE_CHOICES) {
      for (const c of plan(age).cards) {
        expect(c.prompt).not.toMatch(/camera|tripod/i);
        expect(c.prompt).toMatch(/f\/\d/);
        expect(c.prompt).toMatch(/No text, no letters/);
      }
    }
  });
});

describe("planExtraCard with an age", () => {
  const base = { theme, gender: "boy" as const, style: "two-word" as const, names, nextPosition: 14, subjectKey: subjectKey("2026-10-05", "boy", "two-word") };
  it("fixed age: the same child as the post", () => {
    const r = plan("4");
    const e = planExtraCard({ ...base, usedNameIds: r.cards.map((c) => c.name_id), salt: "p|1", age: "4" });
    if (!e.ok) throw new Error(e.reason);
    expect(subjectLine(e.card.prompt)).toBe(subjectLine(babyCards(r)[0].prompt));
    expect(KID_SHOTS).toContain(shotSpec(e.card.shot));
  });
  it("random: a new child of a random age, varying with the salt", () => {
    const ages = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const e = planExtraCard({ ...base, usedNameIds: [], salt: `p|${i}`, age: "random" });
      if (!e.ok) throw new Error(e.reason);
      const line = subjectLine(e.card.prompt);
      expect(line).not.toMatch(/same/);
      ages.add(/newborn|(\d)-year-old/.exec(line)![0]);
      expect(isPropsOnly(e.card.shot)).toBe(false);
    }
    expect(ages.size).toBeGreaterThanOrEqual(6);
  });
  it("no age (legacy post or before 004): the post's legacy baby", () => {
    const legacy = plan(undefined);
    const e = planExtraCard({ ...base, usedNameIds: [], salt: "p|2", age: null });
    if (!e.ok) throw new Error(e.reason);
    expect(subjectLine(e.card.prompt)).toBe(subjectLine(babyCards(legacy)[0].prompt));
  });
});

describe("buildPrompt still works for theme previews (no subject)", () => {
  it("keeps the baby photoshoot header", () => {
    expect(buildPrompt(theme, SITTER_SHOTS[0].text, "girl").split("\n")[0]).toMatch(/baby photoshoot/);
  });
});
