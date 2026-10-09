import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_SETTINGS_DEFAULTS } from "@/lib/db/types";
import { validateSettings } from "@/lib/actions/validate";
import { needsSample, sampleKey, speedLabel, speedOf } from "@/lib/reels/voices";
import { fakeSupabase, isUpdate, op, type Query, type Respond } from "./helpers/fake-supabase";

let respond: Respond = () => undefined;
let fake = fakeSupabase((q) => respond(q));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client, getOwner: async () => ({ id: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveSettingsAction } = await import("@/lib/actions/settings");

const input = { caption_template: "Hi {gender}", hashtags: "#a", handle: "@unique_names", min_images: 9, max_images: 13, sound_on: true, ...TEXT_SETTINGS_DEFAULTS };
const v6 = { reel_voice_id: "kore", reel_speed: 1.1300000000000001, reel_music: false, reel_music_volume: 25 };
const settingsUpdates = () => fake.queries.filter((q) => q.table === "settings" && isUpdate(q)).map((q) => op(q, "update")![1] as Record<string, unknown>);
const failFirst = (error: { message: string; code?: string }) => {
  let first = true;
  respond = (q: Query) => (q.table === "settings" && isUpdate(q) && first ? ((first = false), { error }) : undefined);
};

beforeEach(() => { fake = fakeSupabase((q) => respond(q)); respond = () => undefined; });

describe("pure voice helpers", () => {
  it("sample key = calm params + speed (2 decimals)", () => {
    expect(sampleKey(1.12)).toBe("e0.35-t0.7-c0.5-s1.12-g1");
    expect(sampleKey(1)).toBe("e0.35-t0.7-c0.5-s1.00-g1");
    expect(sampleKey(1.1300000000000001)).toBe(sampleKey(1.13));
  });
  it("speed: numeric strings, out of range and junk fall back to 1.05 (the default from 014); label shows ×", () => {
    expect(speedOf("1.20")).toBe(1.2);
    expect(speedOf(2)).toBe(1.05);
    expect(speedOf(null)).toBe(1.05);
    expect(speedLabel(1.1)).toBe("1.10×");
  });
  it("needsSample: set up and (missing | failed | stale)", () => {
    const k = sampleKey(1.12);
    const v = { id: "kore", ref_path: "r", sample_status: "ready" as const, sample_key: k };
    expect(needsSample(v, k)).toBe(false);
    expect(needsSample(v, sampleKey(1.2))).toBe(true);
    expect(needsSample({ ...v, sample_status: "missing" }, k)).toBe(true);
    expect(needsSample({ ...v, sample_status: "making", sample_key: null }, k)).toBe(false);
    expect(needsSample({ ...v, ref_path: null, sample_status: "missing" }, k)).toBe(false);
    expect(needsSample({ ...v, id: "builtin", ref_path: null, sample_status: "missing" }, k)).toBe(true);
  });
});

describe("validateSettings: narrator + music", () => {
  it("accepts the ranges, refuses outside them", () => {
    expect(validateSettings({ ...input, ...v6 })).toBeNull();
    expect(validateSettings({ ...input, reel_speed: 1 })).toBeNull();
    expect(validateSettings({ ...input, reel_speed: 1.25 })).toBeNull();
    expect(validateSettings({ ...input, reel_speed: 1.3 })).toMatch(/Narration speed must be 1.00× to 1.25×/);
    expect(validateSettings({ ...input, reel_speed: 0.9 })).toMatch(/Narration speed/);
    expect(validateSettings({ ...input, reel_music_volume: 4 })).toBe("Music volume must be 5 to 40 %.");
    expect(validateSettings({ ...input, reel_music_volume: 41 })).toMatch(/Music volume/);
    expect(validateSettings({ ...input, reel_music_volume: 18.5 })).toMatch(/Music volume/);
    expect(validateSettings({ ...input, reel_voice_id: "Not A Voice" })).toMatch(/narrator voice/);
  });
});

describe("saveSettingsAction: narrator + music", () => {
  it("saves voice, speed (rounded), music and volume with the rest", async () => {
    expect(await saveSettingsAction({ ...input, ...v6 })).toEqual({ ok: true });
    expect(settingsUpdates()).toHaveLength(1);
    expect(settingsUpdates()[0]).toMatchObject({ reel_voice_id: "kore", reel_speed: 1.13, reel_music: false, reel_music_volume: 25, handle: "@unique_names" });
  });

  it("a form without them (before 006) writes none of them", async () => {
    expect(await saveSettingsAction(input)).toEqual({ ok: true });
    for (const k of Object.keys(v6)) expect(settingsUpdates()[0]).not.toHaveProperty(k);
  });

  it("before migration 006 (PGRST204): the rest is saved, with a clear note", async () => {
    failFirst({ message: "Could not find the 'reel_speed' column of 'settings' in the schema cache", code: "PGRST204" });
    const r = await saveSettingsAction({ ...input, ...v6 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/narrator and music.*006_reel_voices\.sql/) });
    expect(settingsUpdates()).toHaveLength(2);
    expect(settingsUpdates()[1]).not.toHaveProperty("reel_speed");
    expect(settingsUpdates()[1]).toMatchObject({ caption_template: "Hi {gender}" });
  });

  it("an unknown narrator (foreign key) is a clear error", async () => {
    failFirst({ message: "insert or update on table \"settings\" violates foreign key constraint", code: "23503" });
    expect(await saveSettingsAction({ ...input, ...v6 })).toEqual({ ok: false, error: "Pick a narrator voice from the list." });
  });

  it("rejects an out-of-range value before writing", async () => {
    expect((await saveSettingsAction({ ...input, ...v6, reel_music_volume: 60 })).ok).toBe(false);
    expect(settingsUpdates()).toHaveLength(0);
  });
});

describe("saveSettingsAction: on-screen step labels (014)", () => {
  it("saves the switch; refuses a non-boolean", async () => {
    expect(await saveSettingsAction({ ...input, reel_labels: false })).toEqual({ ok: true });
    expect(settingsUpdates()[0]).toMatchObject({ reel_labels: false });
    expect(validateSettings({ ...input, reel_labels: "yes" as unknown as boolean })).toBe("Turn the on-screen labels on or off.");
  });

  it("a form without it writes none", async () => {
    expect(await saveSettingsAction(input)).toEqual({ ok: true });
    expect(settingsUpdates()[0]).not.toHaveProperty("reel_labels");
  });

  it("before 014 (PGRST204): the rest is saved, with a clear note", async () => {
    failFirst({ message: "Could not find the 'reel_labels' column of 'settings' in the schema cache", code: "PGRST204" });
    const r = await saveSettingsAction({ ...input, reel_labels: true });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/on-screen labels.*014_reel_formats\.sql/) });
    expect(settingsUpdates()).toHaveLength(2);
    expect(settingsUpdates()[1]).not.toHaveProperty("reel_labels");
  });
});
