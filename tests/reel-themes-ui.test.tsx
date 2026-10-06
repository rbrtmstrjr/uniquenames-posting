// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { REEL_THEME_IDS, TEXT_SETTINGS_DEFAULTS, type ReelRow, type ReelSceneRow, type ReelThemeId, type ReelThemeRow, type SettingsRow } from "@/lib/db/types";
import { STATIC_THEMES, THEME_LABEL } from "@/lib/reels/themes";
import { polyfillRadix } from "./helpers/radix-jsdom";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }), usePathname: () => "/settings" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/shell/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health: "ready", lastSeen: "now", row: null }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/realtime/signed-urls", () => ({ useSignedUrls: () => (p?: string | null) => (p ? `https://signed/${p}` : undefined) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({}), auth: { signOut: vi.fn() } }) }));
// Realtime rows: the test can push a newer list (as if the PC saved a preview); the setter records local patches.
let live: unknown[] | null = null;
const setRows = vi.fn();
vi.mock("@/lib/realtime/use-table", () => ({ useRealtimeRows: (_t: string, initial: unknown[]) => [live ?? initial, setRows] }));
const themeActions = vi.hoisted(() => ({ queueThemePreviewAction: vi.fn(), queueAllThemePreviewsAction: vi.fn() }));
vi.mock("@/lib/actions/reel-themes", () => themeActions);
const reelActions = vi.hoisted(() => ({ setReelThemeAction: vi.fn(), saveReelScriptAction: vi.fn(), approveReelAction: vi.fn(), rewriteReelScriptAction: vi.fn(), deleteReelAction: vi.fn(),
  redoReelSceneAction: vi.fn(), skipReelSceneAction: vi.fn(), rerenderReelAction: vi.fn(), retryReelAction: vi.fn() }));
vi.mock("@/lib/actions/reels", () => reelActions);
vi.mock("@/lib/actions/voices", () => ({ setUpVoicesAction: vi.fn(), queueVoiceSamplesAction: vi.fn(), setReelVoiceAction: vi.fn() }));
const saveSettingsAction = vi.hoisted(() => vi.fn(async (_s: unknown) => ({ ok: true })));
vi.mock("@/lib/actions/settings", () => ({ saveSettingsAction }));

const { ThemeGrid } = await import("@/components/settings/theme-grid");
const { SettingsForm } = await import("@/components/settings/settings-form");
const { ThemePicker } = await import("@/components/reels/theme-picker");
const { ScriptReview } = await import("@/components/reels/script-review");
const { ReelProgress } = await import("@/components/reels/reel-progress");

beforeAll(polyfillRadix);
afterEach(() => { cleanup(); vi.clearAllMocks(); live = null; });

const theme = (id: ReelThemeId, o: Partial<ReelThemeRow> = {}): ReelThemeRow => ({
  id, label: THEME_LABEL[id].label, emoji: THEME_LABEL[id].emoji, blurb: `${id} blurb`, style: STATIC_THEMES[id].style, faces: STATIC_THEMES[id].faces,
  grayscale: id === "sketch", sort: REEL_THEME_IDS.indexOf(id) + 1, preview_path: null, preview_status: "missing", error: null,
  version: 1, claimed_at: null, created_at: "", updated_at: "", ...o,
});
const ready = (id: ReelThemeId, o: Partial<ReelThemeRow> = {}) => theme(id, { preview_status: "ready", preview_path: `themes/${id}/preview-v2.jpg`, version: 2, ...o });
const all = (o: Partial<Record<ReelThemeId, Partial<ReelThemeRow>>> = {}) => REEL_THEME_IDS.map((id) => theme(id, o[id]));

