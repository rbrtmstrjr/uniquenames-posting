import { describe, expect, it } from "vitest";
import { UNIQUE_NAMES_CAPTIONS } from "@/packs/unique-names/captions";
import { CAPTION_STYLES } from "@/lib/captions/styles";

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
