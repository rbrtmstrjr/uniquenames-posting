import type { CardRow } from "@/lib/db/types";

export function orderedSelection<T extends Pick<CardRow, "id" | "selected" | "order_index" | "position">>(cards: T[]): T[] {
  return cards.filter((c) => c.selected).sort((a, b) => a.order_index - b.order_index || a.position - b.position);
}

export function uploadNumbers(cards: Pick<CardRow, "id" | "selected" | "order_index" | "position">[]): Map<string, number> {
  return new Map(orderedSelection(cards).map((c, i) => [c.id, i + 1]));
}

// Phone: the share sheet ("Save images" puts them in the gallery, in order).
// Desktop or no share support: a zip download.
export async function saveCards(files: { name: string; blob: Blob }[], caption: string, mode: "share" | "zip", zipName: string): Promise<"shared" | "zipped" | "cancelled"> {
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: "image/jpeg" }));
  if (mode === "share" && typeof navigator !== "undefined" && navigator.canShare?.({ files: asFiles })) {
    try {
      await navigator.share({ files: asFiles, title: "Unique Names", text: caption });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
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
  return "zipped";
}
