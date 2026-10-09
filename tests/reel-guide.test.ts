import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REEL_THREADS } from "@/lib/db/types";
import {
  childWord, cleanFeeling, cleanScene, crayonPrompt, feelingFor, FEELING_FOR_EMOTION, greyText, GUIDE_HOOK_ROOM, GUIDE_LEAD, guidePreviewPrompt,
  guideScenePrompt, isGuideTheme, parentWord, redThreadPrompt, THREAD_FOR_EMOTION, threadFor, threadLine, threadOf, withPhoneFix,
} from "@/lib/reels/guide";
import { CRAYON_GUIDE, CRAYON_PREVIEW_SCENE, ONLY_RED, PHONE_VISIBLE, RED_THREAD_GUIDE, RED_THREAD_PREVIEW } from "@/lib/reels/guide-text";
import { imagePrompt } from "@/lib/reels/image-prompt";
import { scenePrompt } from "@/lib/reels/prompt";
import { REEL_EMOTIONS } from "@/lib/reels/motion";
import { REEL_SHOT_SIZES } from "@/lib/reels/shots";
import { STATIC_THEMES } from "@/lib/reels/themes";

// The owner's guides, as committed in docs/reference (the root copies are the owner's working files).
const guide = (f: string) => readFileSync(join(process.cwd(), "docs", "reference", f), "utf8").replace(/\r\n/g, "\n");
const CRAYON_MD = guide("crayon-parenting-prompt.md");
const RED_MD = guide("red-thread-parenting-prompt.md");
const block = (md: string, heading: string) => {
  const at = md.indexOf(heading);
  expect(at, heading).toBeGreaterThanOrEqual(0);
  return md.slice(at).match(/```\n([\s\S]*?)\n```/)![1];
};
const CRAYON_MASTER = block(CRAYON_MD, "## Master Prompt");
const RED_MASTER = block(RED_MD, "## Master Prompt");
const RED_SLOTS = "[SCENE: characters, action, facial expressions and gestures]\n[THREAD: pick one of the three thread lines below]\nThe feeling is [emotion].";

const CAST = {
  adult: "the mom: a young Filipino mother in her early thirties with warm tan skin and dark-brown hair in a low bun, wearing a mustard-yellow cardigan over a cream dress",
  child: "the baby: a chubby 10-month-old baby boy with warm tan skin and soft dark tufts of hair, wearing a rust-orange romper",
  adult_tag: "Filipino mom, tan skin, low bun, mustard cardigan", child_tag: "chubby baby, tan skin, rust romper", child_age: "a 10-month-old baby boy",
};
const GREY_CAST = {
  adult: "the mom: a young Filipino mother with dark hair in a low bun, wearing a plain cardigan over a striped dress",
  child: "the baby: a chubby 10-month-old baby boy with soft dark tufts of hair, wearing a plain romper",
  adult_tag: "Filipino mom, low bun, plain cardigan", child_tag: "chubby baby, plain romper", child_age: "a 10-month-old baby boy",
};
const SCENE = "The mother hugs the baby tightly on the floor of a messy sala, eyes crinkled shut with a wide smile, the baby laughing with an open mouth and rosy scribbled cheeks. Scattered toy blocks in the foreground, a window with an evening sky behind.";
const line = (x: Record<string, unknown> = {}) => ({ idea: SCENE, emotion: "cuddly", shot_size: "medium", subject: "both", feeling: "comfort after a long day", ...x });

