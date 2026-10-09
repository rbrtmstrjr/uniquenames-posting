import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NameRow, ThemeRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

// "Make A–Z" on Today: both parts in one create_series call, captions that say their part, closing cards.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
let owner: { id: string } | null = { id: "owner" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => owner }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { createAzSeriesAction } = await import("@/lib/actions/series");

const REQ = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333331";
const P2 = "33333333-3333-4333-8333-333333333332";
const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const theme: ThemeRow = {
  id: THEME_ID, title: "Pumpkin Patch", gender: "boy", backdrop: "smooth seamless rust studio backdrop", outfit: "mustard knit romper", props: "tiny pumpkins, wicker basket",
  lighting: "soft warm light from the left", palette: "rust, cream, mustard", status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: "", updated_at: "",
};
const names: NameRow[] = AZ.map((l, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: `${l}ven`, meaning: `meaning of ${l.toLowerCase()}`, gender: "boy", style: "single", status: "available",
  post_id: null, position: null, created_at: "2026-10-01T00:00:00Z", updated_at: "",
}));
const settings = {
  id: 1, caption_template: "Lovely names for your baby {gender}.", hashtags: "#babynames", handle: "@unique_names", min_images: 9, max_images: 13, width: 1080, height: 1350, sound_on: true,
  hashtags_always: "#uniquenames", hashtag_pool: "#babynames #babyboynames #momlife #newmom", cta_enabled: true, cta_messages: "Follow for more / baby name ideas.\nNew names every day. / Follow along!",
  title_font: "poppins", meaning_font: "poppins", mark_font: "poppins",
};
let rpcAnswers: { data?: unknown; error?: { message: string; code?: string } }[] = [];
let worker = { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true };
let dbNames = names;

beforeEach(() => {
  owner = { id: "owner" };
  generateJson.mockReset();
  revalidatePath.mockReset();
  worker = { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true };
  dbNames = names;
  rpcAnswers = [{ data: { status: "ok", post_ids: [P1, P2] } }];
  generateJson.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const part = /Part 1 of 2/.test(prompt) ? 1 : 2;
    return { ok: true, data: { caption: `Part ${part} of our A to Z baby boy names, ${part === 1 ? "A to M" : "N to Z"}, among tiny pumpkins.`, tags: ["#pumpkinbaby"] } };
  });
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return undefined;
    if (q.table === "settings") return { data: settings };
    if (q.table === "names") return { data: dbNames };
    if (q.table === "themes") return { data: [theme] };
    if (q.table === "worker_status") return { data: worker };
    if (q.table === "posts") return { data: [] }; // caption history
    if (q.table === "cards" && op(q, "insert")) return { data: [{ id: `cta-${(op(q, "insert")![1] as { post_id: string }).post_id}` }] };
    if (q.table === "cards") return { data: [] };
    if (q.table === "rpc:create_series") return rpcAnswers.shift() ?? { data: { status: "ok", post_ids: [P1, P2] } };
    return undefined;
  };
});
afterEach(() => vi.restoreAllMocks());

const input = { gender: "boy" as const, postDate: "2026-10-09", requestId: REQ, subjectAge: "2" as const, fonts: { title_font: "quicksand", meaning_font: "poppins", mark_font: "poppins" } };
type SeriesArgs = { p: { request_id: string; theme_id: string; gender: string; post_date: string; subject_age: string; title_font: string;
  parts: { caption: string; caption_style: string; hashtag_set: string; cards: { name: string; position: number; name_id: string }[] }[] } };
const seriesCalls = () => fake.rpcs.filter((r) => r.fn === "create_series").map((r) => (r.args as SeriesArgs).p);

