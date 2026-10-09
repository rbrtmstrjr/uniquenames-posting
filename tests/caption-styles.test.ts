import { describe, expect, it } from "vitest";
import { CAPTION_STYLES, pickStyle, usableStyles } from "@/lib/captions/styles";

const names = [
  { name: "Aurelia", meaning: "golden, from Latin" },
  { name: "Wren", meaning: "small songbird" },
];
const first = () => 0; // always the first of the tied styles

describe("usableStyles", () => {
  it("all six with two names whose meanings support a fact", () => {
    expect(usableStyles(names)).toEqual([...CAPTION_STYLES]);
  });
  it("no names → no spotlight / A-or-B / fact", () => {
    expect(usableStyles([])).toEqual(["story", "question", "compliment"]);
  });
  it("one name → no A-or-B choice", () => {
    expect(usableStyles([names[0]])).not.toContain("choice");
  });
  it("fun fact only when a meaning carries something to say (an origin or a few words)", () => {
    expect(usableStyles([{ name: "Lia", meaning: "light" }, { name: "Mae", meaning: "pearl" }])).not.toContain("fact");
    expect(usableStyles([{ name: "Lia", meaning: "light" }, { name: "Kai", meaning: "sea, Hawaiian" }])).toContain("fact");
  });
});

describe("pickStyle", () => {
  it("never the same style as the previous post", () => {
    for (const prev of CAPTION_STYLES) expect(pickStyle([prev], names, first)).not.toBe(prev);
  });
  it("prefers a style not used recently (least recently used)", () => {
    const recent = ["story", "spotlight", "question", "choice", "fact"];
    expect(pickStyle(recent, names, first)).toBe("compliment");
    expect(pickStyle(["compliment", "story", "spotlight", "question", "choice", "fact"], names, first)).toBe("fact");
  });
  it("random tie-break among the unused ones", () => {
    expect(pickStyle([], names, () => 0)).toBe("story");
    expect(pickStyle([], names, () => 0.99)).toBe("compliment");
  });
  it("extra avoid list (a rewrite never repeats the post's own style)", () => {
    expect(pickStyle([], names, first, ["story"])).toBe("spotlight");
  });
  it("ignores unknown / template entries in the history", () => {
    expect(pickStyle(["template", null], names, first)).toBe("story");
  });
  it("six posts in a row rotate through every style", () => {
    const recent: string[] = [];
    for (let i = 0; i < 6; i++) recent.unshift(pickStyle(recent, names, first));
    expect(new Set(recent).size).toBe(6);
  });
});
