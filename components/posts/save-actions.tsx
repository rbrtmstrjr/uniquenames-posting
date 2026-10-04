"use client";
import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CardRow, PostRow } from "@/lib/db/types";
import { MAX_SHARE_FILES, batchLabel, nextBatchIndex, orderedSelection, shareBatches, shareFiles, zipCards } from "@/lib/files/save";
import { downloadName } from "@/lib/files/download-name";
import { useCardBlobs } from "./use-card-blobs";

export function SaveActions({ post, cards, caption }: { post: PostRow; cards: CardRow[]; caption: string }) {
  const [busy, setBusy] = useState<"share" | "zip" | null>(null);
  const picked = orderedSelection(cards);
  const ready = picked.filter((c) => c.status === "done" && c.card_path);
  const notReady = picked.length - ready.length;
  // File numbers are the tiles' upload numbers (position in the full selection).
  const items = ready.map((c) => ({ card: c, name: downloadName(picked.indexOf(c) + 1, c.name) }));
  const blobs = useCardBlobs(notReady ? [] : ready.map((c) => c.card_path!));
  const prepared = !notReady && ready.length > 0 && blobs.ready === blobs.total;

  const batches = shareBatches(items, MAX_SHARE_FILES);
  const selKey = items.map((i) => i.card.card_path).join("|");
  const [sentFor, setSentFor] = useState({ key: "", n: 0 });
  const sent = sentFor.key === selKey ? sentFor.n : 0; // a new selection starts at batch 1
  const idx = nextBatchIndex(batches.length, sent);

  const zipName = `unique-names-${post.post_date}-${post.gender}.zip`;

  const zip = async (why?: string) => {
    if (why) toast.warning(why);
    setBusy("zip");
    try {
      // Fetch any picture the prefetch missed, so the zip works even if preparing failed.
      const got = await blobs.ensure(items.map((i) => i.card.card_path!));
      await zipCards(items.map((i, n) => ({ name: i.name, blob: got[n] })), caption, zipName);
      toast.success(`Downloaded ${items.length} cards + caption.txt`);
    } catch (e) {
      toast.error(`Could not make the zip: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  // No await before shareFiles: iOS needs the share call inside the tap.
  const share = () => {
    const files = batches[idx].map((i) => new File([blobs.get(i.card.card_path!)!], i.name, { type: "image/jpeg" }));
    setBusy("share");
    void shareFiles(files).then(async (r) => {
      setBusy(null);
      if (r.result === "shared") {
        setSentFor({ key: selKey, n: sent + 1 });
        toast.success(`Shared ${files.length} cards. Copy the caption with its own button.`);
      } else if (r.result !== "cancelled") {
        await zip(r.result === "unsupported"
          ? "Your browser can't share images, so a zip was downloaded instead."
          : `Sharing failed (${r.message}), so a zip was downloaded instead.`);
      }
    });
  };

  // Only Share needs the prefetched set (it must open inside the tap); Zip fetches on demand.
  const canSave = !notReady && ready.length > 0 && busy === null;
  const preparing = !notReady && ready.length > 0 && !prepared;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={share} loading={busy === "share"} disabled={!canSave || !prepared} className="md:hidden">
          <Share2 className="size-4" /> {preparing ? `Preparing ${blobs.ready}/${blobs.total}…` : batches.length ? batchLabel(items.length, MAX_SHARE_FILES, idx) : "Save to phone"}
        </Button>
        <Button onClick={() => void zip()} loading={busy === "zip"} disabled={!canSave} variant="subtle" className="max-md:hidden"><Download className="size-4" /> Download {items.length} as zip</Button>
        <Button onClick={() => void zip()} loading={busy === "zip"} disabled={!canSave} variant="ghost" size="sm" className="md:hidden">Zip instead</Button>
      </div>
      {!picked.length && <p className="text-xs text-muted">Select at least one card to save.</p>}
      {notReady > 0 && <p className="text-xs text-bad" role="status">{notReady} selected card{notReady === 1 ? " is" : "s are"} not ready yet. Wait for {notReady === 1 ? "it" : "them"} to finish (or unselect), then save.</p>}
      {blobs.failed && !notReady && (
        <p className="text-xs text-bad" role="status">Could not prepare some pictures for sharing (the zip still works). <button type="button" onClick={blobs.retry} className="inline-flex min-h-11 items-center font-bold underline">Try again</button></p>
      )}
      {batches.length > 1 && !notReady && <p className="text-xs text-muted">{items.length} cards: your phone shares at most {MAX_SHARE_FILES} at a time, so save in {batches.length} taps, in order.</p>}
    </div>
  );
}
