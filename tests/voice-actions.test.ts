import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReelRow, ReelVoiceRow } from "@/lib/db/types";
import { sampleKey } from "@/lib/reels/voices";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
let owner: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => owner }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const clip = vi.fn<(voice: string, text: string, timeoutMs?: number) => Promise<{ ok: true; wav: Buffer } | { ok: false; error: string }>>();
vi.mock("@/lib/ai/tts", () => ({ REF_TEXT: "Hello, mama.", geminiVoiceClip: (v: string, t: string, ms?: number) => clip(v, t, ms) }));
const A = await import("@/lib/actions/voices");

const REEL = "11111111-1111-4111-8111-111111111111";
const WAV = Buffer.from("RIFF....WAVEfmt ");

const voice = (id: string, o: Partial<ReelVoiceRow> = {}): ReelVoiceRow => ({
  id, label: id === "builtin" ? "Built-in" : id[0].toUpperCase() + id.slice(1), tone: "Warm", gender: null,
  ref_path: null, sample_path: null, sample_status: "missing", sample_key: null, error: null, version: 1,
  claimed_at: null, created_at: "", updated_at: "", ...o,
});
const reelRow = (o: Partial<ReelRow> = {}): ReelRow => ({
  id: REEL, title: "T", topic: null, stage: "baby", doll_cast: { adult: "a", child: "c" }, status: "script", error: null,
  voice_path: null, words: null, preview_path: null, pc_path: null, duration_s: null, version: 3,
  claimed_at: null, started_at: null, finished_at: null, created_at: "", updated_at: "", ...o,
});

interface World {
  voices: ReelVoiceRow[]; settings?: Record<string, unknown> | null; reel?: ReelRow | null;
  voicesError?: { message: string; code?: string }; uploadError?: { message: string; statusCode?: string };
  updateMisses?: boolean; reelUpdated?: boolean; reelUpdateError?: { message: string; code?: string };
}
let w: World;
function world(o: Partial<World> = {}) {
  w = { voices: [voice("builtin"), voice("gacrux"), voice("kore"), voice("puck")], settings: { id: 1, reel_speed: 1.12 }, reel: reelRow(), reelUpdated: true, ...o };
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    const has = (m: string) => q.ops.some((x) => x[0] === m);
    const eqv = (col: string) => q.ops.find((x) => x[0] === "eq" && x[1] === col)?.[2];
    if (q.table === "settings") return { data: w.settings };
    if (q.table === "reel_voices") {
      if (w.voicesError) return { error: w.voicesError };
      if (has("update")) {
        if (w.updateMisses) return { data: [] };
        const v = w.voices.find((x) => x.id === eqv("id"));
        if (v) Object.assign(v, op(q, "update")![1] as object);
        return { data: v ? [{ id: v.id }] : [] };
      }
      if (eqv("id")) return { data: w.voices.find((x) => x.id === eqv("id")) ?? null };
      return { data: w.voices.map((v) => ({ ...v })) };
    }
    if (q.table === "reels") {
      if (has("update")) return w.reelUpdateError ? { error: w.reelUpdateError } : { data: w.reelUpdated ? [{ id: REEL }] : [] };
      return { data: w.reel };
    }
    if (q.table === "storage:reels") return w.uploadError ? { error: w.uploadError } : undefined;
    return undefined;
  };
}
const updates = (table: string) => fake.queries.filter((q) => q.table === table && q.ops.some((o) => o[0] === "update"));
const patchOf = (q: Query) => op(q, "update")![1] as Record<string, unknown>;
const eqOf = (q: Query, col: string) => q.ops.find((x) => x[0] === "eq" && x[1] === col)?.[2];

beforeEach(() => {
  owner = { id: "owner" };
  process.env.GEMINI_API_KEY = "k";
  clip.mockReset();
  clip.mockResolvedValue({ ok: true, wav: WAV });
  world();
});

describe("owner first", () => {
  for (const [name, call] of [
    ["setUp", () => A.setUpVoicesAction()], ["samples", () => A.queueVoiceSamplesAction()], ["reel voice", () => A.setReelVoiceAction(REEL, "kore")],
  ] as const) {
    it(`${name}: signed out throws before any query or Gemini call`, async () => {
      owner = null;
      await expect(call()).rejects.toThrow(/Not signed in/);
      expect(fake.queries).toHaveLength(0);
      expect(clip).not.toHaveBeenCalled();
    });
  }
});