describe("ThemeGrid (Settings)", () => {
  it("before migration 007: the setup note, no cards", () => {
    render(<ThemeGrid themes={null} value={null} onChange={() => {}} />);
    expect(screen.getByText(/007_reel_themes\.sql/)).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("8 cards: emoji + label + blurb, faces badge, status badges, the default checked", () => {
    const themes = all({ animated3d: ready("animated3d"), watercolor: { preview_status: "queued" }, clay: { preview_status: "making" },
      papercraft: { preview_status: "failed", error: "ComfyUI is down" } }).map((t) => (t.id === "animated3d" ? ready("animated3d") : t));
    render(<ThemeGrid themes={themes} value="clay" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Default theme" });
    expect(within(group).getAllByRole("radio")).toHaveLength(8);
    expect(within(group).getByRole("radio", { name: /Clay Stop-motion/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).getByRole("radio", { name: /Knitted Doll/ }).getAttribute("aria-checked")).toBe("false");
    const knit = within(screen.getByTestId("theme-knitted"));
    expect(knit.getByText("knitted blurb")).toBeTruthy();
    expect(knit.getByText("No preview")).toBeTruthy();
    expect(knit.queryByText("Expressive faces")).toBeNull(); // faces=false
    expect(within(screen.getByTestId("theme-anime")).getByText("Expressive faces")).toBeTruthy();
    expect(within(screen.getByTestId("theme-watercolor")).getAllByText("In line").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("theme-clay")).getAllByText("Making…").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("theme-papercraft")).getByText("Failed")).toBeTruthy();
    expect(within(screen.getByTestId("theme-papercraft")).getByText("ComfyUI is down")).toBeTruthy();
    // A ready preview shows its signed picture and no status badge.
    const a3 = screen.getByTestId("theme-animated3d");
    expect(a3.querySelector("img")?.getAttribute("src")).toBe("https://signed/themes/animated3d/preview-v2.jpg");
    expect(within(a3).queryByText("No preview")).toBeNull();
    expect(screen.getByTestId("theme-summary").textContent).toMatch(/1 of 8 previews ready · 2 being made/);
    // In line / being made: Make preview waits.
    expect((within(screen.getByTestId("theme-clay")).getByRole("button", { name: /Making…: Clay/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tapping a card makes it the default; a ready picture opens the large preview", async () => {
    const onChange = vi.fn();
    render(<ThemeGrid themes={[ready("knitted"), theme("anime"), ready("cinematic")]} value="knitted" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Soft Anime/ }));
    expect(onChange).toHaveBeenLastCalledWith("anime");
    // No preview yet: the picture picks the theme too.
    fireEvent.click(screen.getByRole("button", { name: "Use Soft Anime (no preview yet)" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "See the Cinematic Real preview" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Cinematic Real preview" }).getAttribute("src")).toBe("https://signed/themes/cinematic/preview-v2.jpg");
    fireEvent.click(within(dialog).getByRole("button", { name: /Use as default/ }));
    expect(onChange).toHaveBeenLastCalledWith("cinematic");
  });

  it("Make preview queues one theme (shown in line at once); errors toast", async () => {
    themeActions.queueThemePreviewAction.mockResolvedValueOnce({ ok: true });
    render(<ThemeGrid themes={[theme("knitted"), ready("anime")]} value="knitted" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Make preview: Knitted Doll" }));
    await waitFor(() => expect(themeActions.queueThemePreviewAction).toHaveBeenCalledWith("knitted"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const patch = setRows.mock.calls.at(-1)![0] as (p: ReelThemeRow[]) => ReelThemeRow[];
    expect(patch([theme("knitted"), ready("anime")]).map((t) => t.preview_status)).toEqual(["queued", "ready"]);
    themeActions.queueThemePreviewAction.mockResolvedValueOnce({ ok: false, error: "This preview is already in line for your PC." });
    fireEvent.click(screen.getByRole("button", { name: "Make again: Soft Anime" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This preview is already in line for your PC."));
  });

  it("Make all previews (missing + failed only) and the count; hidden when every theme has one", async () => {
    themeActions.queueAllThemePreviewsAction.mockResolvedValueOnce({ ok: true, queued: 2 });
    const { unmount } = render(<ThemeGrid themes={[theme("knitted"), theme("clay", { preview_status: "failed" }), theme("anime", { preview_status: "queued" }), ready("sketch")]} value="knitted" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Make all previews \(2\)/ }));
    await waitFor(() => expect(themeActions.queueAllThemePreviewsAction).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/2 previews in line/)));
    unmount();
    render(<ThemeGrid themes={[ready("knitted"), theme("anime", { preview_status: "making" })]} value="knitted" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Make all previews/ })).toBeNull();
  });

  it("realtime: a preview the PC saves appears live", () => {
    const { rerender } = render(<ThemeGrid themes={[theme("clay", { preview_status: "making" })]} value="clay" onChange={() => {}} />);
    expect(screen.getByTestId("theme-clay").querySelector("img")).toBeNull();
    live = [ready("clay", { version: 3, preview_path: "themes/clay/preview-v3.jpg" })];
    rerender(<ThemeGrid themes={[theme("clay", { preview_status: "making" })]} value="clay" onChange={() => {}} />);
    expect(screen.getByTestId("theme-clay").querySelector("img")?.getAttribute("src")).toBe("https://signed/themes/clay/preview-v3.jpg");
  });
});

describe("SettingsForm: the default theme", () => {
  const base: SettingsRow = { id: 1, caption_template: "Hi {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13,
    width: 1080, height: 1350, sound_on: true, ...TEXT_SETTINGS_DEFAULTS, reel_max_images: 20, updated_at: "" } as SettingsRow;

  it("after 007: the Theme section sits above Narrator & music and Save sends reel_theme_id", async () => {
    render(<SettingsForm initial={{ ...base, reel_theme_id: "knitted" }} themes={all()} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Theme")).toBeGreaterThan(-1);
    expect(headings.indexOf("Theme")).toBeLessThan(headings.indexOf("Narrator & music"));
    fireEvent.click(screen.getByRole("radio", { name: /3D Animated/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveSettingsAction).toHaveBeenCalled());
    expect(saveSettingsAction.mock.calls[0][0]).toMatchObject({ reel_theme_id: "animated3d" });
  });

  it("before 007: the setup note and reel_theme_id is never sent", async () => {
    render(<SettingsForm initial={base} themes={null} />);
    expect(screen.getByText(/007_reel_themes\.sql/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveSettingsAction).toHaveBeenCalled());
    expect(saveSettingsAction.mock.calls[0][0]).not.toHaveProperty("reel_theme_id");
  });
});

const RID = "11111111-1111-4111-8111-111111111111";
const reel = (p: Partial<ReelRow> = {}): ReelRow => ({
  id: RID, title: "Why toddlers say no", topic: null, stage: "toddler", doll_cast: { adult: "the mom doll: a crocheted mother doll", child: "the baby doll: a crocheted baby doll" },
  status: "script", error: null, voice_path: null, words: null, preview_path: null, pc_path: null, duration_s: null,
  version: 1, claimed_at: null, started_at: null, finished_at: null, created_at: "2026-10-05T02:00:00Z", updated_at: "", ...p,
});
const scene = (i: number, p: Partial<ReelSceneRow> = {}): ReelSceneRow => ({
  id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`, reel_id: RID, position: i, beat: "hook", idea: `Idea ${i}`, narration: `Line number ${i} has some words here`,
  image_prompt: "", seed: 1, status: "pending", photo_path: null, attempts: 0, error: null, start_s: null, end_s: null,
  version: 1, claimed_at: null, created_at: "", updated_at: "", ...p,
});

describe("ThemePicker (review page)", () => {
  it("thumbnails with the reel's theme checked; picking saves, shows pending, then refreshes", async () => {
    let resolve!: (v: { ok: true }) => void;
    reelActions.setReelThemeAction.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const onSaved = vi.fn();
    render(<ThemePicker reelId={RID} value="knitted" defaultId="knitted" themes={[ready("knitted"), ready("anime"), theme("clay")]} onSaved={onSaved} />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Knitted Doll" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("pick-anime").querySelector("img")?.getAttribute("src")).toBe("https://signed/themes/anime/preview-v2.jpg");
    expect(screen.getByTestId("theme-current").textContent).toMatch(/Knitted Doll · default/);
    fireEvent.click(screen.getByRole("radio", { name: "Soft Anime" }));
    expect(reelActions.setReelThemeAction).toHaveBeenCalledWith(RID, "anime");
    await waitFor(() => expect(screen.getByTestId("theme-current").textContent).toMatch(/Saving/));
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("radio", { name: "Clay Stop-motion" }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith("anime");
    expect(screen.getByRole("radio", { name: "Soft Anime" }).getAttribute("aria-checked")).toBe("true");
  });

  it("a refused change goes back to the old theme with the server's message", async () => {
    reelActions.setReelThemeAction.mockResolvedValueOnce({ ok: false, error: "The theme can only be changed before you approve the script." });
    render(<ThemePicker reelId={RID} value="clay" defaultId="knitted" themes={[theme("knitted"), theme("clay")]} />);
    expect(screen.getByText(/Make theme previews in Settings/)).toBeTruthy(); // no previews yet
    fireEvent.click(screen.getByRole("radio", { name: "Knitted Doll" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The theme can only be changed before you approve the script."));
    expect(screen.getByRole("radio", { name: "Clay Stop-motion" }).getAttribute("aria-checked")).toBe("true");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ScriptReview: theme + emotion chips", () => {
  const choice = { themes: [ready("knitted"), ready("animated3d")], defaultId: "knitted" as const };

  it("each line shows its emotion chip with shot + motion as subtle text (read-only)", () => {
    render(<ScriptReview reel={reel({ theme_id: "knitted" })} scenes={[
      scene(1, { emotion: "worried", shot: "wide", motion: "punch" }),
      scene(2, { emotion: "teary", shot: "over-the-shoulder", motion: "push_in", key_moment: true }),
      scene(3),
    ]} themes={choice} />);
    const m1 = screen.getByTestId("mood-1");
    expect(m1.textContent).toMatch(/😟\s*worried/);
    expect(m1.textContent).toMatch(/Wide · Punch/);
    const m2 = screen.getByTestId("mood-2");
    expect(m2.textContent).toMatch(/teary/);
    expect(m2.textContent).toMatch(/Over the shoulder · Push in/);
    expect(within(m2).getByText("Key moment")).toBeTruthy();
    expect(screen.queryByTestId("mood-3")).toBeNull(); // a line from before 007
    expect(within(m1).queryByRole("button")).toBeNull();
    expect(within(m1).queryByRole("combobox")).toBeNull();
  });

  it("the picker shows on a 007 reel (pinned theme), and a people theme changes the cast wording", () => {
    render(<ScriptReview reel={reel({ theme_id: "animated3d" })} scenes={[scene(1)]} themes={choice} />);
    expect(screen.getByRole("radio", { name: "3D Animated" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Grown-up:")).toBeTruthy();
    expect(screen.queryByText("Grown-up doll:")).toBeNull();
  });

  it("before 007 (no theme_id on the reel) or without themes: no picker", () => {
    const { unmount } = render(<ScriptReview reel={reel()} scenes={[scene(1)]} themes={choice} />);
    expect(screen.queryByTestId("theme")).toBeNull();
    unmount();
    render(<ScriptReview reel={reel({ theme_id: "knitted" })} scenes={[scene(1)]} themes={null} />);
    expect(screen.queryByTestId("theme")).toBeNull();
    expect(screen.getByText("Grown-up doll:")).toBeTruthy();
  });
});

describe("ReelProgress header", () => {
  it("shows the theme emoji + label after 007; nothing before it", () => {
    const { unmount } = render(<ReelProgress reel={reel({ status: "queued", theme_id: "watercolor" })} scenes={[scene(1, { status: "queued" })]} />);
    expect(screen.getByTestId("reel-theme").textContent).toContain("🎨 Storybook Watercolor");
    unmount();
    render(<ReelProgress reel={reel({ status: "queued", theme_id: null })} scenes={[scene(1, { status: "queued" })]} />);
    expect(screen.getByTestId("reel-theme").textContent).toContain("🧶 Knitted Doll");
    cleanup();
    render(<ReelProgress reel={reel({ status: "queued" })} scenes={[scene(1, { status: "queued" })]} />);
    expect(screen.queryByTestId("reel-theme")).toBeNull();
  });
});
