"use client";
import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CardRow, PostRow } from "@/lib/db/types";
import { orderedSelection, saveCards } from "@/lib/files/save";
import { downloadName } from "@/lib/files/download-name";
import { signedUrlsNow } from "@/lib/realtime/signed-urls";

export function SaveActions({ post, cards, caption }: { post: PostRow; cards: CardRow[]; caption: string }) {
  const [busy, setBusy] = useState<"share" | "zip" | null>(null);
  const picked = orderedSelection(cards);
  const ready = picked.filter((c) => c.status === "done" && c.card_path);

  const run = async (mode: "share" | "zip") => {
    if (!ready.length) { toast.error("Select at least one finished card."); return; }
    if (ready.length < picked.length) toast.warning(`${picked.length - ready.length} selected card(s) are not ready yet and are left out.`);
    setBusy(mode);
    try {
      const urls = await signedUrlsNow(ready.map((c) => c.card_path!));
      const files = await Promise.all(ready.map(async (c, i) => {
        const res = await fetch(urls[c.card_path!]);
        if (!res.ok) throw new Error(`${c.name} could not be downloaded`);
        return { name: downloadName(i + 1, c.name), blob: await res.blob() };
      }));
      const r = await saveCards(files, caption, mode, `unique-names-${post.post_date}-${post.gender}.zip`);
      if (r === "shared") toast.success(`Shared ${files.length} cards`);
      if (r === "zipped") toast.success(`Downloaded ${files.length} cards + caption.txt`);
    } catch (e) {
      toast.error(`Could not save the cards: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => run("share")} loading={busy === "share"} className="md:hidden"><Share2 className="size-4" /> Save {ready.length} to phone</Button>
      <Button onClick={() => run("zip")} loading={busy === "zip"} variant="subtle" className="max-md:hidden"><Download className="size-4" /> Download {ready.length} as zip</Button>
      <Button onClick={() => run("zip")} loading={busy === "zip"} variant="ghost" size="sm" className="md:hidden">Zip instead</Button>
    </div>
  );
}
