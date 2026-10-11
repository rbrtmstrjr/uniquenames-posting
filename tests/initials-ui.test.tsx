// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TEXT_SETTINGS_DEFAULTS, type SettingsRow, type ThemeRow } from "@/lib/db/types";
import { initialsCounts, type InitialsStock } from "@/lib/series/initials";
import { letterCounts, type LetterStock } from "@/lib/series/letter";
import { polyfillRadix } from "./helpers/radix-jsdom";

// Today > Initials: the two tile rows, the plan preview (sources + names), Shuffle, and Generate A·R post.
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let health = "ready";
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health, lastSeen: "now", row: null }) }));
vi.mock("@/lib/actions/posts", () => ({ createPostAction: vi.fn(async () => ({ ok: true, postId: "p1" })) }));
vi.mock("@/lib/actions/suggest", () => ({ letterNameIdeasAction: vi.fn() }));
vi.mock("@/lib/actions/names", () => ({ addNamesAction: vi.fn() }));
vi.mock("@/lib/actions/call", () => ({ callAction: vi.fn(async (fn: () => Promise<unknown>) => fn()), optimistic: vi.fn() }));
const fresh = [{ name: "Asher Rowan", meaning: "happy little tree" }, { name: "Axel Reid", meaning: "father of peace" }];
const planResult = (over: Record<string, unknown> = {}) => ({
  ok: true as const, initials: "AR", want: 9, short: 0, reuse: true, aiNote: null, fresh, counts: { available: 2, new: 2, used: 5 }, summary: "2 unused · 2 new AI · 5 reused",
  names: [
    { source: "available", name: "Arlo Reed", meaning: "eagle and red" }, { source: "available", name: "Ansel Roan", meaning: "noble and red" },
    { source: "new", name: "Asher Rowan", meaning: "happy little tree" }, { source: "new", name: "Axel Reid", meaning: "father of peace" },
    ...["Amos Rhett", "Abel Ross", "Ari Rune", "Avi Reese", "Asa Rey"].map((name) => ({ source: "used", name, meaning: "kind meaning" })),
  ],
  ...over,
});
const planInitialsAction = vi.fn(async (..._a: unknown[]) => planResult());
const createInitialsPostAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, postId: "p2", cards: 9, short: 0 }));
vi.mock("@/lib/actions/initials", () => ({ planInitialsAction, createInitialsPostAction }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));
const { NewPostPanel } = await import("@/components/today/new-post-panel");

