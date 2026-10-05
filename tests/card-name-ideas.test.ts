import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

// "Suggest names" in the card dialog: Gemini (mocked at generateJson) proposes names for the
// card's post (same gender + style, the theme as the idea); nothing is written to the database.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { cardNameIdeasAction } = await import("@/lib/actions/suggest");

const CARD = "00000000-0000-4000-8000-000000000001";
const dbNames = [
  { name: "Hugo Rowe", gender: "boy", style: "two-word" },
  { name: "Corin Ash", gender: "boy", style: "two-word" },
  { name: "Luna", gender: "girl", style: "single" },
];

beforeEach(() => {
  generateJson.mockReset();
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "cards") return { data: { id: CARD, post_id: "p1", theme_id: "t1" } };
    if (q.table === "posts") return { data: { gender: "boy", style: "two-word" } };
    if (q.table === "themes") return { data: { title: "Woodland Explorer" } };
    if (q.table === "names") return { data: dbNames };
    return undefined;
  };
});

describe("cardNameIdeasAction", () => {
  it("returns up to 5 new names for the post's gender + style, themed, without writing anything", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "hugo  ROWE", meaning: "bright mind" }, // already exists (case/space)
      { name: "Rowan Pike", meaning: "little red-haired one" },
      { name: "Ash", meaning: "ash tree" }, // wrong style
      { name: "Fenwick Hale", meaning: "from the marsh farm" },
      { name: "Bram Ellery", meaning: "raven of the island" },
      { name: "Oakley Reed", meaning: "meadow of oak trees" },
      { name: "Silas Thorne", meaning: "of the forest" },
      { name: "Linden Cove", meaning: "gentle linden tree" },
    ] });
    const r = await cardNameIdeasAction(CARD);
    expect(r).toEqual({ ok: true, ideas: [
      { name: "Rowan Pike", meaning: "little red-haired one" },
      { name: "Fenwick Hale", meaning: "from the marsh farm" },
      { name: "Bram Ellery", meaning: "raven of the island" },
      { name: "Oakley Reed", meaning: "meadow of oak trees" },
      { name: "Silas Thorne", meaning: "of the forest" },
    ] });
    const call = generateJson.mock.calls[0][0];
    expect(call.prompt).toContain("Hugo Rowe"); // existing names of this gender + style go to Gemini
    expect(call.prompt).not.toContain("Luna");
    expect(call.prompt).toContain("Woodland Explorer"); // the theme is the idea
    expect(fake.queries.some((q) => op(q, "insert") || op(q, "update") || op(q, "delete"))).toBe(false);
  });

  it("rejects a bad id, a card without a post, and reports Gemini failures", async () => {
    expect(await cardNameIdeasAction("nope")).toEqual({ ok: false, error: expect.any(String) });
    respond = (q: Query) => (q.table === "cards" ? { data: { id: CARD, post_id: null, theme_id: "t1" } } : undefined);
    expect((await cardNameIdeasAction(CARD)).ok).toBe(false);
    respond = (q: Query) => {
      if (q.table === "cards") return { data: { id: CARD, post_id: "p1", theme_id: "t1" } };
      if (q.table === "posts") return { data: { gender: "boy", style: "two-word" } };
      if (q.table === "themes") return { data: { title: "Woodland Explorer" } };
      if (q.table === "names") return { data: dbNames };
      return undefined;
    };
    generateJson.mockResolvedValueOnce({ ok: false, error: "timeout" });
    const r = await cardNameIdeasAction(CARD);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("timeout") });
  });

  it("says so when every idea was already taken", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Hugo Rowe", meaning: "bright mind" }] });
    const r = await cardNameIdeasAction(CARD);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/already|try again/i) });
  });
});
