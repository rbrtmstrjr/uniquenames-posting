import { describe, expect, it } from "vitest";
import { dialogStatus, newPictureAction, textChanged } from "@/lib/status/card-dialog";
import { nextSeed } from "@/lib/actions/helpers";
import type { CardRow } from "@/lib/db/types";

const NOW = Date.parse("2026-10-05T10:00:00Z");
const card = (over: Partial<CardRow> = {}): Pick<CardRow, "name" | "meaning" | "status" | "card_path" | "started_at"> => ({
  name: "Arlo Zenith", meaning: "strong and bright", status: "done", card_path: "cards/x/v1.jpg", started_at: null, ...over,
});

describe("newPictureAction (which action the dialog's New picture calls)", () => {
  it("unchanged text is a plain regenerate", () => {
    expect(newPictureAction(card(), "Arlo Zenith", "strong and bright")).toEqual({ kind: "regenerate" });
  });
  it("whitespace, curly quotes and meaning case alone are not a change", () => {
    expect(newPictureAction(card(), "  Arlo   Zenith ", "Strong and Bright ")).toEqual({ kind: "regenerate" });
    expect(newPictureAction(card({ name: "D'Angelo" }), "D’Angelo", "strong and bright")).toEqual({ kind: "regenerate" });
  });
  it("an edited name sends the new text with the regenerate", () => {
    expect(newPictureAction(card(), "Arlo Zephyr", "strong and bright")).toEqual({ kind: "edit-regenerate", name: "Arlo Zephyr", meaning: "strong and bright" });
  });
  it("an edited meaning sends the new text with the regenerate", () => {
    expect(newPictureAction(card(), "Arlo Zenith", "gentle wind")).toEqual({ kind: "edit-regenerate", name: "Arlo Zenith", meaning: "gentle wind" });
  });
  it("textChanged matches the same rules", () => {
    expect(textChanged(card(), "Arlo Zenith", "STRONG and bright")).toBe(false);
    expect(textChanged(card(), "Arlo", "strong and bright")).toBe(true);
  });
  it("an untouched legacy row (stored before normalizing) never looks edited", () => {
    const legacy = card({ name: "arlo  zenith", meaning: "Strong and bright " });
    expect(textChanged(legacy, legacy.name, legacy.meaning)).toBe(false);
    expect(newPictureAction(legacy, legacy.name, legacy.meaning)).toEqual({ kind: "regenerate" });
    expect(textChanged(legacy, "Arlo Zephyr", legacy.meaning)).toBe(true);
  });
});

describe("dialogStatus (live header state)", () => {
  it("in line shows the queue position", () => {
    expect(dialogStatus(card({ status: "queued" }), "ready", 3, NOW).label).toBe("In line #3");
    expect(dialogStatus(card({ status: "queued" }), "ready", 0, NOW).label).toBe("In line");
  });
  it("an offline PC means waiting, whatever the status", () => {
    expect(dialogStatus(card({ status: "queued" }), "offline", 2, NOW).label).toBe("Waiting for your PC");
    expect(dialogStatus(card({ status: "generating" }), "unknown", 0, NOW).label).toBe("Waiting for your PC");
  });
  it("a queued card with ComfyUI closed waits for ComfyUI", () => {
    expect(dialogStatus(card({ status: "queued" }), "comfy-off", 1, NOW).label).toBe("Waiting for ComfyUI");
  });
  it("making shows the elapsed mm:ss", () => {
    const s = dialogStatus(card({ status: "generating", started_at: new Date(NOW - 75_000).toISOString() }), "ready", 0, NOW);
    expect(s.label).toBe("Making… 1:15");
    expect(s.pulse).toBe(true);
  });
  it("re-stamp, done and failed", () => {
    expect(dialogStatus(card({ status: "restamp" }), "comfy-off", 0, NOW).label).toBe("Updating text…");
    expect(dialogStatus(card({ status: "done" }), "offline", 0, NOW)).toMatchObject({ label: "Ready", tone: "ok", pulse: false });
    expect(dialogStatus(card({ status: "failed" }), "ready", 0, NOW)).toMatchObject({ label: "Failed", tone: "bad" });
  });
});

describe("nextSeed", () => {
  it("gives every version of a card its own positive seed, so a new picture really is new", () => {
    const a = nextSeed("card-1", 2), b = nextSeed("card-1", 3), c = nextSeed("card-2", 2);
    expect(new Set([a, b, c]).size).toBe(3);
    for (const s of [a, b, c]) expect(Number.isSafeInteger(s) && s > 0).toBe(true);
    expect(nextSeed("card-1", 2)).toBe(a);
  });
  it("never repeats the old seed", () => {
    for (let v = 1; v < 50; v++) expect(nextSeed("card-x", v, nextSeed("card-x", v))).not.toBe(nextSeed("card-x", v));
  });
});
