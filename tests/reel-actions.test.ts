import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReelRow, ReelSceneRow } from "@/lib/db/types";
import type { ReelScript, ReelScriptInput, ReelScriptResult } from "@/lib/ai/reel-script";
import { scenePrompt } from "@/lib/reels/prompt";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
let owner: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => owner }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const writeMock = vi.fn<(i: ReelScriptInput) => Promise<ReelScriptResult>>();
vi.mock("@/lib/ai/reel-script", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/reel-script")>()), writeReelScript: (i: ReelScriptInput) => writeMock(i) }));
const A = await import("@/lib/actions/reels");

const REEL = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333331";
const S2 = "33333333-3333-4333-8333-333333333332";
const S3 = "33333333-3333-4333-8333-333333333333";
const CAST = { adult: "the mom doll: a crocheted mom", child: "the toddler doll: a crocheted toddler" };

const script = (title = "The Quiet Hour", n = 3): ReelScript => ({
  title, stage: "toddler", cast: CAST,
  scenes: Array.from({ length: n }, (_, i) => ({ beat: i === 0 ? "hook" : "build", narration: `Line ${i + 1} is spoken softly to you mama.`, idea: `The mom doll does thing ${i + 1}.` })),
});
const ok = (s: ReelScript): ReelScriptResult => ({ ok: true, script: s });

const reelRow = (o: Partial<ReelRow> = {}): ReelRow => ({
  id: REEL, title: "Old Title", topic: "tantrums", stage: "toddler", doll_cast: CAST, status: "script", error: null,
  voice_path: null, words: null, preview_path: null, pc_path: null, duration_s: null, version: 4,
  claimed_at: null, started_at: null, finished_at: null, created_at: "", updated_at: "", ...o,
});
const sceneRow = (id: string, position: number, o: Partial<ReelSceneRow> = {}): ReelSceneRow => ({
  id, reel_id: REEL, position, beat: position === 1 ? "hook" : "build", idea: `idea ${position}`, narration: `narration ${position}`,
  image_prompt: `prompt ${position}`, seed: 1000 + position, status: "pending", photo_path: null, attempts: 0, error: null,
  start_s: null, end_s: null, version: 2, claimed_at: null, created_at: "", updated_at: "", ...o,
});

type Health = "ready" | "comfy-off";
interface World {
  reel?: ReelRow | null; scenes?: ReelSceneRow[]; made?: { title: string; stage: string | null }[]; health?: Health;
  maxImages?: number; speed?: number; reelUpdated?: boolean; sceneUpdated?: boolean; deleted?: boolean;
  listError?: { message: string; code?: string }; sceneInsertError?: { message: string };
  files?: Record<string, { name: string; id: string | null }[]>;
  /** A scene whose guarded update matches nothing (changed in another tab). */
  sceneMisses?: string; stillPending?: { id: string }[];
}
let w: World = {};
function world(o: World = {}) {
  w = { reel: reelRow(), scenes: [sceneRow(S1, 1), sceneRow(S2, 2), sceneRow(S3, 3)], made: [{ title: "Old Title", stage: "toddler" }],
    health: "ready", maxImages: 30, reelUpdated: true, sceneUpdated: true, deleted: true, ...o };
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    const has = (m: string) => q.ops.some((x) => x[0] === m);
    const eqv = (col: string) => q.ops.find((x) => x[0] === "eq" && x[1] === col)?.[2];
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: w.health === "ready" } };
    if (q.table === "settings") return { data: { id: 1, reel_max_images: w.maxImages, ...(w.speed === undefined ? {} : { reel_speed: w.speed }) } };
    if (q.table === "reels") {
      if (has("insert")) return { data: { id: NEW } };
      if (has("update")) return { data: w.reelUpdated ? [{ id: REEL }] : [] };
      if (has("delete")) return { data: w.deleted ? [{ id: REEL }] : [] };
      if (eqv("id")) return { data: w.reel };
      return w.listError ? { error: w.listError } : { data: w.made };
    }
    if (q.table === "reel_scenes") {
      if (has("insert")) return w.sceneInsertError ? { error: w.sceneInsertError } : { data: null };
      if (has("update")) return { data: w.sceneUpdated && eqv("id") !== w.sceneMisses ? [{ id: "x" }] : [] };
      if (has("delete")) return { data: null };
      if (eqv("status") === "pending") return { data: w.stillPending ?? [] };
      if (eqv("id")) return { data: w.scenes!.find((s) => s.id === eqv("id")) ?? null };
      return { data: w.scenes };
    }
    if (q.table.startsWith("storage:")) return { data: w.files?.[q.ops[0][1] as string] ?? [] };
    return undefined;
  };
}
const qs = (table: string, m: string) => fake.queries.filter((q) => q.table === table && q.ops.some((o) => o[0] === m));
const patchOf = (q: Query) => op(q, "update")![1] as Record<string, unknown>;
const rowsOf = (q: Query) => op(q, "insert")![1] as Record<string, unknown>[];

