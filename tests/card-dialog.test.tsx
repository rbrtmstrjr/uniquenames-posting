// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CardRow } from "@/lib/db/types";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { polyfillRadix } from "./helpers/radix-jsdom";

const regenerateCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const restampCardAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, mode: "restamp" as const }));
vi.mock("@/lib/actions/cards", () => ({ regenerateCardAction, restampCardAction }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { CardDialog } = await import("@/components/cards/card-dialog");

beforeAll(polyfillRadix);
beforeEach(() => { regenerateCardAction.mockClear(); restampCardAction.mockClear(); });
afterEach(cleanup);

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: "c1", post_id: "p1", theme_id: "t1", kind: "post", position: 2, name_id: "n1", name: "Arlo Zenith", meaning: "strong and bright",
  shot: "s", prompt: "the prompt", seed: 1, status: "done", error: null, photo_path: "photos/c1/v1.jpg", card_path: "cards/c1/v1.jpg", version: 1,
  selected: true, order_index: 2, queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "", updated_at: "", ...over,
});

function open(c: CardRow, health: WorkerHealth = "ready", extra: { queuePos?: number; onPatch?: (id: string, p: Partial<CardRow>) => void } = {}) {
  return render(<CardDialog card={c} health={health} onClose={() => {}} onDelete={() => {}} {...extra} />);
}
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("CardDialog: New picture keeps the edited text (#3)", () => {
  it("unchanged text calls a plain regenerate", async () => {
    open(card());
    await act(async () => { fireEvent.click(button(/^New picture$/)); });
    expect(regenerateCardAction).toHaveBeenCalledWith("c1");
  });

  it("an edited name goes WITH the regenerate, and the button says so", async () => {
    open(card());
    fireEvent.change(field("Name"), { target: { value: "Arlo Zephyr" } });
    await act(async () => { fireEvent.click(button(/New picture with this text/)); });
    expect(regenerateCardAction).toHaveBeenCalledWith("c1", { name: "Arlo Zephyr", meaning: "strong and bright" });
    expect(restampCardAction).not.toHaveBeenCalled();
  });

  it("flips the live row to in line at once (optimistic)", async () => {
    const onPatch = vi.fn();
    open(card(), "ready", { onPatch });
    await act(async () => { fireEvent.click(button(/^New picture$/)); });
    expect(onPatch).toHaveBeenCalledWith("c1", expect.objectContaining({ status: "queued", started_at: null }));
  });

  it("re-renders from the live row: header status and title follow realtime updates", () => {
    const { rerender } = open(card({ status: "queued" }), "ready", { queuePos: 2 });
    expect(screen.getByText("In line #2")).toBeTruthy();
    rerender(<CardDialog card={card({ status: "generating", started_at: new Date(Date.now() - 5000).toISOString(), name: "Arlo Zephyr" })} health="ready" onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/^Making… 0:0\d$/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Arlo Zephyr" })).toBeTruthy();
    expect(field("Name").value).toBe("Arlo Zephyr");
  });

  it("keeps the owner's unsaved edit when the row changes underneath", () => {
    const { rerender } = open(card());
    fireEvent.change(field("Meaning"), { target: { value: "my edit" } });
    rerender(<CardDialog card={card({ name: "Someone Else" })} health="ready" onClose={() => {}} onDelete={() => {}} />);
    expect(field("Meaning").value).toBe("my edit");
  });
});

describe("CardDialog: Generate lock (#6)", () => {
  it.each([["offline", /Your PC is offline — turn it on to generate/], ["comfy-off", /Open ComfyUI Desktop to generate/]] as const)(
    "%s: New picture is disabled with the reason as visible text", (h, reason) => {
      open(card(), h);
      expect(button(/New picture/).disabled).toBe(true);
      expect(screen.getByText(reason)).toBeTruthy();
    });

  it("ComfyUI closed: a text edit can still be saved (re-stamp needs only Pillow)", () => {
    open(card(), "comfy-off");
    fireEvent.change(field("Name"), { target: { value: "Arlo Zephyr" } });
    expect(button(/Save text/).disabled).toBe(false);
    expect(screen.getByText(/Text edits still save/)).toBeTruthy();
  });

  it("ComfyUI closed: a card without a clean photo cannot save text either (it would regenerate)", () => {
    open(card({ photo_path: null }), "comfy-off");
    fireEvent.change(field("Name"), { target: { value: "Arlo Zephyr" } });
    expect(button(/Save text/).disabled).toBe(true);
  });
});
