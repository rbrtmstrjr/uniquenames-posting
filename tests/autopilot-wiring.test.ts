import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

const pickNames = vi.hoisted(() => vi.fn(async () => ({ kind: "ok", nameIds: [], usage: {}, added: [], skipped: [] })));
const publishPost = vi.hoisted(() => vi.fn(async () => ({ ok: true, state: "scheduled", permalink: null, scheduledFor: "x" })));
const suggestNames = vi.hoisted(() => vi.fn());
const suggestForLetter = vi.hoisted(() => vi.fn());
vi.mock("@/lib/autopilot/names-step", () => ({ pickNames }));
vi.mock("@/lib/facebook/publish", () => ({ publishPost }));
vi.mock("@/lib/ai/suggest", () => ({ suggestNames, suggestForLetter }));
vi.mock("@/lib/posts/create", () => ({ createPostCore: vi.fn() }));
vi.mock("@/lib/cards/remake", () => ({ remakeCard: vi.fn() }));
vi.mock("@/lib/autopilot/judge-names", () => ({ judgeNames: vi.fn() }));
vi.mock("@/lib/autopilot/judge-photos", () => ({ judgeCard: vi.fn(), judgeLookAlike: vi.fn() }));
const { autopilotDeps } = await import("@/lib/autopilot/wiring");

const mk = (respond: Parameters<typeof fakeSupabase>[0] = () => ({ data: { caption: "Hello caption" } })) =>
  autopilotDeps(fakeSupabase(respond).client as never);

beforeEach(() => { pickNames.mockClear(); publishPost.mockClear(); suggestNames.mockReset(); });

describe("autopilotDeps", () => {
  it("passes the item, hint and deadline through to the real pickNames", async () => {
    const item = { id: "i1" } as never;
    await mk().pickNames(item, "a hint", 12345);
    expect(pickNames).toHaveBeenCalledTimes(1);
    const args = pickNames.mock.calls[0] as unknown as unknown[];
    expect(args.slice(1)).toEqual([item, "a hint", 12345]);
  });

  it("schedules with the post's own caption and the given time, only with every selected card checked", async () => {
    await mk().schedule("post-1", "2026-11-21T00:00:00Z");
    expect(publishPost).toHaveBeenCalledWith(expect.anything(), "post-1", { caption: "Hello caption", scheduledAt: "2026-11-21T00:00:00Z", requireChecked: true });
  });

  it("does not schedule when the caption cannot be read or is blank", async () => {
    for (const r of [{ error: { message: "db down" } }, { data: null }, { data: { caption: null } }, { data: { caption: "" } }, { data: { caption: "  \n " } }]) {
      const out = await mk(() => r).schedule("post-1", "2026-11-21T00:00:00Z");
      expect(out).toEqual({ ok: false, error: "Couldn't read the post's caption, so it was not scheduled.", errorKind: "db" });
    }
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("theme suggestions keep only fresh single names", async () => {
    await mk().pickNames({} as never, null);
    const namesDeps = (pickNames.mock.calls[0] as unknown as unknown[])[0] as { suggest: (i: unknown) => Promise<{ ok: boolean; names?: { name: string }[] }> };
    suggestNames.mockResolvedValue({ ok: true, data: [
      { name: "Mary Jane", meaning: "bitter and gracious one" },
      { name: "Noah", meaning: "rest and comfort always" },
      { name: "Zephyr", meaning: "the soft west wind" },
    ] });
    const r = await namesDeps.suggest({ gender: "boy", target: { kind: "theme", title: "Biblical", hint: null }, want: 10, allNames: ["Noah"], existing: [] });
    expect(r.ok).toBe(true);
    // Zephyr passes the Unique Names US gate only because the real US list has it (boys #1123); a list refresh may move it.
    expect(r.names?.map((n) => n.name)).toEqual(["Zephyr"]);
  });
});

describe("supabaseRepo", () => {
  it("reads every name with Autopilot's note (a restored name keeps it)", async () => {
    const { supabaseRepo } = await import("@/lib/autopilot/repo");
    const fake = fakeSupabase(() => ({ data: [{ id: "n1", name: "Saoirse", meaning: "m", gender: "girl", style: "single", status: "available", autopilot_note: "Skipped by Autopilot: hard to say" }] }));
    const names = await supabaseRepo(fake.client as never).allNames();
    expect(names[0].autopilot_note).toBe("Skipped by Autopilot: hard to say");
    expect(fake.queries[0].ops).toContainEqual(["select", "id, name, meaning, gender, style, status, autopilot_note"]);
  });

  it("reads a post's Facebook state", async () => {
    const { supabaseRepo } = await import("@/lib/autopilot/repo");
    const fake = fakeSupabase(() => ({ data: { fb_state: "scheduled" } }));
    expect(await supabaseRepo(fake.client as never).facebookState("p1")).toBe("scheduled");
    expect(fake.queries[0]).toMatchObject({ table: "posts", ops: expect.arrayContaining([["select", "fb_state"], ["eq", "id", "p1"]]) });
    expect(await supabaseRepo(fakeSupabase(() => ({ data: null })).client as never).facebookState("p1")).toBeNull();
  });
});
