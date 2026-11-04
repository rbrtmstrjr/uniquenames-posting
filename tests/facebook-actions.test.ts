import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const updateCaption = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/actions/posts", () => ({ updateCaptionAction: updateCaption }));

// A fake Facebook behind the real config and error class.
const fb = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async (url: string, _o?: { temporary?: boolean }) => `photo:${url.split("/").pop()}`),
  createPost: vi.fn(async (_p: { message: string; photoIds: string[]; scheduledAt?: Date }) => "111_999"),
  permalink: vi.fn(async () => "https://www.facebook.com/111/posts/999"),
  deletePost: vi.fn(async () => {}),
  pageName: vi.fn(async () => "Unique Names"),
}));
vi.mock("@/lib/facebook/graph", async (real) => ({ ...(await real<typeof import("@/lib/facebook/graph")>()), graphClient: () => fb }));
const { FacebookError } = await import("@/lib/facebook/graph");
const { cancelFacebookScheduleAction, checkFacebookAction, publishToFacebookAction } = await import("@/lib/actions/facebook");

const POST_ID = "33333333-3333-4333-8333-333333333333";
const KEYS = { FACEBOOK_PAGE_ID: "111", FACEBOOK_PAGE_TOKEN: "tok", FACEBOOK_APP_SECRET: "sec" };
const card = (id: string, order_index: number, o: Record<string, unknown> = {}) =>
  ({ id, kind: "post", selected: true, status: "done", card_path: `cards/${id}/v1.jpg`, order_index, position: order_index, ...o });

let post: Record<string, unknown>;
let cards: Record<string, unknown>[];
let lockTaken: boolean;

beforeEach(() => {
  Object.assign(process.env, KEYS);
  for (const f of Object.values(fb)) f.mockClear();
  updateCaption.mockClear();
  fake = fakeSupabase((q) => respond(q));
  post = { id: POST_ID, caption: "Names 🥰\n\n#uniquenames", status: "ready", fb_state: null, fb_post_id: null, fb_attempt_at: null };
  // stored order: c3 is first in the owner's order, c2 unselected, the closing card last whatever its order_index
  cards = [card("c1", 2), card("c2", 3, { selected: false }), card("cta", 0, { kind: "cta" }), card("c3", 1)];
  lockTaken = true;
  respond = (q: Query) => {
    if (q.table === "posts" && isUpdate(q) && op(q, "or")) return { data: lockTaken ? [{ id: POST_ID }] : [] };
    if (q.table === "posts" && isUpdate(q)) return { data: null };
    if (q.table === "posts") return { data: post };
    if (q.table === "cards") return { data: cards };
    return undefined;
  };
});

const updates = () => fake.queries.filter((q) => q.table === "posts" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);
const lockFilter = () => String(op(fake.queries.find((q) => q.table === "posts" && op(q, "or"))!, "or")![1]);

describe("publishToFacebookAction: Post now", () => {
  it("posts the selected cards in the upload order (closing card last) as ONE post with the caption, then marks it posted", async () => {
    const r = await publishToFacebookAction(POST_ID, { caption: post.caption as string });
    expect(r).toEqual({ ok: true, state: "published", permalink: "https://www.facebook.com/111/posts/999", scheduledFor: null });
    expect(fb.uploadPhoto.mock.calls.map((c) => c[0])).toEqual([
      "https://signed.example/cards/cards/c3/v1.jpg", "https://signed.example/cards/cards/c1/v1.jpg", "https://signed.example/cards/cards/cta/v1.jpg"]);
    expect(fb.uploadPhoto.mock.calls.every((c) => !c[1]?.temporary)).toBe(true);
    expect(fb.createPost).toHaveBeenCalledTimes(1);
    expect(fb.createPost.mock.calls[0][0]).toEqual({ message: post.caption, photoIds: ["photo:v1.jpg", "photo:v1.jpg", "photo:v1.jpg"], scheduledAt: undefined });
    const [lock, done] = updates();
    expect(lock).toMatchObject({ fb_state: "publishing", fb_error: null });
    expect(lockFilter()).toBe("fb_state.is.null,fb_state.eq.failed");
    expect(done).toMatchObject({ fb_post_id: "111_999", fb_permalink: "https://www.facebook.com/111/posts/999", fb_state: "published", fb_scheduled_for: null, status: "posted" });
    expect(updateCaption).not.toHaveBeenCalled();
  });

  it("saves an edited caption first and posts that text", async () => {
    await publishToFacebookAction(POST_ID, { caption: "New words\n\n#uniquenames" });
    expect(updateCaption).toHaveBeenCalledWith(POST_ID, "New words\n\n#uniquenames");
    expect(fb.createPost.mock.calls[0][0]).toMatchObject({ message: "New words\n\n#uniquenames" });
  });

  it("never sends twice: when the lock is already taken nothing goes to Facebook", async () => {
    lockTaken = false;
    const r = await publishToFacebookAction(POST_ID, { caption: post.caption as string });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/being sent to Facebook right now/) });
    expect(fb.uploadPhoto).not.toHaveBeenCalled();
    expect(fb.createPost).not.toHaveBeenCalled();
  });

  it("an upload failure is 'failed' (safe to retry) and posts nothing", async () => {
    fb.uploadPhoto.mockRejectedValueOnce(new FacebookError("Invalid image", "other", 100));
    const r = await publishToFacebookAction(POST_ID, { caption: post.caption as string });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Facebook refused: Invalid image Nothing was posted\./) });
    expect(fb.createPost).not.toHaveBeenCalled();
    expect(updates().at(-1)).toMatchObject({ fb_state: "failed", fb_error: expect.stringMatching(/Invalid image/) });
  });

  it("no answer while creating the post is 'unsure': never retried by itself, only on purpose", async () => {
    fb.createPost.mockRejectedValueOnce(new FacebookError("Facebook did not answer (timed out).", "network"));
    const r = await publishToFacebookAction(POST_ID, { caption: post.caption as string });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/may or may not be on your Page/) });
    expect(updates().at(-1)).toMatchObject({ fb_state: "unsure" });
    fake = fakeSupabase((q) => respond(q));
    await publishToFacebookAction(POST_ID, { caption: post.caption as string, retryUnsure: true });
    expect(lockFilter()).toMatch(/^fb_state\.is\.null,fb_state\.eq\.failed,fb_state\.eq\.unsure,and\(fb_state\.eq\.publishing,fb_attempt_at\.lt\.\d{4}-/);
  });

  it("a refusal while creating the post is 'failed', with plain words for each kind", async () => {
    fb.createPost.mockRejectedValueOnce(new FacebookError("Temporarily blocked", "blocked", 368));
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/paused posting from this Page/) });
    expect(updates().at(-1)).toMatchObject({ fb_state: "failed" });
    fb.createPost.mockRejectedValueOnce(new FacebookError("Session expired", "auth", 190, 460));
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/update FACEBOOK_PAGE_TOKEN in Vercel/) });
  });

  it("stops before anything is sent: not connected, before 021, already on Facebook, nothing selected, cards not ready", async () => {
    delete process.env.FACEBOOK_PAGE_TOKEN;
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Connect Facebook first/) });
    expect(fake.queries).toHaveLength(0);
    process.env.FACEBOOK_PAGE_TOKEN = "tok";
    const { fb_state: _drop, ...before021 } = post;
    post = before021;
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/021_facebook_posting\.sql/) });
    post = { ...before021, fb_state: "published" };
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: "This post is already on Facebook." });
    post = { ...before021, fb_state: null };
    cards = cards.map((c) => ({ ...c, selected: false }));
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/Select at least one card/) });
    cards = [card("c1", 1), card("c2", 2, { status: "generating", card_path: null })];
    expect(await publishToFacebookAction(POST_ID, { caption: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/1 selected card is not ready yet/) });
    expect(fb.uploadPhoto).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });
});

