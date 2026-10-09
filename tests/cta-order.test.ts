import { describe, expect, it } from "vitest";
import { cardOrder, orderedSelection, uploadNumbers } from "@/lib/files/save";

const c = (id: string, order_index: number, position = order_index, kind: "post" | "cta" = "post", selected = true) => ({ id, order_index, position, kind, selected });

describe("the closing card is always last", () => {
  it("sorts after every name card, whatever its order_index / position", () => {
    const cards = [c("cta", 1, 1, "cta"), c("b", 3), c("a", 2), c("late", 13, 14)];
    expect([...cards].sort(cardOrder).map((x) => x.id)).toEqual(["a", "b", "late", "cta"]);
  });

  it("save / zip order and the upload numbers put it last; it can still be unselected", () => {
    const cards = [c("cta", 0, 12, "cta"), c("a", 1), c("b", 2), c("n", 13, 13)];
    expect(orderedSelection(cards).map((x) => x.id)).toEqual(["a", "b", "n", "cta"]);
    expect(uploadNumbers(cards).get("cta")).toBe(4);
    const off = cards.map((x) => (x.id === "cta" ? { ...x, selected: false } : x));
    expect(orderedSelection(off).map((x) => x.id)).toEqual(["a", "b", "n"]);
  });

  it("rows without a kind (older callers) sort as before", () => {
    expect(orderedSelection([{ id: "x", order_index: 2, position: 2, selected: true }, { id: "y", order_index: 1, position: 1, selected: true }]).map((x) => x.id)).toEqual(["y", "x"]);
  });
});
