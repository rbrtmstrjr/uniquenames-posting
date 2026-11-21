import { describe, expect, it } from "vitest";
import { UNIQUE_NAMES_CAPTIONS } from "@/packs/unique-names/captions";
import { CAPTION_STYLES } from "@/lib/captions/styles";
import { hasBait } from "@/lib/ai/caption-core";
import { plainWordsProblem } from "@/lib/ai/plain-words";
import { shapeProblem, themeLeadProblem } from "@/lib/ai/caption";

const sys = UNIQUE_NAMES_CAPTIONS.postSystem(240);
const guide = (s: (typeof CAPTION_STYLES)[number], g: "boy" | "girl" = "girl") => UNIQUE_NAMES_CAPTIONS.styleGuide[s](g);

describe("Unique Names captions: mom-to-mom, theme first", () => {
  it("turns on title-only prompts and the theme-first check", () => {
    expect(UNIQUE_NAMES_CAPTIONS.titleOnly).toBe(true);
    expect(UNIQUE_NAMES_CAPTIONS.themeFirst).toBe(true);
  });
  it("the system prompt: mom-to-mom voice, theme early, never the set, English only, examples for tone only", () => {
    expect(sys).toMatch(/one mom talks to another/);
    expect(sys).toMatch(/Never describe the photos/);
    expect(sys).toMatch(/never a Filipino or Tagalog word or Taglish/);
    expect(sys).toMatch(/for tone only: never copy/);
    expect(sys).not.toMatch(/talk about the set/);
    expect(sys).toMatch(/at most 220 characters/);
    expect(sys).toMatch(/their names are only examples/);
    expect(sys).toMatch(/no I, me, my, we or us/);
    expect(sys).toMatch(/never lean on a stock line/);
    expect(sys).not.toMatch(/meaning worth keeping\./);
  });
  it("every tone example passes the engine's own checks for the post it stands for", () => {
    const lines = sys.split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith("Examples of the tone"));
    const examples: string[] = [];
    for (const l of lines.slice(at + 1)) { if (!l.startsWith("- ")) break; examples.push(l.slice(2)); }
    expect(examples).toHaveLength(6);
    const inputs = [
      { gender: "girl" as const, letter: "R" },
      { gender: "boy" as const, nameTheme: { title: "Biblical", hint: null } },
      { gender: "girl" as const, letter: "R" },
      { gender: "boy" as const, nameTheme: { title: "Biblical", hint: null } },
      { gender: "girl" as const, nameTheme: { title: "Soft and cool", hint: null } },
      { gender: "boy" as const, letter: "K" },
    ];
    examples.forEach((e, i) => {
      expect(themeLeadProblem(e, inputs[i]), e).toBeNull();
      expect(shapeProblem(e), e).toBeNull();
      expect(plainWordsProblem(e), e).toBeNull();
      expect(hasBait(e), e).toBe(false);
      expect((e.match(/\p{Extended_Pictographic}/gu) ?? []).length, e).toBeLessThanOrEqual(1);
    });
  });
  it("six angles: no-name angles never name names; name angles do", () => {
    for (const s of ["question", "story", "compliment"] as const) expect(guide(s)).toMatch(/Do not name any names/);
    for (const s of ["spotlight", "fact", "choice"] as const) expect(guide(s)).toMatch(/names? from the list/);
    expect(guide("question")).toMatch(/^Feeling question\./);
    expect(guide("story")).toMatch(/^Mom's moment\./);
    expect(guide("compliment")).toMatch(/^Encouragement\./);
    expect(guide("spotlight")).toMatch(/^Meaning hook\./);
    expect(guide("fact")).toMatch(/^Name teaser\./);
    expect(guide("choice", "boy")).toMatch(/^A or B\..*your son/);
    for (const s of CAPTION_STYLES) expect(guide(s)).not.toMatch(/prop|outfit|light|photoshoot/i);
  });
});
