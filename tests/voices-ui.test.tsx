// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReelRow, ReelVoiceRow } from "@/lib/db/types";
import { sampleKey } from "@/lib/reels/voices";
import { reelProgress } from "@/lib/reels/status";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/settings" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/shell/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health: "ready", lastSeen: "now", row: null }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/realtime/signed-urls", () => ({ useSignedUrls: () => (p?: string | null) => (p ? `https://signed/${p}` : undefined) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({}), auth: { signOut: vi.fn() } }) }));
// Realtime rows: the test can push a newer list (as if the PC saved a sample).
let live: unknown[] | null = null;
vi.mock("@/lib/realtime/use-table", () => ({ useRealtimeRows: (_t: string, initial: unknown[]) => [live ?? initial, () => {}] }));
const voiceActions = vi.hoisted(() => ({ setUpVoicesAction: vi.fn(), queueVoiceSamplesAction: vi.fn(), setReelVoiceAction: vi.fn() }));
vi.mock("@/lib/actions/voices", () => voiceActions);
const saveSettingsAction = vi.hoisted(() => vi.fn(async (_s: unknown) => ({ ok: true })));
vi.mock("@/lib/actions/settings", () => ({ saveSettingsAction }));
vi.mock("@/lib/actions/reels", () => ({ saveReelScriptAction: vi.fn(), approveReelAction: vi.fn(), rewriteReelScriptAction: vi.fn(), deleteReelAction: vi.fn() }));

const { NarratorMusic } = await import("@/components/settings/narrator-music");
const { SettingsForm } = await import("@/components/settings/settings-form");
const { VoicePicker } = await import("@/components/reels/voice-picker");
const { ScriptReview } = await import("@/components/reels/script-review");

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
beforeAll(() => {
  polyfillRadix();
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(window.HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); live = null; });

const KEY = sampleKey(1.12);
const voice = (id: string, o: Partial<ReelVoiceRow> = {}): ReelVoiceRow => ({
  id, label: id === "builtin" ? "Built-in" : id[0].toUpperCase() + id.slice(1), tone: "Warm", gender: null,
  ref_path: id === "builtin" ? null : `voices/${id}/ref.wav`, sample_path: null, sample_status: "missing", sample_key: null, error: null,
  version: 1, claimed_at: null, created_at: "", updated_at: "", ...o,
});
const readyVoice = (id: string, o: Partial<ReelVoiceRow> = {}) => voice(id, { sample_status: "ready", sample_path: `voices/${id}/sample-v2.wav`, sample_key: KEY, ...o });
const value = { reel_voice_id: "gacrux", reel_speed: 1.12, reel_music: true, reel_music_volume: 18 };

