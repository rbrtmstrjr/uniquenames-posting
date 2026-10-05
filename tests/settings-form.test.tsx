// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TEXT_SETTINGS_DEFAULTS, type SettingsRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/shell/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("@/lib/actions/settings", () => ({ saveSettingsAction: vi.fn() }));
const { callAction } = vi.hoisted(() => ({ callAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/actions/call", () => ({ callAction }));
const { SettingsForm } = await import("@/components/settings/settings-form");

beforeAll(polyfillRadix);
afterEach(() => { cleanup(); callAction.mockClear(); });

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
