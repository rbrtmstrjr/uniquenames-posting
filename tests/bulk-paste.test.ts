import { describe, expect, it } from "vitest";
import { parseBulkNames } from "@/lib/names/bulk-paste";

describe("parseBulkNames", () => {
  it("parses common separators and infers style", () => {
    const r = parseBulkNames("Arlo Zenith - Peak strength with calm\nLuna – the moon\nIsla Grace: calm waters\nNova | new star", { gender: "girl" });
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { name: "Arlo Zenith", meaning: "peak strength with calm", gender: "girl", style: "two-word" },
      { name: "Luna", meaning: "the moon", gender: "girl", style: "single" },
      { name: "Isla Grace", meaning: "calm waters", gender: "girl", style: "two-word" },
      { name: "Nova", meaning: "new star", gender: "girl", style: "single" },
    ]);
  });
  it("skips blank lines and reports problems with line numbers", () => {
    const r = parseBulkNames("\nArlo2 - x\nNoMeaning\nLuna - the moon\nluna - again\n" + "A".repeat(41) + " - long", { gender: "boy" });
    expect(r.rows.map((x) => x.name)).toEqual(["Luna"]);
    expect(r.issues.map((i) => [i.line, i.reason])).toEqual([
      [2, "Name can only have letters, spaces, hyphens and apostrophes."],
      [3, "Missing meaning. Use: Name - meaning"],
      [5, "Duplicate of another line in this paste."],
      [6, "Name is longer than 40 characters."],
    ]);
  });
});