beforeEach(() => { owner = { id: "owner" }; writeMock.mockReset(); world(); });
afterEach(() => vi.useRealTimers());

describe("every action: owner first, then the id", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["write", () => A.writeReelScriptAction({})],
    ["rewrite", () => A.rewriteReelScriptAction(REEL)],
    ["save", () => A.saveReelScriptAction(REEL, { title: "T", lines: [] })],
    ["approve", () => A.approveReelAction(REEL)],
    ["redo", () => A.redoReelSceneAction(S1)],
    ["skip", () => A.skipReelSceneAction(S1)],
    ["rerender", () => A.rerenderReelAction(REEL)],
    ["retry", () => A.retryReelAction(REEL)],
    ["delete", () => A.deleteReelAction(REEL)],
  ];
  for (const [name, call] of calls) {
    it(`${name}: signed out throws before any query`, async () => {
      owner = null;
      await expect(call()).rejects.toThrow(/Not signed in/);
      expect(fake.queries).toHaveLength(0);
      expect(writeMock).not.toHaveBeenCalled();
    });
  }
  const byId: [string, (id: string) => Promise<{ ok: boolean }>][] = [
    ["rewrite", (id) => A.rewriteReelScriptAction(id)],
    ["save", (id) => A.saveReelScriptAction(id, { title: "T", lines: [] })],
    ["approve", (id) => A.approveReelAction(id)],
    ["redo", (id) => A.redoReelSceneAction(id)],
    ["skip", (id) => A.skipReelSceneAction(id)],
    ["rerender", (id) => A.rerenderReelAction(id)],
    ["retry", (id) => A.retryReelAction(id)],
    ["delete", (id) => A.deleteReelAction(id)],
  ];
  for (const [name, call] of byId) {
    it(`${name}: a bad id is refused without a query`, async () => {
      expect((await call("nope")).ok).toBe(false);
      expect(fake.queries).toHaveLength(0);
    });
  }
});

