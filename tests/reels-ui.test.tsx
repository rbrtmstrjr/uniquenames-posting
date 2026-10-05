// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReelRow, ReelSceneRow, ReelSceneStatus, ReelStatus } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";
import { reelProgress, reelSteps, clock, estimateSeconds } from "@/lib/reels/status";

const push = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace }), usePathname: () => "/reels" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
let health = "ready";
vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health, lastSeen: "now", row: null }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let signVersion = 0;
const download = vi.fn(async (...a: string[]) => `https://dl/${a[0]}`);
vi.mock("@/lib/realtime/signed-urls", () => ({
  useSignedUrls: () => (p?: string | null) => (p ? `https://signed/${p}${signVersion ? `?s=${signVersion}` : ""}` : undefined),
  signedDownloadUrl: (p: string, name: string, bucket: string) => download(p, name, bucket),
}));
vi.mock("@/lib/supabase/client", () => {
  const ch = { on: () => ch, subscribe: () => ch };
  return { createClient: () => ({ channel: () => ch, removeChannel: async () => {}, from: () => ({}) }), realtimeAuthReady: async () => {} };
});
// ReelDetail's realtime rows: null = pass the initial rows through; [] = the reel was deleted.
let rows: unknown[] | null = null;
vi.mock("@/lib/realtime/use-table", () => ({ useRealtimeRows: (_t: string, initial: unknown[]) => [rows ?? initial, () => {}] }));
const ok = async () => ({ ok: true as const });
const actions = vi.hoisted(() => ({
  saveReelScriptAction: vi.fn(), approveReelAction: vi.fn(), rewriteReelScriptAction: vi.fn(), deleteReelAction: vi.fn(),
  redoReelSceneAction: vi.fn(), skipReelSceneAction: vi.fn(), rerenderReelAction: vi.fn(), retryReelAction: vi.fn(),
  writeReelScriptAction: vi.fn(),
}));
vi.mock("@/lib/actions/reels", () => actions);

const { ScriptReview } = await import("@/components/reels/script-review");
const { ReelProgress } = await import("@/components/reels/reel-progress");
const { ReelList, ReelsSetup } = await import("@/components/reels/reel-list");
const { NewReelForm } = await import("@/components/reels/new-reel-form");
const { NAV } = await import("@/components/shell/nav");
const { ReelDetail } = await import("@/components/reels/reel-detail");
const { nextLoadDelay } = await import("@/components/reels/reel-list");

beforeAll(polyfillRadix);
afterEach(() => {
  cleanup(); health = "ready"; vi.clearAllMocks();
  Object.values(actions).forEach((f) => f.mockImplementation(ok));
});
Object.values(actions).forEach((f) => f.mockImplementation(ok));

const RID = "11111111-1111-4111-8111-111111111111";
const sid = (i: number) => `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`;
const reel = (p: Partial<ReelRow> = {}): ReelRow => ({
  id: RID, title: "Why toddlers say no", topic: null, stage: "toddler", doll_cast: { adult: "mum doll", child: "toddler doll" },
  status: "script", error: null, voice_path: null, words: null, preview_path: null, pc_path: null, duration_s: null,
  version: 1, claimed_at: null, started_at: null, finished_at: null, created_at: "2026-10-05T02:00:00Z", updated_at: "", ...p,
});
const scene = (i: number, p: Partial<ReelSceneRow> = {}): ReelSceneRow => ({
  id: sid(i), reel_id: RID, position: i, beat: "hook", idea: `Idea ${i}`, narration: `Line number ${i} has some words here`,
  image_prompt: "", seed: 1, status: "pending", photo_path: null, attempts: 0, error: null, start_s: null, end_s: null,
  version: 1, claimed_at: null, created_at: "", updated_at: "", ...p,
});
const scenes = (n: number, status: ReelSceneStatus = "pending") => Array.from({ length: n }, (_, i) => scene(i + 1, { status }));
const btn = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("reelProgress / reelSteps", () => {
  const w = [{ word: "a", start: 0, end: 1 }];
  it.each<[ReelStatus, Partial<ReelRow>, ReelSceneStatus[], string, number]>([
    ["script", {}, ["pending", "pending"], "Script ready", 0],
    ["queued", {}, ["queued", "queued"], "Waiting for your PC", 0],
    ["voicing", {}, ["queued", "queued"], "Voice…", 0],
    ["imaging", { voice_path: "v", words: w }, ["done", "skipped", "generating", "queued"], "Images 2/4", 50],
    ["rendering", { voice_path: "v", words: w }, ["done", "done"], "Making video…", 85],
    ["ready", { voice_path: "v", words: w }, ["done", "done"], "Ready", 100],
    ["needs_attention", { voice_path: "v", words: w }, ["done", "failed"], "Needs attention", 50],
    ["failed", {}, ["queued"], "Failed", 0],
  ])("%s → label and percent from the rows", (status, extra, st, label, pct) => {
    const r = reelProgress(reel({ status, ...extra }), st.map((s, i) => scene(i + 1, { status: s })));
    expect(r.label).toBe(label);
    expect(r.pct).toBe(pct);
  });

  it("steps: voice done, timing done, images active n/m, video waiting", () => {
    const s = reelSteps(reel({ status: "imaging", voice_path: "v", words: w }), [scene(1, { status: "done" }), scene(2, { status: "generating" })]);
    expect(s.map((x) => `${x.label}:${x.state}`)).toEqual(["Voice:done", "Captions timing:done", "Images 1/2:active", "Video:waiting"]);
  });

  it("estimates the spoken length from the words", () => {
    expect(clock(estimateSeconds(380))).toBe("1:40");
  });
});

