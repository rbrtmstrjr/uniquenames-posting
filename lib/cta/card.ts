import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { planCtaCard, storedAge, subjectKey } from "@/lib/planner";
import { ctaMessagesOf, pickCtaMessage } from "./messages";

type SB = Awaited<ReturnType<typeof createClient>>;

/** How many recent closing cards the rotation looks at (far more than the list is long). */
const RECENT = 40;

export type ClosingCardResult =
  | { status: "added"; cardId: string }
  | { status: "exists" }
  | { status: "off" }
  | { status: "needs010" }
  | { status: "error"; message: string };

export interface ClosingCardPost { id: string; post_date: string; gender: Gender; style: NameStyle; theme_id: string; subject_age?: string | null }

/** settings.cta_enabled is absent until migration 010 runs. */
export const has010 = (s: Partial<SettingsRow> | null | undefined) => typeof s?.cta_enabled === "boolean";

const isMissing010 = (e: { message: string; code?: string }) =>
  e.code === "PGRST204" || e.code === "23514" || /schema cache|cards_kind_check/i.test(e.message);

/**
 * Queue the post's closing "follow" card (migration 010) after its name cards: the same set and
 * child, a rotated message (the least recently used, never the previous post's). Never throws.
 * Before 010 (no settings column, or the database refuses kind 'cta') nothing is added.
 * `force` adds it even when the closing card is switched off in Settings (the owner asked for it).
 */
export async function addClosingCard(sb: SB, o: { post: ClosingCardPost; theme: ThemeRow; settings: Partial<SettingsRow>; force?: boolean }): Promise<ClosingCardResult> {
  try {
    if (!has010(o.settings)) return { status: "needs010" };
    if (!o.force && !o.settings.cta_enabled) return { status: "off" };
    const [{ data: own, error: ownErr }, { data: recent, error: recentErr }] = await Promise.all([
      sb.from("cards").select("id, kind, position").eq("post_id", o.post.id),
      sb.from("cards").select("name").eq("kind", "cta").order("created_at", { ascending: false }).limit(RECENT),
    ]);
    if (ownErr) return { status: "error", message: ownErr.message };
    if (recentErr) console.error("addClosingCard: could not read the recent closing cards", recentErr.message);
    const cards = (own ?? []) as { kind: string; position: number }[];
    if (cards.some((c) => c.kind === "cta")) return { status: "exists" };
    const text = pickCtaMessage(ctaMessagesOf(o.settings), ((recent ?? []) as { name: string }[]).map((r) => r.name), o.post.gender);
    const position = Math.max(0, ...cards.map((c) => c.position)) + 1;
    const plan = planCtaCard({
      theme: o.theme, gender: o.post.gender, subjectKey: subjectKey(o.post.post_date, o.post.gender, o.post.style),
      age: storedAge(o.post.subject_age), salt: o.post.id, position, text,
    });
    const { data, error } = await sb.from("cards").insert({
      post_id: o.post.id, theme_id: o.post.theme_id, kind: "cta", position, name: plan.name, meaning: "",
      shot: plan.shot, prompt: plan.prompt, seed: plan.seed, order_index: position,
    }).select("id");
    if (error) {
      if (error.code === "23505") return { status: "exists" };
      if (isMissing010(error)) return { status: "needs010" };
      return { status: "error", message: error.message };
    }
    const id = (data as { id: string }[] | null)?.[0]?.id;
    return id ? { status: "added", cardId: id } : { status: "error", message: "The closing card was not saved." };
  } catch (e) {
    return { status: "error", message: (e as Error).message || "unknown error" };
  }
}
