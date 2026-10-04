import { describe, expect, it } from "vitest";
import { cardVisual, queuePosition, workerHealth, lastSeenText } from "@/lib/status/card-state-exports";
import { etaSeconds, formatElapsed, formatEta } from "@/lib/status/eta";
import { downloadName } from "@/lib/files/download-name";
import type { WorkerStatusRow } from "@/lib/db/types";

const NOW = Date.parse("2026-10-05T10:00:00Z");
const ws = (secondsAgo: number | null, comfy = true): WorkerStatusRow => ({
  id: 1, last_seen: secondsAgo === null ? null : new Date(NOW - secondsAgo * 1000).toISOString(), comfyui_ok: comfy,
  gpu: null, current_card_id: null, worker_version: null, message: null, updated_at: "",
});

describe("workerHealth", () => {
  it("ready / comfy-off / offline / unknown", () => {
    expect(workerHealth(ws(5), NOW)).toBe("ready");
    expect(workerHealth(ws(5, false), NOW)).toBe("comfy-off");
    expect(workerHealth(ws(46), NOW)).toBe("offline");
    expect(workerHealth(ws(null), NOW)).toBe("unknown");
    expect(workerHealth(null, NOW)).toBe("unknown");
  });
  it("last seen text", () => {
    expect(lastSeenText(ws(14 * 60), NOW)).toBe("14 min ago");
    expect(lastSeenText(ws(20), NOW)).toBe("just now");
    expect(lastSeenText(ws(3 * 3600), NOW)).toBe("3 h ago");
  });
});

describe("cardVisual", () => {
  it("maps status + worker health", () => {
    expect(cardVisual({ status: "queued", card_path: null }, "ready")).toBe("queued");
    expect(cardVisual({ status: "queued", card_path: null }, "offline")).toBe("waiting");
    expect(cardVisual({ status: "generating", card_path: null }, "ready")).toBe("generating");
    expect(cardVisual({ status: "generating", card_path: "x" }, "ready")).toBe("regenerating");
    expect(cardVisual({ status: "queued", card_path: "x" }, "ready")).toBe("regenerating");
    expect(cardVisual({ status: "restamp", card_path: "x" }, "ready")).toBe("restamp");
    expect(cardVisual({ status: "restamp", card_path: "x" }, "comfy-off")).toBe("restamp");
    expect(cardVisual({ status: "restamp", card_path: "x" }, "offline")).toBe("waiting");
    expect(cardVisual({ status: "generating", card_path: "x" }, "offline")).toBe("waiting");
    expect(cardVisual({ status: "done", card_path: "x" }, "offline")).toBe("done");
    expect(cardVisual({ status: "failed", card_path: null }, "ready")).toBe("failed");
  });
  it("queue position puts restamp first then oldest", () => {
    const q = [
      { id: "a", status: "queued" as const, queued_at: "2026-10-05T09:00:00Z", claimed_at: null },
      { id: "b", status: "restamp" as const, queued_at: "2026-10-05T09:05:00Z", claimed_at: null },
      { id: "c", status: "queued" as const, queued_at: "2026-10-05T09:01:00Z", claimed_at: null },
    ];
    expect(queuePosition(q[0], q)).toBe(2);
    expect(queuePosition(q[1], q)).toBe(1);
    expect(queuePosition(q[2], q)).toBe(3);
  });
});

describe("eta", () => {
  it("averages recent durations, defaults to 33 s", () => {
    expect(etaSeconds(3, [])).toBe(99);
    expect(etaSeconds(2, [30, 40])).toBe(70);
    expect(etaSeconds(0, [30])).toBe(0);
  });
  it("formats", () => {
    expect(formatEta(0)).toBe("finishing…");
    expect(formatEta(40)).toBe("under a minute left");
    expect(formatEta(99)).toBe("about 2 min left");
    expect(formatElapsed(18)).toBe("0:18");
    expect(formatElapsed(65)).toBe("1:05");
  });
});

describe("downloadName", () => {
  it("numbers and slugs", () => {
    expect(downloadName(1, "Arlo Zenith")).toBe("01-arlo-zenith.jpg");
    expect(downloadName(12, "D'Angelo")).toBe("12-d-angelo.jpg");
  });
});
