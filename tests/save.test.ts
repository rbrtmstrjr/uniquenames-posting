import { describe, expect, it } from "vitest";
import { orderedSelection, uploadNumbers } from "@/lib/files/save";
import type { CardRow } from "@/lib/db/types";

const c = (id: string, position: number, order_index: number, selected = true, status: CardRow["status"] = "done") =>
  ({ id, position, order_index, selected, status, name: id, card_path: `cards/${id}/v1.jpg` }) as CardRow;

describe("selection order", () => {
  it("orders selected cards by order_index then position and numbers them 1..n", () => {
    const cards = [c("a", 1, 3), c("b", 2, 1), c("c", 3, 2, false), c("d", 4, 2)];
    expect(orderedSelection(cards).map((x) => x.id)).toEqual(["b", "d", "a"]);
    expect([...uploadNumbers(cards)]).toEqual([["b", 1], ["d", 2], ["a", 3]]);
  });
});
