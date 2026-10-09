"use client";
import { useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ReelRow } from "@/lib/db/types";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { rewriteReelCaptionAction } from "@/lib/actions/reels";
import { callAction } from "@/lib/actions/call";

/** The text to paste into Facebook: the caption, a blank line, then the hashtags. */
export const reelCaptionText = (caption: string, hashtags: string | null | undefined) =>
  hashtags?.trim() ? `${caption}\n\n${hashtags.trim()}` : caption;

/**
 * The reel's post caption + hashtags (migration 009) with Copy and Rewrite. Written in the background after the script,
 * so a new reel may show "No caption yet" for a few seconds (realtime fills it in). Before 009: a note to run it.
 */
export function ReelCaption({ reel, onPatch }: { reel: ReelRow; onPatch?: (p: Partial<ReelRow>) => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!("caption" in reel)) {
    return (
      <Panel title="Caption">
        <p className="text-xs text-muted">Reel captions need the database update first (run supabase/migrations/009_captions.sql).</p>
      </Panel>
    );
  }
  const caption = reel.caption?.trim() ?? "";
  const hashtags = reel.hashtags?.trim() ?? "";

  const rewrite = async () => {
    if (busy) return;
    setBusy(true);
    const r = await callAction(() => rewriteReelCaptionAction(reel.id));
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    onPatch?.({ caption: r.caption, hashtags: r.hashtags });
    toast.success(caption ? "New caption written" : "Caption written");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reelCaptionText(caption, hashtags));
    } catch {
      toast.error("Could not copy. Press and hold the caption to copy it.");
      return;
    }
    setCopied(true);
    toast.success("Caption copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Panel title="Caption">
      <div data-testid="reel-caption" aria-busy={busy || undefined} className={busy ? "opacity-60 transition-opacity" : undefined}>
        {caption ? (
          <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm leading-relaxed text-ink">
            <p className="whitespace-pre-wrap break-words select-text">{caption}</p>
            {hashtags && <p className="break-words font-semibold text-accent select-text">{hashtags}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted">{busy ? "Writing the caption…" : "No caption yet. It is written after the script; tap Write caption if it doesn't appear."}</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {caption && (
          <Button variant="subtle" size="sm" className="flex-1" onClick={() => void copy()} disabled={busy}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} Copy caption
          </Button>
        )}
        <Button variant="subtle" size="sm" className="flex-1" loading={busy} onClick={() => void rewrite()}>
          {!busy && <Sparkles className="size-4" aria-hidden />} {caption ? "Rewrite caption" : "Write caption"}
        </Button>
      </div>
    </Panel>
  );
}
