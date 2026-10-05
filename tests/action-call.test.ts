import { describe, expect, it, vi } from "vitest";
import { OFFLINE_ERROR, callAction, optimistic } from "@/lib/actions/call";

describe("callAction", () => {
  it("passes results through", async () => {
    expect(await callAction(async () => ({ ok: true as const, n: 1 }))).toEqual({ ok: true, n: 1 });
    expect(await callAction(async () => ({ ok: false as const, error: "nope" }))).toEqual({ ok: false, error: "nope" });
  });

  it("turns a thrown call (offline) into a failed result", async () => {
    expect(await callAction(async () => { throw new Error("fetch failed"); })).toEqual({ ok: false, error: OFFLINE_ERROR });
  });
});

describe("optimistic", () => {
  it("applies before the action runs and keeps it on success", async () => {
    const log: string[] = [];
    const r = await optimistic(() => log.push("apply"), () => log.push("rollback"), async () => { log.push("action"); return { ok: true as const }; });
    expect(r.ok).toBe(true);
    expect(log).toEqual(["apply", "action"]);
  });

  it("rolls back on a failed result or a thrown call", async () => {
    const rollback = vi.fn();
    expect((await optimistic(() => {}, rollback, async () => ({ ok: false as const, error: "x" }))).ok).toBe(false);
    expect((await optimistic(() => {}, rollback, async () => { throw new Error("offline"); })).ok).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(2);
  });
});
