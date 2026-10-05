"use client";
import { useState } from "react";
import { AlertTriangle, Clock3, Loader2, PenLine, PlugZap, RotateCw } from "lucide-react";
import type { CardRow } from "@/lib/db/types";
import { cardVisual } from "@/lib/status/card-state";
import type { WorkerHealth } from "@/lib/status/worker-health";
import { formatElapsed } from "@/lib/status/eta";
import { useNow } from "@/lib/realtime/hooks";
import { cn } from "@/lib/utils/cn";
import { FadeImage } from "@/components/ui/fade-image";

export function CardTile({ card, url, health, queuePos, onOpen, onRetry, selection, className }: {
  card: CardRow; url?: string; health: WorkerHealth; queuePos: number; onOpen?: () => void; onRetry?: () => void | Promise<void>;
  selection?: { selected: boolean; order: number | null; onToggle: () => void }; className?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const v = cardVisual(card, health);
  const now = useNow(1000);
  const elapsed = card.started_at ? Math.max(0, (now - Date.parse(card.started_at)) / 1000) : 0;
  // The card has a picture to show (its signed URL may still be on the way: FadeImage shimmers until then).
  const showImage = !!card.card_path && (v === "done" || v === "restamp" || v === "regenerating" || v === "waiting" || v === "failed");
  const label = `${card.name}: ${({ queued: "in line", generating: "being made", regenerating: "being remade", restamp: "updating text", done: "ready", failed: "failed", waiting: "waiting for your PC" } as const)[v]}`;

  const retry = async () => {
    if (retrying || !onRetry) return;
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };

  const media = (
    <>
      {showImage && (
        <FadeImage src={url}
          className={cn(v === "regenerating" && "scale-[1.02] opacity-30 blur-[2px]", selection && !selection.selected && "opacity-45 saturate-50")} />
      )}
      {(v === "generating" || v === "regenerating") && <div className={cn("absolute inset-0 shimmer animate-shimmer", v === "regenerating" && "opacity-60")} aria-hidden />}
    </>
  );

  return (
    <div className={cn("group relative aspect-square overflow-hidden rounded-xl bg-surface-2", v === "queued" && "border border-dashed border-line bg-surface-2/40", v === "failed" && "ring-2 ring-bad", className)}>
      {/* one polite live region: announces state changes only, never the ticking timer */}
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`Open ${label}`} className="absolute inset-0 z-[1] block size-full">
          {media}
        </button>
      ) : (
        <div className="absolute inset-0 z-[1] block size-full">{media}</div>
      )}

      {/* state overlay */}
      <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 p-2 text-center">
        {v === "queued" && <><Clock3 className="size-5 text-ink" /><span className="text-xs font-semibold text-ink">#{queuePos || "…"} in line</span></>}
        {(v === "generating" || v === "regenerating") && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-xs font-bold text-ink shadow-soft">
            <Loader2 className="size-3.5 animate-spin text-accent" /> {v === "regenerating" ? "Remaking" : "Making"}… {formatElapsed(elapsed)}
          </span>
        )}
        {v === "waiting" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn px-2.5 py-1 text-xs font-bold text-warn-ink shadow-soft">
            <PlugZap className="size-3.5" /> Waiting for your PC
          </span>
        )}
      </div>
      {v === "restamp" && (
        <span className="absolute left-2 top-2 z-[2] inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-1 text-[11px] font-bold text-ink shadow-soft">
          <PenLine className="size-3 text-accent" /> Updating text…
        </span>
      )}
      {v === "failed" && (
        <div className="absolute inset-x-2 bottom-2 z-[3] rounded-lg bg-surface/95 p-2 text-left shadow-soft">
          <div className="flex items-center gap-1.5 text-xs font-bold text-bad"><AlertTriangle className="size-3.5" /> Failed</div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{card.error ?? "Unknown error"}</p>
          {onRetry && (
            <button type="button" onClick={retry} disabled={retrying} className="mt-1.5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-bad px-2 text-xs font-bold text-bad-ink disabled:opacity-70">
              {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}
      {selection && (
        // 44 px hit area around a 28 px badge: tap the number to select/unselect, tap the picture to open it.
        <button type="button" onClick={selection.onToggle} aria-pressed={selection.selected}
          aria-label={selection.selected ? `Unselect ${card.name} (upload number ${selection.order})` : `Select ${card.name}`}
          className="absolute left-0 top-0 z-[3] grid size-11 place-items-center">
          <span className={cn("grid size-7 place-items-center rounded-lg text-xs font-extrabold shadow-soft",
            selection.selected ? "bg-accent text-accent-ink" : showImage ? "border-2 border-white/90 bg-black/25" : "border-2 border-ink/50 bg-surface/70")}>
            {selection.selected ? selection.order : ""}
          </span>
        </button>
      )}
      {!selection && v !== "failed" && (
        <span className="absolute inset-x-0 bottom-0 z-[2] truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-5 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {card.position}. {card.name}
        </span>
      )}
    </div>
  );
}
