// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TEXT_SETTINGS_DEFAULTS, type NameRow, type SettingsRow, type ThemeRow } from "@/lib/db/types";
import { azCoverage, AZ_LETTERS } from "@/lib/series/az";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let health = "ready";
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health, lastSeen: "now", row: null }) }));
vi.mock("@/lib/actions/posts", () => ({ createPostAction: vi.fn() }));
vi.mock("@/lib/actions/series", () => ({ createAzSeriesAction: vi.fn(async () => ({ ok: true, postIds: ["a", "b"] })) }));
vi.mock("@/lib/actions/suggest", () => ({ fillMissingLettersAction: vi.fn(async () => ({ ok: true, added: 4, letters: [{ letter: "D", added: 3 }, { letter: "Q", added: 1 }], short: ["Q"] })), suggestNamesAction: vi.fn() }));
vi.mock("@/lib/actions/names", () => ({ addNamesAction: vi.fn(), updateNameAction: vi.fn(), setSkipAction: vi.fn(), deleteNameAction: vi.fn(), approveNamesAction: vi.fn(), rejectNamesAction: vi.fn() }));
vi.mock("@/lib/actions/call", () => ({ callAction: vi.fn(async (fn: () => Promise<unknown>) => fn()), optimistic: vi.fn(async () => ({ ok: true })) }));
const { NewPostPanel } = await import("@/components/today/new-post-panel");
const { NamesTable } = await import("@/components/names/names-table");
const { namesFilterFromParams } = await import("@/lib/names/filter");
const { createAzSeriesAction } = await import("@/lib/actions/series");
const { fillMissingLettersAction } = await import("@/lib/actions/suggest");

beforeAll(() => {
  polyfillRadix();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T02:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => { vi.mocked(createAzSeriesAction).mockClear(); vi.mocked(fillMissingLettersAction).mockClear(); });
afterEach(() => { cleanup(); health = "ready"; });

const settings = { id: 1, caption_template: "x", hashtags: "", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, updated_at: "" } satisfies SettingsRow;
const theme: ThemeRow = { id: "t1", title: "Pumpkin Patch", gender: "boy", backdrop: "rust backdrop", outfit: "romper", props: "pumpkins", lighting: "warm", palette: "rust",
  status: "available", sort_order: 0, used_on: null, preview_card_id: null, created_at: "", updated_at: "" };
const stock = [{ gender: "boy" as const, style: "single" as const, count: 30 }];
const full = azCoverage(AZ_LETTERS.map((l) => ({ name: `${l}ven`, status: "available" })));
const gaps = azCoverage([...AZ_LETTERS.filter((l) => l !== "D" && l !== "Q").map((l) => ({ name: `${l}ven`, status: "available" })), { name: "Dax", status: "pending" }]);
const az = (boy = full, ready = true) => ({ ready, coverage: { boy, girl: full } });
const panel = (o: { az?: ReturnType<typeof az> } = {}) => render(<NewPostPanel settings={settings} themes={[theme]} stock={stock} busy={false} az={o.az} />);
const goAz = () => fireEvent.click(screen.getByRole("radio", { name: "A–Z series" }));

describe("Today: the A–Z series option", () => {
  it("is hidden before migration 011 (or without the data)", () => {
    panel();
    expect(screen.queryByRole("radiogroup", { name: "Post type" })).toBeNull();
    cleanup();
    panel({ az: az(full, false) });
    expect(screen.queryByRole("radiogroup", { name: "Post type" })).toBeNull();
    expect(screen.getByRole("button", { name: /Generate post/ })).toBeTruthy();
  });

  it("A–Z mode: single names, a 26-letter strip in two parts, and Make A–Z with the usual choices", async () => {
    panel({ az: az() });
    goAz();
    expect(screen.getByText("Single names")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Number of cards" })).toBeNull();
    const strip = screen.getByRole("group", { name: "A to Z letters for boy single names" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(26);
    expect(within(strip).getByRole("list", { name: "Part 1: A to M" })).toBeTruthy();
    expect(screen.getByTestId("post-summary").textContent).toBe("A–Z · 2 posts (13 + 13 cards) · Boy · Single · Random ages · Pumpkin Patch");
    const make = screen.getByRole("button", { name: /Make A–Z \(2 posts\)/ }) as HTMLButtonElement;
    expect(make.disabled).toBe(false);
    fireEvent.click(make);
    await vi.waitFor(() => expect(vi.mocked(createAzSeriesAction)).toHaveBeenCalled());
    expect(vi.mocked(createAzSeriesAction).mock.calls[0][0]).toMatchObject({ gender: "boy", postDate: "2026-10-09", themeId: "t1", subjectAge: "random", fonts: { title_font: "poppins" } });
    expect(vi.mocked(createAzSeriesAction).mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("missing letters are amber, block Make A–Z with the letters, and Fill missing letters asks Gemini", async () => {
    panel({ az: az(gaps) });
    goAz();
    const strip = screen.getByRole("group", { name: "A to Z letters for boy single names" });
    expect(within(strip).getByRole("listitem", { name: "D: none available, 1 waiting for approval" }).getAttribute("data-state")).toBe("missing");
    expect(within(strip).getByRole("listitem", { name: "Q: none available" }).getAttribute("data-state")).toBe("missing");
    expect(within(strip).getByRole("listitem", { name: "A: 1 available" }).getAttribute("data-state")).toBe("ok");
    expect((screen.getByRole("button", { name: /Make A–Z/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No boy name yet for D, Q\. Fill the missing letters/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review 1 name waiting" }).getAttribute("href")).toBe("/names?status=pending&gender=boy&style=single");
    fireEvent.click(screen.getByRole("button", { name: /Fill missing letters/ }));
    await vi.waitFor(() => expect(vi.mocked(fillMissingLettersAction)).toHaveBeenCalledWith({ gender: "boy" }));
  });

  it("the PC lock still comes first", () => {
    health = "offline";
    panel({ az: az() });
    goAz();
    expect((screen.getByRole("button", { name: /Make A–Z/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Your PC is offline — turn it on to generate")).toBeTruthy();
  });
});

describe("Names page: a filtered view per letter", () => {
  const row = (name: string, status: NameRow["status"], gender: NameRow["gender"] = "boy"): NameRow =>
    ({ id: name, name, meaning: "a meaning", gender, style: "single", status, post_id: null, position: null, created_at: "", updated_at: "" });

  it("reads the filters from the URL, ignoring anything unknown", () => {
    expect(namesFilterFromParams({ status: "pending", gender: "boy", style: "single", letter: "q" })).toEqual({ status: "pending", gender: "boy", style: "single", letter: "Q" });
    expect(namesFilterFromParams({ status: "nope", gender: "x", letter: "7" })).toEqual({ status: undefined, gender: undefined, style: undefined, letter: undefined });
  });

  it("opens on the pending names of one letter; Approve all covers only those", () => {
    render(<NamesTable names={[row("Quentin", "pending"), row("Quincy", "pending"), row("Dax", "pending"), row("Quinn", "pending", "girl"), row("Quade", "available")]}
      initial={{ status: "pending", gender: "boy", style: "single", letter: "Q" }} />);
    expect(screen.getByText("Quentin")).toBeTruthy();
    expect(screen.getByText("Quincy")).toBeTruthy();
    expect(screen.queryByText("Dax")).toBeNull();
    expect(screen.queryByText("Quinn")).toBeNull();
    expect(screen.queryByText("Quade")).toBeNull();
    expect(screen.getByRole("button", { name: /Approve all \(2\)/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "First letter" }).textContent).toContain("Starts with Q");
  });
});