describe("ScriptReview", () => {
  it("edits a line, shows the live word count and saves only the edited line", async () => {
    render(<ScriptReview reel={reel()} scenes={scenes(3)} />);
    expect(screen.getByText("Line 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull(); // nothing to save yet
    const box = screen.getByRole("textbox", { name: "Line 2 narration" });
    fireEvent.change(box, { target: { value: "A shorter second line" } });
    expect(screen.getByTestId("words-2").textContent).toContain("4 words");
    fireEvent.click(btn(/^Save/));
    await waitFor(() => expect(actions.saveReelScriptAction).toHaveBeenCalledTimes(1));
    expect(actions.saveReelScriptAction).toHaveBeenCalledWith(RID, {
      title: "Why toddlers say no", lines: [{ id: sid(2), narration: "A shorter second line", idea: "Idea 2" }],
    });
  });

  it("a save keeps edits typed while it was saving (only what was saved is cleared)", async () => {
    let finish!: (v: { ok: true }) => void;
    actions.saveReelScriptAction.mockImplementation(() => new Promise((res) => { finish = res; }));
    render(<ScriptReview reel={reel()} scenes={scenes(3)} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Line 1 narration" }), { target: { value: "First edit here" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reel title" }), { target: { value: "New title" } });
    fireEvent.click(btn(/^Save/));
    // typed while the save is in flight
    fireEvent.change(screen.getByRole("textbox", { name: "Line 2 narration" }), { target: { value: "Typed during save" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reel title" }), { target: { value: "Newer title" } });
    await act(async () => { finish({ ok: true }); });
    expect((screen.getByRole("textbox", { name: "Line 1 narration" }) as HTMLTextAreaElement).value).toBe("First edit here");
    expect((screen.getByRole("textbox", { name: "Line 2 narration" }) as HTMLTextAreaElement).value).toBe("Typed during save");
    expect((screen.getByRole("textbox", { name: "Reel title" }) as HTMLInputElement).value).toBe("Newer title");
    expect(screen.getByTestId("words-1").textContent).not.toContain("edited");
    expect(screen.getByTestId("words-2").textContent).toContain("edited");
    expect(btn(/^Save/)).toBeTruthy(); // still something to save
  });

  it("warns on a line over 14 words and blocks Save with the reason", () => {
    render(<ScriptReview reel={reel()} scenes={scenes(2)} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Line 1 narration" }), { target: { value: Array(16).fill("word").join(" ") } });
    expect(screen.getByTestId("words-1").textContent).toMatch(/16 words/);
    expect(btn(/^Save/).disabled).toBe(true);
    expect(screen.getAllByText(/Line 1 is longer than 14 words/).length).toBeGreaterThan(0);
  });

  it("a script with no lines: Approve is disabled and says to tap New script", () => {
    render(<ScriptReview reel={reel()} scenes={[]} />);
    expect(btn(/Approve and make reel/).disabled).toBe(true);
    expect(screen.getByText("This script has no lines. Tap New script.")).toBeTruthy();
  });

  it("shows the totals: words and estimated duration", () => {
    render(<ScriptReview reel={reel()} scenes={scenes(2)} />); // 7 words each
    expect(screen.getByTestId("script-totals").textContent).toMatch(/14\s*words/);
    expect(screen.getByTestId("script-totals").textContent).toMatch(/0:04/);
  });

  it("the picture idea is editable inside a disclosure", () => {
    render(<ScriptReview reel={reel()} scenes={scenes(1)} />);
    expect(screen.queryByRole("textbox", { name: "Line 1 picture idea" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Picture idea/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Line 1 picture idea" }), { target: { value: "Mum doll kneels by the sofa" } });
    expect(btn(/^Save/)).toBeTruthy();
  });

  it("Approve is disabled with the lock reason when the PC is offline", () => {
    health = "offline";
    render(<ScriptReview reel={reel()} scenes={scenes(2)} />);
    expect(btn(/Approve and make reel/).disabled).toBe(true);
    expect(screen.getByText("Your PC is offline — turn it on to generate")).toBeTruthy();
  });

  it("Approve with unsaved edits saves first, then approves", async () => {
    render(<ScriptReview reel={reel()} scenes={scenes(2)} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Reel title" }), { target: { value: "Toddlers and no" } });
    fireEvent.click(btn(/Approve and make reel/));
    await waitFor(() => expect(actions.approveReelAction).toHaveBeenCalledWith(RID));
    expect(actions.saveReelScriptAction).toHaveBeenCalledWith(RID, { title: "Toddlers and no", lines: [] });
    expect(actions.saveReelScriptAction.mock.invocationCallOrder[0]).toBeLessThan(actions.approveReelAction.mock.invocationCallOrder[0]);
  });

  it("a failed save stops the approve", async () => {
    actions.saveReelScriptAction.mockImplementation(async () => ({ ok: false, error: "Line 1 has no words." }));
    render(<ScriptReview reel={reel()} scenes={scenes(2)} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Reel title" }), { target: { value: "Other" } });
    fireEvent.click(btn(/Approve and make reel/));
    await waitFor(() => expect(actions.saveReelScriptAction).toHaveBeenCalled());
    expect(actions.approveReelAction).not.toHaveBeenCalled();
  });

  it("Delete asks first, then deletes and goes back to the list", async () => {
    render(<ScriptReview reel={reel()} scenes={scenes(1)} />);
    fireEvent.click(btn(/Delete/));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete reel" }));
    await waitFor(() => expect(actions.deleteReelAction).toHaveBeenCalledWith(RID));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reels"));
  });
});

describe("ReelProgress", () => {
  const w = [{ word: "a", start: 0, end: 1 }];
  it("shows the status, the step strip, the overall bar and a tile per image", () => {
    const list = [scene(1, { status: "done", photo_path: "r/1.jpg" }), scene(2, { status: "generating" }), scene(3, { status: "queued" }), scene(4, { status: "queued" })];
    render(<ReelProgress reel={reel({ status: "imaging", voice_path: "v", words: w })} scenes={list} />);
    expect(screen.getByTestId("reel-status").textContent).toContain("Images 1/4");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
    const strip = screen.getByTestId("step-strip");
    expect(within(strip).getByText("Images 1/4")).toBeTruthy();
    expect(screen.getAllByTestId("scene-tile")).toHaveLength(4);
    expect(screen.getByRole("img", { name: /Image 1/ }).getAttribute("src")).toBe("https://signed/r/1.jpg");
  });

  it("needs attention: the failed image offers Retry image and Skip image", async () => {
    const list = [scene(1, { status: "done" }), scene(2, { status: "failed", attempts: 3, error: "ComfyUI said no" })];
    render(<ReelProgress reel={reel({ status: "needs_attention", voice_path: "v", words: w })} scenes={list} />);
    const banner = screen.getByTestId("attention-banner");
    expect(within(banner).getByText(/Image 2/)).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: /Skip image/ }));
    await waitFor(() => expect(actions.skipReelSceneAction).toHaveBeenCalledWith(sid(2)));
    fireEvent.click(within(banner).getByRole("button", { name: /Retry image/ }));
    await waitFor(() => expect(actions.redoReelSceneAction).toHaveBeenCalledWith(sid(2)));
  });

  it("Retry image is locked with the reason when the PC is offline", () => {
    health = "comfy-off";
    render(<ReelProgress reel={reel({ status: "needs_attention", voice_path: "v", words: w })} scenes={[scene(1, { status: "failed", attempts: 3 })]} />);
    expect((within(screen.getByTestId("attention-banner")).getByRole("button", { name: /Retry image/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Open ComfyUI Desktop to generate").length).toBeGreaterThan(0);
  });

  it("failed: shows the error with Try again (retryReelAction)", async () => {
    render(<ReelProgress reel={reel({ status: "failed", error: "Voice failed: out of memory" })} scenes={scenes(2, "queued")} />);
    expect(screen.getByText(/Voice failed: out of memory/)).toBeTruthy();
    fireEvent.click(btn(/Try again/));
    await waitFor(() => expect(actions.retryReelAction).toHaveBeenCalledWith(RID));
  });

  it("ready: the 9:16 player has the signed preview URL, Download, the PC path and Make video again", async () => {
    const r = reel({ status: "ready", voice_path: "v", words: w, preview_path: `${RID}/preview.mp4`, pc_path: "C:\\Reels\\2026-10-05 Why toddlers say no.mp4", duration_s: 98 });
    const { container } = render(<ReelProgress reel={r} scenes={[scene(1, { status: "done" }), scene(2, { status: "skipped" })]} />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(`https://signed/${RID}/preview.mp4`);
    expect(screen.getByText(/2026-10-05 Why toddlers say no\.mp4/)).toBeTruthy();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(btn(/Download/));
    await waitFor(() => expect(download).toHaveBeenCalledWith(`${RID}/preview.mp4`, "Why toddlers say no.mp4", "reels"));
    open.mockRestore();
    fireEvent.click(btn(/Make video again/));
    await waitFor(() => expect(actions.rerenderReelAction).toHaveBeenCalledWith(RID));
  });

  it("the status label is a polite live region", () => {
    render(<ReelProgress reel={reel({ status: "queued" })} scenes={scenes(1, "queued")} />);
    expect(screen.getByTestId("reel-status").getAttribute("aria-live")).toBe("polite");
  });

  it("redo on a ready reel also puts the reel back in line without its video (optimistic)", async () => {
    const onPatchReel = vi.fn(), onPatchScene = vi.fn();
    render(<ReelProgress reel={reel({ status: "ready", voice_path: "v", words: w, preview_path: "p.mp4", pc_path: "C:/x.mp4" })}
      scenes={[scene(1, { status: "done", photo_path: "a.jpg" })]} onPatchReel={onPatchReel} onPatchScene={onPatchScene} />);
    fireEvent.click(screen.getByRole("button", { name: /Open image 1/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /New picture/ }));
    await waitFor(() => expect(onPatchReel).toHaveBeenCalledWith({ status: "queued", preview_path: null }));
    expect(onPatchScene).toHaveBeenCalledWith(sid(1), expect.objectContaining({ status: "queued" }));
  });

  it("redo while images are still being made only patches the image", async () => {
    const onPatchReel = vi.fn();
    render(<ReelProgress reel={reel({ status: "imaging", voice_path: "v", words: w })} scenes={[scene(1, { status: "failed", attempts: 3 })]} onPatchReel={onPatchReel} />);
    fireEvent.click(within(screen.getByTestId("attention-banner")).getByRole("button", { name: /Retry image/ }));
    await waitFor(() => expect(actions.redoReelSceneAction).toHaveBeenCalled());
    expect(onPatchReel).not.toHaveBeenCalled();
  });

  it("dialog buttons are disabled while another action runs", async () => {
    let finish!: (v: { ok: true }) => void;
    actions.skipReelSceneAction.mockImplementation(() => new Promise((res) => { finish = res; }));
    render(<ReelProgress reel={reel({ status: "needs_attention", voice_path: "v", words: w })} scenes={[scene(1, { status: "failed", attempts: 3 }), scene(2, { status: "failed", attempts: 3 })]} />);
    fireEvent.click(within(screen.getByTestId("attention-banner")).getAllByRole("button", { name: /Skip image/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Open image 2/ }));
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByRole("button", { name: /Skip image/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: /New picture/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish({ ok: true }); });
  });

  it("keeps the first signed video URL while the preview path is the same; video and tiles follow a new path", () => {
    const r = reel({ status: "ready", voice_path: "v", words: w, preview_path: "r/preview-v3.mp4" });
    const { container, rerender } = render(<ReelProgress reel={r} scenes={[scene(1, { status: "done", photo_path: "r/scenes/1-v2.jpg" })]} />);
    const first = container.querySelector("video")!.getAttribute("src");
    signVersion = 1; // a re-sign hands back a different URL for the same path
    rerender(<ReelProgress reel={{ ...r }} scenes={[scene(1, { status: "done", photo_path: "r/scenes/1-v2.jpg" })]} />);
    expect(container.querySelector("video")!.getAttribute("src")).toBe(first);
    rerender(<ReelProgress reel={{ ...r, preview_path: "r/preview-v4.mp4" }} scenes={[scene(1, { status: "done", photo_path: "r/scenes/1-v3.jpg" })]} />);
    expect(container.querySelector("video")!.getAttribute("src")).toContain("r/preview-v4.mp4");
    expect(screen.getByRole("img", { name: /Image 1/ }).getAttribute("src")).toContain("r/scenes/1-v3.jpg");
    signVersion = 0;
  });

  it("tap an image → dialog with Redo", async () => {
    render(<ReelProgress reel={reel({ status: "ready", voice_path: "v", words: w, preview_path: "p.mp4" })} scenes={[scene(1, { status: "done", photo_path: "a.jpg" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /Open image 1/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /New picture/ }));
    await waitFor(() => expect(actions.redoReelSceneAction).toHaveBeenCalledWith(sid(1)));
  });
});

describe("list, new reel, setup, nav", () => {
  it("list: a card per reel with its status badge, linking to the reel", () => {
    render(<ReelList reels={[{ ...reel({ status: "imaging", voice_path: "v", words: [] }), scenes: [scene(1, { status: "done", photo_path: "x.jpg" }), scene(2, { status: "queued" })] }]} />);
    const link = screen.getByRole("link", { name: /Why toddlers say no/ });
    expect(link.getAttribute("href")).toBe(`/reels/${RID}`);
    expect(within(link).getByText("Images 1/2")).toBeTruthy();
  });

  it("empty list: invites a first reel", () => {
    render(<ReelList reels={[]} />);
    expect(screen.getByText("No reels yet")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /New reel/ })[0].getAttribute("href")).toBe("/reels/new");
  });

  it("setup state names the migration", () => {
    render(<ReelsSetup />);
    expect(screen.getByText(/Run supabase\/migrations\/005_reels\.sql in Supabase to turn on Reels\./)).toBeTruthy();
  });

  it("new reel: Write script sends the topic and opens the review page", async () => {
    actions.writeReelScriptAction.mockImplementation(async () => ({ ok: true, reelId: RID }));
    render(<NewReelForm />);
    fireEvent.change(screen.getByRole("textbox", { name: /Topic/ }), { target: { value: "  bedtime battles " } });
    await act(async () => { fireEvent.click(btn(/Write script/)); });
    expect(actions.writeReelScriptAction).toHaveBeenCalledWith({ topic: "bedtime battles" });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/reels/${RID}`));
  });

  it("new reel: an error shows inline with Try again", async () => {
    actions.writeReelScriptAction.mockImplementation(async () => ({ ok: false, error: "Could not write the script: timeout" }));
    render(<NewReelForm />);
    await act(async () => { fireEvent.click(btn(/Write script/)); });
    expect(screen.getByRole("alert").textContent).toContain("Could not write the script: timeout");
    expect(btn(/Try again/)).toBeTruthy();
  });

  it("list reloads are debounced with a 3 s max wait", () => {
    expect(nextLoadDelay(0)).toBe(500);
    expect(nextLoadDelay(2800)).toBe(200);
    expect(nextLoadDelay(5000)).toBe(0);
  });

  it("a reel deleted elsewhere sends the page back to the list", async () => {
    rows = [];
    render(<ReelDetail reel={reel({ status: "queued" })} scenes={[]} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reels"));
    rows = null;
  });

  it("nav has a Reels tab", () => {
    expect(NAV.some((n) => n.href === "/reels" && n.label === "Reels")).toBe(true);
  });
});
