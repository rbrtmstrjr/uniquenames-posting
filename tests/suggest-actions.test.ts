import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

// "Suggest with AI" actions: Gemini is mocked at the generateJson boundary; the database is
// the query-recording fake. Survivors of the uniqueness filter are inserted as 'pending'.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { suggestNamesAction, suggestThemesAction } = await import("@/lib/actions/suggest");
const { approveNamesAction, rejectNamesAction } = await import("@/lib/actions/names");
const { approveThemesAction, rejectThemesAction, moveThemeNextAction } = await import("@/lib/actions/themes");

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dbNames = [
  { name: "Arlo Zenith", gender: "boy", style: "two-word" },
  { name: "Isla Marigold", gender: "girl", style: "two-word" },
  { name: "Luna", gender: "girl", style: "single" },
];
const dbThemes = [
  { title: "Little Captain", gender: "boy", props: "small wooden toy sailboat, coiled rope, little brass anchor", sort_order: 7 },
  { title: "Rose Garden", gender: "girl", props: "pink rose petals, wicker basket", sort_order: 3 },
];
const theme = (title: string, props: string) => ({
  title, props, backdrop: "smooth seamless sage green studio backdrop", outfit: "cream knit romper", lighting: "soft warm light from the left", palette: "sage, cream and oat",
});
const inserted = () => fake.queries.find((q) => op(q, "insert"))?.ops.find((o) => o[0] === "insert")?.[1] as Record<string, unknown>[] | undefined;
let insertError: { message: string; code?: string } | null = null;

beforeEach(() => {
  generateJson.mockReset();
  insertError = null;
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (op(q, "insert")) return { error: insertError };
    if (q.table === "names") return { data: dbNames };
    if (q.table === "themes") return { data: op(q, "limit") ? [{ sort_order: 7 }] : dbThemes };
    return undefined;
  };
});

