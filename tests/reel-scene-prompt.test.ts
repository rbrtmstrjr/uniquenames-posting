import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_TEXT } from "@/lib/planner/prompt";
import { REEL_THEME_IDS } from "@/lib/db/types";
import {
  capWords, castTag, childAge, childNoun, childTagWithAge, dedupeFragments, HOOK_ROOM, onlyLine, EMOTION_FACE, EMOTION_LIGHT, EMOTION_POSE, EMOTION_POSE_ONE, frameOf, lightFor, isDollCast, joinIdea, KNIT_POSE, KNIT_STYLE, positiveOnly,
  SHOT_FRAMES, scenePrompt, splitIdea, undoll, wardrobeCue,
} from "@/lib/reels/prompt";
import { REEL_EMOTIONS, REEL_SHOTS } from "@/lib/reels/motion";
import { REEL_SHOT_SIZES, REEL_SUBJECTS } from "@/lib/reels/shots";
import { DEFAULT_THEME_ID, STATIC_THEMES, STILL_STYLE_TAG, STYLE_TAG, staticTheme, styleTag, themeOf } from "@/lib/reels/themes";

const DOLLS = {
  adult: "the mom doll: a crocheted mother doll with chunky dark-brown yarn hair gathered in a low bun, warm tan wool skin, a mustard-yellow cable-knit cardigan over a cream knitted dress",
  child: "the baby doll: a small crocheted baby doll about six months old with a few soft tufts of dark-brown yarn hair, warm tan wool skin, a rust-orange knitted romper with a round cream collar",
};
const PEOPLE = {
  adult: "the mom: a young mother with dark-brown hair in a low bun, a mustard cardigan", child: "the baby: a chubby baby in a rust romper",
  adult_tag: "Filipino mom, tan skin, low bun, mustard cardigan", child_tag: "chubby baby, tan skin, rust romper",
};
const NEGATIVE = /\b(avoid|not a|without|no (blur|watermark|people|extra))\b/i;
const line = {
  idea: "The mom rocks the baby by the window — the sala at dusk", beat: "build", emotion: "teary",
  action: "holds the baby close, one hand on its back", shot_size: "medium", subject: "both",
};
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const head = (p: string) => p.split("\n")[0];

describe("themes", () => {
  it("the static themes mirror migration 007's seed verbatim (style + faces)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "007_reel_themes.sql"), "utf8");
    const rows = [...sql.matchAll(/\('([a-z0-9]+)', '[^']*', '[^']*', '(?:[^']|'')*', (true|false), (?:true|false), \d+,\s*\n\s*'((?:[^']|'')*)'\)/g)];
    expect(rows.map((r) => r[1])).toEqual([...REEL_THEME_IDS]);
    for (const [, id, faces, style] of rows) {
      const t = STATIC_THEMES[id as keyof typeof STATIC_THEMES];
      expect(t.style, id).toBe(style.replace(/''/g, "'"));
      expect(t.faces, id).toBe(faces === "true");
      expect(t.id).toBe(id);
    }
    expect(STATIC_THEMES.knitted.style).toBe(KNIT_STYLE);
  });

  it("unknown ids fall back to knitted; a usable DB row wins over the static copy", () => {
    expect(DEFAULT_THEME_ID).toBe("knitted");
    expect(staticTheme("nope")).toBe(STATIC_THEMES.knitted);
    expect(staticTheme(null)).toBe(STATIC_THEMES.knitted);
    expect(staticTheme("clay")).toBe(STATIC_THEMES.clay);
    expect(themeOf({ id: "clay", style: "Fresh clay wording.", faces: true, label: "x" })).toEqual({ id: "clay", style: "Fresh clay wording.", faces: true });
    expect(themeOf(null, "anime")).toBe(STATIC_THEMES.anime);
    expect(themeOf({ id: "anime", style: "" }, "anime")).toBe(STATIC_THEMES.anime);
  });

  it("every theme has a short style tag (≤ 12 words, positive-only, no lighting, never camera)", () => {
    expect(Object.keys(STYLE_TAG)).toEqual([...REEL_THEME_IDS]);
    for (const id of REEL_THEME_IDS) {
      expect(words(STYLE_TAG[id]), id).toBeLessThanOrEqual(12);
      expect(STYLE_TAG[id], id).not.toMatch(/camera|\blight\b|avoid|\bno\b|\bnot\b/i);
    }
    expect(STYLE_TAG.sketch).toMatch(/black-and-white/);
    expect(styleTag({ id: "nope" as never })).toBe(STYLE_TAG.knitted);
  });
});

