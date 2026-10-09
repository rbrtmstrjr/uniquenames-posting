// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReelRow } from "@/lib/db/types";

const { toast, rewriteReelCaptionAction } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  rewriteReelCaptionAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/actions/reels", () => ({ rewriteReelCaptionAction }));
vi.mock("@/lib/actions/call", () => ({ callAction: (fn: () => Promise<unknown>) => fn() }));
const { ReelCaption, reelCaptionText } = await import("@/components/reels/reel-caption");

const REEL = "11111111-1111-4111-8111-111111111111";
const base = {
  id: REEL, title: "The Quiet Hour", topic: null, stage: "toddler", doll_cast: { adult: "a", child: "c" }, status: "ready", error: null,
  voice_path: null, words: null, preview_path: null, pc_path: null, duration_s: null, version: 1, claimed_at: null, started_at: null,
  finished_at: null, created_at: "", updated_at: "",
} satisfies ReelRow;
const reel = (o: Partial<ReelRow> = {}): ReelRow => ({ ...base, caption: "Nobody warned you. What helps you?", hashtags: "#uniquenames #bedtime #toddlersleep", ...o });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ReelCaption", () => {
  it("shows the caption and its hashtags with Copy + Rewrite", () => {
    render(<ReelCaption reel={reel()} />);
    expect(screen.getByText("Nobody warned you. What helps you?")).toBeTruthy();
    expect(screen.getByText("#uniquenames #bedtime #toddlersleep")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy caption/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rewrite caption/ })).toBeTruthy();
  });

  it("Copy puts the caption, a blank line and the hashtags on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ReelCaption reel={reel()} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy caption/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Nobody warned you. What helps you?\n\n#uniquenames #bedtime #toddlersleep"));
    expect(reelCaptionText("A?", "")).toBe("A?");
  });

  it("Rewrite calls the action and hands the new caption up", async () => {
    rewriteReelCaptionAction.mockResolvedValueOnce({ ok: true, caption: "New words. What works?", hashtags: "#uniquenames #naps" });
    const onPatch = vi.fn();
    render(<ReelCaption reel={reel()} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: /Rewrite caption/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ caption: "New words. What works?", hashtags: "#uniquenames #naps" }));
    expect(rewriteReelCaptionAction).toHaveBeenCalledWith(REEL);
  });

  it("a failed rewrite says why and changes nothing", async () => {
    rewriteReelCaptionAction.mockResolvedValueOnce({ ok: false, error: "Could not write a caption right now." });
    const onPatch = vi.fn();
    render(<ReelCaption reel={reel()} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: /Rewrite caption/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not write a caption right now."));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("no caption yet: no Copy, a Write caption button", () => {
    render(<ReelCaption reel={reel({ caption: null, hashtags: null })} />);
    expect(screen.queryByRole("button", { name: /Copy caption/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Write caption/ })).toBeTruthy();
    expect(screen.getByText(/No caption yet/)).toBeTruthy();
  });

  it("before 009 (no caption column): a note to run the migration, no buttons", () => {
    render(<ReelCaption reel={base} />);
    expect(screen.getByText(/009_captions\.sql/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
