import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import { partsInOrder } from "@/lib/series/az";

// Posts list: newest first, but the two parts of an A–Z series read Part 1 above Part 2.
type Item = { id: string; series?: string | null; series_id?: string | null; series_part?: number | null };
const az = (id: string, series_id: string, series_part: number): Item => ({ id, series: "az", series_id, series_part });

describe("partsInOrder", () => {
  it("puts Part 1 above Part 2 of each series, leaving every other post where it was", () => {
    const list: Item[] = [{ id: "x" }, az("b2", "s2", 2), az("b1", "s2", 1), { id: "y" }, az("a2", "s1", 2), { id: "z" }, az("a1", "s1", 1)];
    expect(partsInOrder(list).map((p) => p.id)).toEqual(["x", "b1", "b2", "y", "a1", "z", "a2"]);
  });

  it("changes nothing without series posts, or when the parts are already in order", () => {
    const plain: Item[] = [{ id: "a" }, { id: "b", series: null, series_id: null, series_part: null }];
    expect(partsInOrder(plain)).toEqual(plain);
    const ok = [az("p1", "s", 1), az("p2", "s", 2)];
    expect(partsInOrder(ok)).toEqual(ok);
  });
});

const fake = fakeSupabase((q) => (q.table === "posts"
  ? { data: [
      { ...az("p2", "s1", 2), post_date: "2026-10-09", themes: { title: "Sage" }, cards: [] },
      { ...az("p1", "s1", 1), post_date: "2026-10-09", themes: { title: "Sage" }, cards: [] },
      { id: "old", post_date: "2026-10-08", themes: { title: "Moon" }, cards: [] },
    ] }
  : undefined));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
const { getPostList } = await import("@/lib/data/posts");

describe("getPostList", () => {
  it("lists an A–Z series Part 1 first even though Part 2 is newer", async () => {
    expect((await getPostList()).map((p) => p.id)).toEqual(["p1", "p2", "old"]);
  });
});
