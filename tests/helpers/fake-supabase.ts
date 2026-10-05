// A tiny stand-in for the Supabase query builder: records every call chain and
// answers each awaited query through `respond`, so server actions can be tested
// without a network. Each query is { table, ops: [[method, ...args], ...] }.
export type Op = [string, ...unknown[]];
export interface Query { table: string; ops: Op[] }
export type Respond = (q: Query) => { data?: unknown; error?: { message: string } | null } | undefined;

const CHAIN = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "ilike", "in", "is", "not", "order", "limit", "single", "maybeSingle"];

export function fakeSupabase(respond: Respond) {
  const queries: Query[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const from = (table: string) => {
    const q: Query = { table, ops: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) b[m] = (...args: unknown[]) => { q.ops.push([m, ...args]); return b; };
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      const r = respond(q) ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, bad);
    };
    return b;
  };
  const rpc = (fn: string, args: unknown) => {
    rpcs.push({ fn, args });
    const r = respond({ table: `rpc:${fn}`, ops: [["rpc", args]] }) ?? {};
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  };
  return { client: { from, rpc }, queries, rpcs };
}

export const op = (q: Query, m: string) => q.ops.find((o) => o[0] === m);
export const isUpdate = (q: Query) => q.ops.some((o) => o[0] === "update");
