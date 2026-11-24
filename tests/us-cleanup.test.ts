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
  it("does not check used or already-skipped names", () => {
    const p = usCleanupPlan([row("1", "Sakura", { status: "used" }), row("2", "Sakura", { status: "skip" })]);
    expect(p).toEqual({ skip: [], checked: 0 });
  });
  it("keeps a restored name (it carries the note)", () => {
    expect(usCleanupPlan([row("1", "Sakura", { autopilot_note: US_NOTE })]).skip).toEqual([]);
  });
  it("checks two-word names by both words", () => {
    const p = usCleanupPlan([
      row("1", "Vivienne Olivia", { style: "two-word" }),
      row("2", "Vivienne Zzzqx", { style: "two-word" }),
    ]);
    expect(p.skip).toEqual(["2"]);
  });
  it("counts available rows only in checked", () => {
    expect(usCleanupPlan([row("1", "Vivienne"), row("2", "Sakura"), row("3", "Zed", { status: "used" })]).checked).toBe(2);
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
  it("updates in chunks of 200 with the available guard and the note", async () => {
    const many = Array.from({ length: 450 }, (_, i) => row(`s${i}`, "Sakura"));
    // pages of 1,000: the first page is short, so the read stops
    respond = (q) => (op(q, "update") ? { data: [] } : { data: many });
    const r = await usCheckApplyAction();
    expect(r).toEqual({ ok: true, skipped: 450 });
    const ups = fake.queries.filter((q) => op(q, "update"));
    expect(ups.map((q) => (op(q, "in")![2] as string[]).length)).toEqual([200, 200, 50]);
    for (const q of ups) {
      expect(op(q, "update")![1]).toEqual({ status: "skip", autopilot_note: US_NOTE });
      expect(op(q, "eq")).toEqual(["eq", "status", "available"]);
      expect(op(q, "in")![1]).toBe("id");
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
