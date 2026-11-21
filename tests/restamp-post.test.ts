import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardStatus } from "@/lib/db/types";
import { restampSelection } from "@/lib/actions/helpers";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { restampPostAction } = await import("@/lib/actions/posts");

const POST = "33333333-3333-4333-8333-333333333333";
const card = (id: string, status: CardStatus, photo: boolean, version = 2) => ({ id, status, photo_path: photo ? `photos/${id}/v1.jpg` : null, version });

describe("restampSelection (pure)", () => {
  it("takes done/failed cards with a clean photo, counts the ones without, ignores busy cards", () => {
    const cards = [card("a", "done", true), card("b", "failed", true), card("c", "done", false), card("d", "queued", true),
      card("e", "generating", true), card("f", "restamp", true), card("g", "failed", false)];
    const r = restampSelection(cards);
    expect(r.restamp.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.noPhoto).toBe(2);
  });
});

describe("restampPostAction", () => {
  let cards: ReturnType<typeof card>[] = [];
  let stale = new Set<string>();
  beforeEach(() => {
    cards = [card("a", "done", true, 3), card("b", "failed", true), card("c", "done", false), card("d", "generating", true)];
    stale = new Set();
    fake = fakeSupabase((q) => respond(q));
    respond = (q: Query) => {
      if (q.table === "cards" && isUpdate(q)) {
        const id = q.ops.find((o) => o[0] === "eq" && o[1] === "id")![2] as string;
        return { data: stale.has(id) ? [] : [{ id }] };
      }
      if (q.table === "cards") return { data: cards };
      return undefined;
    };
  });
  const updates = () => fake.queries.filter((q) => q.table === "cards" && isUpdate(q));

  it("queues a version-guarded restamp for each finished card with a photo, and counts the rest", async () => {
    expect(await restampPostAction(POST)).toEqual({ ok: true, restamped: 2, noPhoto: 1, skipped: 0, ids: ["a", "b"] });
    const u = updates();
    expect(u).toHaveLength(2);
    expect(op(u[0], "update")![1]).toMatchObject({ status: "restamp", claimed_at: null, error: null, version: 4 });
    expect(u[0].ops).toContainEqual(["eq", "version", 3]);
    expect(u[0].ops).toContainEqual(["in", "status", ["done", "failed"]]);
    expect(op(u[1], "update")![1]).toMatchObject({ version: 3 });
    // The read is scoped to the post; no worker_status read: re-stamps are not locked by the PC state.
    expect(fake.queries.find((q) => q.table === "cards" && !isUpdate(q))!.ops).toContainEqual(["eq", "post_id", POST]);
    expect(fake.queries.some((q) => q.table === "worker_status")).toBe(false);
  });

  it("a card that changed meanwhile is skipped, not an error", async () => {
    stale.add("b");
    expect(await restampPostAction(POST)).toEqual({ ok: true, restamped: 1, noPhoto: 1, skipped: 1, ids: ["a"] }) // b is not reported as queued;
  });

  it("explains when nothing can be re-stamped", async () => {
    cards = [card("c", "done", false)];
    expect(await restampPostAction(POST)).toMatchObject({ ok: false, error: expect.stringMatching(/no clean photo/) });
    cards = [card("d", "queued", true)];
    expect(await restampPostAction(POST)).toMatchObject({ ok: false, error: expect.stringMatching(/No finished cards/) });
    expect(updates()).toHaveLength(0);
  });

  it("rejects a bad id without touching the database", async () => {
    expect(await restampPostAction("nope")).toMatchObject({ ok: false });
    expect(fake.queries).toHaveLength(0);
  });

  it("a database error with nothing re-stamped is reported", async () => {
    respond = (q) => (q.table === "cards" && isUpdate(q) ? { error: { message: "boom" } } : q.table === "cards" ? { data: cards } : undefined);
    expect(await restampPostAction(POST)).toEqual({ ok: false, error: "boom" });
  });
});

describe("restampPostAction on an Autopilot post", () => {
  it("each checked card's new stamp is checked again; a card with no check state gets no check fields", async () => {
    const rows = [{ ...card("a", "done", true, 3), check_state: "passed" }, { ...card("b", "failed", true), check_state: null }];
    fake = fakeSupabase((q) => (q.table === "cards" && isUpdate(q) ? { data: [{ id: q.ops.find((o) => o[0] === "eq" && o[1] === "id")![2] }] } : q.table === "cards" ? { data: rows } : undefined));
    expect(await restampPostAction(POST)).toMatchObject({ ok: true, restamped: 2 });
    const u = fake.queries.filter((q) => q.table === "cards" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);
    expect(u[0]).toMatchObject({ status: "restamp", check_state: "pending", check_note: null });
    expect(u[1]).not.toHaveProperty("check_state");
    // select * reads check_state once 022 ran and still works before it.
    expect(fake.queries.find((q) => q.table === "cards" && !isUpdate(q))!.ops).toContainEqual(["select", "*"]);
  });
});
