// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BUSY_ELSEWHERE, busyElsewhere, canGenerate, workerHealth } from "@/lib/status/worker-health";
import { PcStatus } from "@/components/shell/pc-status";
import type { WorkerStatusRow } from "@/lib/db/types";

// Worker 2.7.1 serves several pages: while it works for another page, this page's worker_status.message is
// BUSY_ELSEWHERE and the status reads "PC busy with your other page" instead of "PC ready".
const NOW = Date.parse("2026-10-10T10:00:00Z");
const ws = (message: string | null, comfy = true, secondsAgo = 5): WorkerStatusRow => ({
  id: 1, last_seen: new Date(NOW - secondsAgo * 1000).toISOString(), comfyui_ok: comfy, gpu: null, current_card_id: null,
  worker_version: "2.7.1", message, updated_at: "",
});

afterEach(cleanup);

describe("busy with the other page", () => {
  it("is the worker's own words (worker/jobs.py BUSY_ELSEWHERE)", () => {
    const py = readFileSync(join(__dirname, "..", "worker", "jobs.py"), "utf8");
    expect(py).toContain(`BUSY_ELSEWHERE = "${BUSY_ELSEWHERE}"`);
    expect(BUSY_ELSEWHERE).toBe("PC busy with your other page");
  });

  it("only on a ready PC with that message; health stays ready, so Generate stays open (the job waits its turn)", () => {
    expect(busyElsewhere(ws(BUSY_ELSEWHERE), NOW)).toBe(true);
    expect(workerHealth(ws(BUSY_ELSEWHERE), NOW)).toBe("ready");
    expect(canGenerate(workerHealth(ws(BUSY_ELSEWHERE), NOW))).toEqual({ ok: true });
    expect(busyElsewhere(ws(null), NOW)).toBe(false);
    expect(busyElsewhere(ws("ComfyUI is not reachable at http://127.0.0.1:8188", false), NOW)).toBe(false);
    expect(busyElsewhere(ws(BUSY_ELSEWHERE, true, 120), NOW)).toBe(false); // offline wins
    expect(busyElsewhere(null, NOW)).toBe(false);
  });

  it("PcStatus says so instead of PC ready; without it, PC ready as before", () => {
    render(<PcStatus health="ready" lastSeen="just now" busyElsewhere />);
    expect(screen.getByText("PC busy with your other page")).toBeTruthy();
    expect(screen.queryByText("PC ready")).toBeNull();
    cleanup();
    render(<PcStatus health="ready" lastSeen="just now" />);
    expect(screen.getByText("PC ready")).toBeTruthy();
    cleanup();
    render(<PcStatus health="ready" lastSeen="just now" busyElsewhere compact />);
    expect(screen.getByText("PC busy with your other page")).toBeTruthy();
  });

  it("an older worker (no message) still reads PC ready", () => {
    expect(busyElsewhere({ ...ws(null), worker_version: "2.6.0" }, NOW)).toBe(false);
  });
});