describe("scenePrompt v2: front-loaded token order", () => {
  it("[shot + angle + lens], [moment, action, feeling], [character tag], [setting], [lighting], [style tag], then NO_TEXT", () => {
    const p = scenePrompt(STATIC_THEMES.animated3d, PEOPLE, line, 4);
    const at = (s: string) => { const i = p.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i; };
    expect(p.startsWith(`Vertical 9:16 ${frameOf("medium", 4)}, `)).toBe(true);
    expect(at("The mom rocks the baby by the window")).toBeLessThan(at(line.action));
    expect(at(line.action)).toBeLessThan(at(EMOTION_FACE.teary));
    expect(at(EMOTION_FACE.teary)).toBeLessThan(at(`${PEOPLE.adult_tag} with chubby baby, rust romper`));
    expect(at("chubby baby, rust romper")).toBeLessThan(at("the sala at dusk"));
    expect(at("the sala at dusk")).toBeLessThan(at(lightFor("teary", "the sala at dusk")));
    expect(at(lightFor("teary", "the sala at dusk"))).toBeLessThan(at(STYLE_TAG.animated3d));
    expect(p.endsWith(`${STYLE_TAG.animated3d}. The only people in the picture are the mom and her baby.\n${NO_TEXT}`)).toBe(true);
    // the long style block is for theme previews only
    expect(p).not.toContain(STATIC_THEMES.animated3d.style);
    expect(p).not.toContain("—");
  });

  it("lens rotation by shot size: wide 24-35, medium 50, close 85, detail 100 macro, POV 24 first-person, B-roll 50", () => {
    const lens = (size: (typeof REEL_SHOT_SIZES)[number]) => SHOT_FRAMES[size].map((f) => Number(f.match(/(\d+)mm/)![1]));
    expect(lens("wide").every((x) => x >= 24 && x <= 35)).toBe(true);
    expect(lens("medium").every((x) => x === 50)).toBe(true);
    expect(lens("close").every((x) => x === 85)).toBe(true);
    expect(lens("detail").every((x) => x === 100)).toBe(true);
    expect(SHOT_FRAMES.detail.every((f) => /macro/.test(f))).toBe(true);
    expect(lens("pov").every((x) => x === 24)).toBe(true);
    expect(SHOT_FRAMES.pov.every((f) => /first-person/.test(f))).toBe(true);
    expect(lens("broll").every((x) => x === 50)).toBe(true);
    const all = REEL_SHOT_SIZES.flatMap((s) => SHOT_FRAMES[s]);
    expect(new Set(all).size).toBe(all.length);
    for (const s of REEL_SHOT_SIZES) expect(SHOT_FRAMES[s].length, s).toBeGreaterThanOrEqual(2);
  });

  it("never the same lens + angle on two lines in a row, whatever the sizes", () => {
    for (const a of REEL_SHOT_SIZES) for (const b of REEL_SHOT_SIZES) for (let i = 0; i < 6; i++) {
      expect(frameOf(a, i), `${a}@${i} → ${b}`).not.toBe(frameOf(b, i + 1));
    }
  });

  it("character tags: one person, both, the script's own tag or a short one cut from the description", () => {
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, subject: "mom" }, 2)).toContain(PEOPLE.adult_tag);
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, subject: "mom" }, 2)).not.toContain(PEOPLE.child_tag);
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, subject: "baby" }, 2)).toContain(PEOPLE.child_tag);
    expect(castTag(PEOPLE, "adult")).toBe(PEOPLE.adult_tag);
    const noTags = { adult: PEOPLE.adult, child: PEOPLE.child };
    expect(castTag(noTags, "adult")).toBe("a young mother with dark-brown hair");
    expect(castTag(noTags, "child")).toBe("a chubby baby in a rust romper");
    expect(words(castTag(DOLLS, "adult"))).toBeLessThanOrEqual(8);
    expect(capWords("one two three, four five six seven eight nine", 6)).toBe("one two three");
    expect(capWords("one, two three four five six seven", 4)).toBe("one, two three four");
  });

  it("detail / B-roll / object / empty shots carry no face: hands get skin tone + wardrobe only", () => {
    expect(wardrobeCue(PEOPLE.adult_tag)).toBe("tan skin, mustard cardigan");
    expect(wardrobeCue("young Filipino mom, warm tan skin, low dark bun, mustard cardigan")).toBe("warm tan skin, mustard cardigan");
    expect(wardrobeCue("chubby six-month-old girl, warm tan skin, rust romper")).toBe("warm tan skin, rust romper");
    const d = scenePrompt(STATIC_THEMES.animated3d, PEOPLE, { ...line, shot_size: "detail", subject: "mom", idea: "fingers fold a tiny sock — the sala at dusk" }, 3);
    expect(d).toContain("the parent's hands, tan skin, mustard cardigan");
    expect(d).not.toMatch(/Filipino mom|low bun|glistening eyes|inner brows/);
    expect(d).toContain("100mm macro");
    const both = scenePrompt(STATIC_THEMES.animated3d, PEOPLE, { ...line, shot_size: "broll", subject: "both" }, 3);
    expect(both).toContain("the parent's and the child's hands, tan skin, mustard cardigan, rust romper");
    expect(words(`${PEOPLE.adult_tag} with ${PEOPLE.child_tag}`)).toBeLessThanOrEqual(15);
    for (const subject of ["object", "none"]) {
      const o = scenePrompt(STATIC_THEMES.animated3d, PEOPLE, { ...line, shot_size: "close", subject, idea: "a half-finished bottle on the counter — the kitchen at 3 a.m." }, 5);
      expect(o, subject).not.toMatch(/mom|baby|hands|holds the baby|glistening/i);
      expect(o).toContain("a half-finished bottle on the counter");
      expect(o).toContain("the kitchen at 3 a.m");
    }
  });

  it("lighting follows the setting's time of day (the feeling sets warm or cool), else the feeling", () => {
    expect(lightFor("playful", "the small sala at night")).toBe("warm dim lamp light at night");
    expect(lightFor("exhausted", "the nursery at 3 a.m.")).toBe("cool dim night light with one warm lamp");
    expect(lightFor("tender", "a jeepney at dusk")).toBe("warm golden dusk light");
    expect(lightFor("laughing", "the kitchen on a sunny afternoon")).toBe("bright warm daylight");
    expect(lightFor("worried", "the sala on a rainy afternoon")).toBe("soft grey rainy-day light");
    expect(lightFor("proud", "lola's garden")).toBe(EMOTION_LIGHT.proud);
    expect(lightFor(null, "")).toBe("soft warm light");
    for (const e of Object.keys(EMOTION_LIGHT)) expect(EMOTION_LIGHT[e as keyof typeof EMOTION_LIGHT]).not.toMatch(/morning|night|afternoon|day/);
    const p = scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, emotion: "playful", idea: "The baby runs laps — the small sala at night" }, 3);
    expect(p).toContain("the small sala at night, warm dim lamp light at night,");
    expect(p).not.toMatch(/daylight/);
  });

  it("feelings: faces themes on faces; pose only in a wide line without its own action; faceless themes always through pose", () => {
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, shot_size: "close" }, 1)).toContain(EMOTION_FACE.teary);
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, shot_size: "wide", action: "" }, 1)).toContain(EMOTION_POSE.teary);
    // a line with an action: only the facial wording, so the pose can't contradict it (e2e: arms up + "head bowed")
    const acted = scenePrompt(STATIC_THEMES.animated3d, PEOPLE, { ...line, shot_size: "wide", subject: "baby", emotion: "teary", action: "reaches both arms high, crying" }, 1);
    expect(acted).toContain(`reaches both arms high, crying, ${EMOTION_FACE.teary}`);
    expect(acted).not.toContain(EMOTION_POSE_ONE.teary);
    expect(acted).not.toMatch(/head bowed|hand over the heart/);
    // one person alone never gets "each other"
    const one = scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, shot_size: "wide", subject: "baby", emotion: "playful", action: "" }, 1);
    expect(one).toContain(EMOTION_POSE_ONE.playful);
    for (const x of Object.values(EMOTION_POSE_ONE)) expect(x).not.toMatch(/each other|together|they /);
    for (const t of [STATIC_THEMES.knitted, STATIC_THEMES.papercraft]) {
      const p = scenePrompt(t, DOLLS, { ...line, shot_size: "close" }, 3);
      expect(p, t.id).toContain(EMOTION_POSE.teary);
      expect(p, t.id).not.toContain(EMOTION_FACE.teary);
    }
  });

  it("knitted keeps the doll cast, doll wording and the grounded pose line when both dolls are in frame", () => {
    const p = scenePrompt(STATIC_THEMES.knitted, DOLLS, { ...line, idea: "The mom doll rocks the baby doll." }, 2);
    expect(p).toContain("The mom doll rocks the baby doll");
    expect(p).toContain(castTag(DOLLS, "adult"));
    expect(p).toContain(STYLE_TAG.knitted);
    expect(p).toContain(KNIT_POSE);
    expect(scenePrompt(STATIC_THEMES.knitted, DOLLS, { ...line, subject: "mom" }, 2)).not.toContain(KNIT_POSE);
    expect(KNIT_POSE).not.toMatch(/\blift/i);
  });

  it("other themes turn a doll cast into people (so a reel can switch theme)", () => {
    const p = scenePrompt(STATIC_THEMES.cinematic, DOLLS, { ...line, idea: "The mom doll rocks the baby doll; the dolls smile." }, 2);
    expect(p).not.toMatch(/\bdolls?\b|crochet|yarn|wool skin|knitted/i);
    expect(p).toContain("The mom rocks the baby; the characters smile");
    expect(p).not.toContain(KNIT_POSE);
    expect(undoll("both dolls hug; the mom doll's lap")).toBe("both of them hug; the mom's lap");
  });

  it("scene 1 keeps the top quarter calm (room for the hook card), faces and action below it; only scene 1", () => {
    for (const id of REEL_THEME_IDS) {
      const p = scenePrompt(STATIC_THEMES[id], DOLLS, line, 0);
      expect(p, id).toContain(HOOK_ROOM);
      expect(p.indexOf(HOOK_ROOM)).toBeGreaterThan(p.indexOf(STYLE_TAG[id]));
      expect(p.trim().endsWith(NO_TEXT)).toBe(true);
    }
    expect(HOOK_ROOM).toMatch(/top quarter of the frame is calm and simple/);
    expect(HOOK_ROOM).toMatch(/faces and the action sit in the lower three quarters/);
    expect(HOOK_ROOM).not.toMatch(/\b(?:no|not|never|without|avoid|empty of|free of)\b|camera|text/i);
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, line, 1)).not.toContain(HOOK_ROOM);
  });

  it("only the opening picture gets the hook treatment", () => {
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, line, 0)).toMatch(/a striking, high-emotion moment: The mom rocks/);
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, line, 1)).not.toMatch(/high-emotion/);
  });

  it("lines from before 008 map their 007 framing to a size and show both characters", () => {
    const p = scenePrompt(STATIC_THEMES.knitted, DOLLS, { idea: "The mom doll gasps.", beat: "hook", shot: "hands-detail", emotion: "surprised" }, 0);
    expect(head(p)).toMatch(/^Vertical 9:16 extreme close-up detail/);
    expect(scenePrompt(STATIC_THEMES.knitted, DOLLS, { idea: "x", beat: "close" }, 5)).toMatch(/^Vertical 9:16 medium shot/);
    expect(scenePrompt(STATIC_THEMES.knitted, DOLLS, { idea: "x", shot: "wide" }, 5)).toMatch(/^Vertical 9:16 wide/);
  });

  it("ideas: the moment and its setting are stored together and split again", () => {
    expect(joinIdea("The mom kneels by the crib.", "the nursery at 3 a.m.")).toBe("The mom kneels by the crib — the nursery at 3 a.m");
    expect(joinIdea("The mom kneels.", "  ")).toBe("The mom kneels");
    expect(splitIdea("The mom kneels — the nursery at 3 a.m.")).toEqual({ moment: "The mom kneels", setting: "the nursery at 3 a.m" });
    expect(splitIdea("The mom kneels by the crib.")).toEqual({ moment: "The mom kneels by the crib", setting: "" });
  });

  it("is positive-only (apart from NO_TEXT) and never says camera, for every theme, emotion, size and subject", () => {
    for (const id of REEL_THEME_IDS) {
      for (const emotion of REEL_EMOTIONS) {
        for (const shot_size of REEL_SHOT_SIZES) {
          for (const subject of REEL_SUBJECTS) {
            const q = scenePrompt(STATIC_THEMES[id], DOLLS, { ...line, emotion, shot_size, subject }, 0);
            expect(q).not.toMatch(/\bcamera\b/i);
            expect(q.replace(NO_TEXT, ""), `${id}/${emotion}/${shot_size}/${subject}`).not.toMatch(NEGATIVE);
            expect(q.match(/No text/g)).toHaveLength(1);
          }
        }
      }
    }
    for (const shot of REEL_SHOTS) expect(scenePrompt(STATIC_THEMES.clay, DOLLS, { idea: "x", shot }, 1)).not.toMatch(/\bcamera\b/i);
  });
});

