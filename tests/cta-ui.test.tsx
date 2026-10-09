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

const cta = (over: Partial<CardRow> = {}): CardRow => ({
  id: "c9", post_id: "p1", theme_id: "t1", kind: "cta", position: 10, name_id: null, name: "Follow for more / baby name ideas.", meaning: "",
  shot: "closing card: x", prompt: "the prompt", seed: 1, status: "done", error: null, photo_path: "photos/c9/v1.jpg", card_path: "cards/c9/v1.jpg", version: 1,
  selected: true, order_index: 10, queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "", updated_at: "", ...over,
});
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("closing card in the UI", () => {
  it("the tile shows a Closing card badge and is announced as the closing card", () => {
    render(<CardTile card={cta()} health="ready" queuePos={0} onOpen={() => {}} selection={{ selected: true, order: 10, onToggle: () => {} }} />);
    expect(screen.getByText("Closing card")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unselect Closing card \(upload number 10\)/ })).toBeTruthy();
  });

  it("the dialog has one Message field (no name, meaning or name ideas); Save text re-stamps the message", async () => {
    render(<CardDialog card={cta()} health="ready" onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Closing card" })).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Meaning")).toBeNull();
    expect(screen.queryByRole("button", { name: /Suggest/ })).toBeNull();
    const msg = screen.getByLabelText(/^Message/) as HTMLInputElement;
    expect(msg.value).toBe("Follow for more / baby name ideas.");
    expect(button(/Save text/).disabled).toBe(true);
    fireEvent.change(msg, { target: { value: "Follow us / for more" } });
    await act(async () => { fireEvent.click(button(/Save text/)); });
    expect(ctaTextAction).toHaveBeenCalledWith("c9", "Follow us / for more");
    expect(restampCardAction).not.toHaveBeenCalled();
  });

  it("New picture: plain remake when unchanged, with the new message when edited", async () => {
    render(<CardDialog card={cta()} health="ready" onClose={() => {}} onDelete={() => {}} />);
    await act(async () => { fireEvent.click(button(/^New picture$/)); });
    expect(regenerateCardAction).toHaveBeenCalledWith("c9");
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: "Still searching? / Follow" } });
    await act(async () => { fireEvent.click(button(/New picture with this text/)); });
    expect(ctaTextAction).toHaveBeenCalledWith("c9", "Still searching? / Follow", true);
  });
});
