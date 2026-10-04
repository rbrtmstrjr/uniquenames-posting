import type { CardStatus, Gender, NameStyle } from "@/lib/db/types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapse inner whitespace and trim: the stored form of a name. */
export const normalizeName = (name: string): string => name.replace(/\s+/g, " ").trim();
/** Case-insensitive dedup key; matches the lower(name) unique index. */
export const nameKey = (name: string): string => normalizeName(name).toLowerCase();
export const styleOf = (name: string): NameStyle => (normalizeName(name).split(" ").length > 1 ? "two-word" : "single");

/** Restamp only when a clean photo is current: done/failed with a photo, or already restamping. */
export function restampMode(card: { status: CardStatus; photo_path: string | null }): "restamp" | "regenerate" {
  if (card.status === "restamp") return "restamp";
  if ((card.status === "done" || card.status === "failed") && card.photo_path) return "restamp";
  return "regenerate";
}

export function validateCreatePost(i: { gender: string; style: string; count: number | null; requestId: string; themeId?: string }): string | null {
  if (!UUID_RE.test(i.requestId ?? "")) return "Bad request id. Reload the page and try again.";
  if (i.themeId !== undefined && !UUID_RE.test(i.themeId)) return "Pick a valid theme.";
  if ((i.gender as Gender) !== "boy" && (i.gender as Gender) !== "girl") return "Pick Boy or Girl.";
  if (i.style !== "two-word" && i.style !== "single") return "Pick a name style.";
  if (i.count !== null && !Number.isInteger(i.count)) return "The card count must be a whole number.";
  return null;
}

/** Split rows into fresh (deduped by key, against `have`) and skipped names. Mutates `have`. */
export function dedupeNames<T extends { name: string }>(rows: T[], have: Set<string>): { fresh: T[]; skipped: string[] } {
  const fresh: T[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const k = nameKey(r.name);
    if (have.has(k)) skipped.push(r.name);
    else { have.add(k); fresh.push(r); }
  }
  return { fresh, skipped };
}