describe("positiveOnly (free text from the script)", () => {
  it("drops every clause that names something absent; a leftover camera becomes viewer", () => {
    expect(positiveOnly("no tears, smiling")).toBe("smiling");
    expect(positiveOnly("She smiles; nobody else is there. The baby giggles")).toBe("She smiles; The baby giggles");
    expect(positiveOnly("hugs him without words, eyes closed")).toBe("eyes closed");
    expect(positiveOnly("he doesn't cry, she isn't worried")).toBe("");
    expect(positiveOnly("waves at the camera, never letting go")).toBe("waves at the viewer");
    expect(positiveOnly("cuddles close, nose to nose")).toBe("cuddles close, nose to nose");
    expect(positiveOnly("")).toBe("");
  });

  it("Knitted Doll: lift / raise / toss / hold-up clauses are dropped (people themes keep them)", () => {
    expect(positiveOnly("the mom doll lifts the baby doll high, both laughing", true)).toBe("both laughing");
    expect(positiveOnly("holds the baby doll up to the window, smiling", true)).toBe("smiling");
    expect(positiveOnly("tosses him in the air; raises her arms", true)).toBe("");
    expect(positiveOnly("the mom lifts the baby high, both laughing")).toBe("the mom lifts the baby high, both laughing");
  });

  it("scenePrompt applies it to idea, action and cast on every theme", () => {
    const dirty = { ...line, idea: "The mom doll lifts the baby doll high, no tears, both laughing.", action: "raises him overhead, not crying, cheeks pressed together" };
    const cast = { adult: `${DOLLS.adult}`, child: DOLLS.child, adult_tag: "mom doll, tan wool skin, no shoes" };
    const k = scenePrompt(STATIC_THEMES.knitted, cast, dirty, 2);
    expect(k).not.toMatch(/lift|raise|overhead|no tears|not crying|no shoes/i);
    expect(k).toContain(", both laughing, cheeks pressed together,");
    // a knitted idea that was only a lift falls back to a calm, grounded moment
    expect(scenePrompt(STATIC_THEMES.knitted, DOLLS, { ...line, idea: "The mom doll lifts the baby doll up." }, 2)).toContain("the two dolls cuddle close together");
    const c = scenePrompt(STATIC_THEMES.cinematic, cast, dirty, 2);
    expect(c).toContain("The mom lifts the baby high, both laughing");
    expect(c).not.toMatch(/no tears|not crying|no shoes/);
  });
});

