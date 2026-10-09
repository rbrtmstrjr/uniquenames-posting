"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle } from "@/lib/db/types";
import { suggestForLetters, suggestNames, suggestThemes } from "@/lib/ai/suggest";
import { AZ_IDEAS_PER_LETTER, azCoverage, fillNeeds, missingLetters } from "@/lib/series/az";
import { NAME_COUNT, THEME_COUNT, VIBE_MAX, filterNameSuggestions, filterThemeSuggestions } from "@/lib/ai/suggest-filter";
import { fail, requireOwner, type ActionResult } from "./result";
import { UUID_RE } from "./helpers";

export type SuggestResult = ActionResult<{ added: number; duplicates: number; invalid: number }>;

const PAGE = 1000; // PostgREST's default max-rows
/** Live databases created before v2 reject status 'pending' (check constraint) until 002_v2.sql runs. */
const V2_MISSING = "Run the v2 database update first (supabase/migrations/002_v2.sql in the Supabase SQL editor), then try again.";

type DbError = { message: string; code?: string };
const insertError = (e: DbError, unique: string) =>
  e.code === "23514" || /status_check/.test(e.message) ? V2_MISSING : e.code === "23505" ? unique : e.message;

const badCount = (n: number, r: { min: number; max: number }) => !Number.isInteger(n) || n < r.min || n > r.max;
const badVibe = (v: unknown) => v !== undefined && (typeof v !== "string" || v.length > VIBE_MAX);

/** Every row of a table (a single select is capped at 1000 rows server-side). */
async function selectAll<T>(sb: Awaited<ReturnType<typeof createClient>>, table: string, cols: string): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).order("id").range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) return { rows };
  }
}

/**
 * Gemini suggests new names; survivors of the uniqueness filter (checked against EVERY name,
 * any gender or status) are added as 'pending' for the owner to approve.
 */
export async function suggestNamesAction(i: { gender: Gender; style: NameStyle; count: number; vibe?: string }): Promise<SuggestResult> {
  await requireOwner();
  if (i.gender !== "boy" && i.gender !== "girl") return fail("Pick Boy or Girl.");
  if (i.style !== "two-word" && i.style !== "single") return fail("Pick a name style.");
  if (badCount(i.count, NAME_COUNT)) return fail(`Ask for ${NAME_COUNT.min} to ${NAME_COUNT.max} names.`);
  if (badVibe(i.vibe)) return fail(`Keep the idea under ${VIBE_MAX} characters.`);
  const sb = await createClient();
  const all = await selectAll<{ name: string; gender: Gender; style: NameStyle }>(sb, "names", "name, gender, style");
  if (all.error) return fail(all.error);
  const existing = all.rows.filter((n) => n.gender === i.gender && n.style === i.style).map((n) => n.name);
  const ai = await suggestNames({ gender: i.gender, style: i.style, count: i.count, vibe: i.vibe, existing });
  if (!ai.ok) return fail(`Gemini could not suggest names: ${ai.error}`);
  const { fresh, duplicates, invalid } = filterNameSuggestions(ai.data, all.rows.map((n) => n.name), i.style);
  const rows = fresh.slice(0, i.count).map((n) => ({ name: n.name, meaning: n.meaning, gender: i.gender, style: i.style, status: "pending" as const }));
  if (rows.length) {
    const { error } = await sb.from("names").insert(rows);
    if (error) return fail(insertError(error, "Some of these names were added at the same time. Try again."));
  }
  revalidatePath("/names");
  return { ok: true, added: rows.length, duplicates, invalid };
}

const CARD_IDEAS = 5;
export type CardNameIdeas = ActionResult<{ ideas: { name: string; meaning: string }[] }>;

/**
 * "Suggest names" in the card dialog: up to 5 new names (+ meanings) for the card's post — same
 * gender and style, its theme as the idea — that no name in the database already has. Nothing is
 * saved: the owner picks one into the Name/Meaning fields, then saves or makes a new picture
 * (which renames the card's own names row through the usual uniqueness-checked path).
 */
export async function cardNameIdeasAction(cardId: string): Promise<CardNameIdeas> {
  await requireOwner();
  if (!UUID_RE.test(cardId ?? "")) return fail("Card not found.");
  const sb = await createClient();
  const { data: card } = await sb.from("cards").select("id, post_id, theme_id, kind").eq("id", cardId).single();
  if (!card) return fail("Card not found.");
  if (!card.post_id || card.kind === "cta") return fail("Name ideas are for the name cards in a post.");
  const [{ data: post }, { data: theme }, all] = await Promise.all([
    sb.from("posts").select("gender, style").eq("id", card.post_id).single(),
    sb.from("themes").select("title").eq("id", card.theme_id).single(),
    selectAll<{ name: string; gender: Gender; style: NameStyle }>(sb, "names", "name, gender, style"),
  ]);
  if (!post) return fail("Post not found.");
  if (all.error) return fail(all.error);
  const { gender, style } = post as { gender: Gender; style: NameStyle };
  const existing = all.rows.filter((n) => n.gender === gender && n.style === style).map((n) => n.name);
  const vibe = theme?.title ? `names that suit a "${theme.title}" baby photoshoot`.slice(0, VIBE_MAX) : undefined;
  const ai = await suggestNames({ gender, style, count: CARD_IDEAS, vibe, existing });
  if (!ai.ok) return fail(`Gemini could not suggest names: ${ai.error}`);
  const { fresh } = filterNameSuggestions(ai.data, all.rows.map((n) => n.name), style);
  if (!fresh.length) return fail("Every idea Gemini had is already one of your names. Try again.");
  return { ok: true, ideas: fresh.slice(0, CARD_IDEAS).map((n) => ({ name: n.name, meaning: n.meaning })) };
}

