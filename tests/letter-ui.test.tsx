// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TEXT_SETTINGS_DEFAULTS, type NameRow, type SettingsRow, type ThemeRow } from "@/lib/db/types";
import { AZ_LETTERS } from "@/lib/series/az";
import { letterCounts, type LetterStock } from "@/lib/series/letter";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let health = "ready";
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health, lastSeen: "now", row: null }) }));
vi.mock("@/lib/actions/posts", () => ({ createPostAction: vi.fn(async () => ({ ok: true, postId: "p1" })) }));
vi.mock("@/lib/actions/suggest", () => ({
  letterNameIdeasAction: vi.fn(async () => ({ ok: true, ideas: [{ name: "Quentin", meaning: "the fifth born" }, { name: "Quillon", meaning: "the sword guard" }, { name: "Quade", meaning: "son of the fourth" }] })),
  suggestNamesAction: vi.fn(),
}));
vi.mock("@/lib/actions/names", () => ({ addNamesAction: vi.fn(async () => ({ ok: true, added: 2, skipped: [] })), updateNameAction: vi.fn(), setSkipAction: vi.fn(), deleteNameAction: vi.fn(), approveNamesAction: vi.fn(), rejectNamesAction: vi.fn() }));
vi.mock("@/lib/actions/call", () => ({ callAction: vi.fn(async (fn: () => Promise<unknown>) => fn()), optimistic: vi.fn(async () => ({ ok: true })) }));
const { NewPostPanel } = await import("@/components/today/new-post-panel");
const { NamesTable } = await import("@/components/names/names-table");
const { namesFilterFromParams } = await import("@/lib/names/filter");
const { createPostAction } = await import("@/lib/actions/posts");
const { letterNameIdeasAction } = await import("@/lib/actions/suggest");
const { addNamesAction } = await import("@/lib/actions/names");

beforeAll(() => {
  polyfillRadix();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T02:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => { vi.mocked(createPostAction).mockClear(); vi.mocked(letterNameIdeasAction).mockClear(); vi.mocked(addNamesAction).mockClear(); });
afterEach(() => { cleanup(); health = "ready"; });

const settings = { id: 1, caption_template: "x", hashtags: "", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, updated_at: "" } satisfies SettingsRow;
const theme: ThemeRow = { id: "t1", title: "Pumpkin Patch", gender: "boy", backdrop: "rust backdrop", outfit: "romper", props: "pumpkins", lighting: "warm", palette: "rust",
  status: "available", sort_order: 0, used_on: null, preview_card_id: null, created_at: "", updated_at: "" };
const stock = [{ gender: "boy" as const, style: "two-word" as const, count: 40 }, { gender: "boy" as const, style: "single" as const, count: 40 }];
// Boy single: 12 K names, 7 Q names, one name on every other letter. Boy two-word: 9 A names.
const many = (l: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `${l}${"abcdefghijklm"[i]}ven` }));
const letters = {
  "boy|single": letterCounts([...many("K", 12), ...many("Q", 7), ...AZ_LETTERS.filter((l) => l !== "K" && l !== "Q").map((l) => ({ name: `${l}ven` }))]),
  "boy|two-word": letterCounts(many("A", 9)),
  "girl|single": letterCounts([]), "girl|two-word": letterCounts([]),
} satisfies LetterStock;
const panel = (o: { letters?: LetterStock } = { letters }) => render(<NewPostPanel settings={settings} themes={[theme]} stock={stock} busy={false} letters={o.letters} />);
const byLetter = () => fireEvent.click(screen.getByRole("radio", { name: "By letter" }));
const single = () => fireEvent.click(within(screen.getByRole("radiogroup", { name: "Name style" })).getByRole("radio", { name: "Single" }));
const tiles = () => screen.getByRole("group", { name: /^Letters for boy/ });
const pickCount = (n: string) => fireEvent.click(within(screen.getByRole("radiogroup", { name: "Number of cards" })).getByRole("radio", { name: n }));