describe("undoll only for a doll-written cast", () => {
  it("detects a doll cast; a people cast keeps its words (a rag doll stays a doll)", () => {
    expect(isDollCast(DOLLS)).toBe(true);
    expect(isDollCast(PEOPLE)).toBe(false);
    const p = scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, idea: "The toddler hugs her knitted rag doll on the sofa." }, 2);
    expect(p).toContain("The toddler hugs her knitted rag doll on the sofa");
    const d = scenePrompt(STATIC_THEMES.anime, DOLLS, { ...line, idea: "The mom doll hugs the baby doll." }, 2);
    expect(d).toContain("The mom hugs the baby");
  });

  it("drops doll materials on bodies and toys (yarn / wool / felt / crocheted), keeps clothing", () => {
    expect(undoll("a few scattered yarn toy blocks")).toBe("a few scattered toy blocks");
    expect(undoll("she cups the tiny yarn feet")).toBe("she cups the tiny feet");
    expect(undoll("felt hands and wool cheeks, a crocheted bunny")).toBe("hands and cheeks, a bunny");
    expect(undoll("a cozy wool sweater")).toBe("a cozy wool sweater");
    const p = scenePrompt(STATIC_THEMES.animated3d, DOLLS, { ...line, idea: "The mom doll cups the tiny yarn feet near yarn toy blocks" }, 3);
    expect(p).not.toMatch(/\byarn\b|crochet|\bdoll/i);
  });

  it("character tags never repeat a fragment (two people, or both pairs of hands)", () => {
    const cast = { ...PEOPLE, adult_tag: "Filipino mom, tan skin, office blouse", child_tag: "baby girl, tan skin, white onesie" };
    const both = scenePrompt(STATIC_THEMES.animated3d, cast, { ...line, shot_size: "medium", subject: "both" }, 3);
    expect(both).toContain("Filipino mom, tan skin, office blouse with baby girl, white onesie");
    const hands = scenePrompt(STATIC_THEMES.animated3d, cast, { ...line, shot_size: "detail", subject: "both" }, 3);
    expect(hands).toContain("the parent's and the child's hands, tan skin, office blouse, white onesie");
    expect(hands.match(/tan skin/g)).toHaveLength(1);
    expect(dedupeFragments("a, b", "B, c")).toBe("c");
  });

  it("maps bead eyes to eyes and drops embroidered", () => {
    expect(undoll("a crocheted baby doll with glossy bead eyes and a small embroidered smile")).toBe("a baby with glossy eyes and a small smile");
  });
});

