import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_TEXT } from "@/lib/planner/prompt";
import { REEL_THEME_IDS } from "@/lib/db/types";
import { EMOTION_FACE, EMOTION_POSE, KNIT_POSE, KNIT_STYLE, SHOT_LENS, scenePrompt, undoll } from "@/lib/reels/prompt";
import { REEL_EMOTIONS, REEL_SHOTS } from "@/lib/reels/motion";
import { DEFAULT_THEME_ID, STATIC_THEMES, staticTheme, themeOf } from "@/lib/reels/themes";

const DOLLS = {
  adult: "the mom doll: a crocheted mother doll with chunky dark-brown yarn hair gathered in a low bun, warm tan wool skin, a mustard-yellow cable-knit cardigan over a cream knitted dress",
  child: "the baby doll: a small crocheted baby doll about six months old with a few soft tufts of dark-brown yarn hair, warm tan wool skin, a rust-orange knitted romper with a round cream collar",
};
const PEOPLE = { adult: "the mom: a young mother with dark-brown hair in a low bun, a mustard cardigan", child: "the baby: a chubby baby in a rust romper" };
const NEGATIVE = /\b(avoid|not a|without|no (blur|watermark|people|extra))\b/i;
const line = { idea: "The mom sits on the sofa rocking the baby by the window.", beat: "build", emotion: "teary", action: "holds the baby close, one hand on its back", shot: "medium" };

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
});

describe("scenePrompt(theme, cast, scene, index)", () => {
  it("composes style + cast + idea + emotion + action + shot + composition + NO_TEXT (faces theme)", () => {
    const p = scenePrompt(STATIC_THEMES.animated3d, PEOPLE, line, 4);
    expect(p).toContain(STATIC_THEMES.animated3d.style);
    expect(p).toContain(`Moment: ${line.idea.replace(/\.$/, "")}.`);
    expect(p).toContain(`Emotion: ${EMOTION_FACE.teary}.`);
    expect(p).toContain(`Body language: ${line.action}.`);
    expect(p).toContain(`Lens: ${SHOT_LENS.medium("characters")}.`);
    expect(p).toContain(`Characters (the same two people in every picture): ${PEOPLE.adult}; ${PEOPLE.child}.`);
    expect(p).toMatch(/Composition: the scene fills the whole frame/);
    expect(p).toMatch(/9:16/);
    expect(p.trim().endsWith(NO_TEXT)).toBe(true);
    // order: moment → emotion → body language → lens, then style
    const at = (s: string) => p.indexOf(s);
    expect(at("Moment:")).toBeLessThan(at("Emotion:"));
    expect(at("Emotion:")).toBeLessThan(at("Body language:"));
    expect(at("Body language:")).toBeLessThan(at("Lens:"));
    expect(at("Lens:")).toBeLessThan(at(STATIC_THEMES.animated3d.style));
  });

  it("faceless themes carry the feeling as body language, never a facial expression", () => {
    for (const t of [STATIC_THEMES.knitted, STATIC_THEMES.papercraft]) {
      const p = scenePrompt(t, DOLLS, line, 3);
      expect(p, t.id).toContain(`Feeling: teary, shown through pose: ${EMOTION_POSE.teary}.`);
      expect(p, t.id).not.toContain("Emotion:");
      expect(p, t.id).not.toContain(EMOTION_FACE.teary);
    }
  });

  it("knitted keeps the doll cast, dolls wording and the grounded pose line", () => {
    const p = scenePrompt(STATIC_THEMES.knitted, DOLLS, { ...line, idea: "The mom doll rocks the baby doll." }, 2);
    expect(p).toContain(DOLLS.adult);
    expect(p).toContain("The mom doll rocks the baby doll");
    expect(p).toContain("Characters (the same two dolls in every picture)");
    expect(p).toContain(KNIT_POSE);
    expect(p).toMatch(/Composition: the handmade set fills/);
    expect(p).toContain("the dolls sharp");
    expect(KNIT_POSE).not.toMatch(/\blift/i);
  });

  it("other themes turn a doll cast into people (so a reel can switch theme)", () => {
    const p = scenePrompt(STATIC_THEMES.cinematic, DOLLS, { ...line, idea: "The mom doll rocks the baby doll; the dolls smile." }, 2);
    expect(p).not.toMatch(/\bdolls?\b|crochet|yarn|wool skin|knitted/i);
    expect(p).toContain("the mom: a mother with chunky dark-brown hair gathered in a low bun, warm tan skin, a mustard-yellow cable-knit cardigan over a cream dress");
    expect(p).toContain("The mom rocks the baby; the characters smile");
    expect(p).not.toContain(KNIT_POSE);
    expect(undoll("both dolls hug; the mom doll's lap")).toBe("both of them hug; the mom's lap");
  });

  it("every shot has its own lens line; the opening picture adds the hook treatment", () => {
    const lenses = REEL_SHOTS.map((shot) => scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, shot }, 3).match(/Lens: ([^\n]*)\./)![1]);
    expect(new Set(lenses).size).toBe(REEL_SHOTS.length);
    const hook = scenePrompt(STATIC_THEMES.anime, PEOPLE, { ...line, shot: "low-angle" }, 0);
    expect(hook).toMatch(/one striking, high-emotion moment/);
    expect(hook).toContain(`${SHOT_LENS["low-angle"]("characters")}, full of strong emotion.`);
    expect(scenePrompt(STATIC_THEMES.anime, PEOPLE, line, 1)).toMatch(/one tender moment/);
  });

  it("lines from before 007 (no emotion / action / shot) keep the old knitted prompt shape", () => {
    const p = scenePrompt(STATIC_THEMES.knitted, DOLLS, { idea: "The mom doll gasps.", beat: "hook" }, 0);
    expect(p).toContain("Lens: 50mm lens at f/2.8, a medium shot full of strong emotion, the dolls sharp.");
    expect(p).not.toMatch(/Emotion:|Feeling:|Body language:/);
    expect(scenePrompt(STATIC_THEMES.knitted, DOLLS, { idea: "x", beat: "close" }, 5)).toContain("a warm medium-wide view");
  });

  it("is positive-only (apart from NO_TEXT) and never says camera, for every theme, emotion and shot", () => {
    for (const id of REEL_THEME_IDS) {
      for (const emotion of REEL_EMOTIONS) {
        for (const shot of REEL_SHOTS) {
          const q = scenePrompt(STATIC_THEMES[id], DOLLS, { ...line, emotion, shot }, 0);
          expect(q).not.toMatch(/\bcamera\b/i);
          expect(q.replace(NO_TEXT, ""), `${id}/${emotion}/${shot}`).not.toMatch(NEGATIVE);
          expect(q.match(/No text/g)).toHaveLength(1);
        }
      }
    }
  });
});
