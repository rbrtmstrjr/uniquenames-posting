import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRow } from "@/lib/db/types";
import { fakeSupabase, isUpdate, type Query, type Respond } from "./helpers/fake-supabase";
import { isPinned } from "@/lib/files/save";

// Editing the front card (023): New picture and Retry work as on any card; its title comes from the post, so the name
// paths (text edit, name ideas, the closing card's message) refuse it; the drag never moves it.
let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson: vi.fn(async () => ({ ok: false, error: "off" })) }));
const { ctaTextAction, regenerateCardAction, restampCardAction } = await import("@/lib/actions/cards");
const { cardNameIdeasAction } = await import("@/lib/actions/suggest");

const CARD_ID = "44444444-4444-4444-8444-444444444444";
const front = { id: CARD_ID, post_id: "33333333-3333-4333-8333-333333333333", theme_id: "22222222-2222-4222-8222-222222222222", kind: "cover",
  position: 0, name_id: null, name: "'S' Names", meaning: "for baby boy", shot: "front card: wide: x", prompt: "p", seed: 5, status: "done", error: null,
  photo_path: "photos/f/v1.jpg", card_path: "cards/f/v1.jpg", version: 1, selected: true, order_index: 0, queued_at: "", claimed_at: null,
  started_at: null, finished_at: null, attempts: 1, created_at: "", updated_at: "", title_pos: "top" } as CardRow;

beforeEach(() => {
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "worker_status") return { data: { id: 1, last_seen: new Date().toISOString(), comfyui_ok: true } };
    if (q.table === "cards" && isUpdate(q)) return { data: [{ id: CARD_ID }] };
    if (q.table === "cards") return { data: front };
    return undefined;
  };
});

describe("editing the front card", () => {
  it("New picture / Retry remake it; its title can't be edited, given name ideas or a message", async () => {
    expect(await regenerateCardAction(CARD_ID)).toEqual({ ok: true });
    const refused = "The front card's title comes from the post, so it can't be edited. Use New picture for a new photo.";
    expect(await regenerateCardAction(CARD_ID, { name: "Arlo", meaning: "strong" })).toEqual({ ok: false, error: refused });
    expect(await restampCardAction(CARD_ID, "Arlo", "strong")).toEqual({ ok: false, error: refused });
    expect(await ctaTextAction(CARD_ID, "Follow")).toEqual({ ok: false, error: "Only the closing card has a message." });
    expect(await cardNameIdeasAction(CARD_ID)).toEqual({ ok: false, error: "Name ideas are for the name cards in a post." });
  });

  it("the drag leaves the front and closing cards where they are", () => {
    expect([isPinned({ kind: "cover" }), isPinned({ kind: "cta" }), isPinned({ kind: "post" }), isPinned({})]).toEqual([true, true, false, false]);
  });
});
