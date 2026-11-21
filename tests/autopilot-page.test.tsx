// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CardRow, AutopilotItemRow, AutopilotRunRow } from "@/lib/db/types";

const { toast, actions, refresh } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  actions: {
    previewAutopilotAction: vi.fn(async () => ({ ok: true, preview: { range: "Sat, Nov 21 – Fri, Nov 27", posts: 14, days: [{ day: "2026-11-21", dayLabel: "Sat, Nov 21", label: "Letter S" }], problems: ["Only 3 girl photoshoot themes are left."] } })),
    startAutopilotAction: vi.fn(async () => ({ ok: true, runId: "r" })),
    stopAutopilotAction: vi.fn(async () => ({ ok: true })),
    resumeAutopilotAction: vi.fn(async () => ({ ok: true })),
    saveNameThemesAction: vi.fn(async () => ({ ok: true })),
  },
  refresh: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/actions/autopilot", () => actions);
const { AutopilotPanel } = await import("@/components/autopilot/autopilot-panel");
const { NameThemesEditor } = await import("@/components/autopilot/name-themes-editor");
const { CardTile } = await import("@/components/cards/card-tile");
const { checkChip } = await import("@/lib/status/card-check");

const run = (o: Partial<AutopilotRunRow> = {}): AutopilotRunRow => ({ id: "r", status: "running", days: 1, first_day: "2026-11-21", message: null, events: [],
  input_tokens: 0, output_tokens: 0, tick_until: null, created_at: "", finished_at: null, updated_at: "", ...o });
