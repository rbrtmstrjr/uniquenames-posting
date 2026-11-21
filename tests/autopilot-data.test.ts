import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
const { getAutopilotData } = await import("@/lib/data/autopilot");

beforeEach(() => { fake = fakeSupabase((q) => respond(q)); });

describe("getAutopilotData", () => {
  it("flags a missing migration, but throws on other errors", async () => {
    respond = (q: Query) => (q.table === "autopilot_runs" ? { error: { message: 'relation "autopilot_runs" does not exist', code: "42P01" } } : { data: { id: 1 } });
    expect(await getAutopilotData()).toMatchObject({ needs022: true, run: null });
    respond = (q: Query) => (q.table === "autopilot_runs" ? { error: { message: "network down" } } : { data: { id: 1 } });
    await expect(getAutopilotData()).rejects.toThrow("Could not load Autopilot: network down");
    respond = (q: Query) => (q.table === "settings" ? { error: { message: "bad settings" } } : { data: [] });
    await expect(getAutopilotData()).rejects.toThrow("Could not load Autopilot: bad settings");
  });

  it("counts the cards of each planned post", async () => {
    respond = (q: Query) => {
      if (q.table === "settings") return { data: { id: 1, autopilot_name_themes: "Biblical" } };
      if (q.table === "autopilot_runs") return { data: [{ id: "r1" }] };
      if (q.table === "autopilot_items") return { data: [{ id: "i1", post_id: "p1" }, { id: "i2", post_id: null }] };
      if (q.table === "cards") return { data: [
        { post_id: "p1", status: "done", check_state: "passed", remakes: 0 }, { post_id: "p1", status: "done", check_state: "passed", remakes: 1 },
        { post_id: "p1", status: "done", check_state: "removed", remakes: 2 }, { post_id: "p1", status: "queued", check_state: null, remakes: 0 }] };
      return undefined;
    };
    const r = await getAutopilotData();
    expect(r.needs022).toBe(false);
    expect(r.items).toHaveLength(2);
    expect(r.nameThemes).toBe("Biblical");
    expect(r.stats).toEqual({ p1: { total: 4, done: 3, passed: 2, remade: 2, removed: 1 } });
  });
});
