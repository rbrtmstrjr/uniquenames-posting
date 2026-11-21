// Pick a post's names (spec: "Names: the parent's-eye check"): the saved names that pass, then AI suggestions (checked
// the same way) while short. Saved names a parent would not choose are skipped with the reason; wrong meanings are
// fixed; a name that only does not fit this post is left alone. Fewer than 8 good names = the post is held.
import type { AutopilotItemRow, Gender } from "@/lib/db/types";
import { startsWith } from "@/lib/series/letter";
import { shuffle } from "@/lib/planner/random";
import type { JudgeResult, Usage } from "./claude-judge";
import type { NameTarget, NameVerdict } from "./judge-names";
import type { AutopilotRepo } from "./repo";
import { MIN_GOOD_NAMES } from "./plan";

export const EXTRA_ROUNDS = 2;
/** An extra AI round starts only with this much time left before the deadline: suggestions (up to 50 s) + the check (up to 120 s). */
export const ROUND_NEEDS_MS = 180_000;
/** Asked for on top of the names still missing (the checks drop some). */
export const ASK_EXTRA = 4;
/** Most saved names judged for one post, letter or name theme (one Claude batch, a random sample): stays inside the tick's time. */
export const STOCK_JUDGE_MAX = 60;
/** More than this share of the judged saved names failing = something is off: none is skipped that round. */
export const MAX_SKIP_SHARE = 0.4;
/** Names listed in the "left alone" event. */
const LEFT_ALONE_LISTED = 20;

type Simple = { name: string; meaning: string };
export interface NamesDeps {
  repo: Pick<AutopilotRepo, "allNames" | "skipName" | "setMeaning" | "addNames">;
  judge: (i: { gender: Gender; target: NameTarget; names: Simple[] }) => Promise<JudgeResult<NameVerdict[]>>;
  suggest: (i: { gender: Gender; target: NameTarget; want: number; allNames: string[]; existing: string[] }) => Promise<{ ok: true; names: Simple[] } | { ok: false; error: string }>;
  rng: () => number;
  /** The clock (ms); tests set it. Defaults to Date.now. */
  now?: () => number;
}
/** `notes`: plain run events (meanings fixed, skips held back) the engine logs. */
type Base = { usage: Usage; added: string[]; skipped: { name: string; why: string }[]; notes?: string[] };
export type NamesOutcome = Base & (
  | { kind: "ok"; nameIds: string[] }
  | { kind: "hold"; why: string }
  | { kind: "retry"; error: string }
  | { kind: "stop"; error: string }
);

