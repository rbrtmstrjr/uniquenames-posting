// Posts by initials (Today > Initials, migration 017): two-word names whose first name starts with one chosen letter
// and whose middle name starts with another ("A·R": Arjay Royce). Followers ask for these, so names used before MAY be
// used again, but new names always come first, strictly: (1) unused names, (2) fresh AI names, (3) names used before,
// least recently used first. Pure helpers shared by Today, the actions, the planner and captions (client-safe).
import type { Gender } from "@/lib/db/types";
import { hashSeed, seededRandom } from "@/lib/planner/random";
import { AZ_LETTERS, letterOf } from "./az";

export const INITIAL_LETTERS = AZ_LETTERS;

/** Two capitals A–Z (what posts.initials stores, migration 017). */
export const isInitials = (x: unknown): x is string => typeof x === "string" && /^[A-Z]{2}$/.test(x);

/** "Arjay Royce" → "AR" (accents dropped: "Élan Rhys" → "ER"); null unless the name is exactly two words. */
export function initialsOf(name: string): string | null {
  const words = name.trim().split(/\s+/);
  if (words.length !== 2) return null;
  const a = letterOf(words[0]);
  const b = letterOf(words[1]);
  return a && b ? `${a}${b}` : null;
}

/** Does this two-word name have these initials? */
export const hasInitials = (name: string, initials: string) => initialsOf(name) === initials;

/** "A·R": how Today, Posts and the post page show the initials. */
export const initialsText = (initials: string) => `${initials[0]}·${initials[1]}`;

/** The label a post by initials shows ("A·R"); null otherwise (or before 017). */
export const initialsLabel = (p: { initials?: string | null }) => (isInitials(p.initials) ? initialsText(p.initials) : null);

/** Today's Initials tiles: per gender, how many available two-word names have each pair of initials ("AR": 3). */
export type InitialsStock = Record<Gender, Record<string, number>>;

/** Per pair of initials, how many of these names have it (pass one gender's available two-word names). */
export function initialsCounts(names: { name: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) {
    const k = initialsOf(n.name);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** The first-name row's counts: per letter, the names whose first name starts with it (any middle initial). */
export function firstInitialCounts(pairs: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(INITIAL_LETTERS.map((l) => [l, 0]));
  for (const [k, n] of Object.entries(pairs)) if (k[0] in out) out[k[0]] += n;
  return out;
}

/** The middle-name row's counts for a chosen first initial: per letter, the names with that pair. */
export function secondInitialCounts(pairs: Record<string, number>, first: string | null): Record<string, number> {
  return Object.fromEntries(INITIAL_LETTERS.map((l) => [l, first ? pairs[`${first}${l}`] ?? 0 : 0]));
}

export type InitialsSource = "available" | "new" | "used";
/** Where each source's names come from, as the owner reads it ("3 unused · 7 new AI · 0 reused"). */
export const SOURCE_LABEL: Record<InitialsSource, string> = { available: "unused", new: "new AI", used: "reused" };

export interface InitialsName { id: string; name: string; meaning: string }
/** A fresh AI name; `parts` = the first and middle name's standard meanings its card meaning is built from. */
export interface InitialsCombo { name: string; meaning: string; parts?: [string, string] }
export interface InitialsPick { source: InitialsSource; name_id: string | null; name: string; meaning: string; parts?: [string, string] }
export type SourceCounts = Record<InitialsSource, number>;
export interface InitialsNamesPlan { picks: InitialsPick[]; counts: SourceCounts; short: number }

const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The names of a post by initials, strictly new first: unused names (in the order given), then fresh AI names, then
 * names used before (pass them least recently used first), then `late` fresh names (common ones), `want` at most. Each first name and each middle name is
 * used once per post (no two "June"s), never one of `takenParts` (the names already on the post), so a name is never
 * there twice either. `short` = how many the post lacks when all three run out.
 */
export function pickInitialsNames(i: {
  want: number; available: InitialsName[]; fresh: InitialsCombo[]; used: InitialsName[]; takenParts?: string[];
  /** Fresh AI names that are common (a unique page relaxed its rule for them): only after the names used before. */
  late?: InitialsCombo[];
}): InitialsNamesPlan {
  const picks: InitialsPick[] = [];
  const parts = new Set((i.takenParts ?? []).flatMap((n) => key(n).split(" ")));
  const take = (source: InitialsSource, rows: { id?: string; name: string; meaning: string; parts?: [string, string] }[]) => {
    for (const r of rows) {
      if (picks.length >= i.want) return;
      const words = key(r.name).split(" ").filter(Boolean);
      if (!words.length || !r.meaning.trim() || words.some((w) => parts.has(w))) continue;
      for (const w of words) parts.add(w);
      picks.push({ source, name_id: source === "new" ? null : r.id ?? null, name: r.name.trim(), meaning: r.meaning.trim(), ...(r.parts ? { parts: r.parts } : {}) });
    }
  };
  take("available", i.available);
  take("new", i.fresh);
  take("used", i.used);
  take("new", i.late ?? []);
  const counts: SourceCounts = { available: 0, new: 0, used: 0 };
  for (const p of picks) counts[p.source]++;
  return { picks, counts, short: Math.max(0, i.want - picks.length) };
}

/** "3 unused · 7 new AI · 0 reused". */
export const sourceSummary = (c: SourceCounts) => (["available", "new", "used"] as const).map((s) => `${c[s]} ${SOURCE_LABEL[s]}`).join(" · ");

/** Fresh AI names asked for when `need` are missing: about 1.5 times as many (the checks drop some), within a cap. */
export const INITIALS_AI = { factor: 1.5, min: 4, max: 20 } as const;
export const initialsAiWanted = (need: number) => (need <= 0 ? 0 : Math.min(INITIALS_AI.max, Math.max(INITIALS_AI.min, Math.ceil(need * INITIALS_AI.factor))));

/** Cards for a post by initials: the chosen count, or for Auto a stable pick in min–max for this date, gender and initials. */
export function initialsWanted(count: number | null, s: { min_images: number; max_images: number }, k: { postDate: string; gender: Gender; initials: string }): number {
  if (count !== null) return count;
  const rng = seededRandom(hashSeed(`${k.postDate}|${k.gender}|initials|${k.initials}`));
  return s.min_images + Math.floor(rng() * (s.max_images - s.min_images + 1));
}

/** Least recently used first: never-dated (unknown) names first, then oldest use; ties by name. */
export function leastRecentlyUsed<T extends { name: string; lastUsed: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.lastUsed !== b.lastUsed) {
      if (a.lastUsed === null) return -1;
      if (b.lastUsed === null) return 1;
      const d = Date.parse(a.lastUsed) - Date.parse(b.lastUsed);
      if (d) return d;
    }
    return a.name.localeCompare(b.name);
  });
}
