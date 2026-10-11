// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CardRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

type Row = { id: string; name: string; meaning: string; detail: string | null; usedBefore?: boolean };
const mine: Row[] = [
  { id: "n-cyrus", name: "Cyrus", meaning: "sun", detail: null },
  { id: "n-olivia", name: "Olivia", meaning: "olive tree", detail: "#1 in the US (2024) · Latin" },
];
type ListResult = { ok: true; names: Row[]; next: number | null } | { ok: false; error: string };
const listSwapNamesAction = vi.fn(async (..._a: unknown[]): Promise<ListResult> => ({ ok: true, names: mine, next: null }));
const swapCardNameAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
vi.mock("@/lib/actions/swap-name", () => ({ listSwapNamesAction, swapCardNameAction }));
const cardNameIdeasAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, ideas: [{ name: "Rowan Pike", meaning: "little red-haired one" }] }));
vi.mock("@/lib/actions/suggest", () => ({ cardNameIdeasAction }));
const regenerateCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const restampCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
vi.mock("@/lib/actions/cards", () => ({ regenerateCardAction, restampCardAction }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));
const { CardDialog } = await import("@/components/cards/card-dialog");

beforeAll(polyfillRadix);
beforeEach(() => {
  for (const f of [listSwapNamesAction, swapCardNameAction, cardNameIdeasAction, regenerateCardAction, restampCardAction, toast.error]) f.mockClear();
  listSwapNamesAction.mockImplementation(async () => ({ ok: true, names: mine, next: null }));
});
afterEach(cleanup);

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: "c1", post_id: "p1", theme_id: "t1", kind: "post", position: 3, name_id: "n1", name: "Hugo", meaning: "bright mind",
  shot: "s", prompt: "the prompt", seed: 1, status: "done", error: null, photo_path: "photos/c1/v1.jpg", card_path: "cards/c1/v1.jpg", version: 1,
  selected: true, order_index: 3, queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "", updated_at: "", ...over,
});
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const tab = (name: string) => screen.getByRole("tab", { name });
const myList = () => screen.getByRole("list", { name: "Your names" });
async function open(c = card()) {
  await act(async () => { render(<CardDialog card={c} health="ready" onClose={() => {}} onDelete={() => {}} />); });
}
const pause = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe("CardDialog: My names | AI ideas", () => {
  it("opens on My names when names fit: an accessible tab switch, rows with meaning and the Name Nest line", async () => {
    await open();
    expect(screen.getByRole("tablist", { name: "Pick a different name" })).toBeTruthy();
    expect(tab("My names").getAttribute("aria-selected")).toBe("true");
    expect(tab("AI ideas").getAttribute("aria-selected")).toBe("false");
    expect(listSwapNamesAction).toHaveBeenCalledWith("c1", {});
    expect(within(myList()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Cyrussun", "Oliviaolive tree#1 in the US (2024) · Latin"]);
    expect(screen.queryByRole("button", { name: /Suggest names/ })).toBeNull();
  });

  it("switches tabs by tap and by arrow keys; the AI ideas work as before", async () => {
    await open();
    fireEvent.click(tab("AI ideas"));
    expect(tab("AI ideas").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("list", { name: "Your names" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Suggest names/ })); });
    fireEvent.click(within(screen.getByRole("list", { name: "Name ideas" })).getByRole("button", { name: /Rowan Pike/ }));
    expect(field("Name").value).toBe("Rowan Pike");
    fireEvent.keyDown(tab("AI ideas"), { key: "ArrowRight" });
    expect(tab("My names").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("My names"));
    // An AI idea saves through today's path (renames the card's own name row).
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save text/ })); });
    expect(restampCardAction).toHaveBeenCalledWith("c1", "Rowan Pike", "little red-haired one");
    expect(swapCardNameAction).not.toHaveBeenCalled();
  });

  it("no name fits: opens on AI ideas, and My names links to the Names page", async () => {
    listSwapNamesAction.mockImplementation(async () => ({ ok: true, names: [], next: null }));
    await open();
    expect(tab("AI ideas").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tab("My names"));
    expect(screen.getByText(/No unused names fit this card/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Names page/ }).getAttribute("href")).toBe("/names");
  });

  it("tapping a name fills Name + Meaning; Save text swaps it in (not a rename)", async () => {
    await open();
    fireEvent.click(within(myList()).getByRole("button", { name: /Cyrus/ }));
    expect(field("Name").value).toBe("Cyrus");
    expect(field("Meaning").value).toBe("sun");
    expect(within(myList()).getByRole("button", { name: /Cyrus/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(field("Meaning"), { target: { value: "the sun" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save text/ })); });
    expect(swapCardNameAction).toHaveBeenCalledWith("c1", "n-cyrus", "the sun");
    expect(restampCardAction).not.toHaveBeenCalled();
    expect(listSwapNamesAction).toHaveBeenCalledTimes(2);
  });

  it("New picture after picking regenerates with that name", async () => {
    await open();
    fireEvent.click(within(myList()).getByRole("button", { name: /Olivia/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /New picture with this text/ })); });
    expect(swapCardNameAction).toHaveBeenCalledWith("c1", "n-olivia", "olive tree", { newPicture: true });
    expect(regenerateCardAction).not.toHaveBeenCalled();
  });

  it("typing over a picked name goes back to today's typed-name path", async () => {
    await open();
    fireEvent.click(within(myList()).getByRole("button", { name: /Cyrus/ }));
    fireEvent.change(field("Name"), { target: { value: "Cyrano" } });
    expect(within(myList()).getByRole("button", { name: /Cyrus/ }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save text/ })); });
    expect(restampCardAction).toHaveBeenCalledWith("c1", "Cyrano", "sun");
    expect(swapCardNameAction).not.toHaveBeenCalled();
  });

  it("the name was just used: a friendly error and the list reloads", async () => {
    swapCardNameAction.mockResolvedValueOnce({ ok: false, error: "That name was just used — pick another." } as never);
    await open();
    fireEvent.click(within(myList()).getByRole("button", { name: /Cyrus/ }));
    listSwapNamesAction.mockImplementation(async () => ({ ok: true, names: [mine[1]], next: null }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save text/ })); });
    expect(toast.error).toHaveBeenCalledWith("That name was just used — pick another.");
    expect(within(myList()).queryByRole("button", { name: /Cyrus/ })).toBeNull();
  });

  it("search waits for a pause in typing, then asks the server", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Search your names"), { target: { value: "ol" } });
    fireEvent.change(screen.getByLabelText("Search your names"), { target: { value: "oli" } });
    expect(listSwapNamesAction).toHaveBeenCalledTimes(1);
    await pause(400);
    expect(listSwapNamesAction).toHaveBeenCalledTimes(2);
    expect(listSwapNamesAction).toHaveBeenLastCalledWith("c1", { q: "oli" });
  });

  it("Show more loads the next 20 after the cursor", async () => {
    listSwapNamesAction.mockImplementationOnce(async () => ({ ok: true, names: [mine[0]], next: 20 }));
    listSwapNamesAction.mockImplementationOnce(async () => ({ ok: true, names: [mine[1]], next: null }));
    await open();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show more" })); });
    expect(listSwapNamesAction).toHaveBeenLastCalledWith("c1", { cursor: 20 });
    expect(within(myList()).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});

describe("My names on a post by initials", () => {
  it("names used before come after the unused ones, labelled", async () => {
    listSwapNamesAction.mockImplementation(async () => ({ ok: true, names: [
      { id: "n-arlo", name: "Arlo Reed", meaning: "eagle and red", detail: null },
      { id: "n-amos", name: "Amos Rhett", meaning: "carried by god", detail: null, usedBefore: true },
    ], next: null }));
    await open(card({ name: "Asher Rowan", name_id: null }));
    expect(within(myList()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Arlo Reedeagle and red", "Amos Rhettcarried by godused before"]);
  });
});