describe("writeReelScriptAction", () => {
  it("writes, then inserts the reel (script, stage, doll_cast) and pending scenes with built prompts and seeds", async () => {
    writeMock.mockResolvedValueOnce(ok(script()));
    const r = await A.writeReelScriptAction({ topic: "  potty   training " });
    expect(r).toEqual({ ok: true, reelId: NEW });
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][0]).toMatchObject({ topic: "potty training", maxScenes: 30, alreadyMade: [{ title: "Old Title", stage: "toddler" }], timeoutMs: 120_000 });
    const [reelIns] = qs("reels", "insert");
    expect(rowsOf(reelIns)).toEqual({ title: "The Quiet Hour", topic: "potty training", stage: "toddler", doll_cast: CAST, status: "script" });
    const rows = rowsOf(qs("reel_scenes", "insert")[0]);
    expect(rows).toHaveLength(3);
    rows.forEach((row, i) => {
      const s = script().scenes[i];
      expect(row).toMatchObject({ reel_id: NEW, position: i + 1, beat: s.beat, idea: s.idea, narration: s.narration, status: "pending",
        image_prompt: scenePrompt(CAST, s.idea, s.beat, i) });
      expect(Number.isSafeInteger(row.seed) && (row.seed as number) > 0 && (row.seed as number) < 2 ** 32).toBe(true);
    });
  });

  it("blank topic: Gemini picks; topic stored as null; max images defaults to 40 before 005's column", async () => {
    world({ maxImages: undefined });
    writeMock.mockResolvedValueOnce(ok(script()));
    expect((await A.writeReelScriptAction({ topic: "   " })).ok).toBe(true);
    expect(writeMock.mock.calls[0][0].topic).toBeUndefined();
    expect(writeMock.mock.calls[0][0].maxScenes).toBe(40);
    expect(rowsOf(qs("reels", "insert")[0])).toMatchObject({ topic: null });
  });

  it("refuses a topic over 120 characters before calling Gemini", async () => {
    const r = await A.writeReelScriptAction({ topic: "x".repeat(121) });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/120/) });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("a title already made (any case / spacing) is rewritten, then accepted", async () => {
    writeMock.mockResolvedValueOnce(ok(script(" old   TITLE"))).mockResolvedValueOnce(ok(script("Brand New")));
    const r = await A.writeReelScriptAction({});
    expect(r.ok).toBe(true);
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(rowsOf(qs("reels", "insert")[0])).toMatchObject({ title: "Brand New" });
  });

  it("after 2 rewrites that still repeat a title: a clear message and nothing saved", async () => {
    writeMock.mockResolvedValue(ok(script("Old Title")));
    const r = await A.writeReelScriptAction({});
    expect(writeMock).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/already made/i) });
    expect(qs("reels", "insert")).toHaveLength(0);
  });

  it("a validation error (too short) is retried too; the last error is shown when every try fails", async () => {
    writeMock.mockResolvedValueOnce({ ok: false, error: "Script too short: 12 scenes (needs at least 23)." }).mockResolvedValueOnce(ok(script()));
    expect((await A.writeReelScriptAction({})).ok).toBe(true);
    writeMock.mockReset();
    writeMock.mockResolvedValue({ ok: false, error: "Line 3 is longer than 14 words." });
    const r = await A.writeReelScriptAction({});
    expect(writeMock).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Line 3 is longer than 14 words/) });
  });

  it("one 270 s budget: each call gets min(120 s, what is left); no call when too little is left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    writeMock
      .mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 200_000); return { ok: false, error: "Gemini timed out." }; })
      .mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 65_000); return { ok: false, error: "Script too short: 100 words (needs at least 264)." }; });
    const r = await A.writeReelScriptAction({});
    expect(writeMock.mock.calls.map((c) => c[0].timeoutMs)).toEqual([120_000, 70_000]);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/too short/) });
  });

  it("before 005 runs: a clear message", async () => {
    for (const listError of [{ message: 'relation "public.reels" does not exist', code: "42P01" }, { message: "Could not find the table 'public.reels' in the schema cache", code: "PGRST205" }]) {
      world({ listError });
      const r = await A.writeReelScriptAction({});
      expect(r).toEqual({ ok: false, error: "Run supabase/migrations/005_reels.sql first." });
    }
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("if the scenes cannot be saved, the new reel is deleted again", async () => {
    world({ sceneInsertError: { message: "boom" } });
    writeMock.mockResolvedValueOnce(ok(script()));
    const r = await A.writeReelScriptAction({});
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/boom/) });
    const del = qs("reels", "delete");
    expect(del).toHaveLength(1);
    expect(del[0].ops).toContainEqual(["eq", "id", NEW]);
  });
});

describe("rewriteReelScriptAction", () => {
  it("keeps the topic, replaces title / stage / doll_cast (version-guarded) and every scene", async () => {
    const s = script("Another Title", 2);
    writeMock.mockResolvedValueOnce(ok(s));
    expect(await A.rewriteReelScriptAction(REEL)).toEqual({ ok: true });
    expect(writeMock.mock.calls[0][0]).toMatchObject({ topic: "tantrums", maxScenes: 30 });
    const [u] = qs("reels", "update");
    expect(patchOf(u)).toEqual({ title: "Another Title", stage: "toddler", doll_cast: CAST, version: 5 });
    expect(u.ops).toContainEqual(["eq", "version", 4]);
    expect(u.ops).toContainEqual(["eq", "status", "script"]);
    expect(qs("reel_scenes", "delete")[0].ops).toContainEqual(["eq", "reel_id", REEL]);
    expect(rowsOf(qs("reel_scenes", "insert")[0]).map((r) => r.position)).toEqual([1, 2]);
  });

  it("only while the reel is a script", async () => {
    world({ reel: reelRow({ status: "queued" }) });
    expect((await A.rewriteReelScriptAction(REEL)).ok).toBe(false);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("a reel changed meanwhile: nothing replaced", async () => {
    world({ reelUpdated: false });
    writeMock.mockResolvedValueOnce(ok(script("Another Title")));
    expect(await A.rewriteReelScriptAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/changed/) });
    expect(qs("reel_scenes", "delete")).toHaveLength(0);
  });
});