describe("setUpVoicesAction", () => {
  it("makes a clip for every voice without one, uploads it insert-only, sets ref_path and queues the sample", async () => {
    const r = await A.setUpVoicesAction();
    expect(r).toEqual({ ok: true, made: 3, skipped: 0, remaining: 0, failed: 0 });
    expect(clip.mock.calls.map((c) => c[0]).sort()).toEqual(["Gacrux", "Kore", "Puck"]);
    expect(clip.mock.calls[0][1]).toBe("Hello, mama.");
    expect(fake.uploads.map((u) => u.path).sort()).toEqual(["voices/gacrux/ref.wav", "voices/kore/ref.wav", "voices/puck/ref.wav"]);
    for (const u of fake.uploads) {
      expect(u.bucket).toBe("reels");
      expect(u.body).toBe(WAV);
      expect(u.opts).toEqual({ contentType: "audio/wav", upsert: false });
    }
    const g = updates("reel_voices").find((q) => eqOf(q, "id") === "gacrux")!;
    expect(patchOf(g)).toMatchObject({ ref_path: "voices/gacrux/ref.wav", sample_status: "queued", error: null, version: 2 });
    expect(eqOf(g, "version")).toBe(1);
  });

  it("skips voices that already have a clip (idempotent) and queues the built-in sample once", async () => {
    world({ voices: [voice("builtin"), voice("gacrux", { ref_path: "voices/gacrux/ref.wav", sample_status: "ready" }), voice("kore")] });
    const r = await A.setUpVoicesAction();
    expect(r).toMatchObject({ ok: true, made: 1, skipped: 1, remaining: 0 });
    expect(clip).toHaveBeenCalledTimes(1);
    expect(clip.mock.calls[0][0]).toBe("Kore");
    const b = updates("reel_voices").find((q) => eqOf(q, "id") === "builtin")!;
    expect(patchOf(b)).toMatchObject({ sample_status: "queued" });
    expect(patchOf(b)).not.toHaveProperty("ref_path");
    // nothing to do the second time
    clip.mockClear();
    const again = await A.setUpVoicesAction();
    expect(again).toMatchObject({ ok: true, made: 0, skipped: 2, remaining: 0 });
    expect(clip).not.toHaveBeenCalled();
    expect(updates("reel_voices").filter((q) => eqOf(q, "id") === "builtin")).toHaveLength(1);
  });

  it("a clip uploaded by an earlier run that stopped (already exists) still gets its ref_path", async () => {
    world({ voices: [voice("kore")], uploadError: { message: "The resource already exists", statusCode: "409" } });
    expect(await A.setUpVoicesAction()).toMatchObject({ ok: true, made: 1, remaining: 0, failed: 0 });
  });

  it("a Gemini or upload failure is counted, the rest go on, and remaining says what is left", async () => {
    clip.mockImplementation(async (v) => (v === "Kore" ? { ok: false, error: "Gemini error 500" } : { ok: true, wav: WAV }));
    const r = await A.setUpVoicesAction();
    expect(r).toMatchObject({ ok: true, made: 2, remaining: 1, failed: 1, lastError: "Kore: Gemini error 500" });
    world({ voices: [voice("kore")], uploadError: { message: "new row violates row-level security policy" } });
    expect(await A.setUpVoicesAction()).toMatchObject({ ok: true, made: 0, remaining: 1, failed: 1 });
    expect(updates("reel_voices")).toHaveLength(0);
  });

  it("stops starting clips when the time budget is nearly spent and returns remaining", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    clip.mockImplementation(async () => { now += 100_000; return { ok: true, wav: WAV }; });
    world({ voices: ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => voice(`voice${x}`)) });
    const r = await A.setUpVoicesAction();
    spy.mockRestore();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.made).toBeLessThan(8);
      expect(r.made).toBeGreaterThan(0);
      expect(r.remaining).toBe(8 - r.made);
    }
    for (const c of clip.mock.calls) expect(c[2]).toBeLessThanOrEqual(60_000);
  });

  it("before migration 006: the setup message, no Gemini call", async () => {
    world({ voicesError: { message: "relation \"public.reel_voices\" does not exist", code: "42P01" } });
    const r = await A.setUpVoicesAction();
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/006_reel_voices\.sql/) });
    expect(clip).not.toHaveBeenCalled();
  });

  it("no Gemini key: a clear error, nothing uploaded", async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await A.setUpVoicesAction()).toEqual({ ok: false, error: "GEMINI_API_KEY is not set." });
    expect(fake.uploads).toHaveLength(0);
  });
});