describe("the master prompts are the guides' own, verbatim and in order", () => {
  it("Crayon: style, depth, [SCENE] (ending with the feeling), closing", () => {
    const scene = "A father holds his toddler son's hands. The feeling is pride and joy.";
    expect(crayonPrompt(scene)).toBe(CRAYON_MASTER.replace(/\[SCENE:[^\]]*\]/, scene));
    expect(CRAYON_MASTER.split("\n\n")).toEqual([CRAYON_GUIDE.style, CRAYON_GUIDE.depth, expect.stringMatching(/^\[SCENE/), CRAYON_GUIDE.close]);
  });

  it("Red Thread: style, depth, [SCENE] / [THREAD] / feeling lines, closing; 'only color' repeated at the start and end", () => {
    const p = redThreadPrompt("SCENE.", "THREAD.", "an unbreakable bond");
    expect(p).toBe(`${ONLY_RED} ${RED_MASTER.replace(RED_SLOTS, "SCENE.\nTHREAD.\nThe feeling is an unbreakable bond.")} ${ONLY_RED}`);
    expect(RED_MASTER.split("\n\n")).toEqual([RED_THREAD_GUIDE.style, RED_THREAD_GUIDE.depth, RED_SLOTS, RED_THREAD_GUIDE.close]);
    // quick fix "thread only on one wrist": the thread line first
    expect(redThreadPrompt("SCENE.", "THREAD.", "x", true)).toContain("\n\nTHREAD.\nSCENE.\nThe feeling is x.\n\n");
  });

  it("the previews use the guides' example scenes: Crayon 'Mother and newborn', Red Thread '2. Newborn'", () => {
    expect(guidePreviewPrompt("crayon")).toBe(crayonPrompt(block(CRAYON_MD, "### Mother and newborn")));
    expect(CRAYON_PREVIEW_SCENE).toBe(block(CRAYON_MD, "### Mother and newborn"));
    const [scene, thread, feeling] = block(RED_MD, "### 2. Newborn").split("\n");
    expect([RED_THREAD_PREVIEW.scene, RED_THREAD_PREVIEW.thread, `The feeling is ${RED_THREAD_PREVIEW.feeling}.`]).toEqual([scene, thread, feeling]);
    expect(guidePreviewPrompt("redthread")).toBe(redThreadPrompt(scene, withPhoneFix(thread), RED_THREAD_PREVIEW.feeling, true));
    expect(guidePreviewPrompt("redthread")).toContain(`thin bright red thread, ${PHONE_VISIBLE}, is tied`);
  });

  it("both styles are guide themes; the 8 old ones are not", () => {
    expect(isGuideTheme(STATIC_THEMES.crayon)).toBe(true);
    expect(isGuideTheme(STATIC_THEMES.redthread)).toBe(true);
    expect(isGuideTheme(STATIC_THEMES.knitted)).toBe(false);
    expect(isGuideTheme(null)).toBe(false);
  });
});