describe("saveReelScriptAction", () => {
  const lines = [
    { id: S1, narration: "narration 1", idea: "idea 1" },
    { id: S2, narration: "A brand new spoken line for scene two", idea: "idea 2" },
    { id: S3, narration: "narration 3", idea: "The toddler doll looks at the camera in the garden" },
  ];

  it("saves the title (guarded) and only the changed lines; a changed idea rebuilds its prompt", async () => {
    expect(await A.saveReelScriptAction(REEL, { title: "  New   Title ", lines })).toEqual({ ok: true });
    const [u] = qs("reels", "update");
    expect(patchOf(u)).toEqual({ title: "New Title", version: 5 });
    expect(u.ops).toContainEqual(["eq", "version", 4]);
    expect(u.ops).toContainEqual(["eq", "status", "script"]);
    const ups = qs("reel_scenes", "update");
    expect(ups).toHaveLength(2);
    const by = (id: string) => ups.find((q) => q.ops.some((o) => o[0] === "eq" && o[1] === "id" && o[2] === id))!;
    expect(patchOf(by(S2))).toEqual({ narration: "A brand new spoken line for scene two", idea: "idea 2", version: 3 });
    const idea = "The toddler doll looks toward the viewer in the garden";
    expect(patchOf(by(S3))).toEqual({ narration: "narration 3", idea, image_prompt: scenePrompt(CAST, idea, "build", 2), version: 3 });
    expect(by(S3).ops).toContainEqual(["eq", "version", 2]);
    expect(by(S3).ops).toContainEqual(["eq", "status", "pending"]);
  });

  it("validates the title and lines", async () => {
    const bad: [string, Parameters<typeof A.saveReelScriptAction>[1]][] = [
      ["no title", { title: "  ", lines }],
      ["long title", { title: "x".repeat(81), lines }],
      ["empty line", { title: "T", lines: [{ id: S1, narration: " ", idea: "i" }] }],
      ["long line", { title: "T", lines: [{ id: S1, narration: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen", idea: "i" }] }],
      ["empty idea", { title: "T", lines: [{ id: S1, narration: "n", idea: "" }] }],
      ["bad id", { title: "T", lines: [{ id: "x", narration: "n", idea: "i" }] }],
    ];
    for (const [why, input] of bad) {
      const r = await A.saveReelScriptAction(REEL, input);
      expect(r.ok, why).toBe(false);
    }
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("a bad line is named by its scene's position, not its place in the list", async () => {
    const r = await A.saveReelScriptAction(REEL, { title: "T", lines: [{ id: S3, narration: "", idea: "i" }] });
    expect(r).toEqual({ ok: false, error: "Line 3 has no words." });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("refuses a line from another reel, a title another reel has, or a reel already approved", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    expect((await A.saveReelScriptAction(REEL, { title: "T", lines: [{ id: other, narration: "n", idea: "i" }] })).ok).toBe(false);
    world({ made: [{ title: "Old Title", stage: null }, { title: "Taken Title", stage: null }] });
    expect(await A.saveReelScriptAction(REEL, { title: "taken  title", lines })).toEqual({ ok: false, error: expect.stringMatching(/already/i) });
    world({ reel: reelRow({ status: "queued" }) });
    expect((await A.saveReelScriptAction(REEL, { title: "T", lines })).ok).toBe(false);
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("keeping its own title is fine", async () => {
    expect((await A.saveReelScriptAction(REEL, { title: "old title", lines: [] })).ok).toBe(true);
  });
});

describe("approveReelAction", () => {
  it("queues every pending scene first, then the reel (guarded)", async () => {
    expect(await A.approveReelAction(REEL)).toEqual({ ok: true });
    expect(fake.queries.filter(isUpdate).map((q) => q.table)).toEqual(["reel_scenes", "reel_scenes", "reel_scenes", "reels"]);
    const [u] = qs("reels", "update");
    expect(patchOf(u)).toMatchObject({ status: "queued", error: null, version: 5 });
    expect(u.ops).toContainEqual(["eq", "version", 4]);
    expect(u.ops).toContainEqual(["eq", "status", "script"]);
    const ups = qs("reel_scenes", "update");
    ups.forEach((s, i) => {
      expect(patchOf(s)).toEqual({ status: "queued", version: 3 });
      expect(s.ops).toContainEqual(["eq", "id", [S1, S2, S3][i]]);
      expect(s.ops).toContainEqual(["eq", "version", 2]);
      expect(s.ops).toContainEqual(["eq", "status", "pending"]);
    });
  });

  it("already approved by another call: the scenes it queued are left untouched", async () => {
    world({ sceneUpdated: false, reelUpdated: false });
    expect(await A.approveReelAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/changed/) });
    const ups = qs("reel_scenes", "update");
    expect(ups).toHaveLength(3);
    expect(ups.every((q) => patchOf(q).status === "queued")).toBe(true);
  });

  it("obeys the generate lock", async () => {
    world({ health: "comfy-off" });
    expect(await A.approveReelAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/ComfyUI/i) });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("only from script; a stale version puts the scenes back to pending", async () => {
    world({ reel: reelRow({ status: "ready" }) });
    expect((await A.approveReelAction(REEL)).ok).toBe(false);
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
    world({ reelUpdated: false });
    expect(await A.approveReelAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/changed/) });
    const ups = qs("reel_scenes", "update");
    expect(ups).toHaveLength(6);
    ups.slice(3).forEach((s, i) => {
      expect(patchOf(s)).toEqual({ status: "pending", version: 4 });
      expect(s.ops).toContainEqual(["eq", "id", [S1, S2, S3][i]]);
      expect(s.ops).toContainEqual(["eq", "version", 3]);
      expect(s.ops).toContainEqual(["eq", "status", "queued"]);
    });
  });

  it("refuses a reel with no lines, without writing", async () => {
    world({ scenes: [] });
    expect(await A.approveReelAction(REEL)).toEqual({ ok: false, error: "This script has no lines. Tap New script." });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("a line that changed in another tab (not moved): reverts its own moves, the reel stays in script", async () => {
    world({ sceneMisses: S2 });
    expect(await A.approveReelAction(REEL)).toEqual({ ok: false, error: "The script changed in another tab. Try again." });
    expect(qs("reels", "update")).toHaveLength(0);
    const reverts = qs("reel_scenes", "update").slice(3);
    expect(reverts.map((q) => q.ops.find((o) => o[0] === "eq" && o[1] === "id")?.[2])).toEqual([S1, S3]);
    reverts.forEach((q) => expect(patchOf(q)).toEqual({ status: "pending", version: 4 }));
  });

  it("a pending line still left after the moves (another tab): reverts and refuses", async () => {
    world({ stillPending: [{ id: S3 }] });
    expect(await A.approveReelAction(REEL)).toEqual({ ok: false, error: "The script changed in another tab. Try again." });
    expect(qs("reels", "update")).toHaveLength(0);
    expect(qs("reel_scenes", "update")).toHaveLength(6);
    const check = fake.queries.find((q) => q.table === "reel_scenes" && !isUpdate(q) && q.ops.some((o) => o[0] === "eq" && o[1] === "status"))!;
    expect(check.ops).toContainEqual(["eq", "reel_id", REEL]);
    expect(check.ops).toContainEqual(["eq", "status", "pending"]);
  });
});

describe("redoReelSceneAction", () => {
  const done = () => [sceneRow(S1, 1, { status: "done", seed: 77, attempts: 1, photo_path: "p" }), sceneRow(S2, 2, { status: "done" })];

  it("finished reel: scene back in line (new seed, attempts 0) and the reel re-queued with no preview", async () => {
    world({ reel: reelRow({ status: "ready", preview_path: "x/preview.mp4", pc_path: "C:/x.mp4" }), scenes: done() });
    expect(await A.redoReelSceneAction(S1)).toEqual({ ok: true });
    const [s] = qs("reel_scenes", "update");
    const p = patchOf(s);
    expect(p).toMatchObject({ status: "queued", attempts: 0, error: null, claimed_at: null, version: 3 });
    expect(p.seed).not.toBe(77);
    expect(Number.isSafeInteger(p.seed) && (p.seed as number) > 0).toBe(true);
    expect(s.ops).toContainEqual(["eq", "version", 2]);
    expect(s.ops).toContainEqual(["in", "status", ["done", "failed", "skipped"]]);
    const [r] = qs("reels", "update");
    expect(patchOf(r)).toMatchObject({ status: "queued", preview_path: null, error: null, claimed_at: null, finished_at: null, version: 5 });
    expect(patchOf(r)).not.toHaveProperty("pc_path");   // the worker replaces the old PC file
    expect(r.ops).toContainEqual(["eq", "version", 4]);
  });

  it("while images are still being made, only the scene changes (the worker's reel claim is left alone)", async () => {
    world({ reel: reelRow({ status: "imaging", claimed_at: "now" }), scenes: done() });
    expect(await A.redoReelSceneAction(S1)).toEqual({ ok: true });
    expect(qs("reel_scenes", "update")).toHaveLength(1);
    expect(qs("reels", "update")).toHaveLength(0);
  });

  it("a skipped image can be made again (reset like a failed one)", async () => {
    world({ reel: reelRow({ status: "ready" }), scenes: [sceneRow(S1, 1, { status: "skipped", attempts: 3, error: "x" }), sceneRow(S2, 2, { status: "done" })] });
    expect(await A.redoReelSceneAction(S1)).toEqual({ ok: true });
    expect(patchOf(qs("reel_scenes", "update")[0])).toMatchObject({ status: "queued", attempts: 0, error: null });
    expect(qs("reels", "update")).toHaveLength(1);
  });

  it("refuses a scene not finished, a script reel, and obeys the lock", async () => {
    world({ reel: reelRow({ status: "imaging" }), scenes: [sceneRow(S1, 1, { status: "generating" })] });
    expect((await A.redoReelSceneAction(S1)).ok).toBe(false);
    world({ reel: reelRow({ status: "script" }), scenes: done() });
    expect((await A.redoReelSceneAction(S1)).ok).toBe(false);
    world({ reel: reelRow({ status: "ready" }), scenes: done(), health: "comfy-off" });
    expect(await A.redoReelSceneAction(S1)).toEqual({ ok: false, error: expect.stringMatching(/ComfyUI/i) });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("if the reel changed meanwhile, the scene is put back", async () => {
    world({ reel: reelRow({ status: "ready" }), scenes: done(), reelUpdated: false });
    expect(await A.redoReelSceneAction(S1)).toEqual({ ok: false, error: expect.stringMatching(/changed/) });
    const ups = qs("reel_scenes", "update");
    expect(ups).toHaveLength(2);
    expect(patchOf(ups[1])).toMatchObject({ status: "done", seed: 77, attempts: 1, version: 4 });
    expect(ups[1].ops).toContainEqual(["eq", "version", 3]);
  });
});

describe("skipReelSceneAction", () => {
  it("only when the reel needs attention: scene skipped, reel back in line", async () => {
    world({ reel: reelRow({ status: "needs_attention", error: "An image failed 3 times." }), scenes: [sceneRow(S1, 1, { status: "failed", attempts: 3 })] });
    expect(await A.skipReelSceneAction(S1)).toEqual({ ok: true });
    const [s] = qs("reel_scenes", "update");
    expect(patchOf(s)).toMatchObject({ status: "skipped", error: null, claimed_at: null, version: 3 });
    expect(s.ops).toContainEqual(["eq", "version", 2]);
    const [r] = qs("reels", "update");
    expect(patchOf(r)).toMatchObject({ status: "queued", error: null, claimed_at: null, version: 5 });
    expect(r.ops).toContainEqual(["eq", "status", "needs_attention"]);
    expect(r.ops).toContainEqual(["eq", "version", 4]);
  });

  it("a reel in line or being made whose image failed 3 times: only the scene is skipped", async () => {
    for (const status of ["queued", "voicing", "imaging", "rendering"] as const) {
      world({ reel: reelRow({ status, claimed_at: "now" }), scenes: [sceneRow(S1, 1, { status: "failed", attempts: 3 })] });
      expect(await A.skipReelSceneAction(S1), status).toEqual({ ok: true });
      expect(patchOf(qs("reel_scenes", "update")[0])).toMatchObject({ status: "skipped", version: 3 });
      expect(qs("reels", "update")).toHaveLength(0);
    }
  });

  it("refused otherwise", async () => {
    world({ reel: reelRow({ status: "imaging" }), scenes: [sceneRow(S1, 1, { status: "failed" })] });
    expect((await A.skipReelSceneAction(S1)).ok).toBe(false);
    world({ reel: reelRow({ status: "queued" }), scenes: [sceneRow(S1, 1, { status: "failed", attempts: 2 })] });
    expect((await A.skipReelSceneAction(S1)).ok).toBe(false);
    world({ reel: reelRow({ status: "needs_attention" }), scenes: [sceneRow(S1, 1, { status: "done" })] });
    expect((await A.skipReelSceneAction(S1)).ok).toBe(false);
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });
});

describe("rerenderReelAction", () => {
  const finished = () => [sceneRow(S1, 1, { status: "done" }), sceneRow(S2, 2, { status: "skipped" })];

  it("ready / failed with every image done or skipped: back in line without its preview", async () => {
    world({ reel: reelRow({ status: "failed", error: "ffmpeg", preview_path: null }), scenes: finished() });
    expect(await A.rerenderReelAction(REEL)).toEqual({ ok: true });
    const [r] = qs("reels", "update");
    expect(patchOf(r)).toMatchObject({ status: "queued", preview_path: null, error: null, claimed_at: null, finished_at: null, version: 5 });
    expect(r.ops).toContainEqual(["eq", "version", 4]);
    expect(r.ops).toContainEqual(["in", "status", ["ready", "failed"]]);
  });

  it("refuses unfinished images, the wrong status, and obeys the lock", async () => {
    world({ reel: reelRow({ status: "ready" }), scenes: [sceneRow(S1, 1, { status: "done" }), sceneRow(S2, 2, { status: "queued" })] });
    expect((await A.rerenderReelAction(REEL)).ok).toBe(false);
    world({ reel: reelRow({ status: "ready" }), scenes: [sceneRow(S1, 1, { status: "skipped" })] });
    expect((await A.rerenderReelAction(REEL)).ok).toBe(false);
    world({ reel: reelRow({ status: "imaging" }), scenes: finished() });
    expect((await A.rerenderReelAction(REEL)).ok).toBe(false);
    world({ reel: reelRow({ status: "ready" }), scenes: finished(), health: "comfy-off" });
    expect(await A.rerenderReelAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/ComfyUI/i) });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
  });
});

describe("retryReelAction", () => {
  it("a stopped reel goes back in line: failed images get fresh attempts, the voice / words / done images stay", async () => {
    world({ reel: reelRow({ status: "failed", error: "boom", voice_path: "v", words: [] }),
      scenes: [sceneRow(S1, 1, { status: "failed", attempts: 3 }), sceneRow(S2, 2, { status: "done" }), sceneRow(S3, 3, { status: "skipped" })] });
    expect(await A.retryReelAction(REEL)).toEqual({ ok: true });
    expect(fake.queries.filter(isUpdate).map((q) => q.table)).toEqual(["reels", "reel_scenes"]);
    const [s] = qs("reel_scenes", "update");
    expect(patchOf(s)).toEqual({ status: "queued", attempts: 0, error: null, claimed_at: null, version: 3 });
    expect(s.ops).toContainEqual(["eq", "id", S1]);
    expect(s.ops).toContainEqual(["eq", "version", 2]);
    expect(s.ops).toContainEqual(["eq", "status", "failed"]);
    const [r] = qs("reels", "update");
    expect(patchOf(r)).toEqual({ status: "queued", error: null, claimed_at: null, finished_at: null, preview_path: null, version: 5 });
    expect(r.ops).toContainEqual(["eq", "version", 4]);
    expect(r.ops).toContainEqual(["eq", "status", "failed"]);
  });

  it("only from failed; obeys the lock; stale version", async () => {
    world({ reel: reelRow({ status: "ready" }) });
    expect((await A.retryReelAction(REEL)).ok).toBe(false);
    world({ reel: reelRow({ status: "failed" }), health: "comfy-off" });
    expect(await A.retryReelAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/ComfyUI/i) });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
    world({ reel: reelRow({ status: "failed" }), reelUpdated: false });
    expect(await A.retryReelAction(REEL)).toEqual({ ok: false, error: expect.stringMatching(/changed/) });
    expect(qs("reel_scenes", "update")).toHaveLength(0);
  });

  it("timed but every image skipped: refused with how to fix it; before timing it may retry", async () => {
    const skipped = [sceneRow(S1, 1, { status: "skipped" }), sceneRow(S2, 2, { status: "skipped" })];
    world({ reel: reelRow({ status: "failed", voice_path: "v", words: [] }), scenes: skipped });
    expect(await A.retryReelAction(REEL)).toEqual({ ok: false, error: "Every image was skipped. Tap an image to make it again." });
    expect(fake.queries.filter(isUpdate)).toHaveLength(0);
    world({ reel: reelRow({ status: "failed", words: null }), scenes: skipped });
    expect((await A.retryReelAction(REEL)).ok).toBe(true);
  });
});

describe("deleteReelAction", () => {
  it("deletes the row, then every stored file under the reel's folder (best effort)", async () => {
    world({ files: {
      [REEL]: [{ name: "voice.wav", id: "f1" }, { name: "preview.mp4", id: "f2" }, { name: "scenes", id: null }],
      [`${REEL}/scenes`]: [{ name: "01.jpg", id: "f3" }, { name: "02.jpg", id: "f4" }],
    } });
    expect(await A.deleteReelAction(REEL)).toEqual({ ok: true });
    expect(qs("reels", "delete")[0].ops).toContainEqual(["eq", "id", REEL]);
    expect(fake.removed).toEqual([{ bucket: "reels", paths: [`${REEL}/voice.wav`, `${REEL}/preview.mp4`, `${REEL}/scenes/01.jpg`, `${REEL}/scenes/02.jpg`] }]);
  });

  it("not found; nothing in storage means nothing removed", async () => {
    expect(await A.deleteReelAction(REEL)).toEqual({ ok: true });
    expect(fake.removed).toEqual([]);
    world({ deleted: false });
    expect(await A.deleteReelAction(REEL)).toEqual({ ok: false, error: "Reel not found." });
  });
});

describe("voices + music (006)", () => {
  it("the script's word target follows the saved narration speed (1 before 006)", async () => {
    writeMock.mockResolvedValue(ok(script()));
    world({ speed: 1.2 });
    await A.writeReelScriptAction({});
    expect(writeMock.mock.calls[0][0].speed).toBe(1.2);
    world();
    await A.writeReelScriptAction({});
    expect(writeMock.mock.calls[1][0].speed).toBe(1);
    world({ speed: 1.12 });
    await A.rewriteReelScriptAction(REEL);
    expect(writeMock.mock.calls[2][0].speed).toBe(1.12);
  });

  it("a music bed that failed ('') is tried again by Make video again / Try again / New picture; a made one is kept", async () => {
    const finished = [sceneRow(S1, 1, { status: "done" })];
    world({ reel: reelRow({ status: "ready", music_path: "" }), scenes: finished });
    expect(await A.rerenderReelAction(REEL)).toEqual({ ok: true });
    expect(patchOf(qs("reels", "update")[0])).toMatchObject({ music_path: null });
    world({ reel: reelRow({ status: "failed", music_path: "" }), scenes: finished });
    expect(await A.retryReelAction(REEL)).toEqual({ ok: true });
    expect(patchOf(qs("reels", "update")[0])).toMatchObject({ music_path: null });
    world({ reel: reelRow({ status: "ready", music_path: "" }), scenes: finished });
    expect(await A.redoReelSceneAction(S1)).toEqual({ ok: true });
    expect(patchOf(qs("reels", "update")[0])).toMatchObject({ music_path: null });
    world({ reel: reelRow({ status: "ready", music_path: `${REEL}/music-v1.flac` }), scenes: finished });
    expect(await A.rerenderReelAction(REEL)).toEqual({ ok: true });
    expect(patchOf(qs("reels", "update")[0])).not.toHaveProperty("music_path");
    // before 006 (no column on the row): never named in the update
    world({ reel: reelRow({ status: "ready" }), scenes: finished });
    expect(await A.rerenderReelAction(REEL)).toEqual({ ok: true });
    expect(patchOf(qs("reels", "update")[0])).not.toHaveProperty("music_path");
  });
});
