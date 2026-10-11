import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Gender, NameRow } from "@/lib/db/types";
import { chunks, nameKey } from "@/lib/actions/helpers";
import { filterInitialsCombos } from "@/lib/ai/suggest-filter";
import { INITIALS_UNIQUE, STYLE_EXAMPLES, suggestForInitials } from "@/lib/ai/initials";
import {
  hasInitials, initialsAiWanted, initialsText, leastRecentlyUsed, pickInitialsNames,
  type InitialsCombo, type InitialsNamesPlan,
} from "@/lib/series/initials";

// The names a post by initials can take (migration 017), read fresh for every plan: unused names with the initials
// (oldest first), names used before (least recently used first) and every name in the database (fresh AI names must be
// new against all of them). Plain selects, so a plan also works before 017 runs (it then skips names used before).

type SB = Awaited<ReturnType<typeof createClient>>;
const PAGE = 1000; // PostgREST's default max-rows
const IN_CHUNK = 100;

export type UsedName = NameRow & { lastUsed: string | null };
export interface InitialsStock {
  /** Unused two-word names of the gender with the initials, oldest first. */
  available: NameRow[];
  /** Names used before ('used', or 'reserved' when not on a post being made), least recently used first. */
  used: UsedName[];
  /** Every name in the database (any gender or status): fresh names must be new against these. */
  allNames: string[];
  /** Names with these initials (any gender or status): the AI is told not to repeat them. */
  seen: string[];
  /** A spread of the owner's two-word names of the gender (the style the AI follows). */
  examples: string[];
  /** The owner's meanings of single names (lowercase name → meaning; this gender's first): a fresh name's part uses it. */
  knownParts: Map<string, string>;
}

/** Every names row, every page (a single select is capped at 1000 rows server-side). */
async function allNameRows(sb: SB): Promise<{ rows: NameRow[]; error?: string }> {
  const rows: NameRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("names").select("*").order("id").range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as NameRow[]));
    if ((data?.length ?? 0) < PAGE) return { rows };
  }
}

/**
 * The stock for one gender + initials. `onPost` (Add card, My names) leaves out the names already on that post (by
 * row and by text: a reused name's card has no name_id).
 */
export async function loadInitialsStock(sb: SB, i: { gender: Gender; initials: string; onPost?: { nameIds: string[]; names: string[] } }):
  Promise<{ ok: true; stock: InitialsStock } | { ok: false; error: string }> {
  const all = await allNameRows(sb);
  if (all.error) return { ok: false, error: all.error };
  const onIds = new Set(i.onPost?.nameIds ?? []);
  const onNames = new Set((i.onPost?.names ?? []).map(nameKey));
  const off = (n: NameRow) => onIds.has(n.id) || onNames.has(nameKey(n.name));
  const withInitials = all.rows.filter((n) => hasInitials(n.name, i.initials));
  const mine = withInitials.filter((n) => n.gender === i.gender && n.style === "two-word" && n.meaning?.trim() && !off(n));
  const byAge = (a: NameRow, b: NameRow) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id);
  const available = mine.filter((n) => n.status === "available").sort(byAge);
  const candidates = mine.filter((n) => n.status === "used" || n.status === "reserved");

  // When each was last on a post: its own post (names.post_id) and any card that reused it (no name_id, same text).
  const postIds = [...new Set(candidates.map((n) => n.post_id).filter((x): x is string => !!x))];
  const posts = new Map<string, { status: string; created_at: string }>();
  for (const ids of chunks(postIds, IN_CHUNK)) {
    const { data, error } = await sb.from("posts").select("id, status, created_at").in("id", ids);
    if (error) return { ok: false, error: error.message };
    for (const p of (data ?? []) as { id: string; status: string; created_at: string }[]) posts.set(p.id, p);
  }
  const reusable = candidates.filter((n) => n.status === "used" || !n.post_id || posts.get(n.post_id)?.status !== "generating");
  const lastUse = new Map<string, string>();
  const later = (k: string, at: string | null | undefined) => { if (at && (!lastUse.has(k) || at > lastUse.get(k)!)) lastUse.set(k, at); };
  for (const names of chunks(reusable.map((n) => n.name), IN_CHUNK)) {
    const { data, error } = await sb.from("cards").select("name, created_at").is("name_id", null).eq("kind", "post").in("name", names);
    if (error) return { ok: false, error: error.message };
    for (const c of (data ?? []) as { name: string; created_at: string }[]) later(nameKey(c.name), c.created_at);
  }
  for (const n of reusable) later(nameKey(n.name), n.post_id ? posts.get(n.post_id)?.created_at : null);
  const used = leastRecentlyUsed(reusable.map((n) => ({ ...n, lastUsed: lastUse.get(nameKey(n.name)) ?? null })));
  const live = (n: NameRow) => n.status === "available" || n.status === "used" || n.status === "reserved";
  const twoWord = all.rows.filter((n) => n.gender === i.gender && n.style === "two-word" && live(n));
  const step = Math.max(1, Math.floor(twoWord.length / STYLE_EXAMPLES));
  const examples = twoWord.filter((_, k) => k % step === 0).slice(0, STYLE_EXAMPLES).map((n) => n.name);
  const knownParts = new Map<string, string>();
  const singles = all.rows.filter((n) => n.style === "single" && live(n) && n.meaning?.trim());
  for (const n of [...singles.filter((x) => x.gender === i.gender), ...singles.filter((x) => x.gender !== i.gender)]) {
    const k = n.name.trim().toLowerCase();
    if (!knownParts.has(k)) knownParts.set(k, n.meaning.trim().toLowerCase());
  }
  return { ok: true, stock: { available, used, allNames: all.rows.map((n) => n.name), seen: withInitials.map((n) => n.name), examples, knownParts } };
}

