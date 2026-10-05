// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TEXT_SETTINGS_DEFAULTS, type SettingsRow, type ThemeRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let health = "ready";
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health, lastSeen: "now", row: null }) }));
vi.mock("@/lib/actions/posts", () => ({ createPostAction: vi.fn() }));
vi.mock("@/lib/actions/call", () => ({ callAction: vi.fn(async () => ({ ok: true })) }));
const { NewPostPanel } = await import("@/components/today/new-post-panel");

beforeAll(() => {
  polyfillRadix();
  // 10:00 in Manila on Mon 5 Oct 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T02:00:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => { cleanup(); health = "ready"; });

const settings = { id: 1, caption_template: "x", hashtags: "", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, updated_at: "" } satisfies SettingsRow;
const theme = (id: string, title: string, gender: "boy" | "girl" = "boy"): ThemeRow => ({
  id, title, gender, backdrop: "sage backdrop", outfit: "romper", props: "basket", lighting: "warm", palette: "rust",
  status: "queued" as ThemeRow["status"], sort_order: 0, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
});
const stock = (count: number) => [{ gender: "boy" as const, style: "two-word" as const, count }];
const generateButton = () => screen.getByRole("button", { name: /Generate post/ });

describe("NewPostPanel (shadcn controls)", () => {
  it("has no native select or date input", () => {
    const { container } = render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    expect(container.querySelector("select, input[type=date]")).toBeNull();
  });

  it("theme Select shows the next theme with (next) and can pick another by keyboard", () => {
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest"), theme("b", "Ocean Blue")]} stock={stock(50)} busy={false} />);
    const trigger = screen.getByRole("combobox", { name: "Theme" });
    expect(trigger.textContent).toContain("Autumn Harvest (next)");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Autumn Harvest (next)", "Ocean Blue"]);
    fireEvent.keyDown(within(listbox).getByRole("option", { name: "Ocean Blue" }), { key: "Enter" });
    expect(screen.getByRole("combobox", { name: "Theme" }).textContent).toContain("Ocean Blue");
  });

  it("date picker defaults to Manila today, shows 'Mon, Oct 5' and picks a new day", () => {
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    const trigger = screen.getByRole("button", { name: "Post date: Mon, Oct 5" });
    expect(screen.getByRole("heading", { name: "New post" })).toBeTruthy();
    fireEvent.click(trigger);
    const grid = screen.getByRole("grid");
    fireEvent.click(within(grid).getByRole("button", { name: /October 7th, 2026/ }));
    expect(screen.getByRole("button", { name: "Post date: Wed, Oct 7" })).toBeTruthy();
  });

  it("Generate is enabled with names and a theme, disabled with the reason otherwise", () => {
    const { rerender } = render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
    rerender(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(3)} busy={false} />);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only 3 boy two-word names left/)).toBeTruthy();
    rerender(<NewPostPanel settings={settings} themes={[theme("g", "Pink Bloom", "girl")]} stock={stock(50)} busy={false} />);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No boy theme left/, { selector: "span.text-xs" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Theme" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ["offline", "Your PC is offline — turn it on to generate"],
    ["unknown", "Your PC is offline — turn it on to generate"],
    ["comfy-off", "Open ComfyUI Desktop to generate"],
  ])("PC %s: Generate is locked with the reason as visible text (#6)", (h, reason) => {
    health = h;
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
    const note = screen.getByText(reason);
    expect(note).toBeTruthy();
    expect(note.closest("[title]")).toBeNull(); // shown, not a tooltip
  });

  it("Fonts row: closed, shows the last-used fonts each in its own face; opens three Selects", () => {
    render(<NewPostPanel settings={{ ...settings, title_font: "quicksand", meaning_font: "comfortaa", mark_font: "nope" }} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    const trigger = screen.getByRole("button", { name: /Fonts/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("Quicksand · Comfortaa · Poppins"); // unknown id → Poppins
    expect(within(trigger).getByText("Quicksand").getAttribute("style")).toMatch(/font-family: "Quicksand"/);
    expect(screen.queryByRole("combobox", { name: "Name font" })).toBeNull();
    fireEvent.click(trigger);
    const name = screen.getByRole("combobox", { name: "Name font" });
    expect(name.textContent).toContain("Quicksand");
    expect(screen.getByRole("combobox", { name: "Meaning font" }).textContent).toContain("Comfortaa");
    expect(screen.getByRole("combobox", { name: "Watermark font" }).textContent).toContain("Poppins");
    expect(screen.getByLabelText("Font sample").textContent).toContain("ARLO ZENITH");
    fireEvent.keyDown(name, { key: "ArrowDown" });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(15);
    const vibes = options.find((o) => o.textContent === "Great Vibes")!;
    expect(vibes.getAttribute("style")).toMatch(/font-family: "Great Vibes", cursive/);
    expect(vibes.getAttribute("style")).toMatch(/font-weight: 400/); // single-weight: no faux bold
    expect(document.querySelector("link[href*='fonts.googleapis.com/css2']")?.getAttribute("href")).toMatch(/display=swap/);
  });

  it("picking a font updates the row and the sample, and Generate sends the fonts", async () => {
    const { callAction } = await import("@/lib/actions/call");
    const { createPostAction } = await import("@/lib/actions/posts");
    vi.mocked(callAction).mockImplementationOnce(async (fn) => { await fn(); return { ok: true }; });
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Fonts/ }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Name font" }), { key: "ArrowDown" });
    fireEvent.keyDown(within(screen.getByRole("listbox")).getByRole("option", { name: "Great Vibes" }), { key: "Enter" });
    expect(screen.getByRole("button", { name: /Fonts/ }).textContent).toContain("Great Vibes · Poppins · Poppins");
    expect(screen.getByLabelText("Font sample").textContent).toContain("Arlo Zenith"); // script font: Title Case
    fireEvent.click(generateButton());
    await vi.waitFor(() => expect(vi.mocked(createPostAction)).toHaveBeenCalled());
    expect(vi.mocked(createPostAction).mock.calls.at(-1)![0]).toMatchObject({ fonts: { title_font: "greatvibes", meaning_font: "poppins", mark_font: "poppins" } });
  });

  it("the G hotkey does not generate while locked", async () => {
    const { callAction } = await import("@/lib/actions/call");
    vi.mocked(callAction).mockClear();
    health = "offline";
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    fireEvent.keyDown(window, { key: "g" });
    expect(vi.mocked(callAction)).not.toHaveBeenCalled();
  });

  it("Child age: defaults to Random, lists newborn to 7 years, and Generate sends the choice", async () => {
    const { callAction } = await import("@/lib/actions/call");
    const { createPostAction } = await import("@/lib/actions/posts");
    vi.mocked(callAction).mockImplementation(async (fn) => { await fn(); return { ok: true }; });
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    const trigger = screen.getByRole("combobox", { name: "Child age" });
    expect(trigger.textContent).toBe("Random · 0–7");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Random (newborn–7)", "Newborn", "1 year", "2 years", "3 years", "4 years", "5 years", "6 years", "7 years"]);
    fireEvent.keyDown(within(screen.getByRole("listbox")).getByRole("option", { name: "5 years" }), { key: "Enter" });
    expect(screen.getByRole("combobox", { name: "Child age" }).textContent).toContain("5 years");
    vi.mocked(createPostAction).mockClear();
    fireEvent.click(generateButton());
    await vi.waitFor(() => expect(vi.mocked(createPostAction)).toHaveBeenCalled());
    expect(vi.mocked(createPostAction).mock.calls.at(-1)![0]).toMatchObject({ subjectAge: "5" });
    vi.mocked(callAction).mockReset();
    vi.mocked(callAction).mockImplementation(async () => ({ ok: true }));
  });

  it("Child age: Generate without touching it sends Random", async () => {
    const { callAction } = await import("@/lib/actions/call");
    const { createPostAction } = await import("@/lib/actions/posts");
    vi.mocked(createPostAction).mockClear();
    vi.mocked(callAction).mockImplementationOnce(async (fn) => { await fn(); return { ok: true }; });
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    fireEvent.click(generateButton());
    await vi.waitFor(() => expect(vi.mocked(createPostAction)).toHaveBeenCalled());
    expect(vi.mocked(createPostAction).mock.calls.at(-1)![0]).toMatchObject({ subjectAge: "random" });
  });

  it("footer summary line follows the choices (Auto shows the card range)", () => {
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest"), theme("g", "Pink Bloom", "girl")]} stock={[...stock(50), { gender: "girl", style: "single", count: 30 }]} busy={false} />);
    const summary = screen.getByTestId("post-summary");
    expect(summary.textContent).toBe("9–13 cards · Boy · Two-word · Random ages · Autumn Harvest");
    fireEvent.click(screen.getByRole("radio", { name: "Girl" }));
    fireEvent.click(screen.getByRole("radio", { name: "Single" }));
    fireEvent.click(screen.getByRole("radio", { name: "11" }));
    expect(summary.textContent).toBe("11 cards · Girl · Single · Random ages · Pink Bloom");
    expect(screen.getByText(/30 names left/)).toBeTruthy();
  });

  it("groups the controls into Who / Look / Cards sections", () => {
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    for (const s of ["Who", "Look", "Cards"]) expect(screen.getByRole("group", { name: s })).toBeTruthy();
    const who = screen.getByRole("group", { name: "Who" });
    expect(within(who).getByRole("radiogroup", { name: "Gender" })).toBeTruthy();
    expect(within(who).getByRole("radiogroup", { name: "Name style" })).toBeTruthy();
    expect(within(who).getByRole("combobox", { name: "Child age" })).toBeTruthy();
    const look = screen.getByRole("group", { name: "Look" });
    expect(within(look).getByRole("combobox", { name: "Theme" })).toBeTruthy();
    expect(within(look).getByLabelText("Theme details").textContent).toContain("sage backdrop");
    expect(within(screen.getByRole("group", { name: "Cards" })).getByRole("radiogroup", { name: "Number of cards" })).toBeTruthy();
  });
});