describe("suggestNamesAction", () => {
  it("asks Gemini with this gender+style's names, filters, and inserts at most `count` as pending", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      { name: "isla  MARIGOLD", meaning: "island golden flower" }, // duplicate (case/space)
      { name: "Isla Fern", meaning: "island green fern" }, // reuses the first name: fine
      { name: "Wren Solene", meaning: "little bird of the sun" },
      { name: "Luna", meaning: "the moon" }, // wrong style
      { name: "Clover Elise", meaning: "lucky meadow, pledged to god" },
      { name: "Daphne Rose", meaning: "laurel tree and rose" },
      { name: "Faye Juniper", meaning: "fairy of the juniper" },
      { name: "Gemma Solene", meaning: "precious jewel of the sun" },
    ] });
    const r = await suggestNamesAction({ gender: "girl", style: "two-word", count: 5, vibe: "flowers" });
    expect(r).toEqual({ ok: true, added: 5, duplicates: 1, invalid: 1 });
    const call = generateJson.mock.calls[0][0];
    expect(call.prompt).toContain("Isla Marigold");
    expect(call.prompt).not.toContain("Arlo Zenith"); // other gender
    expect(call.prompt).not.toContain("Luna,"); // other style
    expect(call.prompt).toContain("Suggest 8 new");
    expect(call.prompt).toContain("flowers");
    expect(inserted()).toEqual([
      { name: "Isla Fern", meaning: "island green fern", gender: "girl", style: "two-word", status: "pending" },
      { name: "Wren Solene", meaning: "little bird of the sun", gender: "girl", style: "two-word", status: "pending" },
      { name: "Clover Elise", meaning: "lucky meadow, pledged to god", gender: "girl", style: "two-word", status: "pending" },
      { name: "Daphne Rose", meaning: "laurel tree and rose", gender: "girl", style: "two-word", status: "pending" },
      { name: "Faye Juniper", meaning: "fairy of the juniper", gender: "girl", style: "two-word", status: "pending" },
    ]);
  });

  it("checks uniqueness against every name, not only the prompt's slice", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Arlo Zenith", meaning: "strong high point" }, { name: "Orion Vale", meaning: "hunter of the valley" }] });
    const r = await suggestNamesAction({ gender: "girl", style: "two-word", count: 5 });
    expect(r).toEqual({ ok: true, added: 1, duplicates: 1, invalid: 0 });
  });

  it("inserts nothing when every suggestion is a duplicate", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Isla Marigold", meaning: "island golden flower" }] });
    expect(await suggestNamesAction({ gender: "girl", style: "two-word", count: 5 })).toEqual({ ok: true, added: 0, duplicates: 1, invalid: 0 });
    expect(inserted()).toBeUndefined();
  });

  it("passes on Gemini's failure without touching the database", async () => {
    generateJson.mockResolvedValueOnce({ ok: false, error: "Gemini timed out." });
    const r = await suggestNamesAction({ gender: "girl", style: "two-word", count: 5 });
    expect(r).toEqual({ ok: false, error: "The AI could not suggest names: Gemini timed out." });
    expect(inserted()).toBeUndefined();
  });

  it("explains the missing v2 database update (status check constraint)", async () => {
    insertError = { message: "new row for relation \"names\" violates check constraint \"names_status_check\"", code: "23514" };
    generateJson.mockResolvedValueOnce({ ok: true, data: [{ name: "Orion Vale", meaning: "hunter of the valley" }] });
    const r = await suggestNamesAction({ gender: "boy", style: "two-word", count: 5 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Run the v2 database update first/);
  });

  it("rejects bad input before calling Gemini", async () => {
    expect((await suggestNamesAction({ gender: "boy", style: "two-word", count: 4 })).ok).toBe(false);
    expect((await suggestNamesAction({ gender: "boy", style: "two-word", count: 51 })).ok).toBe(false);
    expect((await suggestNamesAction({ gender: "x" as "boy", style: "two-word", count: 10 })).ok).toBe(false);
    expect((await suggestNamesAction({ gender: "boy", style: "triple" as "single", count: 10 })).ok).toBe(false);
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("suggestThemesAction", () => {
  it("prompts with this gender's titles + props and inserts survivors as pending after the last sort_order", async () => {
    generateJson.mockResolvedValueOnce({ ok: true, data: [
      theme("Sea Sailor", "coiled rope, little brass anchors, small wooden toy sailboat"), // same props set
      theme("Rose garden", "felt bunny"), // same title (other gender, still unique)
      theme("Forest Nook", "soft felt squirrel toy, small wooden acorn, mossy stone"),
      theme("Berry Patch", "small wicker basket of red berries, plush badger toy"),
      theme("Clean Set", "toy drum, no clutter"), // unsafe wording
    ] });
    const r = await suggestThemesAction({ gender: "boy", count: 3 });
    expect(r).toEqual({ ok: true, added: 2, duplicates: 2, invalid: 1 });
    const prompt = generateJson.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Little Captain: small wooden toy sailboat");
    expect(prompt).not.toContain("Rose Garden");
    expect(inserted()).toEqual([
      { ...theme("Forest Nook", "soft felt squirrel toy, small wooden acorn, mossy stone"), gender: "boy", status: "pending", sort_order: 8 },
      { ...theme("Berry Patch", "small wicker basket of red berries, plush badger toy"), gender: "boy", status: "pending", sort_order: 9 },
    ]);
  });

  it("explains the missing v2 database update", async () => {
    insertError = { message: "violates check constraint \"themes_status_check\"", code: "23514" };
    generateJson.mockResolvedValueOnce({ ok: true, data: [theme("Forest Nook", "felt squirrel")] });
    const r = await suggestThemesAction({ gender: "boy", count: 3 });
    expect(!r.ok && r.error).toMatch(/Run the v2 database update first/);
  });

  it("rejects counts outside 3–15", async () => {
    expect((await suggestThemesAction({ gender: "boy", count: 2 })).ok).toBe(false);
    expect((await suggestThemesAction({ gender: "boy", count: 16 })).ok).toBe(false);
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("approve / reject", () => {
  beforeEach(() => {
    respond = (q) => (op(q, "update") || op(q, "delete") ? { data: [{ id: "x" }] } : q.table === "themes" ? { data: [{ sort_order: 7 }] } : { data: [] });
  });

  it("approving names flips only pending rows to available", async () => {
    expect(await approveNamesAction([ID(1), ID(2)])).toEqual({ ok: true, count: 1 });
    const q = fake.queries.find((x) => op(x, "update"))!;
    expect(op(q, "update")).toEqual(["update", { status: "available" }]);
    expect(op(q, "in")).toEqual(["in", "id", [ID(1), ID(2)]]);
    expect(op(q, "eq")).toEqual(["eq", "status", "pending"]);
  });

  it("rejecting names deletes only pending rows", async () => {
    expect((await rejectNamesAction([ID(1)])).ok).toBe(true);
    const q = fake.queries.find((x) => op(x, "delete"))!;
    expect(op(q, "eq")).toEqual(["eq", "status", "pending"]);
  });

  it("approving themes puts them at the end of Up next, in order, only from pending", async () => {
    expect(await approveThemesAction([ID(1), ID(2)])).toEqual({ ok: true, count: 2 });
    const ups = fake.queries.filter((x) => op(x, "update"));
    expect(ups.map((x) => op(x, "update"))).toEqual([["update", { status: "available", sort_order: 8 }], ["update", { status: "available", sort_order: 9 }]]);
    for (const u of ups) expect(u.ops).toContainEqual(["eq", "status", "pending"]);
    const last = fake.queries.find((x) => x.table === "themes" && op(x, "limit"))!;
    expect(last.ops).toContainEqual(["neq", "status", "pending"]);
  });

  it("rejecting themes deletes only pending themes (never available/used/archived)", async () => {
    expect((await rejectThemesAction([ID(3)])).ok).toBe(true);
    const q = fake.queries.find((x) => op(x, "delete"))!;
    expect(q.table).toBe("themes");
    expect(op(q, "eq")).toEqual(["eq", "status", "pending"]);
  });

  it("reports when nothing was pending any more", async () => {
    respond = () => ({ data: [] });
    expect((await approveNamesAction([ID(1)])).ok).toBe(false);
    expect((await rejectThemesAction([ID(1)])).ok).toBe(false);
  });

  it("refuses empty or malformed id lists", async () => {
    expect((await approveNamesAction([])).ok).toBe(false);
    expect((await rejectNamesAction(["not-a-uuid"])).ok).toBe(false);
    expect((await approveThemesAction(["x"])).ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });

  it("moving a theme next only touches available themes", async () => {
    await moveThemeNextAction(ID(5));
    const q = fake.queries.find((x) => op(x, "update"))!;
    expect(q.ops).toContainEqual(["eq", "status", "available"]);
  });
});

describe("bulk approve / reject at scale", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ID(i + 1));
  const inIds = (q: Query) => (op(q, "in")?.[2] as string[] | undefined) ?? [];

  beforeEach(() => { revalidatePath.mockReset(); });

  it("names beyond 1000 go through in chunks of 100", async () => {
    respond = (q) => (op(q, "update") ? { data: inIds(q).map((id) => ({ id })) } : { data: [] });
    expect(await approveNamesAction(ids(1500))).toEqual({ ok: true, count: 1500 });
    expect(fake.queries.filter((q) => op(q, "update"))).toHaveLength(15);
  });

  it("revalidates when an earlier name chunk succeeded before a later one failed", async () => {
    let n = 0;
    respond = (q) => (op(q, "delete") ? (n++ === 0 ? { data: inIds(q).map((id) => ({ id })) } : { error: { message: "boom" } }) : { data: [] });
    const r = await rejectNamesAction(ids(150));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/boom.*100 were rejected/);
    expect(!r.ok && "done" in r && r.done).toEqual(ids(100)); // the client keeps these removed
    expect(revalidatePath).toHaveBeenCalledWith("/names");
  });

  it("a theme approve that fails part-way reports exactly which ids were approved", async () => {
    let n = 0;
    respond = (q) => {
      if (op(q, "update")) return n++ < 55 ? { data: [{ id: (op(q, "eq") as unknown[])[2] }] } : { error: { message: "boom" } };
      return q.table === "themes" ? { data: [{ sort_order: 7 }] } : { data: [] };
    };
    const r = await approveThemesAction(ids(120));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/boom.*55 were approved/);
    expect(!r.ok && "done" in r && r.done).toEqual(ids(55));
  });

  it("a theme reject that fails part-way reports the deleted ids", async () => {
    let n = 0;
    respond = (q) => (op(q, "delete") ? (n++ === 0 ? { data: inIds(q).map((id) => ({ id })) } : { error: { message: "boom" } }) : { data: [] });
    const r = await rejectThemesAction(ids(120));
    expect(!r.ok && r.error).toMatch(/boom.*50 were rejected/);
    expect(!r.ok && "done" in r && r.done).toEqual(ids(50));
  });

  it("approves more than 100 themes in chunks, with one running sort_order", async () => {
    respond = (q) => (op(q, "update") ? { data: [{ id: "x" }] } : q.table === "themes" ? { data: [{ sort_order: 7 }] } : { data: [] });
    expect(await approveThemesAction(ids(120))).toEqual({ ok: true, count: 120 });
    const orders = fake.queries.filter((q) => op(q, "update")).map((q) => (op(q, "update")![1] as { sort_order: number }).sort_order);
    expect(orders).toEqual(Array.from({ length: 120 }, (_, i) => 8 + i));
  });

  it("rejecting themes removes their preview images from storage (only for themes really deleted)", async () => {
    respond = (q) => {
      if (q.table === "cards") return { data: [
        { theme_id: ID(1), photo_path: "photos/a.png", card_path: "cards/a.jpg" },
        { theme_id: ID(2), photo_path: null, card_path: "cards/b.jpg" },
      ] };
      if (op(q, "delete")) return { data: [{ id: ID(1) }] }; // ID(2) was no longer pending
      return { data: [] };
    };
    expect(await rejectThemesAction([ID(1), ID(2)])).toEqual({ ok: true, count: 1 });
    const read = fake.queries.find((q) => q.table === "cards")!;
    expect(fake.queries.indexOf(read)).toBeLessThan(fake.queries.findIndex((q) => op(q, "delete")));
    expect(read.ops).toContainEqual(["eq", "kind", "preview"]);
    expect(fake.removed).toEqual([{ bucket: "cards", paths: ["photos/a.png", "cards/a.jpg"] }]);
  });

  it("rejects 120 themes in chunks", async () => {
    respond = (q) => (op(q, "delete") ? { data: inIds(q).map((id) => ({ id })) } : { data: [] });
    expect(await rejectThemesAction(ids(120))).toEqual({ ok: true, count: 120 });
    expect(fake.queries.filter((q) => op(q, "delete"))).toHaveLength(3);
    expect(fake.removed).toEqual([]);
  });
});
