import { describe, expect, it } from "vitest";
import { dealProps, seededRandom, splitProps, theProp } from "@/lib/planner";

describe("splitProps", () => {
  it("splits a theme's props line into single props without articles", () => {
    expect(splitProps("wooden toy train on a short track, small vintage suitcase, round station clock"))
      .toEqual(["wooden toy train on a short track", "small vintage suitcase", "round station clock"]);
    expect(splitProps("seashells, small starfish, and a little pile of white sand."))
      .toEqual(["seashells", "small starfish", "little pile of white sand"]);
    expect(splitProps("  the honey jar ;  plush bee toy ,, ")).toEqual(["honey jar", "plush bee toy"]);
  });
  it("keeps an 'and' inside one prop (a single object)", () => {
    expect(splitProps("black and white striped ball, felt bunny")).toEqual(["black and white striped ball", "felt bunny"]);
  });
  it("is empty for an empty line", () => {
    expect(splitProps("")).toEqual([]);
  });
  it("theProp reads right for singular and plural props", () => {
    expect(theProp("small vintage suitcase")).toBe("the small vintage suitcase");
    expect(theProp("cupcakes on a plate")).toBe("the cupcakes on a plate");
  });
});

describe("dealProps", () => {
  const props = ["train", "suitcase", "clock"];
  it("gives every prop its frames before one repeats, deterministically", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const d = dealProps(props, 7, seededRandom(seed));
      expect(d).toEqual(dealProps(props, 7, seededRandom(seed)));
      expect(new Set(d.slice(0, 3))).toEqual(new Set(props));
      expect(new Set(d.slice(3, 6))).toEqual(new Set(props));
      d.forEach((p, i) => { if (i > 0) expect(p).not.toBe(d[i - 1]); });
    }
  });
  it("works with one prop or none", () => {
    expect(dealProps(["basket"], 3, seededRandom(1))).toEqual(["basket", "basket", "basket"]);
    expect(dealProps([], 2, seededRandom(1))).toEqual(["", ""]);
  });
});
