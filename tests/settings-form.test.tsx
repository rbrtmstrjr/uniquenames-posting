// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TEXT_SETTINGS_DEFAULTS, type SettingsRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/shell/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
const { callAction, saveSettingsAction } = vi.hoisted(() => ({
  callAction: vi.fn(async (fn: () => Promise<unknown>) => { await fn(); return { ok: true }; }),
  saveSettingsAction: vi.fn(async (_s: unknown) => ({ ok: true })),
}));
vi.mock("@/lib/actions/settings", () => ({ saveSettingsAction }));
vi.mock("@/lib/actions/call", () => ({ callAction }));
const { SettingsForm } = await import("@/components/settings/settings-form");

beforeAll(polyfillRadix);
afterEach(() => { cleanup(); callAction.mockClear(); saveSettingsAction.mockClear(); });
/** What the last Save sent to the server action. */
const captured = async () => { await Promise.resolve(); return saveSettingsAction.mock.calls.at(-1)?.[0]; };

const initial = { id: 1, caption_template: "Unique {gender} names", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, updated_at: "" } satisfies SettingsRow;

describe("SettingsForm (shadcn controls)", () => {
  it("has no native checkbox, number input, raw input or textarea outside shadcn", () => {
    const { container } = render(<SettingsForm initial={initial} />);
    expect(container.querySelector("input[type=checkbox], input[type=number]")).toBeNull();
    for (const el of container.querySelectorAll("input, textarea")) expect(el.getAttribute("data-slot")).toMatch(/^(input|textarea)$/);
  });

  it("chime is a Switch that toggles", () => {
    render(<SettingsForm initial={initial} />);
    const sw = screen.getByRole("switch", { name: /Chime when a post is ready/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("'Write captions with AI' is a Switch; undefined (migration not run) shows on; it is sent on Save", () => {
    const { caption_ai: _drop, ...legacy } = initial;
    void _drop;
    render(<SettingsForm initial={legacy as SettingsRow} />);
    const sw = screen.getByRole("switch", { name: /Write captions with AI/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Fallback caption/)).toBeTruthy();
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it("card text: three font Selects, each family shown in its own font", () => {
    render(<SettingsForm initial={{ ...initial, title_font: "playfair" }} />);
    const name = screen.getByRole("combobox", { name: "Name font" });
    expect(name.textContent).toContain("Playfair Display");
    expect(name.getAttribute("style")).toMatch(/font-family: "Playfair Display"/);
    expect(screen.getByRole("combobox", { name: "Meaning font" }).textContent).toContain("Poppins");
    expect(screen.getByRole("combobox", { name: "Watermark font" })).toBeTruthy();
    fireEvent.click(name);
    const option = screen.getByRole("option", { name: "Great Vibes" });
    expect(option.getAttribute("style")).toMatch(/font-family: "Great Vibes", cursive/);
    expect(option.getAttribute("style")).toMatch(/font-weight: 400/); // single-weight font: no faux bold
    expect(screen.getAllByRole("option")).toHaveLength(15);
  });

  it("card text: size sliders with px labels and the spec ranges", () => {
    render(<SettingsForm initial={initial} />);
    const title = screen.getByRole("slider", { name: "Name size" });
    expect([title.getAttribute("aria-valuemin"), title.getAttribute("aria-valuemax"), title.getAttribute("aria-valuenow")]).toEqual(["40", "180", "95"]);
    const mark = screen.getByRole("slider", { name: "Watermark size" });
    expect([mark.getAttribute("aria-valuemin"), mark.getAttribute("aria-valuemax")]).toEqual(["12", "48"]);
    expect(screen.getByRole("slider", { name: "Meaning size" }).getAttribute("aria-valuemax")).toBe("90");
    fireEvent.keyDown(title, { key: "ArrowRight" });
    expect(screen.getByText("96 px")).toBeTruthy();
  });

  it("card text: Auto + 9 spots in one group; picking one moves the preview; Save sends the text settings", async () => {
    render(<SettingsForm initial={initial} />);
    const group = screen.getByRole("radiogroup", { name: "Text position" });
    expect(group.querySelectorAll("[data-slot=toggle-group-item]")).toHaveLength(10);
    expect(screen.getByRole("radio", { name: /Auto/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Bottom right" }));
    expect(screen.getByRole("radio", { name: "Bottom right" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("img", { name: /bottom right/ })).toBeTruthy();
    expect(screen.getAllByText(/Re-stamp with current text settings/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(await captured()).toMatchObject({ text_position: "bottom-right", title_font: "poppins", title_size: 95, mark_size: 21 });
  });

  it("card text: before migration 002 (no text columns) the defaults show", () => {
    const legacy = Object.fromEntries(Object.entries(initial).filter(([k]) => !/_font$|_size$|text_position/.test(k))) as unknown as SettingsRow;
    render(<SettingsForm initial={legacy} />);
    expect(screen.getByRole("combobox", { name: "Name font" }).textContent).toContain("Poppins");
    expect(screen.getByRole("slider", { name: "Meaning size" }).getAttribute("aria-valuenow")).toBe("37");
    expect(screen.getByRole("radio", { name: /Auto/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("card counts are sliders with value labels; fewest above most blocks Save", () => {
    render(<SettingsForm initial={{ ...initial, min_images: 13, max_images: 13 }} />);
    const fewest = screen.getByRole("slider", { name: "Fewest cards (Auto)" });
    const most = screen.getByRole("slider", { name: "Most cards (Auto)" });
    expect(fewest.getAttribute("aria-valuenow")).toBe("13");
    expect(most.getAttribute("aria-valuemax")).toBe("30");
    fireEvent.keyDown(fewest, { key: "ArrowRight" });
    expect(fewest.getAttribute("aria-valuenow")).toBe("14");
    expect(screen.getByRole("alert").textContent).toMatch(/min card count cannot be above the max/);
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(most, { key: "ArrowRight" });
    fireEvent.keyDown(most, { key: "ArrowRight" });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(callAction).toHaveBeenCalledTimes(1);
  });
});
