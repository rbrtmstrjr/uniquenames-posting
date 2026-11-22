import { describe, expect, it } from "vitest";
import { cardOrder, kindRank, orderedSelection, uploadNumbers } from "@/lib/files/save";

type Kind = "post" | "cta" | "cover";
const c = (id: string, order_index: number, kind: Kind = "post", selected = true, position = order_index) => ({ id, order_index, position, kind, selected });

describe("the front card is always first, the closing card always last", () => {
  it("cardOrder: the front card, the name cards in the owner's order, then the closing card", () => {
    const cards = [c("cta", 1, "cta"), c("b", 3), c("cover", 9, "cover"), c("a", 2)];
    expect([...cards].sort(cardOrder).map((x) => x.id)).toEqual(["cover", "a", "b", "cta"]);
    expect([kindRank({ kind: "cover" }), kindRank({ kind: "post" }), kindRank({}), kindRank({ kind: "cta" })]).toEqual([0, 1, 1, 2]);
  });

  it("save / zip order and the upload numbers start at the front card; unselected, the next card moves up", () => {
    const cards = [c("a", 1), c("cover", 0, "cover"), c("b", 2), c("cta", 3, "cta")];
    expect(orderedSelection(cards).map((x) => x.id)).toEqual(["cover", "a", "b", "cta"]);
    expect(uploadNumbers(cards).get("cover")).toBe(1);
    expect(uploadNumbers(cards).get("a")).toBe(2);
    const off = cards.map((x) => (x.id === "cover" ? { ...x, selected: false } : x));
    expect(uploadNumbers(off).has("cover")).toBe(false);
    expect(uploadNumbers(off).get("a")).toBe(1);
  });
});
