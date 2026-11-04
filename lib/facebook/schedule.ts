import type { PostRow } from "@/lib/db/types";

// Post now / Schedule (2026-11-04): the panel's time handling (the owner thinks in Manila time, UTC+8 all year, no DST)
// and what the panel shows for a post's Facebook state. Pure, so it is tested without a browser.

export const MANILA_OFFSET = "+08:00";
const MANILA_MS = 8 * 3600_000;
/** The same window the server enforces (lib/actions/facebook): 15 minutes to 29 days ahead. */
export const SCHEDULE_MIN_MS = 15 * 60_000;
export const SCHEDULE_MAX_MS = 29 * 24 * 3600_000;
/** A 'publishing' older than this was cut off mid-way: shown (and retried) as unsure. */
export const STALE_PUBLISHING_MS = 10 * 60_000;

/** "2026-11-05T19:00": a <input type="datetime-local"> value for this moment in Manila. */
export const manilaInputValue = (d: Date) => new Date(d.getTime() + MANILA_MS).toISOString().slice(0, 16);

/** The moment a datetime-local value means in Manila, or null for an empty / invalid value. */
export function fromManilaInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00${MANILA_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The picker's first suggestion: 7:00 PM Manila today, or tomorrow when today's is too close. */
export function defaultScheduleTime(now: Date): Date {
  const today = fromManilaInput(`${manilaInputValue(now).slice(0, 10)}T19:00`)!;
  return today.getTime() - now.getTime() >= SCHEDULE_MIN_MS ? today : new Date(today.getTime() + 24 * 3600_000);
}

/** The picker's min / max (whole minutes, Manila). */
export function scheduleBounds(now: Date): { min: string; max: string } {
  const min = new Date(Math.ceil((now.getTime() + SCHEDULE_MIN_MS) / 60_000) * 60_000);
  return { min: manilaInputValue(min), max: manilaInputValue(new Date(now.getTime() + SCHEDULE_MAX_MS)) };
}

/** Why a picked time can't be used, or null. */
export function scheduleProblem(at: Date | null, now: Date): string | null {
  if (!at) return "Pick a date and time.";
  if (at.getTime() - now.getTime() < SCHEDULE_MIN_MS) return "Pick a time at least 15 minutes from now.";
  if (at.getTime() - now.getTime() > SCHEDULE_MAX_MS) return "Facebook schedules up to 29 days ahead.";
  return null;
}

/** "Thu, Nov 5, 7:00 PM" in Manila. */
export const manilaLabel = (iso: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(iso));

export type FacebookView =
  | { kind: "ready" }
  | { kind: "sending" }
  | { kind: "failed"; error: string }
  | { kind: "unsure" }
  | { kind: "published"; link: string | null }
  | { kind: "scheduled"; at: string }
  | { kind: "scheduled-done"; at: string; link: string | null };

/** What the panel shows for the post's Facebook state at `now`. */
export function facebookView(post: Pick<PostRow, "fb_state" | "fb_permalink" | "fb_scheduled_for" | "fb_attempt_at" | "fb_error">, now: number): FacebookView {
  switch (post.fb_state) {
    case "published": return { kind: "published", link: post.fb_permalink ?? null };
    case "scheduled":
      if (!post.fb_scheduled_for) return { kind: "published", link: post.fb_permalink ?? null };
      return Date.parse(post.fb_scheduled_for) > now
        ? { kind: "scheduled", at: post.fb_scheduled_for }
        : { kind: "scheduled-done", at: post.fb_scheduled_for, link: post.fb_permalink ?? null };
    case "publishing":
      return post.fb_attempt_at && now - Date.parse(post.fb_attempt_at) > STALE_PUBLISHING_MS ? { kind: "unsure" } : { kind: "sending" };
    case "unsure": return { kind: "unsure" };
    case "failed": return { kind: "failed", error: post.fb_error || "The last try didn't go through. Nothing was posted." };
    default: return { kind: "ready" };
  }
}
