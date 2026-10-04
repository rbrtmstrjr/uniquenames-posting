"use client";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { cn } from "@/lib/utils/cn";

const TEXT: Record<WorkerHealth, { label: string; fix: string; dot: string }> = {
  ready: { label: "PC ready", fix: "Your PC and ComfyUI are on.", dot: "bg-ok" },
  "comfy-off": { label: "ComfyUI closed", fix: "Open ComfyUI Desktop on your PC.", dot: "bg-warn" },
  offline: { label: "PC offline", fix: "Turn on your PC (the card worker starts by itself).", dot: "bg-bad" },
  unknown: { label: "PC not seen yet", fix: "Start the card worker on your PC.", dot: "bg-muted" },
};

export function PcStatus({ health, lastSeen, compact }: { health: WorkerHealth; lastSeen: string; compact?: boolean }) {
  const t = TEXT[health];
  return (
    <div className="flex items-center gap-2" title={`${t.label}. ${t.fix}`} role="status" aria-live="polite">
      <span className={cn("size-2.5 shrink-0 rounded-full", t.dot, health === "ready" && "shadow-[0_0_0_4px_color-mix(in_oklab,var(--ok)_20%,transparent)]")} />
      {!compact && (
        <div className="min-w-0 text-xs leading-tight">
          <div className="font-semibold text-ink">{t.label}</div>
          <div className="text-muted">{health === "offline" ? `Last seen ${lastSeen}` : t.fix}</div>
        </div>
      )}
      {compact && <span className="text-xs font-semibold text-muted">{t.label}</span>}
    </div>
  );
}

export const PC_TEXT = TEXT;
