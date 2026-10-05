import type { CardStatus, Gender, NameStyle } from "@/lib/db/types";
import { normalizeQuotes } from "@/lib/names/bulk-paste";
import { hashSeed } from "@/lib/planner/random";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raise a lowercase first letter. Never lowercases anything: "AJ", "Mary-JANE", "McKenzie" stay as typed. */
const capFirst = (p: string): string => p.charAt(0).toLocaleUpperCase() + p.slice(1);

/**
 * The stored form of a name, used by EVERY insert/edit path (manual add, paste, card edit,
 * AI suggestions): straight apostrophes, single spaces, trimmed, and each word (and each
 * hyphenated part) starting with a capital, so "arlo   zenith" is saved as "Arlo Zenith".
 * Only a lowercase FIRST letter is ever changed. These are first + middle names, not
 * surnames, so short words like "Le" or "Van" are names and get a capital too.
 */
export const normalizeName = (name: string): string =>
  normalizeQuotes(name).replace(/\s+/g, " ").trim().split(" ")
    .map((w) => w.split("-").map(capFirst).join("-"))
    .join(" ");
/** Case- and whitespace-insensitive dedup key (names are stored normalized, matching the lower(name) unique index). */
export const nameKey = (name: string): string => normalizeName(name).toLowerCase();
export const styleOf = (name: string): NameStyle => (normalizeName(name).split(" ").length > 1 ? "two-word" : "single");

/**
 * The seed for a card's next version. ComfyUI is deterministic: the same prompt + seed
 * makes the same photo, so "New picture" must change the seed or nothing visibly changes.
 * `avoid` (the current seed) is never returned.
 */
export function nextSeed(cardId: string, version: number, avoid?: number): number {
  let s = hashSeed(`${cardId}|v${version}`) || 1;
  if (s === avoid) s = (s % 4294967295) + 1;
  return s;
}

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

/** A list of row ids from the client: non-empty, at most `max`, every one a UUID. Returns an error or null. */
export function badIds(ids: unknown, max: number): string | null {
  if (!Array.isArray(ids) || ids.length === 0) return "Nothing selected.";
  if (ids.length > max) return `Pick at most ${max} at a time.`;
  if (!ids.every((id) => typeof id === "string" && UUID_RE.test(id))) return "Bad id. Reload the page and try again.";
  return null;
}

/** Split a list into chunks (long `in (...)` filters travel in the URL). */
export const chunks = <T,>(xs: T[], size: number): T[][] => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