export interface InitialsNamesResult {
  plan: InitialsNamesPlan;
  /** The fresh AI names the plan takes (the client sends them back on Generate). */
  fresh: InitialsCombo[];
  /** Why there are no (or too few) AI names, when the AI failed; the plan then uses what is unused / used. */
  aiError?: string;
  stock: InitialsStock;
}

/**
 * The names for `want` cards, strictly new first: unused, then fresh AI names (`keep` = names already shown, re-checked;
 * then ONE AI call for the rest when `ai` is on, a few more than missing, never one of `skip`), then names used before
 * (only when `reuse`: create_initials_post exists). Never throws on an AI failure: it reports it in `aiError`.
 */
export async function planInitialsNames(sb: SB, i: {
  gender: Gender; initials: string; want: number; keep?: InitialsCombo[]; skip?: string[]; ai: boolean; reuse?: boolean;
  onPost?: { nameIds: string[]; names: string[] };
}): Promise<{ ok: true; result: InitialsNamesResult } | { ok: false; error: string }> {
  const got = await loadInitialsStock(sb, i);
  if (!got.ok) return got;
  const { stock } = got;
  const skip = i.skip ?? [];
  const known = [...stock.allNames, ...skip];
  // Names already shown are checked again (still new, still grounded in their part meanings).
  const keptAll = filterInitialsCombos((i.keep ?? []).map((c) => ({ name: c.name, meaning: c.meaning, gender: i.gender, part1_meaning: c.parts?.[0], part2_meaning: c.parts?.[1] })),
    known, { initials: i.initials, want: i.want, unique: INITIALS_UNIQUE, knownParts: stock.knownParts }, i.gender);
  const kept = [...keptAll.fresh, ...keptAll.relaxed];
  let fresh: InitialsCombo[] = keptAll.fresh;
  // Common AI names (a unique page relaxed its rule for them) come only after the names used before.
  let late: InitialsCombo[] = keptAll.relaxed;
  let aiError: string | undefined;
  const need = i.want - stock.available.length - keptAll.fresh.length;
  if (i.ai && need > 0) {
    const ask = initialsAiWanted(need);
    // Every valid one is kept (a name whose first or middle name repeats another's is skipped when picking).
    const ai = await suggestForInitials({
      gender: i.gender, initials: i.initials, want: ask, ask, examples: stock.examples, knownParts: stock.knownParts,
      allNames: [...known, ...kept.map((k) => k.name)], existing: [...stock.seen, ...kept.map((k) => k.name)], skip,
    });
    if (!ai.ok) aiError = ai.error;
    else {
      fresh = [...keptAll.fresh, ...ai.result.fresh];
      late = [...keptAll.relaxed, ...ai.result.relaxed];
      if (!ai.result.fresh.length && !ai.result.relaxed.length) aiError = `The AI had no new ${initialsText(i.initials)} names this time.`;
    }
  }
  const plan = pickInitialsNames({ want: i.want, available: stock.available, fresh, late, used: i.reuse === false ? [] : stock.used, takenParts: i.onPost?.names });
  const taken = new Set(plan.picks.filter((p) => p.source === "new").map((p) => nameKey(p.name)));
  return { ok: true, result: { plan, fresh: [...fresh, ...late].filter((f) => taken.has(nameKey(f.name))), aiError, stock } };
}

/** Does the database have migration 017 (posts.initials and its functions)? A read error other than "no such column" counts as yes. */
export async function has017(sb: SB): Promise<boolean> {
  const { error } = await sb.from("posts").select("initials").limit(1);
  return !(error && (error.code === "PGRST204" || error.code === "42703" || /schema cache|column .* does not exist/i.test(error.message)));
}

/** A database function that does not exist yet (its migration not run). */
export const missingFunction = (e: { message: string; code?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message);
