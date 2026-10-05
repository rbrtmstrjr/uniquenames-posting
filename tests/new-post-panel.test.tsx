// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SettingsRow, ThemeRow } from "@/lib/db/types";
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

const settings = { id: 1, caption_template: "x", hashtags: "", handle: "@u", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true, updated_at: "" } satisfies SettingsRow;
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
    expect(screen.getByText(/New post · Mon, Oct 5/)).toBeTruthy();
    fireEvent.click(trigger);
    const grid = screen.getByRole("grid");
    fireEvent.click(within(grid).getByRole("button", { name: /October 7th, 2026/ }));
    expect(screen.getByRole("button", { name: "Post date: Wed, Oct 7" })).toBeTruthy();
    expect(screen.getByText(/New post · Wed, Oct 7/)).toBeTruthy();
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

  it("the G hotkey does not generate while locked", async () => {
    const { callAction } = await import("@/lib/actions/call");
    vi.mocked(callAction).mockClear();
    health = "offline";
    render(<NewPostPanel settings={settings} themes={[theme("a", "Autumn Harvest")]} stock={stock(50)} busy={false} />);
    fireEvent.keyDown(window, { key: "g" });
    expect(vi.mocked(callAction)).not.toHaveBeenCalled();
  });
});
