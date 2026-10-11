import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, op, type Query, type Respond } from "./helpers/fake-supabase";

// Names > Export PDF on the server: the Route Handler, the export builder, sorting rounds, the password reveal and a
// name's group. The database is the query-recording fake; the AI is mocked at the Gemini boundary.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
let owner: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => owner }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));

const { buildExport, validateExport, NEEDS_018 } = await import("@/lib/pdf/export");
const { sortNamesAction, revealExportPasswordAction } = await import("@/lib/actions/names-pdf");
const { setNameCategoryAction } = await import("@/lib/actions/names");
const { POST } = await import("@/app/(app)/names/export/route");
const { packById } = await import("@/packs");
const { PASSWORD_RE } = await import("@/lib/pdf/password");

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Row = Record<string, unknown>;
const row = (n: number, o: Row = {}): Row => ({
  id: ID(n), name: `Name${String(n).padStart(3, "0")}`, meaning: "a kind meaning", gender: n % 2 ? "girl" : "boy", style: "single", status: "available",
  meaning_category: "love", ...o,
});
let names: Row[] = [];
let insertError: { message: string; code?: string } | null = null;
const inserts = () => fake.queries.filter((q) => op(q, "insert"));
const updates = () => fake.queries.filter((q) => op(q, "update"));
/** Every AI call answers each numbered name with `group`, through the call's own parse(). */
const aiAnswers = (group = "nature") => generateJson.mockImplementation(async (input: { prompt: string; parse: (raw: unknown) => unknown }) => {
  const n = Number(input.prompt.match(/^Sort these (\d+) names:/)![1]);
  return { ok: true, data: input.parse({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, group })) }) };
});

beforeEach(() => {
  owner = { id: "owner" };
  generateJson.mockReset();
  revalidatePath.mockReset();
  insertError = null;
  names = [row(1), row(2), row(3, { style: "two-word", name: "Isla Fern", meaning_category: "nature" }), row(4, { status: "used" })];
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "exports" && op(q, "insert")) return { error: insertError };
    if (q.table === "exports") return { data: { password: "Kp7m-Xr4d-Tq9w" } };
    if (q.table === "names" && op(q, "update")) return { data: [{ id: "x" }] };
    if (q.table === "names") {
      const nullOnly = q.ops.some((o) => o[0] === "is" && o[1] === "meaning_category");
      const list = nullOnly ? names.filter((n) => n.meaning_category === null) : names;
      const range = op(q, "range") as [string, number, number] | undefined;
      return { data: range ? list.slice(range[1], range[2] + 1) : list };
    }
    return undefined;
  };
});

const UN = packById("unique-names");
const build = (o: Partial<Parameters<typeof buildExport>[0]> = {}) =>
  buildExport({ sb: fake.client as never, pack: UN, buyer: "Jane Doe", gender: "both", now: new Date("2026-10-11T08:00:00Z"), ...o });

