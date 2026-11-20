import { beforeEach, describe, expect, it, vi } from "vitest";

const tick = vi.hoisted(() => vi.fn(async () => ({ ran: true, status: "running" })));
const admin = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock("@/lib/autopilot/engine", () => ({ tick }));
vi.mock("@/lib/autopilot/wiring", () => ({ autopilotDeps: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
const { POST } = await import("@/app/api/autopilot/tick/route");
const { keyOk } = await import("@/lib/autopilot/key");
const { isPublicPath } = await import("@/lib/supabase/proxy");

const SECRET = "s".repeat(40);
const req = (key?: string) => new Request("https://site/api/autopilot/tick", { method: "POST", headers: key ? { "x-autopilot-key": key } : {} });

beforeEach(() => { tick.mockClear(); process.env.AUTOPILOT_SECRET = SECRET; admin.client = {}; });

describe("the tick route", () => {
  it("is reachable without a login (it checks its own key)", () => {
    expect(isPublicPath("/api/autopilot/tick")).toBe(true);
  });
  it("needs the secret, at least 32 characters, compared in constant time", () => {
    expect(keyOk(SECRET, SECRET)).toBe(true);
    expect(keyOk("wrong", SECRET)).toBe(false);
    expect(keyOk(null, SECRET)).toBe(false);
    expect(keyOk("short", "short")).toBe(false);
  });
  it("401 with a wrong key, 503 when the keys are not set, else one tick", async () => {
    expect((await POST(req("nope"))).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
    delete process.env.AUTOPILOT_SECRET;
    expect((await POST(req(SECRET))).status).toBe(503);
    process.env.AUTOPILOT_SECRET = SECRET;
    admin.client = null;
    expect((await POST(req(SECRET))).status).toBe(503);
    admin.client = {};
    const ok = await POST(req(SECRET));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ran: true, status: "running" });
  });
});
