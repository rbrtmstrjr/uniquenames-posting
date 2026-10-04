"use client";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { Activity } from "@/lib/realtime/hooks";
import { cn } from "@/lib/utils/cn";

export function ActivityPill({ a }: { a: Activity }) {
  if (a.post) {
    const bad = a.failed > 0;
    return (
      <Link href={`/posts/${a.post.id}`} aria-live="polite"
        className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-bold shadow-soft",
          bad ? "bg-bad/12 text-bad" : "bg-accent-soft text-accent")}>
        {bad ? <AlertTriangle className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
        <span>{bad ? `${a.failed} failed · ${a.done}/${a.total}` : `Generating ${a.done}/${a.total}`}</span>
        <span className="hidden font-medium opacity-80 sm:inline">· {a.etaText}</span>
      </Link>
    );
  }
  if (a.finishedPostId) {
    return (
      <Link href={`/posts/${a.finishedPostId}`} aria-live="polite" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ok/12 px-3 text-xs font-bold text-ok shadow-soft">
        <CheckCircle2 className="size-3.5" /> Post ready
      </Link>
    );
  }
  return null;
}