describe("queueVoiceSamplesAction", () => {
  const KEY = sampleKey(1.12);
  it("queues set-up voices with no sample, a failed one or a stale one; leaves ready/in-line ones and voices not set up", async () => {
    world({ voices: [
      voice("builtin"),                                                                            // missing, set up → queue
      voice("gacrux", { ref_path: "r", sample_status: "ready", sample_key: KEY }),                  // current → leave
      voice("kore", { ref_path: "r", sample_status: "ready", sample_key: sampleKey(1.05), version: 4 }), // stale → queue
      voice("puck", { ref_path: "r", sample_status: "failed" }),                                    // failed → queue
      voice("zephyr", { ref_path: "r", sample_status: "making" }),                                  // being made → leave
      voice("leda", { ref_path: "r", sample_status: "queued" }),                                    // in line → leave
      voice("orus"),                                                                               // not set up → leave
    ] });
    const r = await A.queueVoiceSamplesAction();
    expect(r).toEqual({ ok: true, queued: 3, notSetUp: 1 });
    expect(updates("reel_voices").map((q) => eqOf(q, "id")).sort()).toEqual(["builtin", "kore", "puck"]);
    const k = updates("reel_voices").find((q) => eqOf(q, "id") === "kore")!;
    expect(patchOf(k)).toMatchObject({ sample_status: "queued", error: null, version: 5 });
    expect(eqOf(k, "version")).toBe(4);
  });

  it("the key follows the saved speed (before 006 the speed is 1.00)", async () => {
    world({ settings: { id: 1, reel_speed: 1.2 }, voices: [voice("kore", { ref_path: "r", sample_status: "ready", sample_key: KEY })] });
    expect(await A.queueVoiceSamplesAction()).toMatchObject({ queued: 1 });
    world({ settings: { id: 1 }, voices: [voice("kore", { ref_path: "r", sample_status: "ready", sample_key: sampleKey(1) })] });
    expect(await A.queueVoiceSamplesAction()).toMatchObject({ queued: 0 });
  });

  it("a row changed in the meantime is not counted", async () => {
    world({ updateMisses: true, voices: [voice("builtin")] });
    expect(await A.queueVoiceSamplesAction()).toMatchObject({ ok: true, queued: 0 });
  });
});

describe("setReelVoiceAction", () => {
  it("sets the voice on a reel in script (version-guarded) and clears what a voice makes", async () => {
    world({ voices: [voice("kore", { ref_path: "voices/kore/ref.wav" })] });
    expect(await A.setReelVoiceAction(REEL, "kore")).toEqual({ ok: true });
    const u = updates("reels")[0];
    expect(patchOf(u)).toEqual({ voice_id: "kore", voice_path: null, words: null, music_path: null, preview_path: null, version: 4 });
    expect(eqOf(u, "version")).toBe(3);
    expect(eqOf(u, "status")).toBe("script");
  });

  it("null goes back to the Settings default; the built-in voice needs no clip", async () => {
    expect(await A.setReelVoiceAction(REEL, null)).toEqual({ ok: true });
    expect(patchOf(updates("reels")[0]).voice_id).toBeNull();
    expect(await A.setReelVoiceAction(REEL, "builtin")).toEqual({ ok: true });
  });

  it("refuses after approval, a voice not set up, an unknown voice, bad ids and a stale reel", async () => {
    world({ reel: reelRow({ status: "imaging" }), voices: [voice("kore", { ref_path: "r" })] });
    expect(await A.setReelVoiceAction(REEL, "kore")).toEqual({ ok: false, error: "The narrator can only be changed before you approve the script." });
    world({ voices: [voice("kore")] });
    expect((await A.setReelVoiceAction(REEL, "kore")).ok).toBe(false);
    world({ voices: [] });
    expect(await A.setReelVoiceAction(REEL, "nope")).toEqual({ ok: false, error: "Pick a voice from the list." });
    expect(await A.setReelVoiceAction(REEL, "Bad Id!")).toEqual({ ok: false, error: "Pick a voice from the list." });
    expect((await A.setReelVoiceAction("x", "kore")).ok).toBe(false);
    world({ reelUpdated: false });
    expect(await A.setReelVoiceAction(REEL, null)).toEqual({ ok: false, error: expect.stringMatching(/just changed/) });
    world({ reel: null });
    expect(await A.setReelVoiceAction(REEL, null)).toEqual({ ok: false, error: "Reel not found." });
    expect(updates("reels")).toHaveLength(0);
  });

  it("before migration 006 (no voice_id column): the setup message", async () => {
    world({ reelUpdateError: { message: "Could not find the 'voice_id' column of 'reels' in the schema cache", code: "PGRST204" } });
    expect(await A.setReelVoiceAction(REEL, null)).toEqual({ ok: false, error: expect.stringMatching(/006_reel_voices\.sql/) });
  });
});
