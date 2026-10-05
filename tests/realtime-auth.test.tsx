// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

// A fake browser client that records the order of auth vs. channel joins.
const calls: string[] = [];
let handler: ((p: unknown) => void) | null = null;
let resolveSession: (() => void) | null = null;
const fake = {
  auth: {
    getSession: () => new Promise((res) => { resolveSession = () => { calls.push("session"); res({ data: { session: { access_token: "user-jwt" } } }); }; }),
  },
  realtime: { setAuth: async (t: string) => { calls.push(`setAuth:${t}`); } },
  channel: () => {
    calls.push("channel");
    const ch = {
      on: (_e: string, _f: unknown, cb: (p: unknown) => void) => { handler = cb; return ch; },
      subscribe: () => { calls.push("subscribe"); return ch; },
    };
    return ch;
  },
  removeChannel: async () => {},
};
vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => fake }));

const { useRealtimeRows } = await import("@/lib/realtime/use-table");

beforeEach(() => { calls.length = 0; handler = null; resolveSession = null; });
afterEach(cleanup);

type R = { id: number; last_seen: string };
const seed: R[] = [{ id: 1, last_seen: "a" }];

describe("useRealtimeRows auth", () => {
  it("joins the channel only after the signed-in token is on the socket", async () => {
    renderHook(() => useRealtimeRows<R>("worker_status", seed, { key: "w" }));
    await act(async () => {});
    expect(calls).not.toContain("channel"); // must not join as anon before the session loads
    await act(async () => { resolveSession!(); });
    expect(calls).toEqual(["session", "setAuth:user-jwt", "channel", "subscribe"]);
  });

  it("ignores an event the server could not authorize and resyncs instead", async () => {
    const refetch = vi.fn(async () => [{ id: 1, last_seen: "fresh" }]);
    const { result } = renderHook(() => useRealtimeRows<R>("worker_status", seed, { key: "w", refetch }));
    await act(async () => { resolveSession!(); });
    refetch.mockClear();
    await act(async () => {
      handler!({ eventType: "UPDATE", new: {}, old: {}, errors: ["Error 401: Unauthorized"] });
    });
    expect(result.current[0]).toEqual([{ id: 1, last_seen: "fresh" }]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("applies a normal update", async () => {
    const { result } = renderHook(() => useRealtimeRows<R>("worker_status", seed, { key: "w" }));
    await act(async () => { resolveSession!(); });
    await act(async () => { handler!({ eventType: "UPDATE", new: { id: 1, last_seen: "b" }, old: {}, errors: null }); });
    expect(result.current[0]).toEqual([{ id: 1, last_seen: "b" }]);
  });
});
