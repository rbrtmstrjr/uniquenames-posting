import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { latestYear, parseYear, pickTop } from "@/scripts/lib/ssa";
import { acceptMeanings, meaningProblem, meaningsPrompt, originProblem } from "@/scripts/lib/meanings";

const year = (rows: [string, "F" | "M", number][]) => rows.map((r) => r.join(",")).join("\r\n") + "\r\n";

describe("SSA national data (scripts/import-ssa.ts)", () => {
  it("reads the latest yobYYYY.txt in the zip", async () => {
    const zip = new JSZip();
    zip.file("yob2023.txt", year([["Ava", "F", 9]]));
    zip.file("yob2024.txt", year([["Olivia", "F", 10], ["Liam", "M", 12]]));
    zip.file("NationalReadMe.pdf", "x");
    const got = await latestYear(await zip.generateAsync({ type: "uint8array" }));
    expect(got.year).toBe(2024);
    expect(got.text).toContain("Olivia,F,10");
    await expect(latestYear(await new JSZip().generateAsync({ type: "uint8array" }))).rejects.toThrow(/no yobYYYY/);
  });

  it("ranks per sex in file order and skips junk lines", () => {
    const r = parseYear(year([["Olivia", "F", 100], ["Emma", "F", 90], ["Liam", "M", 120], ["Noah", "M", 110]]) + "bad line\n");
    expect(r.girl.map((x) => [x.name, x.rank])).toEqual([["Olivia", 1], ["Emma", 2]]);
    expect(r.boy.map((x) => [x.name, x.rank])).toEqual([["Liam", 1], ["Noah", 2]]);
  });

  it("top N per gender, each name once (the gender that gave it more), topped up, with SSA ranks", () => {
    const rows = parseYear(year([
      ["Olivia", "F", 100], ["Avery", "F", 90], ["Emma", "F", 80], ["Mia", "F", 70],
      ["Liam", "M", 120], ["Avery", "M", 50], ["Noah", "M", 40], ["Leo", "M", 30],
    ]));
    const top = pickTop(rows, 2024, 3);
    expect(top.filter((n) => n.gender === "girl").map((n) => [n.name, n.us_rank])).toEqual([["Olivia", 1], ["Avery", 2], ["Emma", 3]]);
    expect(top.filter((n) => n.gender === "boy").map((n) => [n.name, n.us_rank])).toEqual([["Liam", 1], ["Noah", 3], ["Leo", 4]]);
    expect(top.every((n) => n.style === "single" && n.us_year === 2024)).toBe(true);
  });
});

describe("meanings + origins (scripts/name-meanings.ts)", () => {
  it("meaning: 2-6 plain lowercase words, one meaning", () => {
    expect(meaningProblem("olive tree")).toBeNull();
    expect(meaningProblem("gift of god")).toBeNull();
    for (const bad of ["", "peace", "Olive tree", "olive tree.", "light or bright", "a b c d e f g", "olive, tree", "x".repeat(81)]) {
      expect([bad, meaningProblem(bad)]).not.toEqual([bad, null]);
    }
  });

  it("origin: 1-3 capitalized words", () => {
    expect(originProblem("Old English")).toBeNull();
    expect(originProblem("Latin")).toBeNull();
    for (const bad of ["", "latin", "Latin, Greek", "A B C D"]) expect([bad, originProblem(bad)]).not.toEqual([bad, null]);
  });

  it("keeps only valid answers for the names asked", () => {
    const asked = [{ name: "Olivia", gender: "girl" as const }, { name: "Liam", gender: "boy" as const }, { name: "Nova", gender: "girl" as const }];
    expect(meaningsPrompt(asked)).toContain("- Liam (boy)");
    const { ok, rejected } = acceptMeanings({ names: [
      { name: "olivia", meaning: "olive tree.", origin: "Latin" },
      { name: "Liam", meaning: "Strong-willed warrior", origin: "Irish" },
      { name: "Zed", meaning: "the last one", origin: "English" },
      { name: "Nova", meaning: "", origin: "Latin" },
    ] }, asked);
    expect(ok).toEqual({ Olivia: { meaning: "olive tree", origin: "Latin" } });
    expect(rejected.map((r) => r.name)).toEqual(["Liam", "Nova"]);
    expect(acceptMeanings(null, asked).ok).toEqual({});
  });
});