describe("Red Thread: the thread line", () => {
  const W = { parent: "parent", child: "child" };
  it("plain lines A / B / C are the guide's own (without the phone fix and the side)", () => {
    const plain = { phone: false, side: false };
    expect(threadLine({ kind: "both", ...W }, "plain", plain)).toBe(block(RED_MD, "### A. Parent + child both visible"));
    expect(threadLine({ kind: "parent", ...W }, "plain", plain)).toBe(block(RED_MD, "### B. Only the parent visible"));
    expect(threadLine({ kind: "child", ...W }, "plain", plain)).toBe(block(RED_MD, "### C. Only the child visible"));
  });

  it("the cast words replace parent / child; a baby gets the tiny wrist; always thick enough for a phone screen", () => {
    const a = threadLine({ kind: "both", parent: "mother", child: "baby", tiny: true });
    expect(a).toBe(`A clearly visible thin bright red thread, ${PHONE_VISIBLE}, is tied in a small bow around the mother's wrist and tied around the baby's tiny wrist, one continuous thread connecting both wrists, looping loosely around them, with a short end trailing gently onto the floor.`);
    expect(threadLine({ kind: "child", parent: "father", child: "girl" })).toContain("around the girl's wrist,");
    for (const kind of ["both", "parent", "child", "none"] as const) for (const t of REEL_THREADS) {
      const l = threadLine({ kind, parent: "mother", child: "baby" }, t);
      expect(l, `${kind}/${t}`).toContain(PHONE_VISIBLE);
      expect(l, `${kind}/${t}`).toMatch(/^A clearly visible thin bright red thread/);
      expect(l, `${kind}/${t}`).not.toMatch(/\bparent\b|\bchild\b|camera/);
      if (kind !== "none") expect(l, `${kind}/${t}`).toMatch(/tied in a small bow around the (mother|baby)'s/);
    }
  });

  it("direction across cuts: the parent's thread leaves to the right, the child's to the left; nobody → it rests on the things", () => {
    for (const t of REEL_THREADS) {
      expect(threadLine({ kind: "parent", parent: "mother", child: "baby" }, t), t).toMatch(/out of the right side of the frame/);
      expect(threadLine({ kind: "child", parent: "mother", child: "baby" }, t), t).toMatch(/out of the left side of the frame/);
    }
    expect(threadLine({ kind: "none", parent: "mother", child: "baby" })).toMatch(/rests on the floor and drapes across the things in the picture.*leading out of the frame/);
  });

  it("the thread tells the story: tight loop, long stretch, tangled knot, loose but tied (guide examples 6-8)", () => {
    const both = (t: (typeof REEL_THREADS)[number]) => threadLine({ kind: "both", parent: "mother", child: "boy" }, t);
    expect(both("tight")).toMatch(/pulled short and tight between them/);
    expect(both("stretched")).toMatch(/one long continuous thread stretching across the floor between them, still connected/);
    expect(both("tangled")).toMatch(/loosely tangled in a messy knot between them, but still connected/);
    expect(both("loose")).toMatch(/long and loose between them .*but still tied/);
    expect(new Set(REEL_THREADS.map(both)).size).toBe(REEL_THREADS.length);
  });

  it("thread state: the script's (aliases ok), else from the emotion (hugs tight, hard times loose)", () => {
    expect(threadOf("Tangled")).toBe("tangled");
    expect(threadOf("long stretched")).toBe("stretched");
    expect(threadOf("loose but still tied")).toBe("loose");
    expect(threadOf("frayed")).toBeNull();
    expect(threadFor("stretched", "cuddly")).toBe("stretched");
    expect(threadFor(undefined, "cuddly")).toBe("tight");
    expect(threadFor("??", "worried")).toBe("loose");
    expect(threadFor(null, null)).toBe("plain");
    expect(Object.keys(THREAD_FOR_EMOTION).sort()).toEqual([...REEL_EMOTIONS].sort());
  });
});

describe("the [SCENE] text", () => {
  it("cleanScene: drops framing words, the feeling sentence (kept apart), viewer looks, negated clauses, lens words", () => {
    expect(cleanScene("Close view of the mother hugging her son, looking at the camera. The feeling is pure joy.", { both: true }))
      .toEqual({ scene: "The mother hugging her son, looking at each other.", feeling: "pure joy" });
    expect(cleanScene("Wide shot: a quiet kitchen at night, no people around, seen through a 50mm lens").scene).toBe("A quiet kitchen at night.");
    expect(cleanScene("   ").scene).toBe("");
    // one person: a look at the viewer is dropped, not turned into "each other"
    expect(cleanScene("The mother waves, looking into the camera. A cup of tea beside her.").scene).toBe("The mother waves. A cup of tea beside her.");
  });

  it("Red Thread: thread sentences and red-family colours go (the thread line is the only red)", () => {
    const r = cleanScene("A mother in a red dress hugs her son. A red thread is tied on her wrist. Pink flowers and a rosy blanket beside them.", { red: true, both: true });
    expect(r.scene).toBe("A mother in a dress hugs her son. Flowers and a blanket beside them.");
    expect(greyText("a bright red apple, crimson curtains and a coral cup")).toBe("a apple, curtains and a cup");
  });

  it("the feeling: the script's phrase, cleaned; else the emotion's", () => {
    expect(cleanFeeling("The feeling is: Pure love and warmth!")).toBe("pure love and warmth");
    expect(cleanFeeling("I am home.")).toBe("I am home");
    expect(feelingFor("", "teary")).toBe(FEELING_FOR_EMOTION.teary);
    expect(feelingFor("letting go while still holding on", "teary")).toBe("letting go while still holding on");
  });

  it("cast words: mother / father; baby (tiny wrist) / boy / girl / child", () => {
    expect(parentWord(CAST)).toBe("mother");
    expect(parentWord({ ...CAST, adult: "the dad: a young Filipino father", adult_tag: "Filipino dad" })).toBe("father");
    expect(childWord(CAST)).toEqual({ word: "baby", tiny: true });
    expect(childWord({ ...CAST, child_age: "a 3-year-old toddler girl", child: "the girl: a little girl", child_tag: "little girl" })).toEqual({ word: "girl", tiny: false });
    expect(childWord({ ...CAST, child_age: "a 4-year-old boy", child: "the boy: a small boy", child_tag: "small boy" })).toEqual({ word: "boy", tiny: false });
  });
});

describe("guideScenePrompt: one picture", () => {
  it("Crayon: the master prompt around shot + scene + the same cast sentences + 'The feeling is …'", () => {
    const p = guideScenePrompt({ id: "crayon" }, CAST, line(), 3);
    const scene = p.split("\n\n")[2];
    expect(p).toBe(crayonPrompt(scene));
    expect(scene).toBe(`${GUIDE_LEAD.medium[0]} ${SCENE} The mother is a young Filipino mother in her early thirties with warm tan skin and dark-brown hair in a low bun, wearing a mustard-yellow cardigan over a cream dress. The baby is a chubby 10-month-old baby boy with warm tan skin and soft dark tufts of hair, wearing a rust-orange romper. The feeling is comfort after a long day.`);
    expect(p).not.toMatch(/camera|\d+\s?mm|\blens\b/i);
  });

  it("the same cast sentence in every picture of that person (hand details too); one person → only theirs; nobody → none", () => {
    const mom = guideScenePrompt({ id: "crayon" }, CAST, line({ subject: "mom", shot_size: "close" }), 2);
    expect(mom).toContain("The mother is a young Filipino mother");
    expect(mom).not.toContain("The baby is");
    const baby = guideScenePrompt({ id: "crayon" }, CAST, line({ subject: "baby", shot_size: "wide" }), 4);
    expect(baby).toContain("The baby is a chubby 10-month-old baby boy");
    const hands = guideScenePrompt({ id: "crayon" }, CAST, line({ subject: "both", shot_size: "detail" }), 5);
    expect(hands).toContain(`${GUIDE_LEAD.detail[0]}`);
    expect(hands).toContain("The mother is a young Filipino mother in her early thirties");
    expect(hands).toContain("The baby is a chubby 10-month-old baby boy");
    const still = guideScenePrompt({ id: "crayon" }, CAST, line({ subject: "object", shot_size: "close", idea: "A cold cup of coffee on the kitchen table." }), 6);
    expect(still).toContain(`${GUIDE_LEAD.close[1]} A cold cup of coffee on the kitchen table. The feeling is comfort after a long day.`);
    expect(still).not.toMatch(/The mother|The baby/);
  });

  it("every shot size is said in plain words; line 1 keeps the top band calm for the hook card", () => {
    for (const s of REEL_SHOT_SIZES) {
      const p = guideScenePrompt({ id: "crayon" }, CAST, line({ shot_size: s }), 3);
      expect(p, s).toContain(GUIDE_LEAD[s][0].replace("PARENT", "mother"));
      expect(p, s).not.toMatch(/camera|\d+\s?mm|\blens\b/i);
    }
    expect(guideScenePrompt({ id: "crayon" }, CAST, line(), 0)).toContain(`${GUIDE_LEAD.medium[0]} ${GUIDE_HOOK_ROOM} ${SCENE.slice(0, 20)}`);
  });

  it("Red Thread: thread line A first when both are in the picture, B / C after the scene, the thread on the objects when nobody is", () => {
    const both = guideScenePrompt({ id: "redthread" }, GREY_CAST, line({ thread: "tight" }), 2);
    const slots = both.split("\n\n")[2].split("\n");
    expect(slots).toHaveLength(3);
    expect(slots[0]).toBe(threadLine({ kind: "both", parent: "mother", child: "baby", tiny: true }, "tight"));
    expect(slots[1]).toMatch(/^A medium view/);
    expect(slots[2]).toBe("The feeling is comfort after a long day.");
    expect(both.startsWith(`${ONLY_RED} ${RED_THREAD_GUIDE.style}`)).toBe(true);
    expect(both.endsWith(`${RED_THREAD_GUIDE.close} ${ONLY_RED}`)).toBe(true);

    const mom = guideScenePrompt({ id: "redthread" }, GREY_CAST, line({ subject: "mom", shot_size: "close", thread: "stretched" }), 3).split("\n\n")[2].split("\n");
    expect(mom[0]).toMatch(/^A close-up view/);
    expect(mom[1]).toBe(threadLine({ kind: "parent", parent: "mother", child: "baby", tiny: true }, "stretched"));
    const baby = guideScenePrompt({ id: "redthread" }, GREY_CAST, line({ subject: "baby", shot_size: "wide", thread: null, emotion: "worried" }), 4).split("\n\n")[2].split("\n");
    expect(baby[1]).toBe(threadLine({ kind: "child", parent: "mother", child: "baby", tiny: true }, "loose"));
    const none = guideScenePrompt({ id: "redthread" }, GREY_CAST, line({ subject: "none", shot_size: "broll", idea: "An empty crib by the window." }), 5).split("\n\n")[2].split("\n");
    expect(none[1]).toBe(threadLine({ kind: "none", parent: "mother", child: "baby" }));
  });

  it("Red Thread: every picture has the thread and no other red word (the cast's and the scene's reds go)", () => {
    const redCast = { ...CAST, adult: "the mom: a young mother in a red blouse", adult_tag: "young mom, red blouse" };
    for (const subject of ["both", "mom", "baby", "object", "none"]) for (const s of REEL_SHOT_SIZES) {
      const p = guideScenePrompt({ id: "redthread" }, redCast, line({ subject, shot_size: s, idea: `${SCENE} A red ball on the rug.` }), 1);
      expect(p, `${subject}/${s}`).toMatch(/A clearly visible thin bright red thread, thick enough/);
      const rest = p.replaceAll(ONLY_RED, "").replace(/bright red thread/g, "").replace(/except the red thread/g, "").replace(/thin bright red thread, the only color/, "");
      expect(rest, `${subject}/${s}`).not.toMatch(/\b(?:red|rosy|pink|rust)\b/i);
    }
  });

  it("an old (knitted) script switched to a guide style: the doll words become people", () => {
    const dolls = { adult: "the mom doll: a crocheted mother doll with yarn hair, warm tan wool skin", child: "the baby doll: a crocheted baby doll in a rust romper" };
    const p = guideScenePrompt({ id: "crayon" }, dolls, { idea: "The mom doll cuddles the baby doll — the sala at night", emotion: "cuddly", shot_size: "medium", subject: "both" }, 2);
    expect(p).not.toMatch(/doll|crochet|yarn|wool/i);
    expect(p).toContain("the sala at night");
    expect(p).toContain(`The feeling is ${FEELING_FOR_EMOTION.cuddly}.`);
  });

  it("imagePrompt: guide styles use the guide builder, the 8 old themes keep the playbook builder", () => {
    expect(imagePrompt(STATIC_THEMES.crayon, CAST, line(), 2)).toBe(guideScenePrompt({ id: "crayon" }, CAST, line(), 2));
    expect(imagePrompt(STATIC_THEMES.redthread, CAST, line(), 2)).toBe(guideScenePrompt({ id: "redthread" }, CAST, line(), 2));
    expect(imagePrompt(STATIC_THEMES.anime, CAST, line(), 2)).toBe(scenePrompt(STATIC_THEMES.anime, CAST, line(), 2));
  });
});
