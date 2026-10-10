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
  w = { voices: [voice("builtin"), voice("gacrux"), voice("sulafat"), voice("achernar"), voice("kore")], settings: { id: 1, reel_speed: 1.12 }, reel: reelRow(), reelUpdated: true, ...o };
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
    ["setUp", () => A.setUpVoicesAction()], ["samples", () => A.queueVoiceSamplesAction()], ["reel voice", () => A.setReelVoiceAction(REEL, "sulafat")],
  ] as const) {
    it(`${name}: signed out throws before any query or Gemini call`, async () => {
      owner = null;
      await expect(call()).rejects.toThrow(/Not signed in/);
      expect(fake.queries).toHaveLength(0);
      expect(clip).not.toHaveBeenCalled();
    });
  }
});

describe("setUpVoicesAction (house voices only, 2.6.0)", () => {
  it("makes a clip for every house voice without one, uploads it insert-only, sets ref_path and queues the sample", async () => {
    const r = await A.setUpVoicesAction();
    expect(r).toEqual({ ok: true, made: 3, skipped: 0, remaining: 0, failed: 0 });
    expect(clip.mock.calls.map((c) => c[0]).sort()).toEqual(["Achernar", "Gacrux", "Sulafat"]);   // never Kore or the built-in voice
    expect(clip.mock.calls[0][1]).toBe("Hello, mama.");
    expect(fake.uploads.map((u) => u.path).sort()).toEqual(["voices/achernar/ref.wav", "voices/gacrux/ref.wav", "voices/sulafat/ref.wav"]);
    for (const u of fake.uploads) {
      expect(u.bucket).toBe("reels");
      expect(u.body).toBe(WAV);
      expect(u.opts).toEqual({ contentType: "audio/wav", upsert: false });
    }
    const g = updates("reel_voices").find((q) => eqOf(q, "id") === "gacrux")!;
    expect(patchOf(g)).toMatchObject({ ref_path: "voices/gacrux/ref.wav", sample_status: "queued", error: null, version: 2 });
    expect(eqOf(g, "version")).toBe(1);
    expect(updates("reel_voices").map((q) => eqOf(q, "id"))).not.toContain("builtin");
    expect(updates("reel_voices").map((q) => eqOf(q, "id"))).not.toContain("kore");
  });

  it("skips house voices that already have a clip (idempotent); the built-in and other voices are left alone", async () => {
    world({ voices: [voice("builtin"), voice("gacrux", { ref_path: "voices/gacrux/ref.wav", sample_status: "ready" }), voice("sulafat"), voice("kore")] });
    const r = await A.setUpVoicesAction();
    expect(r).toMatchObject({ ok: true, made: 1, skipped: 1, remaining: 0 });
    expect(clip).toHaveBeenCalledTimes(1);
    expect(clip.mock.calls[0][0]).toBe("Sulafat");
    expect(updates("reel_voices").map((q) => eqOf(q, "id"))).toEqual(["sulafat"]);
    // nothing to do the second time
    clip.mockClear();
    const again = await A.setUpVoicesAction();
    expect(again).toMatchObject({ ok: true, made: 0, skipped: 2, remaining: 0 });
    expect(clip).not.toHaveBeenCalled();
  });

  it("a clip uploaded by an earlier run that stopped (already exists) still gets its ref_path", async () => {
    world({ voices: [voice("sulafat")], uploadError: { message: "The resource already exists", statusCode: "409" } });
    expect(await A.setUpVoicesAction()).toMatchObject({ ok: true, made: 1, remaining: 0, failed: 0 });
  });

  it("a Gemini or upload failure is counted, the rest go on, and remaining says what is left", async () => {
    clip.mockImplementation(async (v) => (v === "Sulafat" ? { ok: false, error: "Gemini error 500" } : { ok: true, wav: WAV }));
    const r = await A.setUpVoicesAction();
    expect(r).toMatchObject({ ok: true, made: 2, remaining: 1, failed: 1, lastError: "Sulafat: Gemini error 500" });
    world({ voices: [voice("sulafat")], uploadError: { message: "new row violates row-level security policy" } });
    expect(await A.setUpVoicesAction()).toMatchObject({ ok: true, made: 0, remaining: 1, failed: 1 });
    expect(updates("reel_voices")).toHaveLength(0);
  });

  it("stops starting clips when the time budget is nearly spent and returns remaining", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    clip.mockImplementation(async () => { now += 100_000; return { ok: true, wav: WAV }; });
    world({ voices: ["gacrux", "sulafat", "vindemiatrix", "achernar"].map((x) => voice(x)) });
    const r = await A.setUpVoicesAction();
    spy.mockRestore();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.made).toBeLessThan(4);
      expect(r.made).toBeGreaterThan(0);
      expect(r.remaining).toBe(4 - r.made);
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

describe("queueVoiceSamplesAction (house voices only)", () => {
  const KEY = sampleKey(1.12);
  it("queues set-up house voices with no sample, a failed one or a stale one; leaves the rest", async () => {
    world({ voices: [
      voice("builtin"),                                                                            // hidden → leave
      voice("gacrux", { ref_path: "r", sample_status: "ready", sample_key: KEY }),                  // current → leave
      voice("sulafat", { ref_path: "r", sample_status: "ready", sample_key: "e0.35-t0.7-c0.5-s1.12-g1", version: 4 }), // old style → queue
      voice("achernar", { ref_path: "r", sample_status: "failed" }),                                // failed → queue
      voice("vindemiatrix"),                                                                       // not set up → leave
      voice("kore", { ref_path: "r", sample_status: "failed" }),                                    // not a house voice → leave
      voice("leda", { ref_path: "r", sample_status: "missing" }),                                   // not a house voice → leave
    ] });
    const r = await A.queueVoiceSamplesAction();
    expect(r).toEqual({ ok: true, queued: 2, notSetUp: 1 });
    expect(updates("reel_voices").map((q) => eqOf(q, "id")).sort()).toEqual(["achernar", "sulafat"]);
    const k = updates("reel_voices").find((q) => eqOf(q, "id") === "sulafat")!;
    expect(patchOf(k)).toMatchObject({ sample_status: "queued", error: null, version: 5 });
    expect(eqOf(k, "version")).toBe(4);
  });

  it("the key follows the saved speed (before 006 the speed is 1.00)", async () => {
    world({ settings: { id: 1, reel_speed: 1.2 }, voices: [voice("sulafat", { ref_path: "r", sample_status: "ready", sample_key: KEY })] });
    expect(await A.queueVoiceSamplesAction()).toMatchObject({ queued: 1 });
    world({ settings: { id: 1 }, voices: [voice("sulafat", { ref_path: "r", sample_status: "ready", sample_key: sampleKey(1) })] });
    expect(await A.queueVoiceSamplesAction()).toMatchObject({ queued: 0 });
  });

  it("a row changed in the meantime is not counted", async () => {
    world({ updateMisses: true, voices: [voice("gacrux", { ref_path: "r" })] });
    expect(await A.queueVoiceSamplesAction()).toMatchObject({ ok: true, queued: 0 });
  });
});

describe("setReelVoiceAction", () => {
  it("sets a house voice on a reel in script (version-guarded) and clears what a voice makes", async () => {
    world({ voices: [voice("sulafat", { ref_path: "voices/sulafat/ref.wav" })] });
    expect(await A.setReelVoiceAction(REEL, "sulafat")).toEqual({ ok: true });
    const u = updates("reels")[0];
    expect(patchOf(u)).toEqual({ voice_id: "sulafat", voice_path: null, words: null, music_path: null, preview_path: null, version: 4 });
    expect(eqOf(u, "version")).toBe(3);
    expect(eqOf(u, "status")).toBe("script");
  });

  it("null goes back to the Settings default", async () => {
    expect(await A.setReelVoiceAction(REEL, null)).toEqual({ ok: true });
    expect(patchOf(updates("reels")[0]).voice_id).toBeNull();
  });

  it("refuses after approval, a voice not set up, voices outside the house list, bad ids and a stale reel", async () => {
    world({ reel: reelRow({ status: "imaging" }), voices: [voice("sulafat", { ref_path: "r" })] });
    expect(await A.setReelVoiceAction(REEL, "sulafat")).toEqual({ ok: false, error: "The narrator can only be changed before you approve the script." });
    world({ voices: [voice("sulafat")] });
    expect((await A.setReelVoiceAction(REEL, "sulafat")).ok).toBe(false);
    world({ voices: [voice("kore", { ref_path: "r" })] });
    expect(await A.setReelVoiceAction(REEL, "kore")).toEqual({ ok: false, error: "Pick a voice from the list." });
    expect(await A.setReelVoiceAction(REEL, "builtin")).toEqual({ ok: false, error: "Pick a voice from the list." });
    world({ voices: [] });
    expect(await A.setReelVoiceAction(REEL, "achernar")).toEqual({ ok: false, error: "Pick a voice from the list." });
    expect(await A.setReelVoiceAction(REEL, "Bad Id!")).toEqual({ ok: false, error: "Pick a voice from the list." });
    expect((await A.setReelVoiceAction("x", "sulafat")).ok).toBe(false);
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