const item = (o: Partial<AutopilotItemRow>): AutopilotItemRow => ({ id: "i", run_id: "r", day: "2026-11-21", slot: "morning", gender: "girl", scheduled_for: "2026-11-21T00:47:00Z",
  letter: "S", name_theme: null, name_count: 10, post_id: null, state: "planned", lookalike_done: false, attempts: 0, note: null, created_at: "", updated_at: "", ...o });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Autopilot page", () => {
  it("without a run: shows the plan and its warnings, and starts", async () => {
    await act(async () => { render(<AutopilotPanel run={null} items={[]} stats={{}} />); });
    expect(screen.getByText(/Sat, Nov 21 – Fri, Nov 27/)).toBeTruthy();
    expect(screen.getByText(/Only 3 girl photoshoot themes/)).toBeTruthy();
    expect(actions.previewAutopilotAction).toHaveBeenCalledWith(7);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start/ })); });
    expect(actions.startAutopilotAction).toHaveBeenCalledWith(7);
    expect(refresh).toHaveBeenCalled();
  });

  it("with a run: each planned post with its time, state and link; held posts under Needs you; Stop asks first", async () => {
    render(<AutopilotPanel run={run()} items={[
      item({ id: "a", state: "scheduled", post_id: "p1" }),
      item({ id: "b", slot: "afternoon", gender: "boy", scheduled_for: "2026-11-21T05:12:00Z", state: "held", post_id: "p2", note: "Only 5 good boy names" }),
    ]} stats={{ p1: { total: 11, done: 11, passed: 11, remade: 2, removed: 0 } }} />);
    expect(screen.getByText("8:47 AM")).toBeTruthy();
    expect(screen.getByText("1:12 PM")).toBeTruthy();
    expect(screen.getAllByText(/Sat, Nov 21 · Letter S/).length).toBeGreaterThan(0);
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText(/Only 5 good boy names/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Stop Autopilot/ })); });
    expect(actions.stopAutopilotAction).toHaveBeenCalledWith("r");
  });

  it("a paused run shows why and offers Resume", async () => {
    render(<AutopilotPanel run={run({ status: "paused", message: "Your Claude credits have run out. Fix it, then press Resume." })} items={[item({})]} stats={{}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/credits have run out/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resume/ })); });
    expect(actions.resumeAutopilotAction).toHaveBeenCalledWith("r");
  });

  it("name themes editor validates and saves", async () => {
    render(<NameThemesEditor text={"Biblical"} />);
    const box = screen.getByLabelText("Name themes");
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("Add at least one name theme.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Biblical\nSoft and cool" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save name themes/ })); });
    expect(actions.saveNameThemesAction).toHaveBeenCalledWith("Biblical\nSoft and cool");
  });

  it("card chip text", () => {
    expect(checkChip({ check_state: "passed", check_note: "Checked" })).toEqual({ text: "Checked", tone: "ok" });
    expect(checkChip({ check_state: "passed", check_note: "Remade: odd hands or fingers" })).toEqual({ text: "Remade: odd hands or fingers", tone: "ok" });
    expect(checkChip({ check_state: "removed", check_note: "Removed: too much skin" })).toEqual({ text: "Removed: too much skin", tone: "bad" });
    expect(checkChip({ check_state: "failed", check_note: "Could not check twice: x" })).toEqual({ text: "Not checked", tone: "bad" });
    expect(checkChip({ check_state: "pending", check_note: null })).toBeNull();
    expect(checkChip({ check_state: null, check_note: null })).toBeNull();
  });

  it("a done run still lists its held posts under Needs you", () => {
    render(<AutopilotPanel run={run({ status: "done" })} items={[item({ state: "held", post_id: "p2", note: "Only 5 good boy names" })]} stats={{}} />);
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText(/Only 5 good boy names/)).toBeTruthy();
    expect(within(needs).getByRole("link", { name: "Open post" }).getAttribute("href")).toBe("/posts/p2");
  });

  it("shows making and checking progress, and hides it without cards", () => {
    render(<AutopilotPanel run={run()} items={[
      item({ id: "a", state: "making", post_id: "p1" }),
      item({ id: "b", slot: "afternoon", scheduled_for: "2026-11-21T05:12:00Z", state: "checking", post_id: "p2" }),
      item({ id: "c", slot: "afternoon", scheduled_for: "2026-11-21T06:12:00Z", state: "making", post_id: "p3" }),
    ]} stats={{ p1: { total: 11, done: 4, passed: 0, remade: 1, removed: 0 }, p2: { total: 11, done: 11, passed: 7, remade: 0, removed: 0 }, p3: { total: 0, done: 0, passed: 0, remade: 0, removed: 0 } }} />);
    expect(screen.getByText("Making cards 4/11")).toBeTruthy();
    expect(screen.getByText("Checking 7/11")).toBeTruthy();
    expect(screen.getByText("Making cards")).toBeTruthy();
    expect(screen.getByText("1 remade")).toBeTruthy();
  });

  it("a paused run with no message still says what to do", () => {
    render(<AutopilotPanel run={run({ status: "paused", message: null })} items={[item({})]} stats={{}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Press Resume to carry on/);
  });

  it("changing the days re-previews, and a slow answer for the old count never replaces the new one", async () => {
    const pv = (range: string) => ({ ok: true as const, preview: { range, posts: 2, days: [], problems: [] } });
    let releaseOld: (v: ReturnType<typeof pv>) => void = () => {};
    actions.previewAutopilotAction
      .mockImplementationOnce(() => new Promise((res) => { releaseOld = res as typeof releaseOld; }) as never)
      .mockImplementationOnce((async () => pv("NEW RANGE")) as never);
    await act(async () => { render(<AutopilotPanel run={null} items={[]} stats={{}} />); });
    await act(async () => { fireEvent.change(screen.getByLabelText("How many days"), { target: { value: "3" } }); });
    expect(actions.previewAutopilotAction).toHaveBeenLastCalledWith(3);
    expect(screen.getByText(/NEW RANGE/)).toBeTruthy();
    await act(async () => { releaseOld(pv("OLD RANGE")); });
    expect(screen.queryByText(/OLD RANGE/)).toBeNull();
    expect(screen.getByText(/NEW RANGE/)).toBeTruthy();
  });

  it("refreshes every 10 seconds while running, never for a done run, and stops on unmount", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<AutopilotPanel run={run()} items={[item({})]} stats={{}} />);
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(10_000); });
      expect(refresh).toHaveBeenCalledTimes(1);
      unmount();
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(refresh).toHaveBeenCalledTimes(1);
      cleanup();
      await act(async () => { render(<AutopilotPanel run={run({ status: "done" })} items={[]} stats={{}} />); });
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("Stop does nothing until the owner confirms", async () => {
    render(<AutopilotPanel run={run()} items={[item({})]} stats={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(actions.stopAutopilotAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Keep going/ }));
    expect(actions.stopAutopilotAction).not.toHaveBeenCalled();
  });

  it("a done card shows its check chip; one without a check shows none", () => {
    const card = { id: "c1", post_id: "p1", kind: "post", position: 1, name: "Arlo", status: "done", card_path: "x.png", photo_path: "y.png", started_at: null,
      check_state: "passed", check_note: "Remade: odd hands or fingers" } as unknown as CardRow;
    render(<CardTile card={card} health="ready" queuePos={0} />);
    expect(screen.getByText("Remade: odd hands or fingers")).toBeTruthy();
    cleanup();
    render(<CardTile card={{ ...card, check_state: null, check_note: null } as CardRow} health="ready" queuePos={0} />);
    expect(screen.queryByText(/Remade|Checked|Not checked|Removed/)).toBeNull();
  });
});
