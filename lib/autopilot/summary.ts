import type { AutopilotItemRow, AutopilotRunRow } from "@/lib/db/types";

/** Claude Opus 5.5 list prices (per million tokens): the checks' cost. */
export const OPUS_INPUT_PER_MTOK = 4;
export const OPUS_OUTPUT_PER_MTOK = 20;

export const runCost = (run: Pick<AutopilotRunRow, "input_tokens" | "output_tokens">) =>
  Math.round(((run.input_tokens * OPUS_INPUT_PER_MTOK + run.output_tokens * OPUS_OUTPUT_PER_MTOK) / 1e6) * 100) / 100;

export function summarize(run: AutopilotRunRow, items: AutopilotItemRow[]) {
  const count = (kind: string) => (run.events ?? []).filter((e) => e.kind === kind).length;
  return {
    scheduled: items.filter((i) => i.state === "scheduled").length,
    held: items.filter((i) => i.state === "held").length,
    namesAdded: count("name_added"), namesSkipped: count("name_skipped"),
    remade: count("card_remade"), removed: count("card_removed"),
    costUsd: runCost(run),
  };
}
