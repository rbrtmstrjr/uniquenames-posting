import { describe, expect, it } from "vitest";
import { batchLabel, nextBatchIndex, orderedSelection, shareBatches, uploadNumbers } from "@/lib/files/save";
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

describe("share batches", () => {
  const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it("splits into batches of at most 10, in order", () => {
    expect(shareBatches(nums(13), 10)).toEqual([nums(10), [11, 12, 13]]);
    expect(shareBatches(nums(10), 10)).toEqual([nums(10)]);
    expect(shareBatches(nums(9), 10)).toEqual([nums(9)]);
    expect(shareBatches([], 10)).toEqual([]);
  });
  it("picks the next batch after each successful share and wraps around", () => {
    expect(nextBatchIndex(2, 0)).toBe(0);
    expect(nextBatchIndex(2, 1)).toBe(1);
    expect(nextBatchIndex(2, 2)).toBe(0);
    expect(nextBatchIndex(0, 0)).toBe(0);
  });
  it("labels the button with the upload numbers in the batch", () => {
    expect(batchLabel(13, 10, 0)).toBe("Save 1–10 to phone");
    expect(batchLabel(13, 10, 1)).toBe("Save 11–13 to phone");
    expect(batchLabel(11, 10, 1)).toBe("Save 11 to phone");
    expect(batchLabel(7, 10, 0)).toBe("Save 7 to phone");
    expect(batchLabel(1, 10, 0)).toBe("Save 1 to phone");
  });
});