beforeAll(() => {
  polyfillRadix();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T02:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => { planInitialsAction.mockClear(); createInitialsPostAction.mockClear(); toast.success.mockClear(); planInitialsAction.mockImplementation(async () => planResult()); });
afterEach(() => { cleanup(); health = "ready"; });

const settings = { id: 1, caption_template: "x", hashtags: "", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, updated_at: "" } satisfies SettingsRow;
const theme: ThemeRow = { id: "t1", title: "Pumpkin Patch", gender: "boy", backdrop: "rust backdrop", outfit: "romper", props: "pumpkins", lighting: "warm", palette: "rust",
  status: "available", sort_order: 0, used_on: null, preview_card_id: null, created_at: "", updated_at: "" };
const stock = [{ gender: "boy" as const, style: "two-word" as const, count: 40 }, { gender: "boy" as const, style: "single" as const, count: 40 }];
const letters = { "boy|single": letterCounts([]), "boy|two-word": letterCounts([]), "girl|single": letterCounts([]), "girl|two-word": letterCounts([]) } satisfies LetterStock;
const initials: InitialsStock = { boy: initialsCounts([{ name: "Arlo Reed" }, { name: "Ansel Roan" }, { name: "Axel Jude" }]), girl: {} };
const panel = (o: { initials?: InitialsStock } = { initials }) => render(<NewPostPanel settings={settings} themes={[theme]} stock={stock} busy={false} letters={letters} initials={o.initials} />);
const byInitials = () => fireEvent.click(screen.getByRole("radio", { name: "Initials" }));
const firstRow = () => screen.getByRole("group", { name: "First initial for boy names" });
const secondRow = () => screen.getByRole("group", { name: "Middle initial for boy names" });
const gen = () => screen.getByRole("button", { name: /Generate/ }) as HTMLButtonElement;
const pause = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function pickAR() {
  fireEvent.click(within(firstRow()).getByRole("button", { name: "A: 3 unused" }));
  fireEvent.click(within(secondRow()).getByRole("button", { name: "A·R: 2 unused" }));
  await pause(300);
}

describe("Today: posts by initials", () => {
  it("no Initials option without the initials data", () => {
    panel({});
    expect(screen.queryByRole("radio", { name: "Initials" })).toBeNull();
  });

  it("two rows of 26 tiles, two-word only; Generate waits for both initials", () => {
    panel();
    byInitials();
    expect(within(firstRow()).getAllByRole("button")).toHaveLength(26);
    expect(within(secondRow()).getAllByRole("button")).toHaveLength(26);
    expect(screen.queryByRole("radiogroup", { name: "Name style" })).toBeNull();
    expect(screen.getByText("Two-word")).toBeTruthy();
    expect(gen().disabled).toBe(true);
    expect(screen.getByText("Pick both initials.")).toBeTruthy();
    fireEvent.click(within(firstRow()).getByRole("button", { name: "A: 3 unused" }));
    expect(within(secondRow()).getByRole("button", { name: "A·R: 2 unused" }).getAttribute("data-state")).toBe("short");
    expect(within(secondRow()).getByRole("button", { name: "A·J: 1 unused" })).toBeTruthy();
  });

  it("both initials: the plan preview (sources + names), then Generate A·R post with the shown AI names", async () => {
    panel();
    byInitials();
    await pickAR();
    expect(planInitialsAction).toHaveBeenCalledTimes(1);
    expect(planInitialsAction.mock.calls[0][0]).toMatchObject({ gender: "boy", first: "A", second: "R", count: null, postDate: "2026-10-11" });
    expect(screen.getByTestId("initials-summary").textContent).toBe("2 unused · 2 new AI · 5 reused");
    const list = screen.getByRole("list", { name: "Planned names" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Arlo Reedeagle and redunused", "Ansel Roannoble and redunused", "Asher Rowanhappy little treenew AI", "Axel Reidfather of peacenew AI",
      "Amos Rhettkind meaningreused", "Abel Rosskind meaningreused", "Ari Runekind meaningreused", "Avi Reesekind meaningreused", "Asa Reykind meaningreused",
    ]);
    expect(screen.getByTestId("post-summary").textContent).toBe("9–13 cards · initials A·R · Boy · Two-word · Random ages · Pumpkin Patch");
    expect(gen().textContent).toContain("Generate A·R post");
    expect(gen().disabled).toBe(false);
    await act(async () => { fireEvent.click(gen()); });
    expect(createInitialsPostAction).toHaveBeenCalledTimes(1);
    const sent = createInitialsPostAction.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ gender: "boy", first: "A", second: "R", count: null, themeId: "t1", subjectAge: "random", fresh });
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(toast.success).toHaveBeenCalledWith("A·R post queued. Cards will appear as they are made.");
  });

  it("Shuffle asks again, skipping the AI names shown; a count change keeps them", async () => {
    panel();
    byInitials();
    await pickAR();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Shuffle/ })); });
    expect(planInitialsAction.mock.calls[1][0]).toMatchObject({ skip: ["Asher Rowan", "Axel Reid"] });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Number of cards" })).getByRole("radio", { name: "11" }));
    await pause(300);
    expect(planInitialsAction.mock.calls[2][0]).toMatchObject({ count: 11, keep: fresh, skip: ["Asher Rowan", "Axel Reid"] });
  });

  it("a short plan says how many cards the post will have; an AI failure is explained", async () => {
    planInitialsAction.mockImplementation(async () => planResult({ short: 6, want: 9, aiNote: "down. Using your unused and earlier names instead.",
      names: [{ source: "available", name: "Xavi Quinn", meaning: "new house wise" }, { source: "used", name: "Xeno Quill", meaning: "kind stranger" }, { source: "used", name: "Xan Quade", meaning: "the fourth" }],
      counts: { available: 1, new: 0, used: 2 }, summary: "1 unused · 0 new AI · 2 reused" }));
    panel();
    byInitials();
    await pickAR();
    expect(screen.getByText("Only 3 of 9 names: the post will have 3 cards.")).toBeTruthy();
    expect(screen.getByText("down. Using your unused and earlier names instead.")).toBeTruthy();
    expect(gen().disabled).toBe(false);
  });

  it("the PC lock still comes first", async () => {
    health = "offline";
    panel();
    byInitials();
    await pickAR();
    expect(gen().disabled).toBe(true);
    expect(screen.getByText("Your PC is offline — turn it on to generate")).toBeTruthy();
  });
});
