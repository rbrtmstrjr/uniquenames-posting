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

  it("card text: no font Selects (fonts are picked per post on Today); the preview uses the last-used fonts", () => {
    render(<SettingsForm initial={{ ...initial, title_font: "playfair", meaning_font: "lora" }} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByText(/Fonts are chosen per post on Today/)).toBeTruthy();
    expect(screen.getByText(/Playfair Display · Lora · Poppins/)).toBeTruthy();
    expect(document.querySelector("link[href*='fonts.googleapis.com']")).toBeTruthy();
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
    expect(screen.getByText(/Poppins · Poppins · Poppins/)).toBeTruthy();
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

  it("Reels: 'Images per reel' slider 10–40 with a value label; it is sent on Save", async () => {
    render(<SettingsForm initial={{ ...initial, reel_max_images: 10 }} />);
    const sl = screen.getByRole("slider", { name: "Images per reel" });
    expect([sl.getAttribute("aria-valuemin"), sl.getAttribute("aria-valuemax"), sl.getAttribute("aria-valuenow")]).toEqual(["10", "40", "10"]);
    fireEvent.keyDown(sl, { key: "ArrowRight" });
    expect(sl.getAttribute("aria-valuenow")).toBe("11");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).toMatchObject({ reel_max_images: 11 });
  });

  it("Reels (014): an 'On-screen step labels' switch bound to reel_labels, sent on Save", async () => {
    render(<SettingsForm initial={{ ...initial, reel_max_images: 20, reel_labels: true }} />);
    const sw = screen.getByRole("switch", { name: "On-screen step labels" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).toMatchObject({ reel_labels: false });
  });

  it("Reels: before 014 (no reel_labels) the switch is hidden and never sent", async () => {
    render(<SettingsForm initial={{ ...initial, reel_max_images: 20 }} />);
    expect(screen.queryByRole("switch", { name: "On-screen step labels" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).not.toHaveProperty("reel_labels");
  });

  it("Reels: before migration 005 (no column) the slider shows 40 and says to run 005", () => {
    render(<SettingsForm initial={initial} />);
    expect(screen.getByRole("slider", { name: "Images per reel" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText(/005_reels\.sql/)).toBeTruthy();
  });
});

describe("SettingsForm hashtags (009)", () => {
  const with009 = { ...initial, hashtags_always: "#uniquenames", hashtag_pool: "#babynames #babygirlnames #babyboynames #momlife" };

  it("Always + Pool fields replace the single Hashtags field; the help says ≤ 4 per post, rotated", () => {
    render(<SettingsForm initial={with009} />);
    expect((screen.getByRole("textbox", { name: /Always/ }) as HTMLInputElement).value).toBe("#uniquenames");
    expect((screen.getByRole("textbox", { name: /Pool/ }) as HTMLTextAreaElement).value).toContain("#momlife");
    expect(screen.queryByRole("textbox", { name: /^Hashtags$/ })).toBeNull();
    expect(screen.getByText(/At most 4 hashtags per post/)).toBeTruthy();
  });

  it("the fallback preview shows the template + the always-tag + 2 pool tags (no boy tag on the girl preview)", () => {
    render(<SettingsForm initial={with009} />);
    expect(screen.getByText(/Fallback preview/).parentElement!.textContent).toContain("Unique girl names\n\n#uniquenames #babynames #babygirlnames");
  });

  it("edits are sent on Save; a bait tag blocks Save with a clear message", async () => {
    render(<SettingsForm initial={with009} />);
    const pool = screen.getByRole("textbox", { name: /Pool/ });
    fireEvent.change(pool, { target: { value: "#babynames #fyp #momlife" } });
    expect(screen.getByRole("alert").textContent).toMatch(/#fyp.*bait/);
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(pool, { target: { value: "#babynames #newmom #momlife" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).toMatchObject({ hashtags_always: "#uniquenames", hashtag_pool: "#babynames #newmom #momlife" });
  });

  it("before 009: the fields show what posts use (old tags merged into the default pool), are read-only, are not sent, and say to run 009", async () => {
    render(<SettingsForm initial={{ ...initial, hashtags: "#parenting #fypシ" }} />);
    const pool = screen.getByRole("textbox", { name: /Pool/ }) as HTMLTextAreaElement;
    expect(pool.value).toMatch(/^#babynames .* #parenting$/);
    expect(pool.disabled).toBe(true);
    expect(screen.getByText(/009_captions\.sql/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const sent = await captured();
    expect(sent).not.toHaveProperty("hashtag_pool");
    expect(sent).not.toHaveProperty("hashtags_always");
  });
});

describe("SettingsForm: closing card", () => {
  it("before 010: shown with the default messages, disabled, never sent", async () => {
    render(<SettingsForm initial={initial} />);
    const sw = screen.getByRole("switch", { name: /Add a closing card to every post/ });
    expect(sw.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/010_cta_card\.sql/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const sent = await captured();
    expect(sent).not.toHaveProperty("cta_enabled");
    expect(sent).not.toHaveProperty("cta_messages");
  });

  it("after 010: the switch and the messages are sent; a bad message blocks Save", async () => {
    render(<SettingsForm initial={{ ...initial, cta_enabled: true, cta_messages: "Follow for more / baby name ideas." }} />);
    const sw = screen.getByRole("switch", { name: /Add a closing card to every post/ });
    fireEvent.click(sw);
    const box = screen.getByDisplayValue("Follow for more / baby name ideas.");
    fireEvent.change(box, { target: { value: "Follow us / every day\nMore {gender} names" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await captured()).toMatchObject({ cta_enabled: false, cta_messages: "Follow us / every day\nMore {gender} names" });
    fireEvent.change(box, { target: { value: "a / b / c / d" } });
    expect(screen.getByRole("alert").textContent).toMatch(/3 lines/);
  });
});
