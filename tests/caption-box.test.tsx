// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { toast, updateCaptionAction, rewriteCaptionAction } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  updateCaptionAction: vi.fn(),
  rewriteCaptionAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/actions/posts", () => ({ updateCaptionAction, rewriteCaptionAction }));
const { CaptionBox } = await import("@/components/posts/caption-box");

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const box = () => screen.getByLabelText("Caption") as HTMLTextAreaElement;
const rewriteBtn = () => screen.getByRole("button", { name: /Rewrite caption/ }) as HTMLButtonElement;

beforeEach(() => { updateCaptionAction.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CaptionBox Rewrite caption", () => {
  it("shows a pending state, locks the box, then replaces and keeps the text as saved", async () => {
    const d = deferred<{ ok: true; caption: string }>();
    rewriteCaptionAction.mockReturnValueOnce(d.promise);
    render(<CaptionBox postId="p1" initial="Old caption" />);
    await act(async () => { fireEvent.click(rewriteBtn()); });
    expect(rewriteBtn().disabled).toBe(true);
    expect(box().readOnly).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Writing/);
    await act(async () => { d.resolve({ ok: true, caption: "New AI caption\n\n#tags" }); });
    expect(box().value).toBe("New AI caption\n\n#tags");
    expect(box().readOnly).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(toast.success).toHaveBeenCalledWith("New caption written", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
  });

  it("Undo puts the owner's previous text back and saves it", async () => {
    rewriteCaptionAction.mockResolvedValueOnce({ ok: true, caption: "AI text" });
    render(<CaptionBox postId="p1" initial="My own words" />);
    await act(async () => { fireEvent.click(rewriteBtn()); });
    const undo = toast.success.mock.calls.find((c) => c[0] === "New caption written")![1].action.onClick;
    await act(async () => { undo(); });
    expect(box().value).toBe("My own words");
    expect(updateCaptionAction).toHaveBeenCalledWith("p1", "My own words");
  });

  it("an unsaved edit is saved before Rewrite runs (blur on tap), never lost silently", async () => {
    const save = deferred<{ ok: true }>();
    updateCaptionAction.mockReturnValueOnce(save.promise);
    rewriteCaptionAction.mockResolvedValueOnce({ ok: true, caption: "AI text" });
    render(<CaptionBox postId="p1" initial="Old" />);
    fireEvent.change(box(), { target: { value: "Edited by owner" } });
    await act(async () => { fireEvent.blur(box()); fireEvent.click(rewriteBtn()); });
    expect(updateCaptionAction).toHaveBeenCalledWith("p1", "Edited by owner");
    expect(rewriteCaptionAction).not.toHaveBeenCalled();
    await act(async () => { save.resolve({ ok: true }); });
    expect(rewriteCaptionAction).toHaveBeenCalledTimes(1);
    const undo = toast.success.mock.calls.find((c) => c[0] === "New caption written")![1].action.onClick;
    await act(async () => { undo(); });
    expect(box().value).toBe("Edited by owner");
  });

  it("a failed rewrite keeps the text and toasts the reason", async () => {
    rewriteCaptionAction.mockResolvedValueOnce({ ok: false, error: "Could not write a new caption right now. Your caption is unchanged." });
    render(<CaptionBox postId="p1" initial="Keep me" />);
    await act(async () => { fireEvent.click(rewriteBtn()); });
    expect(box().value).toBe("Keep me");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/unchanged/));
  });
});
