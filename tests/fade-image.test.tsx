// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FadeImage } from "@/components/ui/fade-image";
import { CardTile } from "@/components/cards/card-tile";
import type { CardRow } from "@/lib/db/types";

afterEach(cleanup);

const img = (c: HTMLElement) => c.querySelector("img");

describe("FadeImage", () => {
  it("shows only the shimmer while the signed URL is not there yet", () => {
    const { container } = render(<FadeImage />);
    expect(screen.getByTestId("image-skeleton")).toBeTruthy();
    expect(img(container)).toBeNull();
  });

  it("keeps the image invisible behind the shimmer until it loads, then fades it in", () => {
    const { container } = render(<FadeImage src="https://x.test/a.jpg" className="opacity-45" />);
    const el = img(container)!;
    expect(screen.queryByTestId("image-skeleton")).toBeTruthy();
    expect(el.dataset.loaded).toBe("false");
    expect(el.className).toContain("opacity-0");
    expect(el.className).not.toContain("opacity-45");

    fireEvent.load(el);
    expect(screen.queryByTestId("image-skeleton")).toBeNull();
    expect(img(container)!.dataset.loaded).toBe("true");
    expect(img(container)!.className).not.toContain("opacity-0");
    expect(img(container)!.className).toContain("opacity-45"); // caller's dimmed state applies once loaded
  });

  it("shimmers again for a new picture (remade card)", () => {
    const { container, rerender } = render(<FadeImage src="https://x.test/a.jpg" />);
    fireEvent.load(img(container)!);
    rerender(<FadeImage src="https://x.test/b.jpg" />);
    expect(screen.queryByTestId("image-skeleton")).toBeTruthy();
    expect(img(container)!.dataset.loaded).toBe("false");
  });

  it("stops shimmering when the picture fails to load", () => {
    const { container } = render(<FadeImage src="https://x.test/broken.jpg" />);
    fireEvent.error(img(container)!);
    expect(screen.queryByTestId("image-skeleton")).toBeNull();
  });
});

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: "c1", post_id: "p1", theme_id: "t1", kind: "post", position: 1, name_id: null, name: "Arlo Zenith", meaning: "peak strength",
  shot: "", prompt: "", seed: 1, status: "done", error: null, photo_path: "p.png", card_path: "c1/v1.jpg", version: 1, selected: false,
  order_index: 1, queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: null, finished_at: null, attempts: 1,
  created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", ...over,
} as CardRow);

describe("CardTile image", () => {
  it("shows a shimmer (not a blank square) for a finished card whose URL is still being signed", () => {
    const { container } = render(<CardTile card={card()} health="ready" queuePos={0} />);
    expect(screen.getByTestId("image-skeleton")).toBeTruthy();
    expect(img(container)).toBeNull();
  });

  it("fades the picture in once it has loaded", () => {
    const { container } = render(<CardTile card={card()} url="https://x.test/c1.jpg" health="ready" queuePos={0} />);
    fireEvent.load(img(container)!);
    expect(screen.queryByTestId("image-skeleton")).toBeNull();
  });
});