export async function pickNames(d: NamesDeps, item: Pick<AutopilotItemRow, "gender" | "letter" | "name_theme" | "name_count">, hint: string | null, deadline?: number): Promise<NamesOutcome> {
  const notes: string[] = [];
  const base: Base = { usage: { input: 0, output: 0 }, added: [], skipped: [], notes };
  const target: NameTarget = item.letter ? { kind: "letter", letter: item.letter } : { kind: "theme", title: item.name_theme ?? "", hint };
  const label = item.letter ? `letter ${item.letter}` : `"${item.name_theme}"`;
  const all = await d.repo.allNames();
  const sameKind = all.filter((n) => n.gender === item.gender && n.style === "single" && (!item.letter || startsWith(n.name, item.letter)));
  const good: { id: string; name: string }[] = [];
  const judge = async (names: Simple[]) => {
    const r = await d.judge({ gender: item.gender, target, names });
    base.usage.input += r.usage.input;
    base.usage.output += r.usage.output;
    return r;
  };
  const failed = (r: { error: string; stop: boolean }): NamesOutcome => (r.stop ? { ...base, kind: "stop", error: r.error } : { ...base, kind: "retry", error: r.error });

  // 1. The saved names: one batch (a random sample when there are more), to stay inside the tick's time.
  let stock = sameKind.filter((n) => n.status === "available");
  if (stock.length > STOCK_JUDGE_MAX) stock = shuffle(stock, d.rng).slice(0, STOCK_JUDGE_MAX);
  if (stock.length) {
    const r = await judge(stock.map((n) => ({ name: n.name, meaning: n.meaning })));
    if (!r.ok) return failed(r);
    const toSkip: { id: string; name: string; why: string }[] = [];
    for (const [k, v] of r.data.entries()) {
      const n = stock[k];
      if (!v.good) {
        // A name the owner brought back after Autopilot skipped it (it keeps its note) is never skipped again; like a
        // name that does not fit, it is simply not used.
        if (v.reason !== "not judged" && !n.autopilot_note) toSkip.push({ id: n.id, name: n.name, why: v.reason || "not a good pick" });
        continue;
      }
      if (!v.fits) continue;
      if (v.meaning_wrong && v.meaning && v.meaning !== n.meaning) {
        await d.repo.setMeaning(n.id, v.meaning);
        notes.push(`Meaning fixed for ${n.name}: ${n.meaning} → ${v.meaning}`);
      }
      good.push({ id: n.id, name: n.name });
    }
    // Too many at once looks like a bad check, not a bad list: the names are only left unused, for the owner to look at.
    if (toSkip.length > stock.length * MAX_SKIP_SHARE) {
      const listed = toSkip.slice(0, LEFT_ALONE_LISTED).map((s) => s.name).join(", ");
      const more = toSkip.length > LEFT_ALONE_LISTED ? ` and ${toSkip.length - LEFT_ALONE_LISTED} more` : "";
      notes.push(`Autopilot left ${toSkip.length} names alone that it would have skipped: please look at them (${listed}${more}).`);
    } else {
      for (const s of toSkip) {
        await d.repo.skipName(s.id, `Skipped by Autopilot: ${s.why}`);
        base.skipped.push({ name: s.name, why: s.why });
      }
    }
  }

  // 2. More from the AI while short, checked the same way.
  const known = new Set(all.map((n) => n.name.toLowerCase()));
  let lastError: string | null = null;
  let outOfTime = false;
  for (let round = 0; round < EXTRA_ROUNDS && good.length < item.name_count; round++) {
    if (deadline !== undefined && deadline - (d.now ?? Date.now)() < ROUND_NEEDS_MS) { outOfTime = true; break; }
    const s = await d.suggest({
      gender: item.gender, target, want: item.name_count - good.length + ASK_EXTRA,
      allNames: [...all.map((n) => n.name), ...base.added], existing: [...sameKind.map((n) => n.name), ...base.added],
    });
    if (!s.ok) { lastError = s.error; continue; }
    const fresh = s.names.filter((n) => !known.has(n.name.toLowerCase()));
    if (!fresh.length) continue;
    const r = await judge(fresh);
    if (!r.ok) return failed(r);
    const keep = fresh.flatMap((n, k) => (r.data[k].good && r.data[k].fits ? [{ name: n.name, meaning: r.data[k].meaning || n.meaning, gender: item.gender }] : []));
    for (const n of fresh) known.add(n.name.toLowerCase());
    for (const saved of await d.repo.addNames(keep)) {
      good.push(saved);
      base.added.push(saved.name);
    }
  }

  if (good.length < MIN_GOOD_NAMES) {
    // A failed suggestion round is a temporary outage, not the owner's problem: try again later.
    if (outOfTime) return { ...base, kind: "retry", error: "Ran out of time picking names; trying again." };
    if (lastError) return { ...base, kind: "retry", error: lastError };
    return { ...base, kind: "hold", why: `Only ${good.length} good ${item.gender} names for ${label} (${MIN_GOOD_NAMES} needed). Add names, then make this post on Today.` };
  }
  // shuffle() already returns a new array, so `good` is not mutated.
  return { ...base, kind: "ok", nameIds: shuffle(good, d.rng).slice(0, item.name_count).map((g) => g.id) };
}
