import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { previewAutopilotAction, startAutopilotAction, stopAutopilotAction, resumeAutopilotAction, saveNameThemesAction } = await import("@/lib/actions/autopilot");

const RUN = "55555555-5555-4555-8555-555555555555";
const settings = { id: 1, min_images: 6, max_images: 26, autopilot_name_themes: "Biblical\nSoft and cool" };
const posts = [{ fb_state: "scheduled", fb_scheduled_for: "2026-11-19T05:29:00Z", posted_at: "2026-11-19T05:29:00Z", letter: "R", name_theme: null }];
const themes = [...Array(7).fill({ gender: "boy" }), ...Array(3).fill({ gender: "girl" })];
let insertErr: { message: string; code?: string } | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-20T03:00:00Z"), toFake: ["Date"] });
  Object.assign(process.env, { FACEBOOK_PAGE_ID: "1", FACEBOOK_PAGE_TOKEN: "t", FACEBOOK_APP_SECRET: "s", ANTHROPIC_API_KEY: "k", AUTOPILOT_SECRET: "x".repeat(40), SUPABASE_SERVICE_ROLE_KEY: "srk" });
  insertErr = null;
  fake = fakeSupabase((q) => respond(q));
  respond = (q: Query) => {
    if (q.table === "settings" && isUpdate(q)) return { data: [{ id: 1 }] };
    if (q.table === "settings") return { data: settings };
    if (q.table === "posts") return { data: posts };
    if (q.table === "themes") return { data: themes };
    if (q.table === "autopilot_runs" && op(q, "insert")) return insertErr ? { error: insertErr } : { data: { id: RUN } };
    if (q.table === "autopilot_runs" && isUpdate(q)) return { data: [{ id: RUN }] };
    if (q.table === "autopilot_items" && op(q, "insert")) return { data: null };
    return undefined;
  };
});

describe("Autopilot actions", () => {
  it("previews the next days from the last Facebook post, and warns about themes", async () => {
    const r = await previewAutopilotAction(7);
    expect(r.ok && r.preview).toMatchObject({ range: "Sat, Nov 21 – Fri, Nov 27", posts: 14 });
    // Unique Names skips the letters short of US names (fewer than 16 ranked 101-2,000: U and X here), then Z goes on to the themes.
    expect(r.ok && r.preview.days.map((d) => d.label)).toEqual(["Letter S", "Letter T", "Letter V", "Letter W", "Letter Y", "Letter Z", "Biblical names"]);
    expect(r.ok && r.preview.problems).toEqual(["Only 3 girl photoshoot themes are left: the girl posts from Tue, Nov 24 will be held. Add girl themes first."]);
    expect(await previewAutopilotAction(8)).toEqual({ ok: false, error: "Pick 1 to 7 days." });
  });

  it("starts a run with its planned posts", async () => {
    expect(await startAutopilotAction(2)).toEqual({ ok: true, runId: RUN });
    const run = op(fake.queries.find((q) => q.table === "autopilot_runs" && op(q, "insert"))!, "insert")![1] as Record<string, unknown>;
    expect(run).toMatchObject({ days: 2, first_day: "2026-11-21" });
    const items = op(fake.queries.find((q) => q.table === "autopilot_items" && op(q, "insert"))!, "insert")![1] as Record<string, unknown>[];
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ run_id: RUN, day: "2026-11-21", slot: "morning", letter: "S", name_theme: null });
  });

  it("explains what is missing before starting", async () => {
    delete process.env.FACEBOOK_PAGE_TOKEN;
    expect(await startAutopilotAction(7)).toMatchObject({ ok: false, error: expect.stringMatching(/Connect Facebook first/) });
    process.env.FACEBOOK_PAGE_TOKEN = "t";
    delete process.env.AUTOPILOT_SECRET;
    expect(await startAutopilotAction(7)).toMatchObject({ ok: false, error: expect.stringMatching(/AUTOPILOT_SECRET/) });
    process.env.AUTOPILOT_SECRET = "x".repeat(40);
    insertErr = { message: "duplicate key value violates unique constraint \"autopilot_runs_one_active\"", code: "23505" };
    expect(await startAutopilotAction(7)).toEqual({ ok: false, error: "Autopilot is already running. Stop it first." });
  });

  it("stop, resume and the name-theme list", async () => {
    expect(await stopAutopilotAction(RUN)).toEqual({ ok: true });
    expect(op(fake.queries.filter((q) => q.table === "autopilot_runs" && isUpdate(q)).at(-1)!, "update")![1]).toMatchObject({ status: "stopped", message: null });
    expect(await resumeAutopilotAction(RUN)).toEqual({ ok: true });
    expect(await saveNameThemesAction("")).toEqual({ ok: false, error: "Add at least one name theme." });
    expect(await saveNameThemesAction("  Biblical \n\n Soft and cool ")).toEqual({ ok: true });
    expect(op(fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).at(-1)!, "update")![1]).toEqual({ autopilot_name_themes: "Biblical\nSoft and cool" });
  });

  it("says so when stop or resume changed nothing, and filters by status", async () => {
    await stopAutopilotAction(RUN);
    const stop = fake.queries.filter((q) => q.table === "autopilot_runs" && isUpdate(q)).at(-1)!;
    expect(op(stop, "in")!.slice(1)).toEqual(["status", ["running", "waiting", "paused"]]);
    await resumeAutopilotAction(RUN);
    const resume = fake.queries.filter((q) => q.table === "autopilot_runs" && isUpdate(q)).at(-1)!;
    expect(resume.ops.filter((o) => o[0] === "eq").map((o) => o.slice(1))).toContainEqual(["status", "paused"]);
    const base = respond;
    respond = (q) => (q.table === "autopilot_runs" && isUpdate(q) ? { data: [] } : base(q));
    expect(await stopAutopilotAction(RUN)).toEqual({ ok: false, error: "That run is no longer active." });
    expect(await resumeAutopilotAction(RUN)).toEqual({ ok: false, error: "That run isn't paused." });
  });

  it("removes the run when the plan cannot be saved, and says so if it cannot", async () => {
    const base = respond;
    respond = (q) => (q.table === "autopilot_items" && op(q, "insert") ? { error: { message: "boom" } } : base(q));
    expect(await startAutopilotAction(2)).toEqual({ ok: false, error: "Could not save the plan: boom" });
    expect(fake.queries.some((q) => q.table === "autopilot_runs" && op(q, "delete"))).toBe(true);
    respond = (q) => (q.table === "autopilot_items" && op(q, "insert") ? { error: { message: "boom" } }
      : q.table === "autopilot_runs" && op(q, "delete") ? { error: { message: "nope" } } : base(q));
    expect(await startAutopilotAction(2)).toEqual({ ok: false, error: "Could not save the plan: boom. Also could not undo the started run (nope): press Stop on the Autopilot page before starting again." });
  });

  it("reads the newest Facebook posts first, nulls last", async () => {
    await previewAutopilotAction(1);
    const q = fake.queries.find((x) => x.table === "posts")!;
    expect(q.ops.filter((o) => o[0] === "order").map((o) => o.slice(1))).toEqual([
      ["posted_at", { ascending: false, nullsFirst: false }], ["fb_scheduled_for", { ascending: false, nullsFirst: false }]]);
  });
});
