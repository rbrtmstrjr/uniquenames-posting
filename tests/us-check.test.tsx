// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NameRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

const preview = vi.fn();
const apply = vi.fn();
vi.mock("@/lib/actions/names", () => ({
  addNamesAction: vi.fn(), updateNameAction: vi.fn(), setSkipAction: vi.fn(), deleteNameAction: vi.fn(), approveNamesAction: vi.fn(), rejectNamesAction: vi.fn(),
  setNameCategoryAction: vi.fn(), usCheckPreviewAction: (...a: unknown[]) => preview(...a), usCheckApplyAction: (...a: unknown[]) => apply(...a),
}));
vi.mock("@/lib/actions/suggest", () => ({ suggestNamesAction: vi.fn() }));
const { UsCheck } = await import("@/components/names/us-check");
const { NamesTable } = await import("@/components/names/names-table");

beforeAll(polyfillRadix);
afterEach(() => { cleanup(); preview.mockReset(); apply.mockReset(); });

const open = () => fireEvent.click(screen.getByRole("button", { name: "Check names against the US list" }));

describe("UsCheck", () => {
  it("previews, then skips on confirm", async () => {
    preview.mockResolvedValue({ ok: true, skip: 12, checked: 300 });
    apply.mockResolvedValue({ ok: true, skipped: 12 });
    render(<UsCheck />);
    open();
    expect(await screen.findByText("12 names aren't US names (300 checked). Skip them?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip them" }));
    expect(await screen.findByText("12 names skipped.")).toBeTruthy();
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("Cancel closes the confirm without applying", async () => {
    preview.mockResolvedValue({ ok: true, skip: 3, checked: 10 });
    render(<UsCheck />);
    open();
    await screen.findByText(/aren't US names/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/aren't US names/)).toBeNull());
    expect(apply).not.toHaveBeenCalled();
  });
  it("says so when nothing needs skipping", async () => {
    preview.mockResolvedValue({ ok: true, skip: 0, checked: 40 });
    render(<UsCheck />);
    open();
    expect(await screen.findByText("Every available and pending name is a US name.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip them" })).toBeNull();
  });
  it("one name: singular wording", async () => {
    preview.mockResolvedValue({ ok: true, skip: 1, checked: 300 });
    apply.mockResolvedValue({ ok: true, skipped: 1 });
    render(<UsCheck />);
    open();
    expect(await screen.findByText("1 name isn't a US name (300 checked). Skip it?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip it" }));
    expect(await screen.findByText("1 name skipped.")).toBeTruthy();
  });
});

const now = "2026-10-05T00:00:00Z";
const row = (name: string): NameRow =>
  ({ id: name, name, meaning: "m", gender: "girl", style: "single", status: "available", post_id: null, position: null, created_at: now, updated_at: now });

describe("NamesTable US rank", () => {
  it("shows the rank, or says the name is not on the list (ranks keyed by row id)", () => {
    render(<NamesTable names={[row("Vivienne"), row("Sakura")]} usRanks={{ Vivienne: 172, Sakura: null }} />);
    expect(screen.getByText("US #172")).toBeTruthy();
    expect(screen.getByText("Not on the US list")).toBeTruthy();
  });
  it("a top-100 name says it is too common (100 is, 101 is not)", () => {
    render(<NamesTable names={[row("Olivia"), row("Margot"), row("Willa")]} usRanks={{ Olivia: 5, Margot: 100, Willa: 101 }} />);
    expect(screen.getByText("US #5 · too common")).toBeTruthy();
    expect(screen.getByText("US #100 · too common")).toBeTruthy();
    expect(screen.getByText("US #101")).toBeTruthy();
  });
  it("shows nothing when no ranks are passed", () => {
    render(<NamesTable names={[row("Vivienne")]} />);
    expect(screen.queryByText(/US #/)).toBeNull();
  });
});
