// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CardRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

const ideas = [
  { name: "Rowan Pike", meaning: "little red-haired one" },
  { name: "Bram Ellery", meaning: "raven of the island" },
];
const cardNameIdeasAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, ideas }));
vi.mock("@/lib/actions/suggest", () => ({ cardNameIdeasAction }));
const regenerateCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/lib/actions/cards", () => ({ regenerateCardAction, restampCardAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { CardDialog } = await import("@/components/cards/card-dialog");

beforeAll(polyfillRadix);
beforeEach(() => { cardNameIdeasAction.mockClear(); regenerateCardAction.mockClear(); });
afterEach(cleanup);

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: "c1", post_id: "p1", theme_id: "t1", kind: "post", position: 3, name_id: "n1", name: "Hugo Rowe", meaning: "bright mind, gentle soul",
  shot: "s", prompt: "the prompt", seed: 1, status: "done", error: null, photo_path: "photos/c1/v1.jpg", card_path: "cards/c1/v1.jpg", version: 1,
  selected: true, order_index: 3, queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "", updated_at: "", ...over,
});
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("CardDialog: Suggest names", () => {
  it("asks for ideas, and a picked idea fills Name + Meaning so New picture uses it", async () => {
    render(<CardDialog card={card()} health="ready" onClose={() => {}} onDelete={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Suggest names/ })); });
    expect(cardNameIdeasAction).toHaveBeenCalledWith("c1");
    const list = screen.getByRole("list", { name: "Name ideas" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Rowan Pikelittle red-haired one", "Bram Elleryraven of the island"]);
    fireEvent.click(within(list).getByRole("button", { name: /Bram Ellery/ }));
    expect(field("Name").value).toBe("Bram Ellery");
    expect(field("Meaning").value).toBe("raven of the island");
    expect(within(list).getByRole("button", { name: /Bram Ellery/ }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /New picture with this text/ })); });
    expect(regenerateCardAction).toHaveBeenCalledWith("c1", { name: "Bram Ellery", meaning: "raven of the island" });
  });

  it("shows the error when Gemini has nothing new", async () => {
    cardNameIdeasAction.mockResolvedValueOnce({ ok: false, error: "Every idea Gemini had is already one of your names. Try again." } as never);
    render(<CardDialog card={card()} health="ready" onClose={() => {}} onDelete={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Suggest names/ })); });
    expect(screen.getByRole("alert").textContent).toMatch(/already one of your names/);
  });

  it("is not offered on a theme preview card (no post)", () => {
    render(<CardDialog card={card({ post_id: null, kind: "preview" })} health="ready" onClose={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole("button", { name: /Suggest names/ })).toBeNull();
  });
});
