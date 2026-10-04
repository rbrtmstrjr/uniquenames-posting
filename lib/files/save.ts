import type { CardRow } from "@/lib/db/types";

export function orderedSelection<T extends Pick<CardRow, "id" | "selected" | "order_index" | "position">>(cards: T[]): T[] {
  return cards.filter((c) => c.selected).sort((a, b) => a.order_index - b.order_index || a.position - b.position);
}

export function uploadNumbers(cards: Pick<CardRow, "id" | "selected" | "order_index" | "position">[]): Map<string, number> {
  return new Map(orderedSelection(cards).map((c, i) => [c.id, i + 1]));
}

// Android Chrome refuses to share more than 10 files at once.
export const MAX_SHARE_FILES = 10;

export function shareBatches<T>(items: T[], size = MAX_SHARE_FILES): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// `sent` = how many batches were shared successfully so far; after the last one it starts over.
export function nextBatchIndex(batchCount: number, sent: number): number {
  return batchCount ? sent % batchCount : 0;
}

export function batchLabel(total: number, size: number, index: number): string {
  if (total <= size) return `Save ${total} to phone`;
  const start = index * size + 1;
  const end = Math.min(total, start + size - 1);
  return start === end ? `Save ${start} to phone` : `Save ${start}–${end} to phone`;
}

// MUST be called straight from the tap handler with no await before it: iOS only allows
// navigator.share() inside the tap's transient activation. (The synchronous part of an
// async function runs immediately, so the share call below still counts as inside the tap.)
export async function shareFiles(files: File[]): Promise<{ result: "shared" } | { result: "cancelled" } | { result: "unsupported" } | { result: "failed"; message: string }> {
  if (typeof navigator === "undefined" || !navigator.canShare?.({ files })) return { result: "unsupported" };
  try {
    await navigator.share({ files });
    return { result: "shared" };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { result: "cancelled" };
    return { result: "failed", message: (e as Error).message || "unknown error" };
  }
}

export async function zipCards(files: { name: string; blob: Blob }[], caption: string, zipName: string): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  zip.file("caption.txt", caption);
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
