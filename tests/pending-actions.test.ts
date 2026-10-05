import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Respond } from "./helpers/fake-supabase";

// Pending (AI-suggested) names/themes: the existing actions must never turn them into
// "available" behind the owner's back, and a pending name can be removed.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { deleteNameAction, setSkipAction } = await import("@/lib/actions/names");
const { setArchivedAction } = await import("@/lib/actions/themes");

beforeEach(() => {
  respond = (q) => (q.ops.some((o) => o[0] === "update" || o[0] === "delete") ? { data: [{ id: "x" }] } : { data: [] });
  fake = fakeSupabase((q) => respond(q));
});

describe("pending names", () => {
  it("can be deleted (rejecting a suggestion)", async () => {
    expect(await deleteNameAction("n1")).toEqual({ ok: true });
    const del = fake.queries.find((q) => op(q, "delete"))!;
    expect(op(del, "in")).toEqual(["in", "status", ["available", "skip", "pending"]]);
  });
  it("cannot be skipped or un-skipped into available", async () => {
    await setSkipAction("n1", true);
    await setSkipAction("n1", false);
    const ins = fake.queries.filter((q) => op(q, "update")).map((q) => op(q, "in"));
    expect(ins).toEqual([["in", "status", ["available"]], ["in", "status", ["skip"]]]);
  });
});

describe("pending themes", () => {
  it("archive only touches available themes, restore only archived ones", async () => {
    await setArchivedAction("t1", true);
    await setArchivedAction("t1", false);
    const ins = fake.queries.filter((q) => op(q, "update")).map((q) => op(q, "in"));
    expect(ins).toEqual([["in", "status", ["available"]], ["in", "status", ["archived"]]]);
  });
});
