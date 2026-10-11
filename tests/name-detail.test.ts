import { describe, expect, it } from "vitest";
import { nameDetail } from "@/lib/names/detail";

// Names page (Name Nest, migration 015): the US rank and origin under the meaning, so the owner can check them before approving.
describe("nameDetail", () => {
  it("rank with year, origin, either alone, or nothing (Unique Names)", () => {
    expect(nameDetail({ us_rank: 38, us_year: 2025, origin: "Greek" })).toBe("#38 in the US (2025) · Greek");
    expect(nameDetail({ us_rank: 3, us_year: null, origin: null })).toBe("#3 in the US");
    expect(nameDetail({ origin: " Old English " })).toBe("Old English");
    expect(nameDetail({})).toBeNull();
    expect(nameDetail({ us_rank: 0, origin: "" })).toBeNull();
  });
});
