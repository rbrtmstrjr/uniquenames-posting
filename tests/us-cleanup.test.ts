import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Respond } from "./helpers/fake-supabase";

let gate = true;
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/names/us-list", async (real) => ({ ...(await real<typeof import("@/lib/names/us-list")>()), usGateOn: () => gate }));
const { usCleanupPlan } = await import("@/lib/names/us-cleanup");
const { usCheckPreviewAction, usCheckApplyAction } = await import("@/lib/actions/names");
const { US_NOTE } = await import("@/lib/names/us-list");

type Row = Parameters<typeof usCleanupPlan>[0][number];
const row = (id: string, name: string, o: Partial<Row> = {}): Row =>
  ({ id, name, gender: "girl", style: "single", status: "available", autopilot_note: null, ...o });

describe("usCleanupPlan", () => {
  it("skips an available non-US name (Sakura) and a too-common one (Olivia)", () => {
    expect(usCleanupPlan([row("1", "Sakura"), row("2", "Olivia")]).skip).toEqual(["1", "2"]);
  });
  it("keeps an available name in the US range (Vivienne)", () => {
    expect(usCleanupPlan([row("1", "Vivienne")])).toEqual({ skip: [], checked: 1 });
  });
  it("does not check used, reserved or already-skipped names", () => {
    const p = usCleanupPlan([row("1", "Sakura", { status: "used" }), row("2", "Sakura", { status: "skip" }), row("3", "Sakura", { status: "reserved" })]);
    expect(p).toEqual({ skip: [], checked: 0 });
  });
  it("checks pending names too: a pending non-US name is skipped, a pending US name is kept", () => {
    const p = usCleanupPlan([row("1", "Sakura", { status: "pending" }), row("2", "Vivienne", { status: "pending" })]);
    expect(p).toEqual({ skip: ["1"], checked: 2 });
  });
  it("keeps a restored name (it carries the note)", () => {
    expect(usCleanupPlan([row("1", "Sakura", { autopilot_note: US_NOTE })]).skip).toEqual([]);
  });
  it("keeps any name with a note: Autopilot's own skips the owner brought back too (names-step's rule)", () => {
    const p = usCleanupPlan([
      row("1", "Sakura", { autopilot_note: "made up" }),
      row("2", "Olivia", { status: "pending", autopilot_note: "too close to Aria" }),
      row("3", "Sakura", { autopilot_note: "" }),
    ]);
    expect(p).toEqual({ skip: ["3"], checked: 3 });
  });
  it("checks two-word names by both words", () => {
    const p = usCleanupPlan([
      row("1", "Vivienne Olivia", { style: "two-word" }),
      row("2", "Vivienne Zzzqx", { style: "two-word" }),
    ]);
    expect(p.skip).toEqual(["2"]);
  });
  it("counts available and pending rows only in checked", () => {
    expect(usCleanupPlan([row("1", "Vivienne"), row("2", "Sakura", { status: "pending" }), row("3", "Zed", { status: "used" })]).checked).toBe(2);
  });
});

const names = [row("a", "Sakura"), row("b", "Olivia"), row("c", "Vivienne")];

beforeEach(() => {
  gate = true;
  respond = (q) => (op(q, "update") ? { data: [] } : { data: names });
  fake = fakeSupabase((q) => respond(q));
});

describe("usCheckPreviewAction", () => {
  it("returns the counts and changes nothing", async () => {
    expect(await usCheckPreviewAction()).toEqual({ ok: true, skip: 2, checked: 3 });
    expect(fake.queries.some((q) => op(q, "update"))).toBe(false);
  });
  it("reads available and pending names", async () => {
    await usCheckPreviewAction();
    const read = fake.queries.find((q) => q.table === "names")!;
    expect(op(read, "in")).toEqual(["in", "status", ["available", "pending"]]);
    expect(op(read, "eq")).toBeUndefined();
  });
  it("refuses when the gate is off", async () => {
    gate = false;
    expect(await usCheckPreviewAction()).toEqual({ ok: false, error: "This check is for Unique Names." });
  });
  it("returns a failed result on a read error", async () => {
    respond = () => ({ error: { message: "boom" } });
    expect(await usCheckPreviewAction()).toEqual({ ok: false, error: "boom" });
  });
});

describe("usCheckApplyAction", () => {
  it("updates in chunks of 100 with the available-or-pending guard and the note", async () => {
    const many = Array.from({ length: 450 }, (_, i) => row(`s${i}`, "Sakura", { status: i % 2 ? "pending" : "available" }));
    // pages of 1,000: the first page is short, so the read stops
    respond = (q) => (op(q, "update") ? { data: [] } : { data: many });
    const r = await usCheckApplyAction();
    expect(r).toEqual({ ok: true, skipped: 450 });
    const ups = fake.queries.filter((q) => op(q, "update"));
    const ins = (q: (typeof ups)[number]) => q.ops.filter((o) => o[0] === "in");
    expect(ups.map((q) => (ins(q).find((o) => o[1] === "id")![2] as string[]).length)).toEqual([100, 100, 100, 100, 50]);
    for (const q of ups) {
      expect(op(q, "update")![1]).toEqual({ status: "skip", autopilot_note: US_NOTE });
      expect(ins(q)).toContainEqual(["in", "status", ["available", "pending"]]);
      expect(op(q, "eq")).toBeUndefined();
    }
  });
  it("refuses when the gate is off", async () => {
    gate = false;
    expect(await usCheckApplyAction()).toEqual({ ok: false, error: "This check is for Unique Names." });
    expect(fake.queries.length).toBe(0);
  });
  it("returns a failed result when an update fails", async () => {
    respond = (q) => (op(q, "update") ? { error: { message: "nope" } } : { data: names });
    expect(await usCheckApplyAction()).toEqual({ ok: false, error: "nope" });
  });
  it("returns a failed result on a read error", async () => {
    respond = () => ({ error: { message: "boom" } });
    expect(await usCheckApplyAction()).toEqual({ ok: false, error: "boom" });
  });
});
