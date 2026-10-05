// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

// "Suggest with AI" + approval UI. The server actions are mocked; callAction/optimistic are the
// real ones, so optimistic changes and rollbacks are exercised.
let health = "ready";
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health, lastSeen: "now", row: null }) }));
vi.mock("@/lib/realtime/use-table", () => ({ useRealtimeRows: (_t: string, initial: unknown[]) => [initial] }));
vi.mock("@/lib/realtime/signed-urls", () => ({ useSignedUrls: () => () => undefined }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
const m = vi.hoisted(() => ({
  approveNamesAction: vi.fn(), rejectNamesAction: vi.fn(), approveThemesAction: vi.fn(), rejectThemesAction: vi.fn(),
  suggestNamesAction: vi.fn(), suggestThemesAction: vi.fn(), makePreviewAction: vi.fn(),
}));
vi.mock("@/lib/actions/names", () => ({
  addNamesAction: vi.fn(), updateNameAction: vi.fn(), setSkipAction: vi.fn(), deleteNameAction: vi.fn(),
  approveNamesAction: m.approveNamesAction, rejectNamesAction: m.rejectNamesAction,
}));
vi.mock("@/lib/actions/themes", () => ({
  makePreviewAction: m.makePreviewAction, moveThemeNextAction: vi.fn(), reorderThemesAction: vi.fn(), setArchivedAction: vi.fn(), saveThemeAction: vi.fn(),
  approveThemesAction: m.approveThemesAction, rejectThemesAction: m.rejectThemesAction,
}));
vi.mock("@/lib/actions/suggest", () => ({ suggestNamesAction: m.suggestNamesAction, suggestThemesAction: m.suggestThemesAction }));
const { NamesTable } = await import("@/components/names/names-table");
const { ThemeList } = await import("@/components/themes/theme-list");
const { outcomeText } = await import("@/components/ui/suggest-dialog");

beforeAll(polyfillRadix);
afterEach(cleanup);
beforeEach(() => { health = "ready"; Object.values(m).forEach((f) => f.mockReset()); });

const now = "2026-10-05T00:00:00Z";
const nm = (name: string, status: NameRow["status"], gender: NameRow["gender"] = "boy"): NameRow =>
  ({ id: name, name, meaning: "a meaning", gender, style: "single", status, post_id: null, position: null, created_at: now, updated_at: now });
const th = (title: string, status: ThemeRow["status"], sort_order = 1): ThemeRow => ({
  id: title, title, gender: "boy", backdrop: "smooth seamless sage studio backdrop", outfit: "knit romper", props: "felt fox toy, pine cones", lighting: "soft", palette: "sage, cream",
  status, sort_order, used_on: null, preview_card_id: null, created_at: now, updated_at: now,
});
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("outcomeText", () => {
  it("reports added and skipped counts", () => {
    expect(outcomeText({ added: 8, duplicates: 3, invalid: 0 }, "name")).toBe("Added 8 suggestions (3 duplicates skipped).");
    expect(outcomeText({ added: 1, duplicates: 1, invalid: 2 }, "theme")).toBe("Added 1 suggestion (1 duplicate, 2 unusable skipped).");
    expect(outcomeText({ added: 0, duplicates: 5, invalid: 0 }, "name")).toMatch(/^No new names this time \(5 duplicates skipped\)/);
  });
});

describe("Names: suggest + approve", () => {
  it("shows a Pending approval banner that opens the pending view with Approve/Edit/Reject per row", () => {
    render(<NamesTable names={[nm("Aaron", "available"), nm("Zephyr", "pending"), nm("Orion", "pending")]} />);
    fireEvent.click(within(screen.getByText(/Pending approval \(2\)/).closest("div")!).getByRole("button", { name: "Review" }));
    expect(screen.getByRole("button", { name: "Approve Zephyr" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Zephyr" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject Zephyr" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Zephyr" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve all (2)" })).toBeTruthy();
  });

  it("approves one name optimistically and calls the action with its id", async () => {
    m.approveNamesAction.mockResolvedValue({ ok: true, count: 1 });
    render(<NamesTable names={[nm("Zephyr", "pending"), nm("Orion", "pending")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve Zephyr" }));
    expect(screen.queryByText("Zephyr")).toBeNull(); // left the pending view at once
    await waitFor(() => expect(m.approveNamesAction).toHaveBeenCalledWith(["Zephyr"]));
  });

  it("puts a rejected name back when the server refuses", async () => {
    m.rejectNamesAction.mockResolvedValue({ ok: false, error: "nope" });
    render(<NamesTable names={[nm("Zephyr", "pending"), nm("Orion", "pending")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject Zephyr" }));
    await waitFor(() => expect(m.rejectNamesAction).toHaveBeenCalledWith(["Zephyr"]));
    await waitFor(() => expect(screen.getByText("Zephyr")).toBeTruthy());
  });

  it("Reject all asks first, then rejects every pending name shown", async () => {
    m.rejectNamesAction.mockResolvedValue({ ok: true, count: 2 });
    render(<NamesTable names={[nm("Zephyr", "pending"), nm("Orion", "pending"), nm("Aaron", "available")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    const dlg = await screen.findByRole("dialog", { name: /Reject 2 suggested names/ });
    fireEvent.click(within(dlg).getByRole("button", { name: "Reject all" }));
    await waitFor(() => expect(m.rejectNamesAction).toHaveBeenCalledWith(["Zephyr", "Orion"].sort((a, b) => a.localeCompare(b))));
  });

  it("the suggest dialog stays open with a progress state, then shows the outcome", async () => {
    const d = deferred<unknown>();
    m.suggestNamesAction.mockReturnValue(d.promise);
    render(<NamesTable names={[nm("Aaron", "available")]} />);
    fireEvent.click(screen.getByRole("button", { name: /Suggest with AI/ }));
    const dlg = await screen.findByRole("dialog", { name: "Suggest names with AI" });
    fireEvent.click(within(dlg).getByRole("radio", { name: "Boy" }));
    fireEvent.click(within(dlg).getByRole("radio", { name: "Single" }));
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "sea names" } });
    fireEvent.click(within(dlg).getByRole("button", { name: /Suggest 10 names/ }));
    expect(await within(dlg).findByText(/Gemini is thinking up 10 names/)).toBeTruthy();
    expect(m.suggestNamesAction).toHaveBeenCalledWith({ gender: "boy", style: "single", count: 10, vibe: "sea names" });
    await act(async () => { d.resolve({ ok: true, added: 7, duplicates: 2, invalid: 1 }); });
    expect(await within(dlg).findByText("Added 7 suggestions (2 duplicates, 1 unusable skipped).")).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "Review them" })).toBeTruthy();
  });

  it("shows the action's error (e.g. the missing v2 update) inside the dialog", async () => {
    m.suggestNamesAction.mockResolvedValue({ ok: false, error: "Run the v2 database update first (…), then try again." });
    render(<NamesTable names={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Suggest with AI/ }));
    const dlg = await screen.findByRole("dialog", { name: "Suggest names with AI" });
    fireEvent.click(within(dlg).getByRole("button", { name: /Suggest 10 names/ }));
    expect((await within(dlg).findByRole("alert")).textContent).toMatch(/Run the v2 database update first/);
  });

  it("Approve all while one approve is in flight sends only the others, and a late failure restores just that one", async () => {
    const first = deferred<unknown>();
    m.approveNamesAction.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, count: 2 });
    render(<NamesTable names={[nm("Zephyr", "pending"), nm("Orion", "pending"), nm("Atlas", "pending")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve Zephyr" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all (2)" }));
    await waitFor(() => expect(m.approveNamesAction).toHaveBeenCalledTimes(2));
    expect(m.approveNamesAction.mock.calls[1][0]).toEqual(["Atlas", "Orion"]);
    expect(screen.queryByText("Orion")).toBeNull();
    await act(async () => { first.resolve({ ok: false, error: "nope" }); });
    await waitFor(() => expect(screen.getByText("Zephyr")).toBeTruthy()); // only Zephyr rolls back
    expect(screen.queryByText("Orion")).toBeNull();
    expect(screen.queryByText("Atlas")).toBeNull();
  });
});

describe("Themes: pending approval section", () => {
  it("Approve all while one approve is in flight approves only the others, after it in Up next", async () => {
    const first = deferred<unknown>();
    m.approveThemesAction.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, count: 1 });
    render(<ThemeList themes={[th("Forest Nook", "pending", 9), th("Forest Two", "pending", 10), th("Boho", "available", 1)]} previews={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve Forest Nook" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => expect(m.approveThemesAction).toHaveBeenCalledTimes(2));
    expect(m.approveThemesAction.mock.calls[1][0]).toEqual(["Forest Two"]);
    const upNext = screen.getByRole("heading", { name: /Up next · 3 left/ }).parentElement!;
    expect(within(upNext).getAllByRole("listitem").map((li) => li.textContent?.includes("Forest Two"))).toEqual([false, false, true]);
    await act(async () => { first.resolve({ ok: true, count: 1 }); });
  });

  it("lists suggestions above Up next with Make preview, Approve, Edit, Reject", () => {
    render(<ThemeList themes={[th("Forest Nook", "pending", 9), th("Boho", "available", 1)]} previews={[]} />);
    const sec = screen.getByRole("region", { name: /Pending approval · 1/ });
    expect(within(sec).getByText("Forest Nook")).toBeTruthy();
    expect(within(sec).getByRole("button", { name: "Make a preview of Forest Nook" })).toBeTruthy();
    for (const b of ["Approve Forest Nook", "Edit Forest Nook", "Reject Forest Nook"]) expect(within(sec).getByRole("button", { name: b })).toBeTruthy();
    const upNext = screen.getByRole("heading", { name: /Up next · 1 left/ }).parentElement!;
    expect(within(upNext).queryByText("Forest Nook")).toBeNull();
  });

  it("Make preview on a pending theme obeys the generate lock", () => {
    health = "offline";
    render(<ThemeList themes={[th("Forest Nook", "pending", 9)]} previews={[]} />);
    expect((screen.getByRole("button", { name: "Make a preview of Forest Nook" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("approving moves the theme to the end of Up next; Edit is disabled while it runs", async () => {
    const d = deferred<unknown>();
    m.approveThemesAction.mockReturnValue(d.promise);
    render(<ThemeList themes={[th("Forest Nook", "pending", 9), th("Forest Two", "pending", 10), th("Boho", "available", 1)]} previews={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve Forest Nook" }));
    const upNext = screen.getByRole("heading", { name: /Up next · 2 left/ }).parentElement!;
    const items = within(upNext).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[1]).toContain("Forest Nook");
    expect(m.approveThemesAction).toHaveBeenCalledWith(["Forest Nook"]);
    await act(async () => { d.resolve({ ok: true, count: 1 }); });
  });

  it("Edit on a pending theme is disabled while its own action is in flight", async () => {
    const d = deferred<unknown>();
    m.makePreviewAction.mockReturnValue(d.promise);
    render(<ThemeList themes={[th("Forest Nook", "pending", 9)]} previews={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Make a preview of Forest Nook" }));
    expect((screen.getByRole("button", { name: "Edit Forest Nook" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { d.resolve({ ok: true, cardId: "c" }); });
    expect((screen.getByRole("button", { name: "Edit Forest Nook" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed reject puts the theme back", async () => {
    m.rejectThemesAction.mockResolvedValue({ ok: false, error: "nope" });
    render(<ThemeList themes={[th("Forest Nook", "pending", 9)]} previews={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject Forest Nook" }));
    await waitFor(() => expect(m.rejectThemesAction).toHaveBeenCalledWith(["Forest Nook"]));
    await waitFor(() => expect(screen.getByText("Forest Nook")).toBeTruthy());
  });

  it("Suggest with AI defaults to the gender being viewed", async () => {
    m.suggestThemesAction.mockResolvedValue({ ok: true, added: 3, duplicates: 0, invalid: 0 });
    render(<ThemeList themes={[]} previews={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: "Girl themes" }));
    fireEvent.click(screen.getByRole("button", { name: /Suggest with AI/ }));
    const dlg = await screen.findByRole("dialog", { name: "Suggest themes with AI" });
    fireEvent.click(within(dlg).getByRole("button", { name: /Suggest 5 themes/ }));
    await waitFor(() => expect(m.suggestThemesAction).toHaveBeenCalledWith({ gender: "girl", count: 5, vibe: undefined }));
    expect(await within(dlg).findByText("Added 3 suggestions.")).toBeTruthy();
  });
});
