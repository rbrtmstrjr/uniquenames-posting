import { PlugZap } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** The visible reason a Generate / New picture / Add a card / Make preview button is locked (phones have no tooltips). */
export function GenerateLockNote({ reason, extra, className }: { reason: string; extra?: string; className?: string }) {
  return (
    <p role="status" className={cn("flex items-start gap-1.5 rounded-xl bg-warn/15 px-3 py-2 text-xs font-semibold text-warn-text", className)}>
      <PlugZap className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{reason}{extra ? <span className="font-normal"> {extra}</span> : null}</span>
    </p>
  );
}
