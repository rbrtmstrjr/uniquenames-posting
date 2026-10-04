"use client";
import { Panel } from "@/components/ui/panel";
import { PcStatus, PC_TEXT } from "@/components/shell/pc-status";
import { useWorkerContext } from "@/components/shell/app-shell";

export function WorkerCard() {
  const { health, lastSeen, row } = useWorkerContext();
  return (
    <Panel title="Your PC">
      <PcStatus health={health} lastSeen={lastSeen} />
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Last seen</dt><dd className="text-ink">{lastSeen}</dd>
        <dt className="text-muted">GPU</dt><dd className="truncate text-ink">{row?.gpu ?? "—"}</dd>
        <dt className="text-muted">Worker</dt><dd className="text-ink">{row?.worker_version ?? "—"}</dd>
        <dt className="text-muted">Working on</dt><dd className="text-ink">{row?.current_card_id ? "a card" : "nothing"}</dd>
        {row?.message && (<><dt className="text-muted">Note</dt><dd className="text-ink">{row.message}</dd></>)}
      </dl>
      {health !== "ready" && <p className="mt-3 rounded-xl border border-warn bg-warn/12 p-3 text-sm text-ink">{PC_TEXT[health].fix}</p>}
    </Panel>
  );
}