describe("publishToFacebookAction: Schedule", () => {
  it("uploads temporary photos and lets Facebook hold the post until the time; the post is marked posted at that time", async () => {
    const at = new Date(Date.now() + 24 * 3600_000);
    const r = await publishToFacebookAction(POST_ID, { caption: "x", scheduledAt: at.toISOString() });
    expect(r).toMatchObject({ ok: true, state: "scheduled", scheduledFor: at.toISOString() });
    expect(fb.uploadPhoto.mock.calls.every((c) => c[1]?.temporary === true)).toBe(true);
    expect(fb.createPost.mock.calls[0][0].scheduledAt!.toISOString()).toBe(at.toISOString());
    expect(updates().at(-1)).toMatchObject({ fb_state: "scheduled", fb_scheduled_for: at.toISOString(), status: "posted", posted_at: at.toISOString() });
  });

  it("keeps the time inside Facebook's window (15 minutes to 29 days) before anything is sent", async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const far = new Date(Date.now() + 40 * 24 * 3600_000).toISOString();
    expect(await publishToFacebookAction(POST_ID, { caption: "x", scheduledAt: soon })).toMatchObject({ ok: false, error: expect.stringMatching(/at least 15 minutes/) });
    expect(await publishToFacebookAction(POST_ID, { caption: "x", scheduledAt: far })).toMatchObject({ ok: false, error: expect.stringMatching(/up to 29 days/) });
    expect(await publishToFacebookAction(POST_ID, { caption: "x", scheduledAt: "not a date" })).toMatchObject({ ok: false, error: "Pick a valid date and time." });
    expect(fake.queries).toHaveLength(0);
  });
});

describe("cancelFacebookScheduleAction", () => {
  it("deletes the scheduled post on Facebook and puts the post back to ready", async () => {
    post = { ...post, fb_state: "scheduled", fb_post_id: "111_5", status: "posted" };
    expect(await cancelFacebookScheduleAction(POST_ID)).toEqual({ ok: true });
    expect(fb.deletePost).toHaveBeenCalledWith("111_5");
    expect(updates().at(-1)).toMatchObject({ fb_post_id: null, fb_state: null, fb_scheduled_for: null, status: "ready", posted_at: null });
    expect(fake.rpcs.map((r) => r.fn)).toEqual(["refresh_post"]);
  });

  it("only cancels a scheduled post", async () => {
    post = { ...post, fb_state: "published", fb_post_id: "111_5" };
    expect(await cancelFacebookScheduleAction(POST_ID)).toMatchObject({ ok: false, error: "This post is not scheduled on Facebook." });
    expect(fb.deletePost).not.toHaveBeenCalled();
  });
});

describe("checkFacebookAction", () => {
  it("shows the Page name, or what to fix", async () => {
    expect(await checkFacebookAction()).toEqual({ ok: true, pageName: "Unique Names" });
    fb.pageName.mockRejectedValueOnce(new FacebookError("Session expired", "auth", 190));
    expect(await checkFacebookAction()).toMatchObject({ ok: false, error: expect.stringMatching(/update FACEBOOK_PAGE_TOKEN in Vercel\.$/) });
    delete process.env.FACEBOOK_APP_SECRET;
    expect(await checkFacebookAction()).toMatchObject({ ok: false, error: expect.stringMatching(/^Connect Facebook first/) });
  });
});