describe("no strangers, no faces on objects, a fixed child age (e2e 4cc98904)", () => {
  const CAST = { ...PEOPLE, child_age: "a 10-month-old baby boy" };

  it("style tags never invite faces, families or extra characters; the still variant has no character wording at all", () => {
    for (const id of REEL_THEME_IDS) {
      expect(STYLE_TAG[id], id).not.toMatch(/face|family|people|characters?/i);
      expect(STILL_STYLE_TAG[id], id).not.toMatch(/face|family|people|character|doll|skin|figure/i);
      expect(STILL_STYLE_TAG[id].split(" ").length, id).toBeLessThanOrEqual(12);
    }
    expect(styleTag(STATIC_THEMES.knitted, true)).toBe(STILL_STYLE_TAG.knitted);
  });

  it("pictures with nobody in them carry no lens / mm words (they summon a lens in frame); people shots keep them", async () => {
    const { STILL_FRAMES } = await import("@/lib/reels/prompt");
    const block = { ...line, idea: "a wooden blue block tipping off a small stack — the play mat at noon" };
    for (const id of REEL_THEME_IDS) for (const subject of ["object", "none"]) for (const shot_size of REEL_SHOT_SIZES) for (let i = 1; i < 4; i++) {
      const p = scenePrompt(STATIC_THEMES[id], CAST, { ...block, subject, shot_size }, i);
      expect(p, `${id}/${subject}/${shot_size}`).not.toMatch(/\blens\b|\d+\s?mm\b|camera/i);
    }
    expect(scenePrompt(STATIC_THEMES.cinematic, CAST, { ...block, subject: "object", shot_size: "detail" }, 1))
      .toMatch(/^Vertical 9:16 macro close-up at eye level, very shallow depth of field, soft background blur, a quiet still life, a wooden blue block/);
    expect(scenePrompt(STATIC_THEMES.cinematic, CAST, { ...line, subject: "mom", shot_size: "close" }, 1)).toMatch(/85mm lens/);
    expect(scenePrompt(STATIC_THEMES.cinematic, CAST, { ...line, subject: "mom", shot_size: "detail" }, 1)).toMatch(/100mm macro lens/);
    const all = REEL_SHOT_SIZES.flatMap((s) => [...STILL_FRAMES[s], ...SHOT_FRAMES[s]]);
    expect(new Set(all).size).toBe(all.length);
    for (const a of REEL_SHOT_SIZES) for (const b of REEL_SHOT_SIZES) for (let i = 0; i < 6; i++) {
      expect(frameOf(a, i, true)).not.toBe(frameOf(b, i + 1, true));
    }
  });

  it("people-free shots also lose lens / mm / camera words from the script's own idea and setting", async () => {
    const { scrubOptics } = await import("@/lib/reels/prompt");
    expect(scrubOptics("a blue block seen through a 50mm lens, tipping over")).toBe("a blue block, tipping over");
    expect(scrubOptics("the crib, macro lens, soft blur")).toBe("the crib, soft blur");
    expect(scrubOptics("a bottle on the counter, 85 mm")).toBe("a bottle on the counter");
    expect(scrubOptics("a toy facing the camera")).toBe("a toy");
    expect(scrubOptics("a quiet kitchen")).toBe("a quiet kitchen");
    const p = scenePrompt(STATIC_THEMES.cinematic, CAST, { ...line, subject: "object", shot_size: "detail",
      idea: "a blue block seen through a 50mm lens, tipping off a stack, the camera close — the play mat, macro lens" }, 2);
    expect(p).not.toMatch(/\blens\b|\d+\s?mm\b|camera|viewer/i);
    expect(p).toContain("a quiet still life, a blue block, tipping off a stack");
    // people shots keep their own lens line
    expect(scenePrompt(STATIC_THEMES.cinematic, CAST, { ...line, subject: "mom" }, 2)).toMatch(/50mm lens/);
  });

  it("every prompt says who is in frame, positively", () => {
    const p = (subject: string, shot_size = "medium") => scenePrompt(STATIC_THEMES.animated3d, CAST, { ...line, subject, shot_size }, 3);
    expect(p("both")).toContain("The only people in the picture are the mom and her baby.");
    expect(p("mom")).toContain("The mom is the only person in the picture.");
    expect(p("baby")).toContain("The baby is the only person in the picture.");
    expect(p("both", "detail")).toContain("The only people in the picture are the mom and her baby, seen only as their hands.");
    const still = p("object");
    expect(still).toContain("a quiet still life, the mom rocks the baby by the window, a calm, peaceful space");
    expect(still).toContain(STILL_STYLE_TAG.animated3d);
    expect(still).not.toMatch(/only person|only people/);
    for (const s of ["both", "mom", "baby", "object", "none"]) expect(p(s).replace(NO_TEXT, "")).not.toMatch(/\b(?:no|nobody|not|without|empty of|else)\b/i);
    const dad = scenePrompt(STATIC_THEMES.anime, { ...CAST, adult_tag: "Filipino dad, tan skin, grey shirt" }, { ...line, subject: "both" }, 3);
    expect(dad).toContain("The only people in the picture are the dad and his baby.");
    expect(onlyLine("both", false, "mom", "toddler", true)).toBe("The only figures in the picture are the mom doll and her toddler doll.");
    expect(onlyLine("none", false, "mom", "baby")).toBe("");
  });

  it("the child's age leads its tag every time the child appears", () => {
    const b = scenePrompt(STATIC_THEMES.animated3d, CAST, { ...line, subject: "baby" }, 3);
    expect(b).toContain("a 10-month-old baby boy, tan skin, rust romper");
    expect(b).not.toContain("chubby baby");
    const both = scenePrompt(STATIC_THEMES.animated3d, CAST, { ...line, subject: "both" }, 3);
    expect(both).toContain("Filipino mom, tan skin, low bun, mustard cardigan with a 10-month-old baby boy, rust romper");
    expect(childTagWithAge("chubby baby, tan skin, rust romper", "a 2-year-old toddler girl")).toBe("a 2-year-old toddler girl, tan skin, rust romper");
    expect(childAge({ adult: "x", child: "Leo, a chubby six-month-old baby with dark hair" })).toBe("six-month-old baby");
    expect(childAge({ adult: "x", child: "Leo, an energetic toddler" }, "toddler")).toBe("a toddler");
    expect(childNoun("a 10-month-old baby boy")).toBe("baby");
    expect(childNoun("a 2-year-old toddler girl")).toBe("toddler");
    expect(childNoun("a newborn baby")).toBe("newborn");
    expect(childNoun("a four-year-old boy")).toBe("child");
    expect(scenePrompt(STATIC_THEMES.anime, { ...CAST, child_age: "a 2-year-old toddler girl" }, { ...line, subject: "baby" }, 3))
      .toContain("The toddler is the only person in the picture.");
  });
});
