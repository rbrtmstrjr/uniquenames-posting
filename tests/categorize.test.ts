import { beforeEach, describe, expect, it, vi } from "vitest";

// Sorting names into the PDF's meaning groups: the AI is mocked at the Gemini boundary (AI_PROVIDER unset).
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { CATEGORY_SYSTEM, categorizeNames, categoryPrompt, parseCategories } = await import("@/lib/ai/categorize");

const item = (i: number) => ({ id: `id${i}`, name: `Name${i}`, meaning: `meaning ${i}` });
/** Answer each call through its own parse(), like the real client does. */
const answer = (fn: (prompt: string) => unknown) =>
  generateJson.mockImplementation(async (input: { prompt: string; parse: (raw: unknown) => unknown }) => {
    const data = input.parse(fn(input.prompt));
    return data ? { ok: true, data } : { ok: false, error: "bad shape" };
  });
const count = (prompt: string) => Number(prompt.match(/^Sort these (\d+) names:/)![1]);

beforeEach(() => { generateJson.mockReset(); delete process.env.AI_PROVIDER; });

describe("categorize", () => {
  it("the system prompt lists the twelve groups and their meaning", () => {
    expect(CATEGORY_SYSTEM).toContain("- nature: flowers, plants");
    expect(CATEGORY_SYSTEM).toContain('Use "more" only when no other group fits');
    expect(categoryPrompt([{ name: " Wren  ", meaning: "little\nbird" }])).toBe("Sort these 1 names:\n1. Wren: little bird");
  });

  it("parseCategories keeps valid numbers and groups only, once each", () => {
    expect(parseCategories({ items: [{ n: 1, group: "nature" }, { n: 1, group: "light" }, { n: 3, group: "water" }, { n: 2, group: "Nature" }, { n: 9, group: "love" }, { n: 2.5, group: "love" }] }, 3))
      .toEqual([{ n: 1, group: "nature" }, { n: 3, group: "water" }]);
    expect(parseCategories({}, 3)).toBeNull();
    expect(parseCategories(null, 3)).toBeNull();
  });

  it("batches of 100 names, three at a time; uses the small task with a low temperature", async () => {
    answer((p) => ({ items: Array.from({ length: count(p) }, (_, i) => ({ n: i + 1, group: "love" })) }));
    const r = await categorizeNames(Array.from({ length: 250 }, (_, i) => item(i)));
    expect(r.error).toBeNull();
    expect(r.groups.size).toBe(250);
    expect(generateJson).toHaveBeenCalledTimes(3);
    expect(generateJson.mock.calls.map((c) => count(c[0].prompt))).toEqual([100, 100, 50]);
    expect(generateJson.mock.calls[0][0]).toMatchObject({ temperature: 0.2, schema: { type: "OBJECT" } });
    expect(generateJson.mock.calls[2][0].prompt).toContain("1. Name200: meaning 200");
  });

  it("a name the AI skips is asked once more, then goes to the fallback group", async () => {
    let call = 0;
    answer((p) => {
      call++;
      if (call === 1) return { items: [{ n: 1, group: "nature" }, { n: 3, group: "bogus" }] }; // 2 skipped, 3 invalid
      expect(count(p)).toBe(2);
      return { items: [{ n: 1, group: "water" }] }; // still skips the second one
    });
    const r = await categorizeNames([item(1), item(2), item(3)]);
    expect([...r.groups]).toEqual([["id1", "nature"], ["id2", "water"], ["id3", "more"]]);
  });

  it("a failed call comes back as an error with the groups found so far", async () => {
    let call = 0;
    generateJson.mockImplementation(async (input: { prompt: string; parse: (raw: unknown) => unknown }) => {
      call++;
      if (call === 2) return { ok: false, error: "Gemini error 503" };
      return { ok: true, data: input.parse({ items: Array.from({ length: count(input.prompt) }, (_, i) => ({ n: i + 1, group: "peace" })) }) };
    });
    const r = await categorizeNames(Array.from({ length: 400 }, (_, i) => item(i)));
    expect(r.error).toBe("Gemini error 503");
    expect(r.groups.size).toBe(200); // batches 1 and 3 of the first round; the 4th is not asked
  });
});
