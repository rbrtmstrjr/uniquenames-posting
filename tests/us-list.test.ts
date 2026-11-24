import { describe, expect, it } from "vitest";
import { US_LIST, US_NOTE, keepUsNames, makeUsList, usKey, type UsNamesData } from "@/lib/names/us-list";

// Ranks: Vivienne 150, Vera 900, Olivia 1 (top 100), Vikram 4000 (only allowed if the letter is short), Zoe 300.
const ranks = (from: number, n: number, letter: string) =>
  Object.fromEntries(Array.from({ length: n }, (_, k) => [`${letter}x${k}`, from + k]));
const data: UsNamesData = {
  years: [2022, 2023, 2024],
  girl: { vivienne: 150, vera: 900, olivia: 1, zoe: 300, rose: 120, ...ranks(200, 30, "v") },
  boy: { vikram: 4000, victor: 500, james: 5 },
};
const L = makeUsList(data);

describe("the US list", () => {
  it("keys ignore case and accents", () => {
    expect(usKey(" Zoë ")).toBe("zoe");
    expect(L.rank("ZOË", "girl")).toBe(300);
  });
  it("101 to 2,000 for a letter with enough names", () => {
    expect(L.isUsName("Vivienne", "girl")).toBe(true);
    expect(L.isUsName("Olivia", "girl")).toBe(false); // top 100
    expect(L.isUsName("Nobody", "girl")).toBe(false); // not on the list
  });
  it("a letter with fewer than 25 names in range widens to 5,000", () => {
    expect(L.maxRankFor("V", "boy")).toBe(5000); // only Victor (500) in 101..2000 for boys' V
    expect(L.isUsName("Vikram", "boy")).toBe(true);
    expect(L.maxRankFor("v", "girl")).toBe(2000); // 30+ girls' V names in range
  });
  it("two-word: both words top 5,000, first not top 100", () => {
    expect(L.isUsTwoWord("Vivienne Rose", "girl")).toBe(true);
    expect(L.isUsTwoWord("Olivia Rose", "girl")).toBe(false);
    expect(L.isUsTwoWord("Vivienne Nobody", "girl")).toBe(false);
    expect(L.isUsTwoWord("Vivienne", "girl")).toBe(false);
  });
  it("the real list has both genders and recent years", () => {
    expect(US_LIST.latestYear).toBeGreaterThanOrEqual(2023);
    expect(US_LIST.rank("Olivia", "girl")).toBeLessThanOrEqual(10);
    expect(US_LIST.rank("Liam", "boy")).toBeLessThanOrEqual(10);
    expect(US_NOTE).toBe("Not a US name");
  });
  it("keepUsNames drops names outside the range (Unique Names)", () => {
    const r = keepUsNames([{ name: "Olivia" }, { name: "Vivienne" }, { name: "Vikram" }], "girl", { style: "single" });
    expect(r.kept.map((n) => n.name)).toEqual(["Vivienne"]);
    expect(r.dropped).toBe(2);
  });
});