describe("NarratorMusic (Settings)", () => {
  it("before migration 006: the setup note, no controls", () => {
    render(<NarratorMusic voices={null} value={null} savedSpeed={1} onChange={() => {}} />);
    expect(screen.getByText(/006_reel_voices\.sql/)).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("voice grid: label, tone, status badges, the default checked; picking another changes the default", () => {
    const onChange = vi.fn();
    const voices = [voice("builtin"), readyVoice("gacrux", { tone: "Mature" }), voice("kore", { sample_status: "queued" }),
      voice("puck", { sample_status: "making" }), voice("zephyr", { sample_status: "failed", error: "boom" }), readyVoice("leda", { sample_key: sampleKey(1) })];
    render(<NarratorMusic voices={voices} value={value} savedSpeed={1.12} onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Default narrator" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(within(group).getByRole("radio", { name: /Gacrux/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(screen.getByTestId("voice-gacrux")).getByText("Mature")).toBeTruthy();
    expect(within(screen.getByTestId("voice-builtin")).getByText("No sample")).toBeTruthy();
    expect(within(screen.getByTestId("voice-kore")).getByText("In line")).toBeTruthy();
    expect(within(screen.getByTestId("voice-puck")).getByText("Making…")).toBeTruthy();
    expect(within(screen.getByTestId("voice-zephyr")).getByText("Failed")).toBeTruthy();
    expect(within(screen.getByTestId("voice-leda")).getByText("Old speed")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: /Kore/ }));
    expect(onChange).toHaveBeenCalledWith({ reel_voice_id: "kore" });
    expect(screen.getByTestId("voice-summary").textContent).toMatch(/2 of 6 samples ready · 2 being made · 1 made at another speed/);
  });

  it("▶ plays a ready sample through its signed URL (one at a time); no sample = disabled", async () => {
    render(<NarratorMusic voices={[readyVoice("gacrux"), readyVoice("kore"), voice("puck")]} value={value} savedSpeed={1.12} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Play Puck sample" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play Gacrux sample" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop Gacrux sample" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Play Kore sample" }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Play Gacrux sample" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop Kore sample" }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play Kore sample" })).toBeTruthy();
  });

  it("speed slider shows ×; music switch turns the volume slider off", () => {
    const onChange = vi.fn();
    const { rerender } = render(<NarratorMusic voices={[readyVoice("gacrux")]} value={value} savedSpeed={1.12} onChange={onChange} />);
    expect(screen.getByTestId("speed-value").textContent).toBe("1.12×");
    expect(screen.getByTestId("volume-value").textContent).toBe("18 %");
    const sliders = screen.getAllByRole("slider");
    expect(sliders.map((s) => [s.getAttribute("aria-valuemin"), s.getAttribute("aria-valuemax")])).toEqual([["1", "1.25"], ["5", "40"]]);
    fireEvent.keyDown(sliders[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ reel_speed: 1.13 });
    fireEvent.click(screen.getByRole("switch", { name: /Background music/ }));
    expect(onChange).toHaveBeenCalledWith({ reel_music: false });
    rerender(<NarratorMusic voices={[readyVoice("gacrux")]} value={{ ...value, reel_music: false }} savedSpeed={1.12} onChange={onChange} />);
    expect(screen.getAllByRole("slider")[1].getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText(/voice only/)).toBeTruthy();
  });

  it("Set up voices: confirm, then calls the action again until nothing remains, with live progress", async () => {
    voiceActions.setUpVoicesAction
      .mockResolvedValueOnce({ ok: true, made: 1, skipped: 0, remaining: 1, failed: 0 })
      .mockResolvedValueOnce({ ok: true, made: 1, skipped: 1, remaining: 0, failed: 0 });
    render(<NarratorMusic voices={[voice("builtin"), voice("gacrux", { ref_path: null }), voice("kore", { ref_path: null })]} value={value} savedSpeed={1.12} onChange={() => {}} />);
    expect(screen.getByText(/One-time setup/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Make samples/ })).toBeNull(); // nothing set up yet
    expect((screen.getByRole("radio", { name: /Kore/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Set up voices/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/2 voices/);
    fireEvent.click(within(dialog).getByRole("button", { name: /Set up voices/ }));
    await waitFor(() => expect(voiceActions.setUpVoicesAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Voices are set up/)));
  });

  it("Set up voices stops when a call makes nothing and says why", async () => {
    voiceActions.setUpVoicesAction.mockResolvedValue({ ok: true, made: 0, skipped: 0, remaining: 2, failed: 2, lastError: "Gacrux: Gemini error 429" });
    render(<NarratorMusic voices={[voice("gacrux", { ref_path: null }), voice("kore", { ref_path: null })]} value={value} savedSpeed={1.12} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Set up voices/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Set up voices/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/2 voices could not be set up.*429/)));
    expect(voiceActions.setUpVoicesAction).toHaveBeenCalledTimes(1);
  });

  it("Make samples counts missing/failed/stale, queues them, and waits for a saved speed", async () => {
    voiceActions.queueVoiceSamplesAction.mockResolvedValue({ ok: true, queued: 3, notSetUp: 0 });
    const voices = [voice("builtin"), readyVoice("gacrux"), voice("kore", { sample_status: "failed" }), readyVoice("leda", { sample_key: sampleKey(1) })];
    const { rerender } = render(<NarratorMusic voices={voices} value={value} savedSpeed={1.12} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Make samples (3)" }));
    await waitFor(() => expect(voiceActions.queueVoiceSamplesAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/3 samples in line/)));
    rerender(<NarratorMusic voices={voices} value={{ ...value, reel_speed: 1.2 }} savedSpeed={1.12} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: /Make samples/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Save settings first, so new samples use 1.20×/)).toBeTruthy();
  });

  it("samples appear live (realtime rows)", () => {
    const { rerender } = render(<NarratorMusic voices={[voice("gacrux", { sample_status: "making" })]} value={value} savedSpeed={1.12} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Play Gacrux sample" }) as HTMLButtonElement).disabled).toBe(true);
    live = [readyVoice("gacrux")];
    rerender(<NarratorMusic voices={[voice("gacrux", { sample_status: "making" })]} value={value} savedSpeed={1.12} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Play Gacrux sample" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SettingsForm + Narrator & music", () => {
  const base = { id: 1 as const, caption_template: "Unique {gender} names", hashtags: "#b", handle: "@unique_names", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true,
    title_font: "poppins", meaning_font: "poppins", mark_font: "poppins", title_size: 95, meaning_size: 37, mark_size: 21, text_position: "auto" as const, caption_ai: true, reel_max_images: 30, updated_at: "" };

  it("before 006: the setup note and nothing narrator-related is sent", async () => {
    render(<SettingsForm initial={base} voices={null} />);
    expect(screen.getByText("Narrator & music")).toBeTruthy();
    expect(screen.getByText(/006_reel_voices\.sql/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveSettingsAction).toHaveBeenCalledTimes(1));
    const sent = saveSettingsAction.mock.calls[0][0] as Record<string, unknown>;
    for (const k of ["reel_voice_id", "reel_speed", "reel_music", "reel_music_volume"]) expect(sent).not.toHaveProperty(k);
  });

  it("after 006: the chosen default, speed, music and volume are saved with the rest", async () => {
    render(<SettingsForm initial={{ ...base, reel_voice_id: "gacrux", reel_speed: 1.12, reel_music: true, reel_music_volume: 18 }}
      voices={[readyVoice("gacrux"), readyVoice("kore")]} />);
    fireEvent.click(screen.getByRole("radio", { name: /Kore/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Background music/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveSettingsAction).toHaveBeenCalledTimes(1));
    expect(saveSettingsAction.mock.calls[0][0]).toMatchObject({ reel_voice_id: "kore", reel_speed: 1.12, reel_music: false, reel_music_volume: 18 });
  });
});

describe("VoicePicker (review page)", () => {
  const RID = "11111111-1111-4111-8111-111111111111";
  const voices = [voice("builtin"), readyVoice("gacrux", { tone: "Mature" }), readyVoice("kore", { tone: "Firm" }), voice("puck")];

  it("lists ready voices, shows the Settings default, plays it, and saves a new pick (null = back to the default)", async () => {
    voiceActions.setReelVoiceAction.mockResolvedValue({ ok: true });
    render(<VoicePicker reelId={RID} value={null} defaultId="gacrux" voices={voices} />);
    const trigger = screen.getByRole("combobox", { name: "Narrator" });
    expect(trigger.textContent).toMatch(/Gacrux.*Mature.*default/);
    fireEvent.click(screen.getByRole("button", { name: "Play Gacrux sample" }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringMatching(/^Gacrux/), expect.stringMatching(/^Kore/)]); // no un-sampled voices
    fireEvent.click(options[1]);
    await waitFor(() => expect(voiceActions.setReelVoiceAction).toHaveBeenCalledWith(RID, "kore"));
    expect(screen.getByRole("combobox", { name: "Narrator" }).textContent).toMatch(/Kore/);
    fireEvent.click(screen.getByRole("combobox", { name: "Narrator" }));
    fireEvent.click((await screen.findAllByRole("option"))[0]);
    await waitFor(() => expect(voiceActions.setReelVoiceAction).toHaveBeenLastCalledWith(RID, null));
  });

  it("a refused change rolls back with the reason", async () => {
    voiceActions.setReelVoiceAction.mockResolvedValue({ ok: false, error: "The narrator can only be changed before you approve the script." });
    render(<VoicePicker reelId={RID} value="kore" defaultId="gacrux" voices={voices} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Narrator" }));
    fireEvent.click((await screen.findAllByRole("option"))[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/before you approve/)));
    expect(screen.getByRole("combobox", { name: "Narrator" }).textContent).toMatch(/Kore/);
  });

  it("no samples yet: says the default and links to Settings", () => {
    render(<VoicePicker reelId={RID} value={null} defaultId="gacrux" voices={[voice("gacrux"), voice("builtin")]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/Gacrux/).textContent).toMatch(/Gacrux \(default\)/);
    expect(screen.getByRole("link", { name: /Set up voices in Settings/ }).getAttribute("href")).toBe("/settings");
  });
});

describe("review page length + status label", () => {
  const reel = (p: Partial<ReelRow> = {}): ReelRow => ({
    id: "11111111-1111-4111-8111-111111111111", title: "T", topic: null, stage: "baby", doll_cast: { adult: "a", child: "c" }, status: "script",
    error: null, voice_path: null, words: null, preview_path: null, pc_path: null, duration_s: null, version: 1,
    claimed_at: null, started_at: null, finished_at: null, created_at: "", updated_at: "", ...p,
  });

  it("the word target scales with the narration speed; the picker sits in the Script panel", () => {
    const scenes = Array.from({ length: 2 }, (_, i) => ({
      id: `22222222-2222-4222-8222-00000000000${i}`, reel_id: "r", position: i + 1, beat: "hook", idea: "i", narration: "a b c",
      image_prompt: "", seed: 1, status: "pending" as const, photo_path: null, attempts: 0, error: null, start_s: null, end_s: null,
      version: 1, claimed_at: null, created_at: "", updated_at: "",
    }));
    render(<ScriptReview reel={reel()} scenes={scenes} narrator={{ voices: [readyVoice("gacrux")], defaultId: "gacrux", speed: 1.12 }} />);
    expect(screen.getByText(/Aim for 370–470 words/)).toBeTruthy();
    expect(within(screen.getByTestId("narrator")).getByRole("combobox", { name: "Narrator" })).toBeTruthy();
    cleanup();
    render(<ScriptReview reel={reel()} scenes={scenes} />);
    expect(screen.getByText(/Aim for 330–420 words/)).toBeTruthy();
    expect(screen.queryByTestId("narrator")).toBeNull();
  });

  it("voicing with words = the music bed is being made", () => {
    const w = [{ word: "a", start: 0, end: 1 }];
    expect(reelProgress(reel({ status: "voicing", voice_path: "v", words: w }), []).label).toBe("Music…");
    expect(reelProgress(reel({ status: "voicing", voice_path: "v" }), []).label).toBe("Timing captions…");
    expect(reelProgress(reel({ status: "voicing" }), []).label).toBe("Voice…");
  });
});

