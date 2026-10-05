// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardTile } from "@/components/cards/card-tile";
import type { CardRow } from "@/lib/db/types";

afterEach(cleanup);

const failed = {
  id: "c1", post_id: "p1", theme_id: "t1", kind: "post", position: 1, name_id: null, name: "Arlo", meaning: "x", shot: "s", prompt: "p", seed: 1,
  status: "failed", error: "ComfyUI crashed", photo_path: null, card_path: null, version: 1, selected: true, order_index: 1,
  queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1, created_at: "", updated_at: "",
} as CardRow;

describe("CardTile Retry follows the Generate lock (#6)", () => {
  it("ready: Retry works", () => {
    const onRetry = vi.fn();
    render(<CardTile card={failed} health="ready" queuePos={0} onRetry={onRetry} />);
    const b = screen.getByRole("button", { name: /Retry/ }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onRetry).toHaveBeenCalled();
  });

  it.each([
    ["offline", "Your PC is offline — turn it on to generate"],
    ["unknown", "Your PC is offline — turn it on to generate"],
    ["comfy-off", "Open ComfyUI Desktop to generate"],
  ] as const)("%s: Retry is disabled and the reason is visible text", (h, reason) => {
    const onRetry = vi.fn();
    render(<CardTile card={failed} health={h} queuePos={0} onRetry={onRetry} />);
    const b = screen.getByRole("button", { name: /Retry/ }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByText(reason)).toBeTruthy();
  });
});
