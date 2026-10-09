import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

// Today's data: available names per letter for By letter; an A–Z series made earlier shows both parts.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
const { getTodayData } = await import("@/lib/data/today");

const now = new Date().toISOString();
const post = (id: string, o: Record<string, unknown> = {}) => ({ id, status: "generating", updated_at: now, gender: "boy", style: "single", ...o });
let latest: Record<string, unknown>[] = [];

beforeEach(() => {
  latest = [post("p2", { series: "az", series_id: "s1", series_part: 2 })];
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    const sel = String(op(q, "select")?.[1] ?? "");
    if (q.table === "settings") return { data: { id: 1 } };
    if (q.table === "themes") return { data: [] };
    if (q.table === "names" && sel === "name, gender, style") return { data: [{ name: "Arlo", gender: "boy", style: "single" }, { name: "Atlas", gender: "boy", style: "single" },
      { name: "Arlo Zenith", gender: "boy", style: "two-word" }, { name: "Bea", gender: "girl", style: "single" }] };
    if (q.table === "names") return { data: null };
    if (q.table === "posts" && op(q, "eq")?.[1] === "series_id") return { data: [post("p1", { series: "az", series_id: "s1", series_part: 1 }), latest[0]] };
    if (q.table === "posts") return { data: latest };
    if (q.table === "cards") return { data: [{ id: "c1", post_id: "p1", position: 1 }, { id: "c2", post_id: "p2", position: 1 }] };
    return undefined;
  };
});

describe("getTodayData (letters, A–Z parts)", () => {
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

  it("counts the available names per letter for each gender + style (only available ones are read)", async () => {
    const d = await getTodayData();
    expect(d.letters["boy|single"]).toMatchObject({ A: 2, B: 0 });
    expect(d.letters["boy|two-word"]).toMatchObject({ A: 1 });
    expect(d.letters["girl|single"]).toMatchObject({ B: 1, A: 0 });
    expect(Object.keys(d.letters["girl|two-word"])).toHaveLength(26);
    const read = fake.queries.find((q) => q.table === "names" && op(q, "select")?.[1] === "name, gender, style")!;
    expect(op(read, "eq")).toEqual(["eq", "status", "available"]);
  });
});
