import { describe, expect, it } from "vitest";
import { US_LETTER_POOL_MIN, US_LIST, US_NOTE, keepUsNames, makeUsList, usCandidates, usGateOn, usKey, usLetterOk, type UsNamesData } from "@/lib/names/us-list";

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
  it("keys keep letters only: hyphens, apostrophes and spaces go", () => {
    expect(usKey("Anne-Marie")).toBe("annemarie");
    expect(usKey("D'Angelo")).toBe("dangelo");
    expect(usKey("Zoë-Rose ")).toBe("zoerose");
    const H = makeUsList({ years: [2025], girl: { annemarie: 900 }, boy: { dangelo: 700 } });
    expect(H.rank("Anne-Marie", "girl")).toBe(900);
    expect(H.rank("D'Angelo", "boy")).toBe(700);
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
  it("usPool counts a letter's names from 101 up to its range (the widened one for a short letter)", () => {
    expect(L.usPool("V", "girl")).toBe(32); // Vivienne, Vera and 30 more in 101..2000
    expect(L.usPool("v", "boy")).toBe(2); // Victor 500 and Vikram 4000 (boys' V widens to 5,000)
    expect(L.usPool("O", "girl")).toBe(0); // Olivia is top 100
    expect(US_LETTER_POOL_MIN).toBe(16);
  });
  it("usLetterOk: both genders need 16 names in range (real list: girls' U and Q are short, V is fine)", () => {
    expect(US_LIST.usPool("U", "girl")).toBeLessThan(16);
    expect(US_LIST.usPool("Q", "girl")).toBeLessThan(16);
    expect(usLetterOk("U")).toBe(false);
    expect(usLetterOk("Q")).toBe(false);
    expect(usLetterOk("V")).toBe(true);
    expect(usLetterOk("a")).toBe(true);
  });
  it("usLetterOk is always true when the gate is off (Name Nest)", () => {
    const saved = process.env.NICHE;
    process.env.NICHE = "name-nest";
    try {
      expect(usGateOn()).toBe(false);
      expect(usLetterOk("U")).toBe(true);
    } finally { if (saved === undefined) delete process.env.NICHE; else process.env.NICHE = saved; }
  });
  it("the real list has no SSA placeholders", () => {
    for (const k of ["unknown", "baby", "infant", "boy", "girl", "babyboy", "babygirl"]) {
      expect([k, US_LIST.rank(k, "girl"), US_LIST.rank(k, "boy")]).toEqual([k, null, null]);
    }
  });
  it("the real list has both genders and recent years", () => {
    expect(US_LIST.latestYear).toBeGreaterThanOrEqual(2023);
    expect(US_LIST.rank("Olivia", "girl")).toBeLessThanOrEqual(10);
    expect(US_LIST.rank("Liam", "boy")).toBeLessThanOrEqual(10);
    expect(US_NOTE).toBe("Not a US name");
  });
  describe("usCandidates (the names the AI picks from)", () => {
    const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    it("with a letter: names starting with it, ranked 101 up to the letter's range, display-cased", () => {
      const v = L.usCandidates("girl", { letter: "v", exclude: [], rng: seeded(1) });
      expect([...v].sort()).toEqual(["Vera", "Vivienne", ...Array.from({ length: 30 }, (_, k) => `Vx${k}`)].sort());
      // boys' V is short (1 name in 101..2,000), so it widens to 5,000 like isUsName: Victor and Vikram
      expect([...L.usCandidates("boy", { letter: "V", exclude: [] })].sort()).toEqual(["Victor", "Vikram"]);
      expect(L.usCandidates("girl", { letter: "O", exclude: [] })).toEqual([]); // Olivia is top 100
    });
    it("without a letter: every name ranked 101 to 2,000 (never the widened range)", () => {
      expect([...L.usCandidates("boy", { exclude: [] })].sort()).toEqual(["Victor"]); // James top 100, Vikram 4,000
      const all = L.usCandidates("girl", { exclude: [] });
      expect(all).toHaveLength(34); // Vivienne, Vera, Zoe, Rose + 30; not Olivia
      expect(all).toContain("Zoe");
      expect(all).not.toContain("Olivia");
    });
    it("leaves out the library's names (any case, any accents)", () => {
      const r = L.usCandidates("girl", { exclude: ["VIVIENNE", " Zoë ", "vera", "Nobody"] });
      expect(r).toHaveLength(31);
      for (const n of ["Vivienne", "Zoe", "Vera"]) expect(r).not.toContain(n);
      expect(L.usCandidates("girl", { letter: "Z", exclude: new Set(["zoe"]) })).toEqual([]);
    });
    it("a random sample of at most `limit` (150 with a letter, 300 without by default), from `rng`", () => {
      const five = L.usCandidates("girl", { letter: "V", exclude: [], limit: 5, rng: seeded(3) });
      expect(five).toHaveLength(5);
      expect(new Set(five).size).toBe(5);
      expect(L.usCandidates("girl", { letter: "V", exclude: [], limit: 5, rng: seeded(3) })).toEqual(five);
      expect(L.usCandidates("girl", { letter: "V", exclude: [], limit: 5, rng: seeded(4) })).not.toEqual(five);
      expect(usCandidates("girl", { letter: "A", exclude: [] })).toHaveLength(150);
      expect(usCandidates("boy", { exclude: [] })).toHaveLength(300);
      expect(usCandidates("girl", { letter: "Z", exclude: ["Zora"] })).toHaveLength(44); // 45 girls' Z names in 101..2,000
      for (const n of usCandidates("girl", { letter: "Z", exclude: [] })) {
        expect([n, US_LIST.isUsName(n, "girl", "Z"), n === n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()]).toEqual([n, true, true]);
      }
    });
  });
  it("keepUsNames drops names outside the range (Unique Names)", () => {
    const r = keepUsNames([{ name: "Olivia" }, { name: "Vivienne" }, { name: "Vikram" }], "girl", { style: "single" });
    expect(r.kept.map((n) => n.name)).toEqual(["Vivienne"]);
    expect(r.dropped).toBe(2);
  });
});
