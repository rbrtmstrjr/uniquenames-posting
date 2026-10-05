import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { regenerateCardAction, restampCardAction } = await import("@/lib/actions/cards");
const { addCardAction, createPostAction } = await import("@/lib/actions/posts");
const { makePreviewAction } = await import("@/lib/actions/themes");

const ID = "11111111-1111-4111-8111-111111111111";
const base: CardRow = {
  id: ID, post_id: "p1", theme_id: "t1", kind: "post", position: 2, name_id: "n1", name: "Arlo Zenith", meaning: "strong and bright",
  shot: "s", prompt: "p", seed: 12345, status: "done", error: null, photo_path: "photos/x/v3.jpg", card_path: "cards/x/v3.jpg", version: 3,
  selected: true, order_index: 2, queued_at: "2026-10-05T00:00:00Z", claimed_at: null, started_at: "2026-10-05T00:00:01Z", finished_at: "2026-10-05T00:00:30Z",
  attempts: 1, created_at: "", updated_at: "",
} as CardRow;

type Health = "ready" | "comfy-off" | "offline" | "unknown";
const workerRow = (h: Health) => h === "unknown" ? null : {
  id: 1, last_seen: new Date(Date.now() - (h === "offline" ? 120_000 : 3_000)).toISOString(), comfyui_ok: h === "ready",
};

/** Answers: the card select, worker_status, the dup-name check, and the updates (configurable). */
function world(opts: { card?: CardRow | null; health?: Health; dup?: boolean; updated?: boolean; nameError?: string } = {}) {
  const { card = base, health = "ready", dup = false, updated = true, nameError } = opts;
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "worker_status") return { data: workerRow(health) };
    if (q.table === "cards" && isUpdate(q)) return { data: updated ? [{ id: ID }] : [] };
    if (q.table === "cards") return { data: card };
    if (q.table === "names" && isUpdate(q)) return nameError ? { error: { message: nameError } } : { data: null };
    if (q.table === "names") return { data: dup ? [{ id: "other" }] : [] };
    return undefined;
  };
}
const cardUpdates = () => fake.queries.filter((q) => q.table === "cards" && isUpdate(q));
const nameUpdates = () => fake.queries.filter((q) => q.table === "names" && isUpdate(q));
const patchOf = (q: Query) => op(q, "update")![1] as Record<string, unknown>;

beforeEach(() => world());

describe("regenerateCardAction: plain New picture / Retry", () => {
  it("requeues in one guarded update with a new seed and leaves the text alone", async () => {
    const r = await regenerateCardAction(ID);
    expect(r).toEqual({ ok: true });
    expect(cardUpdates()).toHaveLength(1);
    const q = cardUpdates()[0];
    const p = patchOf(q);
    expect(p).toMatchObject({ status: "queued", claimed_at: null, version: 4, attempts: 0 });
    expect(p.seed).not.toBe(base.seed);
    expect(Number.isSafeInteger(p.seed) && (p.seed as number) > 0).toBe(true);
    expect(p).not.toHaveProperty("name");
    expect(q.ops).toContainEqual(["eq", "version", 3]);
    expect(nameUpdates()).toHaveLength(0);
  });

  it("passing the same text (after normalizing) is still a plain regenerate", async () => {
    const r = await regenerateCardAction(ID, { name: "  Arlo  Zenith", meaning: "Strong and bright" });
    expect(r.ok).toBe(true);
    expect(patchOf(cardUpdates()[0])).not.toHaveProperty("name");
    expect(nameUpdates()).toHaveLength(0);
  });

  it("refuses while the card is being made, and when someone else moved the version", async () => {
    world({ card: { ...base, status: "generating" } });
    expect(await regenerateCardAction(ID)).toMatchObject({ ok: false, error: expect.stringMatching(/being made right now/) });
    expect(cardUpdates()).toHaveLength(0);
    world({ updated: false });
    expect(await regenerateCardAction(ID)).toMatchObject({ ok: false, error: expect.stringMatching(/just changed/) });
  });
});

