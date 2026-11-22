// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CardRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

const regenerateCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const restampCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
const ctaTextAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
vi.mock("@/lib/actions/cards", () => ({ regenerateCardAction, restampCardAction, ctaTextAction }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { CardDialog } = await import("@/components/cards/card-dialog");
const { CardTile } = await import("@/components/cards/card-tile");

beforeAll(polyfillRadix);
beforeEach(() => { regenerateCardAction.mockClear(); restampCardAction.mockClear(); ctaTextAction.mockClear(); });
afterEach(cleanup);

const front = (over: Partial<CardRow> = {}): CardRow => ({
  id: "f1", post_id: "p1", theme_id: "t1", kind: "cover", position: 0, name_id: null, name: "'S' Names", meaning: "for baby boy",
  shot: "front card: wide: x", prompt: "the prompt", seed: 1, status: "done", error: null, photo_path: "photos/f1/v1.jpg", card_path: "cards/f1/v1.jpg",
  version: 1, selected: true, order_index: 0, queued_at: "2026-11-22T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "", updated_at: "", title_pos: "top", ...over,
});
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("front card in the UI", () => {
  it("the tile shows a Front card badge and is announced as the front card", () => {
    render(<CardTile card={front()} health="ready" queuePos={0} onOpen={() => {}} selection={{ selected: true, order: 1, onToggle: () => {} }} />);
    expect(screen.getByText("Front card")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unselect Front card \(upload number 1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open Front card: ready/ })).toBeTruthy();
  });

  it("the dialog shows the title; no name, meaning, message, name swap or Save text; New picture remakes the photo", async () => {
    render(<CardDialog card={front()} health="ready" onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Front card" })).toBeTruthy();
    expect(screen.getByText("'S' Names")).toBeTruthy();
    expect(screen.getByText("for baby boy")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Meaning")).toBeNull();
    expect(screen.queryByLabelText(/^Message/)).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Pick a different name" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save text/ })).toBeNull();
    await act(async () => { fireEvent.click(button(/^New picture$/)); });
    expect(regenerateCardAction).toHaveBeenCalledWith("f1");
    expect(restampCardAction).not.toHaveBeenCalled();
    expect(ctaTextAction).not.toHaveBeenCalled();
  });
});
