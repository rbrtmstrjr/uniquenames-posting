// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ExportLogRow, NameRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

// Names > Export PDF (dialog, sorting progress, password shown once), Past exports and a name's meaning group.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }), usePathname: () => "/names" }));
const m = vi.hoisted(() => ({ sortNamesAction: vi.fn(), revealExportPasswordAction: vi.fn(), setNameCategoryAction: vi.fn() }));
vi.mock("@/lib/actions/names-pdf", () => ({ sortNamesAction: m.sortNamesAction, revealExportPasswordAction: m.revealExportPasswordAction }));
vi.mock("@/lib/actions/names", () => ({
  addNamesAction: vi.fn(), updateNameAction: vi.fn(), setSkipAction: vi.fn(), deleteNameAction: vi.fn(), approveNamesAction: vi.fn(), rejectNamesAction: vi.fn(),
  setNameCategoryAction: m.setNameCategoryAction,
}));
vi.mock("@/lib/actions/suggest", () => ({ suggestNamesAction: vi.fn() }));
const { ExportPdf } = await import("@/components/names/export-pdf");
const { PastExports } = await import("@/components/names/past-exports");
const { NamesTable } = await import("@/components/names/names-table");

beforeAll(polyfillRadix);
afterEach(cleanup);
const writeText = vi.fn(async () => {});
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  refresh.mockReset();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
});

const now = "2026-10-05T00:00:00Z";
const nm = (name: string, o: Partial<NameRow> = {}): NameRow => ({
  id: name, name, meaning: "a meaning", gender: "girl", style: name.includes(" ") ? "two-word" : "single", status: "available",
  post_id: null, position: null, created_at: now, updated_at: now, meaning_category: "love", ...o,
});
const NAMES = [nm("Wren"), nm("Isla Fern"), nm("Luna", { status: "used", meaning_category: null }), nm("Ezra", { gender: "boy" }),
  nm("Pending", { status: "pending", meaning_category: null }), nm("Skip", { status: "skip" })];

const pdfResponse = (headers: Record<string, string> = {}) => new Response(new Blob(["%PDF-1.7"]), {
  status: 200, headers: { "Content-Type": "application/pdf", "X-Export-Password": "Kp7m-Xr4d-Tq9w", "X-Export-File": "unique-names-girl-names-2026-10-11-abc123.pdf",
    "X-Export-Count": "3", "X-Export-Pages": "9", "X-Export-Logged": "1", ...headers },
});
const open = () => fireEvent.click(screen.getByRole("button", { name: /Export PDF/ }));
const buyer = (v: string) => fireEvent.change(screen.getByPlaceholderText(/Maria Santos/), { target: { value: v } });
const create = () => screen.getByRole("button", { name: /Create PDF/ });

