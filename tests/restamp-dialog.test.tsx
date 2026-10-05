// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PostRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";
import { RestampDialog } from "@/components/posts/restamp-dialog";

beforeAll(polyfillRadix);
afterEach(cleanup);

const base: PostRow = { id: "p1", request_id: null, post_date: "2026-10-05", gender: "boy", style: "two-word", theme_id: "t1", caption: "",
  status: "ready", posted_at: null, created_at: "", updated_at: "" };
const settingsFonts = { title_font: "playfair", meaning_font: "lora", mark_font: "poppins" };

function show(post: PostRow, onConfirm = vi.fn()) {
  render(<RestampDialog open onOpenChange={() => {}} post={post} settingsFonts={settingsFonts} counts={{ restamp: 3, noPhoto: 1 }}
    health="offline" busy={false} onConfirm={onConfirm} />);
  return onConfirm;
}
const combo = (name: string) => screen.getByRole("combobox", { name });
const pick = (name: string, font: string) => {
  fireEvent.keyDown(combo(name), { key: "ArrowDown" });
  fireEvent.keyDown(within(screen.getByRole("listbox")).getByRole("option", { name: font }), { key: "Enter" });
};

describe("RestampDialog fonts", () => {
  it("prefills the post's own fonts (null keys from settings) and shows the counts", () => {
    show({ ...base, title_font: "quicksand", meaning_font: null, mark_font: "comfortaa" });
    expect(combo("Name font").textContent).toContain("Quicksand");
    expect(combo("Meaning font").textContent).toContain("Lora");
    expect(combo("Watermark font").textContent).toContain("Comfortaa");
    expect(screen.getByText(/3 cards will be re-stamped/)).toBeTruthy();
    expect(screen.getByText(/1 older card has no clean photo/)).toBeTruthy();
    expect(screen.getByText(/Your PC is offline/)).toBeTruthy();
  });

  it("confirm sends the picked fonts (post with the 003 columns)", () => {
    const onConfirm = show({ ...base, title_font: null, meaning_font: null, mark_font: null });
    pick("Name font", "Great Vibes");
    fireEvent.click(screen.getByRole("button", { name: "Re-stamp" }));
    expect(onConfirm).toHaveBeenCalledWith({ title_font: "greatvibes", meaning_font: "lora", mark_font: "poppins" });
  });

  it("before 003 (no font columns): unchanged fonts send nothing, so re-stamp keeps working", () => {
    const onConfirm = show(base);
    expect(combo("Name font").textContent).toContain("Playfair Display");
    fireEvent.click(screen.getByRole("button", { name: "Re-stamp" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });
});