/**
 * Gemini suggests new photoshoot themes; survivors (new title AND new props set, against every
 * theme) are added as 'pending' after the last theme in line.
 */
export async function suggestThemesAction(i: { gender: Gender; count: number; vibe?: string }): Promise<SuggestResult> {
  await requireOwner();
  if (i.gender !== "boy" && i.gender !== "girl") return fail("Pick Boy or Girl.");
  if (badCount(i.count, THEME_COUNT)) return fail(`Ask for ${THEME_COUNT.min} to ${THEME_COUNT.max} themes.`);
  if (badVibe(i.vibe)) return fail(`Keep the idea under ${VIBE_MAX} characters.`);
  const sb = await createClient();
  const all = await selectAll<{ title: string; gender: Gender; props: string; sort_order: number }>(sb, "themes", "title, gender, props, sort_order");
  if (all.error) return fail(all.error);
  const existing = all.rows.filter((t) => t.gender === i.gender).map((t) => ({ title: t.title, props: t.props }));
  const ai = await suggestThemes({ gender: i.gender, count: i.count, vibe: i.vibe, existing });
  if (!ai.ok) return fail(`Gemini could not suggest themes: ${ai.error}`);
  const { fresh, duplicates, invalid } = filterThemeSuggestions(ai.data, all.rows, i.gender);
  const last = all.rows.reduce((m, t) => Math.max(m, Number(t.sort_order) || 0), 0);
  const rows = fresh.slice(0, i.count).map((t, k) => ({ ...t, status: "pending" as const, sort_order: last + 1 + k }));
  if (rows.length) {
    const { error } = await sb.from("themes").insert(rows);
    if (error) return fail(insertError(error, "A theme with one of these titles was added at the same time. Try again."));
  }
  revalidatePath("/themes");
  return { ok: true, added: rows.length, duplicates, invalid };
}

export type FillLettersResult = ActionResult<{ added: number; letters: { letter: string; added: number }[]; short: string[] }>;

/**
 * "Fill missing letters" for the A–Z series: every letter with no available single name of this
 * gender gets up to 3 real names from Gemini (counting the ideas already waiting), checked against
 * EVERY name in the database and saved as 'pending' for the owner to approve on the Names page.
 * `short` = letters that got fewer than asked (Gemini knew no more new, real names).
 */
export async function fillMissingLettersAction(i: { gender: Gender }): Promise<FillLettersResult> {
  await requireOwner();
  if (i.gender !== "boy" && i.gender !== "girl") return fail("Pick Boy or Girl.");
  const sb = await createClient();
  const all = await selectAll<{ name: string; gender: Gender; style: NameStyle; status: string }>(sb, "names", "name, gender, style, status");
  if (all.error) return fail(all.error);
  const mine = all.rows.filter((n) => n.gender === i.gender && n.style === "single");
  const coverage = azCoverage(mine);
  const missing = missingLetters(coverage);
  if (!missing.length) return fail(`Every letter already has a ${i.gender} name. Nothing to fill.`);
  const needs = fillNeeds(coverage);
  if (!needs.length) {
    return fail(`Every missing letter (${missing.join(", ")}) already has ${AZ_IDEAS_PER_LETTER} name ideas waiting for approval. Review them on the Names page.`);
  }
  const ai = await suggestForLetters({ gender: i.gender, needs, existing: mine.map((n) => n.name), allNames: all.rows.map((n) => n.name) });
  if (!ai.ok) return fail(`Gemini could not suggest names: ${ai.error}`);
  const rows = ai.result.fresh.map((n) => ({ name: n.name, meaning: n.meaning, gender: i.gender, style: "single" as const, status: "pending" as const }));
  if (rows.length) {
    const { error } = await sb.from("names").insert(rows);
    if (error) return fail(insertError(error, "Some of these names were added at the same time. Try again."));
  }
  const letters = needs.map((n) => ({ letter: n.letter, added: ai.result.fresh.filter((f) => f.letter === n.letter).length }));
  revalidatePath("/names");
  revalidatePath("/", "layout");
  return { ok: true, added: rows.length, letters, short: letters.filter((l, k) => l.added < needs[k].want).map((l) => l.letter) };
}
