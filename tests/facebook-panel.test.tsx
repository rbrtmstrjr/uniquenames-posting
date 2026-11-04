// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CardRow, PostRow } from "@/lib/db/types";

const { toast, publishToFacebookAction, cancelFacebookScheduleAction } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  publishToFacebookAction: vi.fn(),
  cancelFacebookScheduleAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/actions/facebook", () => ({ publishToFacebookAction, cancelFacebookScheduleAction }));
const { FacebookPanel } = await import("@/components/posts/facebook-panel");

const post = (o: Partial<PostRow> = {}) => ({ id: "p1", caption: "c", status: "ready", fb_state: null, ...o }) as PostRow;
const card = (id: string, o: Partial<CardRow> = {}) =>
  ({ id, kind: "post", selected: true, status: "done", card_path: `cards/${id}/v1.jpg`, order_index: 1, position: 1, ...o }) as CardRow;
const cards = [card("a"), card("b"), card("c", { selected: false })];
const btn = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("FacebookPanel", () => {
  it("asks before posting, then posts the box's caption and shows it as posted", async () => {
    publishToFacebookAction.mockResolvedValueOnce({ ok: true, state: "published", permalink: "https://fb/p", scheduledFor: null });
    const onPatch = vi.fn();
    render(<FacebookPanel post={post()} cards={cards} caption="Box text" connected onPatch={onPatch} />);
    fireEvent.click(btn(/^Post now$/));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/2 cards go out as one post/);
    expect(publishToFacebookAction).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Post now/ })); });
    expect(publishToFacebookAction).toHaveBeenCalledWith("p1", { caption: "Box text", retryUnsure: false });
    expect(onPatch).toHaveBeenLastCalledWith(expect.objectContaining({ fb_state: "published", fb_permalink: "https://fb/p", status: "posted" }));
    expect(toast.success).toHaveBeenCalledWith("Posted to Facebook");
  });

  it("is disabled with the reason until Facebook is connected and the cards are ready", () => {
    render(<FacebookPanel post={post()} cards={cards} caption="c" connected={false} onPatch={vi.fn()} />);
    expect(btn(/^Post now$/).disabled).toBe(true);
    expect(btn(/Schedule/).disabled).toBe(true);
    expect(screen.getByText(/Connect Facebook first/)).toBeTruthy();
    cleanup();
    render(<FacebookPanel post={post()} cards={[card("a", { status: "generating", card_path: null })]} caption="c" connected onPatch={vi.fn()} />);
    expect(btn(/^Post now$/).disabled).toBe(true);
    expect(screen.getByText(/1 selected card is not ready yet/)).toBeTruthy();
  });

  it("schedules at the picked Manila time", async () => {
    const at = new Date(Date.now() + 2 * 24 * 3600_000);
    const value = new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 16);
    publishToFacebookAction.mockResolvedValueOnce({ ok: true, state: "scheduled", permalink: null, scheduledFor: `${value}:00+08:00` });
    render(<FacebookPanel post={post()} cards={cards} caption="c" connected onPatch={vi.fn()} />);
    fireEvent.click(btn(/Schedule/));
    fireEvent.change(screen.getByLabelText("Date and time"), { target: { value } });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Schedule/ })); });
    expect(publishToFacebookAction).toHaveBeenCalledWith("p1", { caption: "c", scheduledAt: new Date(`${value}:00+08:00`).toISOString() });
  });

  it("shows a scheduled post with Cancel schedule, and an unsure one with a deliberate Retry anyway", async () => {
    cancelFacebookScheduleAction.mockResolvedValueOnce({ ok: true });
    const onPatch = vi.fn();
    render(<FacebookPanel post={post({ fb_state: "scheduled", fb_scheduled_for: new Date(Date.now() + 3600_000).toISOString(), status: "posted" })} cards={cards} caption="c" connected onPatch={onPatch} />);
    expect(screen.getByText(/Scheduled for/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Post now$/ })).toBeNull();
    fireEvent.click(btn(/Cancel schedule/));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Cancel schedule/ })); });
    expect(cancelFacebookScheduleAction).toHaveBeenCalledWith("p1");
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ fb_state: null, status: "ready" }));
    cleanup();
    render(<FacebookPanel post={post({ fb_state: "unsure" })} cards={cards} caption="c" connected onPatch={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/may or may not be on your Page/);
    fireEvent.click(btn(/Retry anyway/));
    expect(screen.getByRole("dialog").textContent).toMatch(/Only do this if you checked your Page/);
  });

  it("when the answer is lost, it says the post may still finish (and does not invite a second tap)", async () => {
    publishToFacebookAction.mockRejectedValueOnce(new Error("network"));
    render(<FacebookPanel post={post()} cards={cards} caption="c" connected onPatch={vi.fn()} />);
    fireEvent.click(btn(/^Post now$/));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Post now/ })); });
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/It may still finish/), expect.anything());
  });
});