describe("createAzSeriesAction", () => {
  it("plans A–M and N–Z with one theme and sends both parts in ONE create_series call", async () => {
    expect(await createAzSeriesAction(input)).toEqual({ ok: true, postIds: [P1, P2] });
    const [p] = seriesCalls();
    expect(seriesCalls()).toHaveLength(1);
    expect(p).toMatchObject({ request_id: REQ, theme_id: THEME_ID, gender: "boy", post_date: "2026-10-09", subject_age: "2", title_font: "quicksand" });
    expect(p.parts[0].cards.map((c) => c.name[0])).toEqual(AZ.slice(0, 13));
    expect(p.parts[1].cards.map((c) => c.name[0])).toEqual(AZ.slice(13));
    expect(p.parts.flatMap((x) => x.cards.map((c) => c.position))).toEqual([...Array(13).keys(), ...Array(13).keys()].map((k) => k + 1));
    expect(fake.rpcs.some((r) => r.fn === "create_post")).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("each part's caption says its part, in different styles, with the series tag and different hashtag sets", async () => {
    await createAzSeriesAction(input);
    const [p] = seriesCalls();
    expect(p.parts[0].caption).toMatch(/^Part 1 of our A to Z baby boy names, A to M/);
    expect(p.parts[1].caption).toMatch(/^Part 2 of our A to Z baby boy names, N to Z/);
    expect(p.parts[0].caption_style).not.toBe(p.parts[1].caption_style);
    for (const part of p.parts) expect(part.hashtag_set.split(" ")).toEqual(expect.arrayContaining(["#uniquenames", "#atozbabynames"]));
    expect(p.parts[0].hashtag_set).not.toBe(p.parts[1].hashtag_set);
    const prompts = generateJson.mock.calls.map((c) => c[0].prompt as string);
    expect(prompts.some((x) => x.includes("Part 1 of 2 of an A to Z series"))).toBe(true);
    expect(prompts.some((x) => x.includes("Part 2 of 2 of an A to Z series"))).toBe(true);
  });

  it("queues a closing card at the end of each part (one per post)", async () => {
    await createAzSeriesAction(input);
    const ctas = fake.queries.filter((q) => q.table === "cards" && op(q, "insert")).map((q) => op(q, "insert")![1] as { post_id: string; kind: string; position: number });
    expect(ctas.map((c) => [c.post_id, c.kind])).toEqual([[P1, "cta"], [P2, "cta"]]);
  });

  it("refuses with the missing letters (no database write)", async () => {
    dbNames = names.filter((n) => !["D", "Q"].includes(n.name[0]));
    const r = await createAzSeriesAction(input);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/No available single boy name for D, Q\. Use Fill missing letters/) });
    expect(seriesCalls()).toHaveLength(0);
  });

  it("uses the Generate lock (PC offline / ComfyUI closed)", async () => {
    worker = { id: 1, last_seen: new Date(Date.now() - 3600_000).toISOString(), comfyui_ok: true };
    const r = await createAzSeriesAction(input);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/offline/i);
    worker = { id: 1, last_seen: new Date().toISOString(), comfyui_ok: false };
    expect((await createAzSeriesAction(input)).ok).toBe(false);
    expect(seriesCalls()).toHaveLength(0);
  });

  it("before 011 (no create_series) explains the database update", async () => {
    rpcAnswers = [{ error: { message: "Could not find the function public.create_series(p) in the schema cache", code: "PGRST202" } }];
    expect(await createAzSeriesAction(input)).toEqual({ ok: false, error: expect.stringMatching(/011_az_series\.sql/) });
    expect(fake.queries.some((q) => q.table === "cards" && op(q, "insert"))).toBe(false);
  });

  it("a conflict (a name or the theme just taken) re-plans once with the same request id", async () => {
    rpcAnswers = [{ data: { status: "conflict", reason: "names" } }, { data: { status: "ok", post_ids: [P1, P2] } }];
    expect(await createAzSeriesAction(input)).toEqual({ ok: true, postIds: [P1, P2] });
    expect(seriesCalls().map((p) => p.request_id)).toEqual([REQ, REQ]);
    rpcAnswers = [{ data: { status: "conflict", reason: "theme" } }, { data: { status: "conflict", reason: "theme" } }];
    expect((await createAzSeriesAction(input)).ok).toBe(false);
  });

  it("validates the input after the owner check, before any database call", async () => {
    expect((await createAzSeriesAction({ ...input, requestId: "nope" })).ok).toBe(false);
    expect((await createAzSeriesAction({ ...input, gender: "x" as "boy" })).ok).toBe(false);
    expect((await createAzSeriesAction({ ...input, postDate: "tomorrow" })).ok).toBe(false);
    expect((await createAzSeriesAction({ ...input, fonts: { title_font: "comic", meaning_font: "poppins", mark_font: "poppins" } })).ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
    owner = null;
    await expect(createAzSeriesAction(input)).rejects.toThrow(/Not signed in/);
  });
});
