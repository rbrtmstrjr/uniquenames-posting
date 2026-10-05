import { describe, expect, it } from "vitest";
import { canGenerate, GENERATE_LOCK } from "@/lib/status/worker-health";

describe("canGenerate", () => {
  it("only a ready PC with ComfyUI open can generate", () => {
    expect(canGenerate("ready")).toEqual({ ok: true });
  });
  it("an offline or never-seen PC locks with the turn-it-on reason", () => {
    expect(canGenerate("offline")).toEqual({ ok: false, reason: "Your PC is offline — turn it on to generate" });
    expect(canGenerate("unknown")).toEqual({ ok: false, reason: GENERATE_LOCK.offline });
  });
  it("a closed ComfyUI locks with the open-ComfyUI reason", () => {
    expect(canGenerate("comfy-off")).toEqual({ ok: false, reason: "Open ComfyUI Desktop to generate" });
  });
});
