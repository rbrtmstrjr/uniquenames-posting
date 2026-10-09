import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

// Today's data: the A–Z option only after 011; an A–Z series shows both parts.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
const { getTodayData } = await import("@/lib/data/today");

const now = new Date().toISOString();
const post = (id: string, o: Record<string, unknown> = {}) => ({ id, status: "generating", updated_at: now, gender: "boy", style: "single", ...o });
let latest: Record<string, unknown>[] = [];
let has011 = true;

beforeEach(() => {
  latest = [post("p2", { series: "az", series_id: "s1", series_part: 2 })];
  has011 = true;
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    const sel = String(op(q, "select")?.[1] ?? "");
    if (q.table === "settings") return { data: { id: 1 } };
    if (q.table === "themes") return { data: [] };
    if (q.table === "names" && sel === "name, gender, status") return { data: [{ name: "Arlo", gender: "boy", status: "available" }, { name: "Dax", gender: "boy", status: "pending" }, { name: "Bea", gender: "girl", status: "available" }] };
    if (q.table === "names") return { data: null };
    if (q.table === "posts" && sel === "series_part") return has011 ? { data: [] } : { error: { message: "column posts.series_part does not exist", code: "42703" } };
    if (q.table === "posts" && op(q, "eq")?.[1] === "series_id") return { data: [post("p1", { series: "az", series_id: "s1", series_part: 1 }), latest[0]] };
    if (q.table === "posts") return { data: latest };
    if (q.table === "cards") return { data: [{ id: "c1", post_id: "p1", position: 1 }, { id: "c2", post_id: "p2", position: 1 }] };
    return undefined;
  };
});

describe("getTodayData (A–Z)", () => {
  it("shows both parts of the latest series, Part 1 first, each with its own cards", async () => {
    const d = await getTodayData();
    expect(d.activePosts.map((a) => [a.post.id, a.cards.map((c) => c.id)])).toEqual([["p1", ["c1"]], ["p2", ["c2"]]]);
  });

  it("an ordinary latest post shows alone", async () => {
    latest = [post("p9")];
    const d = await getTodayData();
    expect(d.activePosts.map((a) => a.post.id)).toEqual(["p9"]);
    expect(fake.queries.some((q) => op(q, "eq")?.[1] === "series_id")).toBe(false);
  });

  it("counts the letters per gender, and is not ready before 011", async () => {
    let d = await getTodayData();
    expect(d.az.ready).toBe(true);
    expect(d.az.coverage.boy.find((c) => c.letter === "A")).toEqual({ letter: "A", available: 1, pending: 0 });
    expect(d.az.coverage.boy.find((c) => c.letter === "D")).toEqual({ letter: "D", available: 0, pending: 1 });
    expect(d.az.coverage.girl.find((c) => c.letter === "B")).toEqual({ letter: "B", available: 1, pending: 0 });
    has011 = false;
    d = await getTodayData();
    expect(d.az.ready).toBe(false);
  });
});