describe("regenerateCardAction with edited text (the #3 fix)", () => {
  it("saves the new name + meaning and requeues in ONE card update, then updates the names row with its style", async () => {
    const r = await regenerateCardAction(ID, { name: "Arlo  Zephyr", meaning: "Gentle West Wind " });
    expect(r).toEqual({ ok: true });
    expect(cardUpdates()).toHaveLength(1);
    const p = patchOf(cardUpdates()[0]);
    expect(p).toMatchObject({ name: "Arlo Zephyr", meaning: "gentle west wind", status: "queued", claimed_at: null, version: 4 });
    expect(p.seed).not.toBe(base.seed);
    expect(cardUpdates()[0].ops).toContainEqual(["eq", "version", 3]);
    expect(nameUpdates()).toHaveLength(1);
    expect(patchOf(nameUpdates()[0])).toEqual({ name: "Arlo Zephyr", meaning: "gentle west wind", style: "two-word" });
    expect(nameUpdates()[0].ops).toContainEqual(["eq", "id", "n1"]);
  });

  it("validates the text first", async () => {
    expect(await regenerateCardAction(ID, { name: "Arlo 3", meaning: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/letters/) });
    expect(await regenerateCardAction(ID, { name: "Arlo", meaning: "  " })).toMatchObject({ ok: false, error: "Type the meaning." });
    expect(cardUpdates()).toHaveLength(0);
  });

  it("refuses a spelling another name already has (like restamp)", async () => {
    world({ dup: true });
    expect(await regenerateCardAction(ID, { name: "Taken Name", meaning: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/already has that spelling/) });
    expect(cardUpdates()).toHaveLength(0);
  });

  it("writes the names row BEFORE the card, so a names failure leaves the card untouched", async () => {
    world({ nameError: 'duplicate key value violates unique constraint "names_lower_name"' });
    const r = await regenerateCardAction(ID, { name: "Arlo Zephyr", meaning: "wind" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/already has that spelling/) });
    expect(cardUpdates()).toHaveLength(0);
    expect(fake.queries.filter(isUpdate).map((q) => q.table)).toEqual(["names"]);
  });

  it("names first, then card; a stale card update puts only the names row back (no card rollback race)", async () => {
    world({ updated: false });
    const r = await regenerateCardAction(ID, { name: "Arlo Zephyr", meaning: "wind" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/just changed/) });
    expect(fake.queries.filter(isUpdate).map((q) => q.table)).toEqual(["names", "cards", "names"]);
    expect(patchOf(nameUpdates()[1])).toEqual({ name: "Arlo Zenith", meaning: "strong and bright", style: "two-word" });
  });

  it("restamp also writes names first and restores them on a stale card", async () => {
    world({ updated: false });
    expect(await restampCardAction(ID, "Arlo Zephyr", "wind")).toMatchObject({ ok: false });
    expect(fake.queries.filter(isUpdate).map((q) => q.table)).toEqual(["names", "cards", "names"]);
  });
});

describe("Generate lock on the server (#6)", () => {
  it.each([["offline", /offline/], ["unknown", /offline/], ["comfy-off", /ComfyUI/]] as const)("%s PC: New picture is refused", async (h, re) => {
    world({ health: h });
    expect(await regenerateCardAction(ID)).toMatchObject({ ok: false, error: expect.stringMatching(re) });
    expect(await regenerateCardAction(ID, { name: "Arlo Zephyr", meaning: "wind" })).toMatchObject({ ok: false });
    expect(cardUpdates()).toHaveLength(0);
  });

  it("a re-stamp is allowed with ComfyUI closed (Pillow only)", async () => {
    world({ health: "comfy-off" });
    expect(await restampCardAction(ID, "Arlo Zephyr", "wind")).toMatchObject({ ok: true, mode: "restamp" });
  });

  it("a text edit that has to regenerate (no clean photo) is refused with ComfyUI closed", async () => {
    world({ health: "comfy-off", card: { ...base, photo_path: null } });
    expect(await restampCardAction(ID, "Arlo Zephyr", "wind")).toMatchObject({ ok: false, error: expect.stringMatching(/ComfyUI/) });
    expect(cardUpdates()).toHaveLength(0);
  });

  it("a worker_status read error does not block (fail open)", async () => {
    world();
    const inner = respond;
    respond = (q) => (q.table === "worker_status" ? { error: { message: "blip" } } : inner(q));
    expect((await regenerateCardAction(ID)).ok).toBe(true);
  });

  it("Add a card, Generate post and Make preview are refused while the PC is offline", async () => {
    world({ health: "offline" });
    expect(await addCardAction("p1")).toMatchObject({ ok: false, error: expect.stringMatching(/offline/) });
    expect(await createPostAction({ gender: "boy", style: "two-word", count: null, postDate: "2026-10-05", requestId: ID })).toMatchObject({ ok: false, error: expect.stringMatching(/offline/) });
    expect(await makePreviewAction("t1")).toMatchObject({ ok: false, error: expect.stringMatching(/offline/) });
    expect(fake.rpcs).toHaveLength(0);
    expect(fake.queries.filter((q) => q.ops.some((o) => o[0] === "insert"))).toHaveLength(0);
  });
});
