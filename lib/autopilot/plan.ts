// Autopilot's plan for one run (pure, spec 2026-11-20): which days, which letter or name theme each day, which gender
// in the morning, the random times inside the windows and how many names each post gets.
import type { Gender, PostRow } from "@/lib/db/types";
import { AZ_LETTERS } from "@/lib/series/az";
import { SCHEDULE_MAX_MS, manilaLabel } from "@/lib/facebook/schedule";
import { nameThemeLabel } from "./name-themes";

/** Minutes after midnight, Manila: morning 8:00–9:59 AM, afternoon 1:00–1:59 PM. */
export const MORNING = { from: 8 * 60, to: 9 * 60 + 59 } as const;
export const AFTERNOON = { from: 13 * 60, to: 13 * 60 + 59 } as const;
/** 8 to 14 names a post: 10 to 16 cards with the front and closing cards (owner, 2026-11-21). */
export const NAMES_PER_POST = { min: 8, max: 14 } as const;
/** The names step needs at least this many good names to make a post, or it is held. */
export const MIN_GOOD_NAMES = 8;
export const MAX_DAYS = 7;
const MANILA_MS = 8 * 3600_000;
const DAY_MS = 86400_000;

export type Label = { letter: string; nameTheme: null } | { letter: null; nameTheme: string };

/** The label after `last`: A..Z, then the name themes in order, then A again. */
export function nextLabel(last: Label | null, themes: string[]): Label {
  const A: Label = { letter: "A", nameTheme: null };
  const firstTheme: Label = themes.length ? { letter: null, nameTheme: themes[0] } : A;
  if (!last) return A;
  if (last.letter !== null) {
    const i = AZ_LETTERS.indexOf(last.letter);
    return i >= 0 && i < AZ_LETTERS.length - 1 ? { letter: AZ_LETTERS[i + 1], nameTheme: null } : firstTheme;
  }
  const i = themes.findIndex((t) => t.toLowerCase() === last.nameTheme.toLowerCase());
  if (i === -1) return firstTheme;
  return i < themes.length - 1 ? { letter: null, nameTheme: themes[i + 1] } : A;
}

/** The Manila calendar day of `t` ("2026-11-21"). */
export const manilaDay = (t: number) => new Date(t + MANILA_MS).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** `minutes` after midnight Manila on `day`. */
export const manilaTime = (day: string, minutes: number) => new Date(Date.parse(`${day}T00:00:00+08:00`) + minutes * 60_000);

/** The run's first day: the day after the last day with a Facebook post, and never before tomorrow (Manila). */
export function firstDay(lastFacebookAt: string | null, now: number): string {
  const tomorrow = addDays(manilaDay(now), 1);
  if (!lastFacebookAt) return tomorrow;
  const after = addDays(manilaDay(Date.parse(lastFacebookAt)), 1);
  return after > tomorrow ? after : tomorrow;
}

type FbPost = Pick<PostRow, "fb_state" | "fb_scheduled_for" | "posted_at" | "letter" | "name_theme">;

/** The latest Facebook time (scheduled or published) and the label of the latest such post that has one. */
export function lastFacebook(posts: FbPost[]): { at: string | null; label: Label | null } {
  let at: string | null = null;
  let labelAt = -Infinity;
  let label: Label | null = null;
  for (const p of posts) {
    if (p.fb_state !== "scheduled" && p.fb_state !== "published") continue;
    const when = p.fb_scheduled_for ?? p.posted_at;
    if (!when) continue;
    const t = Date.parse(when);
    if (at === null || t > Date.parse(at)) at = when;
    const own: Label | null = p.letter ? { letter: p.letter, nameTheme: null } : p.name_theme ? { letter: null, nameTheme: p.name_theme } : null;
    if (own && t > labelAt) { labelAt = t; label = own; }
  }
  return { at, label };
}

export interface PlannedItem {
  day: string; slot: "morning" | "afternoon"; gender: Gender; scheduledFor: string;
  letter: string | null; nameTheme: string | null; nameCount: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pick = (lo: number, hi: number, rng: () => number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Two posts a day (one boy, one girl, random order), each at a random minute of its window. */
export function planRun(i: { firstDay: string; days: number; last: Label | null; themes: string[]; minImages: number; maxImages: number; rng: () => number }): PlannedItem[] {
  const lo = clamp(NAMES_PER_POST.min, i.minImages, i.maxImages);
  const hi = clamp(NAMES_PER_POST.max, i.minImages, i.maxImages);
  const out: PlannedItem[] = [];
  let label = i.last;
  for (let d = 0; d < i.days; d++) {
    const day = addDays(i.firstDay, d);
    label = nextLabel(label, i.themes);
    const morning: Gender = i.rng() < 0.5 ? "boy" : "girl";
    const slots = [
      { slot: "morning" as const, gender: morning, w: MORNING },
      { slot: "afternoon" as const, gender: (morning === "boy" ? "girl" : "boy") as Gender, w: AFTERNOON },
    ];
    for (const s of slots) {
      out.push({
        day, slot: s.slot, gender: s.gender, scheduledFor: manilaTime(day, pick(s.w.from, s.w.to, i.rng)).toISOString(),
        letter: label.letter, nameTheme: label.nameTheme, nameCount: pick(lo, hi, i.rng),
      });
    }
  }
  return out;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** "2026-11-21" -> "Sat, Nov 21". */
export const dayLabel = (day: string) => DAY_FMT.format(new Date(`${day}T00:00:00Z`));

/** "Letter S" or "Biblical names". */
export function labelText(p: { letter: string | null; name_theme?: string | null; nameTheme?: string | null }): string {
  if (p.letter) return `Letter ${p.letter}`;
  return nameThemeLabel({ name_theme: p.name_theme ?? p.nameTheme ?? null }) ?? "";
}

/** What the owner should know before starting (themes run out; with `now`, posts beyond Facebook's 29 days). */
export function planProblems(items: PlannedItem[], themesLeft: Record<Gender, number>, now?: number): string[] {
  const out: string[] = [];
  if (now !== undefined) {
    // Facebook refuses a time more than 29 days ahead: those posts would be made and then held.
    const limit = now + SCHEDULE_MAX_MS;
    if (items.some((i) => Date.parse(i.scheduledFor) > limit)) {
      out.push(`Facebook schedules up to 29 days ahead: the posts after ${manilaLabel(new Date(limit).toISOString())} would be held. Pick fewer days.`);
    }
  }
  for (const g of ["girl", "boy"] as const) {
    const mine = items.filter((i) => i.gender === g);
    const left = themesLeft[g] ?? 0;
    if (left >= mine.length) continue;
    out.push(`Only ${left} ${g} photoshoot theme${left === 1 ? " is" : "s are"} left: the ${g} posts from ${dayLabel(mine[left].day)} will be held. Add ${g} themes first.`);
  }
  return out;
}
