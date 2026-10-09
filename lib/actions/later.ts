import "server-only";
import { after } from "next/server";

/**
 * Run `task` after the response is sent (Next's `after`), so slow optional work (a reel caption)
 * never holds up the action. Outside a request (scripts) it just runs in the background. A failure
 * is logged and never thrown.
 */
export function later(task: () => Promise<unknown>) {
  const run = () => task().catch((e) => console.error("later: background task failed:", e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    void run();
  }
}