describe("validateExport", () => {
  it("needs a buyer (2..120 characters, no control characters) and Girl / Boy / Both", () => {
    expect(validateExport({ buyer: "  Jane   Doe ", gender: "girl" })).toEqual({ ok: true, buyer: "Jane Doe", gender: "girl" });
    expect(validateExport({ buyer: "Jane <jane@example.com>", gender: "both" })).toMatchObject({ ok: true });
    expect(validateExport({ buyer: "J", gender: "girl" })).toMatchObject({ ok: false, error: /buyer's name or email/ });
    expect(validateExport({ buyer: "x".repeat(121), gender: "girl" })).toMatchObject({ ok: false });
    expect(validateExport({ buyer: "Jane\u0007", gender: "girl" })).toMatchObject({ ok: false });
    expect(validateExport({ buyer: "Jane", gender: "girls" })).toMatchObject({ ok: false, error: "Pick Girl, Boy or Both." });
    expect(validateExport(null)).toMatchObject({ ok: false });
  });
});

describe("buildExport", () => {
  it("approved names only, a new password, the PDF, and a log row", async () => {
    const r = await build();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = fake.queries.find((x) => x.table === "names")!;
    expect(op(q, "in")).toEqual(["in", "status", ["available", "reserved", "used"]]);
    expect(generateJson).not.toHaveBeenCalled(); // every name already has its group
    expect(r.pdf.subarray(0, 8).toString()).toBe("%PDF-1.7");
    expect(r.password).toMatch(PASSWORD_RE);
    expect(r).toMatchObject({ count: 4, logged: true, warning: null });
    expect(r.fileName).toMatch(/^unique-names-girl-and-boy-names-2026-10-11-[0-9a-f]{6}\.pdf$/);
    expect(op(inserts()[0], "insert")![1]).toEqual({ buyer: "Jane Doe", gender: "both", name_count: 4, password: r.password, file_name: r.fileName, pack: "unique-names" });
    const again = await build();
    expect(again.ok && again.password).not.toBe(r.password);
  });

  it("only the picked gender", async () => {
    const r = await build({ gender: "boy" });
    expect(r.ok && r.count).toBe(2);
    expect(r.ok && r.fileName).toMatch(/-boy-names-/);
  });

  it("sorts names without a group first and stores the groups (never over the owner's own choice)", async () => {
    names = [row(1, { meaning_category: null }), row(2, { meaning_category: null }), row(3)];
    aiAnswers("water");
    const r = await build();
    expect(r.ok).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
    const u = updates();
    expect(u).toHaveLength(1);
    expect(op(u[0], "update")).toEqual(["update", { meaning_category: "water" }]);
    expect(op(u[0], "in")).toEqual(["in", "id", [ID(1), ID(2)]]);
    expect(op(u[0], "is")).toEqual(["is", "meaning_category", null]);
  });

  it("before migration 018: sorts in memory for this PDF, logs nothing, and says so", async () => {
    names = names.map(({ meaning_category: _m, ...n }) => n);
    insertError = { message: 'relation "public.exports" does not exist', code: "42P01" };
    aiAnswers("peace");
    const r = await build();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(generateJson).toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
    expect(r).toMatchObject({ logged: false, warning: NEEDS_018, count: 4 });
  });

  it("fails clearly when the AI cannot sort, or there are no names", async () => {
    names = [row(1, { meaning_category: null })];
    generateJson.mockResolvedValue({ ok: false, error: "Gemini error 503." });
    expect(await build()).toEqual({ ok: false, error: "Couldn't sort the names by meaning: Gemini error 503. Try again." });
    expect(inserts()).toHaveLength(0);
    names = [];
    expect(await build({ gender: "girl" })).toEqual({ ok: false, error: "There are no approved girl names yet." });
  });
});

describe("POST /names/export", () => {
  const post = (body: unknown) => POST(new Request("http://x/names/export", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("owner only", async () => {
    owner = null;
    const res = await post({ buyer: "Jane", gender: "girl" });
    expect(res.status).toBe(401);
    expect(fake.queries).toHaveLength(0);
  });

  it("checks the form", async () => {
    expect((await post("not json")).status).toBe(400);
    const res = await post({ buyer: "", gender: "girl" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Type the buyer's name or email." });
  });

  it("answers the PDF as a download with its password once, never cached", async () => {
    const res = await post({ buyer: "Jane Doe", gender: "girl" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="unique-names-girl-names-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.pdf"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-export-password")).toMatch(PASSWORD_RE);
    expect(res.headers.get("x-export-count")).toBe("2");
    expect(res.headers.get("x-export-logged")).toBe("1");
    expect(res.headers.get("x-export-warning")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(revalidatePath).toHaveBeenCalledWith("/names");
  });

  it("a 422 with the reason when nothing can be made", async () => {
    names = [];
    const res = await post({ buyer: "Jane Doe", gender: "both" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "There are no approved names yet." });
  });
});

describe("sortNamesAction", () => {
  it("sorts one round (300) of the approved names without a group; says how many are left", async () => {
    names = Array.from({ length: 350 }, (_, i) => row(i + 1, { meaning_category: null }));
    aiAnswers("light");
    const r = await sortNamesAction();
    expect(r).toEqual({ ok: true, sorted: 300, remaining: 50 });
    expect(generateJson).toHaveBeenCalledTimes(3);
    const q = fake.queries.find((x) => x.table === "names")!;
    expect(op(q, "in")).toEqual(["in", "status", ["available", "reserved", "used"]]);
    expect(op(q, "is")).toEqual(["is", "meaning_category", null]);
    expect(revalidatePath).toHaveBeenCalledWith("/names");
  });

  it("nothing to do; and before migration 018 says so instead of failing", async () => {
    expect(await sortNamesAction()).toEqual({ ok: true, sorted: 0, remaining: 0 });
    respond = () => ({ error: { message: "column names.meaning_category does not exist", code: "42703" } });
    expect(await sortNamesAction()).toEqual({ ok: true, sorted: 0, remaining: 0, needs018: true });
  });

  it("an AI failure is an error, after storing what was sorted", async () => {
    names = [row(1, { meaning_category: null })];
    generateJson.mockResolvedValue({ ok: false, error: "Gemini error 429." });
    expect(await sortNamesAction()).toEqual({ ok: false, error: "Gemini error 429." });
  });

  it("owner only", async () => {
    owner = null;
    await expect(sortNamesAction()).rejects.toThrow(/Not signed in/);
  });
});

describe("revealExportPasswordAction / setNameCategoryAction", () => {
  it("reveals a logged password by id", async () => {
    expect(await revealExportPasswordAction(ID(9))).toEqual({ ok: true, password: "Kp7m-Xr4d-Tq9w" });
    expect(await revealExportPasswordAction("nope")).toEqual({ ok: false, error: "Unknown export." });
    owner = null;
    await expect(revealExportPasswordAction(ID(9))).rejects.toThrow();
  });

  it("sets or clears a name's group; refuses unknown groups", async () => {
    expect(await setNameCategoryAction(ID(1), "royal")).toEqual({ ok: true });
    expect(op(updates()[0], "update")).toEqual(["update", { meaning_category: "royal" }]);
    expect(await setNameCategoryAction(ID(1), null)).toEqual({ ok: true });
    expect(await setNameCategoryAction(ID(1), "Royal" as never)).toEqual({ ok: false, error: "Unknown group." });
    respond = () => ({ error: { message: "Could not find the 'meaning_category' column of 'names' in the schema cache", code: "PGRST204" } });
    expect(await setNameCategoryAction(ID(1), "royal")).toEqual({ ok: false, error: "Run supabase/migrations/018_names_pdf.sql first." });
  });
});