describe("Export PDF dialog", () => {
  it("previews what goes in per pick (approved names only) and needs a buyer", () => {
    render(<ExportPdf names={NAMES} canSort />);
    open();
    const what = screen.getByLabelText("What goes in");
    expect(within(what).getByText("Girl")).toBeTruthy();
    expect(what.textContent).toContain("Single 2");
    expect(what.textContent).toContain("Combo 1");
    expect(what.textContent).toContain("3 names in all");
    expect(what.textContent).toContain("1 names are not sorted by meaning yet");
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    expect(screen.getByLabelText("What goes in").textContent).toContain("4 names in all");
    expect((create() as HTMLButtonElement).disabled).toBe(true);
    buyer("Jane Doe");
    expect((create() as HTMLButtonElement).disabled).toBe(false);
  });

  it("sorts first (with progress), makes the PDF, downloads it and shows its password once", async () => {
    m.sortNamesAction.mockResolvedValueOnce({ ok: true, sorted: 1, remaining: 0 });
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<ExportPdf names={NAMES} canSort />);
    open();
    buyer("  Jane Doe ");
    fireEvent.click(create());
    await screen.findByText("Kp7m-Xr4d-Tq9w");
    expect(m.sortNamesAction).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/names/export", expect.objectContaining({ method: "POST", body: JSON.stringify({ buyer: "Jane Doe", gender: "girl" }) }));
    expect(screen.getByText(/Shown once/).textContent).toContain("kept in Past exports");
    expect(screen.getByText(/unique-names-girl-names/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Copy password/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Kp7m-Xr4d-Tq9w"));
    // closed and opened again: the password is gone
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    open();
    expect(screen.queryByText("Kp7m-Xr4d-Tq9w")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("no sorting step when every name has its group or before migration 018; shows the server's warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pdfResponse({ "X-Export-Logged": "0", "X-Export-Warning": encodeURIComponent("Run migration 018 first.") })));
    render(<ExportPdf names={NAMES.map(({ meaning_category: _m, ...n }) => n)} canSort={false} />);
    open();
    buyer("Jane");
    fireEvent.click(create());
    expect((await screen.findByRole("alert")).textContent).toBe("Run migration 018 first.");
    expect(m.sortNamesAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Shown once/).textContent).not.toContain("Past exports");
    vi.unstubAllGlobals();
  });

  it("shows why it failed (sorting or the server) and keeps the form", async () => {
    m.sortNamesAction.mockResolvedValueOnce({ ok: false, error: "Gemini error 429." });
    render(<ExportPdf names={NAMES} canSort />);
    open();
    buyer("Jane");
    fireEvent.click(create());
    expect((await screen.findByRole("alert")).textContent).toBe("Sorting names by meaning stopped: Gemini error 429.");
    m.sortNamesAction.mockResolvedValueOnce({ ok: true, sorted: 0, remaining: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "There are no approved girl names yet." }, { status: 422 })));
    fireEvent.click(create());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("There are no approved girl names yet."));
    expect(create()).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("Past exports", () => {
  const rows: ExportLogRow[] = [{ id: "e1", created_at: now, buyer: "Jane Doe", gender: "both", name_count: 312, file_name: "x.pdf", pack: "unique-names" }];
  it("before migration 018 says how to add the log", () => {
    render(<PastExports exports={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Past exports/ }));
    expect(screen.getByText(/018_names_pdf\.sql/)).toBeTruthy();
  });
  it("lists exports and reveals a password on demand", async () => {
    m.revealExportPasswordAction.mockResolvedValueOnce({ ok: true, password: "Ab3d-Ef4h-Jk5m" });
    render(<PastExports exports={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Past exports (1)" }));
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText(/Girl & Boy · 312 names · x\.pdf/)).toBeTruthy();
    expect(screen.queryByText("Ab3d-Ef4h-Jk5m")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the password for Jane Doe" }));
    expect(await screen.findByText("Ab3d-Ef4h-Jk5m")).toBeTruthy();
    expect(m.revealExportPasswordAction).toHaveBeenCalledWith("e1");
  });
});

describe("Names: a name's meaning group", () => {
  it("approved names get a group select (after 018); picking one saves it", async () => {
    m.setNameCategoryAction.mockResolvedValue({ ok: true });
    render(<NamesTable names={NAMES} initial={{ status: "all" }} />);
    expect(screen.getByRole("combobox", { name: "Meaning group of Wren" }).textContent).toContain("Love & Joy");
    expect(screen.getByRole("combobox", { name: "Meaning group of Luna" }).textContent).toContain("Not sorted");
    expect(screen.queryByRole("combobox", { name: "Meaning group of Pending" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Meaning group of Skip" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Meaning group of Wren" }), { key: "ArrowDown" });
    fireEvent.keyDown(within(screen.getByRole("listbox")).getByRole("option", { name: "Royal & Noble" }), { key: "Enter" });
    await waitFor(() => expect(m.setNameCategoryAction).toHaveBeenCalledWith("Wren", "royal"));
    expect(screen.getByRole("combobox", { name: "Meaning group of Wren" }).textContent).toContain("Royal & Noble");
  });

  it("no select before migration 018 (rows without the column)", () => {
    render(<NamesTable names={NAMES.map(({ meaning_category: _m, ...n }) => n)} initial={{ status: "all" }} />);
    expect(screen.queryByRole("combobox", { name: /Meaning group of/ })).toBeNull();
  });
});
