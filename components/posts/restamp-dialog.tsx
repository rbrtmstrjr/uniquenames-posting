"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CatalogFontsLink, FontFields } from "@/components/fonts/font-select";
import { fontsOf, restampFonts, type PostFonts } from "@/lib/fonts/post-fonts";
import type { PostRow } from "@/lib/db/types";
import type { WorkerHealth } from "@/lib/status/worker-health";

/**
 * "Re-stamp this post?": the post's fonts (prefilled from the post, or the settings fonts when
 * it has none) plus the counts. Confirm sends the fonts to save on the post before re-stamping
 * (see restampFonts for the case before migration 003).
 */
export function RestampDialog({ open, onOpenChange, post, settingsFonts, counts, health, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; post: PostRow; settingsFonts: PostFonts;
  counts: { restamp: number; noPhoto: number }; health: WorkerHealth; busy: boolean;
  onConfirm: (fonts: PostFonts | undefined) => void;
}) {
  const prefill = fontsOf(post, settingsFonts);
  const [picked, setPicked] = useState<PostFonts>(prefill);
  // Each time the dialog opens it starts from the post's current fonts.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(prefill);
  }
  const n = counts.restamp;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Re-stamp this post?"
      description="The name, meaning and watermark are stamped again in these fonts, with your current text sizes and position. The photos stay the same.">
      {open && <CatalogFontsLink />}
      <FontFields idPrefix="restamp-font" value={picked} onChange={setPicked} className="mb-4" />
      <ul className="mb-4 space-y-1 text-sm text-muted">
        <li>{n} card{n === 1 ? "" : "s"} will be re-stamped, about a second each once your PC picks {n === 1 ? "it" : "them"} up.</li>
        {counts.noPhoto > 0 && <li>{counts.noPhoto} older card{counts.noPhoto === 1 ? " has" : "s have"} no clean photo and will stay as {counts.noPhoto === 1 ? "it is" : "they are"}.</li>}
        {health === "offline" && <li className="font-semibold text-ink">Your PC is offline: the cards wait until it is on.</li>}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Keep as is</Button>
        <Button loading={busy} onClick={() => onConfirm(restampFonts(post, prefill, picked))}>Re-stamp</Button>
      </div>
    </Dialog>
  );
}