describe("Today: posts by letter", () => {
  it("without the letter data there is no Post type choice (and no A–Z series anywhere)", () => {
    panel({});
    expect(screen.queryByRole("radiogroup", { name: "Post type" })).toBeNull();
    cleanup();
    panel();
    expect(screen.queryByRole("radio", { name: "A–Z series" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Normal post" })).toBeTruthy();
  });

  it("By letter: 26 letter buttons with their counts for the chosen style; picking one makes it the post's letter", () => {
    panel();
    byLetter();
    expect(screen.getByRole("radiogroup", { name: "Number of cards" })).toBeTruthy();
    expect(within(tiles()).getAllByRole("button")).toHaveLength(26);
    // Two-word (the default style here): 9 A names, enough for Auto (9).
    expect(within(tiles()).getByRole("button", { name: "A: 9 available" }).getAttribute("data-state")).toBe("ok");
    const gen = () => screen.getByRole("button", { name: /Generate/ }) as HTMLButtonElement;
    expect(gen().disabled).toBe(true);
    expect(screen.getByText("Pick a letter.")).toBeTruthy();
    single();
    pickCount("10");
    const k = within(tiles()).getByRole("button", { name: "K: 12 available" });
    expect(k.getAttribute("data-state")).toBe("ok");
    expect(k.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(k);
    expect(k.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("post-summary").textContent).toBe("10 cards · names starting with K · Boy · Single · Random ages · Pumpkin Patch");
    expect(gen().textContent).toContain("Generate K post");
    expect(gen().disabled).toBe(false);
  });

  it("Generate K post sends the letter with the usual choices", async () => {
    panel();
    byLetter();
    single();
    pickCount("10");
    fireEvent.click(within(tiles()).getByRole("button", { name: "K: 12 available" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate K post/ }));
    await vi.waitFor(() => expect(vi.mocked(createPostAction)).toHaveBeenCalled());
    expect(vi.mocked(createPostAction).mock.calls[0][0]).toMatchObject({ gender: "boy", style: "single", count: 10, letter: "K", themeId: "t1", subjectAge: "random", postDate: "2026-10-09" });
  });

  it("a normal post sends no letter", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Generate post/ }));
    await vi.waitFor(() => expect(vi.mocked(createPostAction)).toHaveBeenCalled());
    expect(vi.mocked(createPostAction).mock.calls[0][0]).not.toHaveProperty("letter");
  });

  it("a short letter is amber, blocks Generate, and Suggest with AI adds the ticked names as available", async () => {
    panel();
    byLetter();
    single();
    pickCount("10");
    const q = within(tiles()).getByRole("button", { name: "Q: 7 available, 3 short" });
    expect(q.getAttribute("data-state")).toBe("short");
    fireEvent.click(q);
    expect((screen.getByRole("button", { name: /Generate Q post/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Need 3 more Q names")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Suggest with AI/ }));
    await vi.waitFor(() => expect(vi.mocked(letterNameIdeasAction)).toHaveBeenCalledWith({ gender: "boy", style: "single", letter: "Q", count: 6 }));
    const list = await screen.findByRole("list", { name: "Q name ideas" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(3);
    const add = () => screen.getByRole("button", { name: /^Add/ }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    fireEvent.click(within(list).getByRole("checkbox", { name: /Quentin/ }));
    fireEvent.click(within(list).getByRole("checkbox", { name: /Quade/ }));
    expect(add().textContent).toContain("Add 2 names");
    fireEvent.click(add());
    await vi.waitFor(() => expect(vi.mocked(addNamesAction)).toHaveBeenCalled());
    expect(vi.mocked(addNamesAction).mock.calls[0][0]).toEqual([
      { name: "Quentin", meaning: "the fifth born", gender: "boy", style: "single" },
      { name: "Quade", meaning: "son of the fourth", gender: "boy", style: "single" },
    ]);
  });

  it("the PC lock still comes first", () => {
    health = "offline";
    panel();
    byLetter();
    fireEvent.click(within(tiles()).getByRole("button", { name: /^A: / }));
    expect((screen.getByRole("button", { name: /Generate A post/ }) as HTMLButtonElement).disabled).toBe(true);
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
