import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { coverPoseId, nextTitlePlace, pickCoverPose, planCoverCard, storedAge, subjectKey } from "@/lib/planner";
import { activePack, type CoverTitleInput } from "@/packs";

type SB = Awaited<ReturnType<typeof createClient>>;

/** How many recent front cards the pose rotation looks at (more than the pool is long). */
const RECENT = 40;

export type FrontCardResult =
  | { status: "added"; cardId: string }
  | { status: "exists" }
  | { status: "off" }
  | { status: "none" }
  | { status: "needs023" }
  | { status: "error"; message: string };

export interface FrontCardPost { id: string; post_date: string; gender: Gender; style: NameStyle; theme_id: string; subject_age?: string | null }

/** settings.cover_enabled is absent until migration 023 runs. */
export const has023 = (s: Partial<SettingsRow> | null | undefined) => typeof s?.cover_enabled === "boolean";

const isMissing023 = (e: { message: string; code?: string }) =>
  e.code === "PGRST204" || e.code === "23514" || /schema cache|cards_kind_check|title_pos/i.test(e.message);

/**
 * Queue the post's front card (migration 023), placed first (position 0): the same set and child as the post, the
 * least recently used pose (never the previous post's), the title's place alternating from the previous front card, and
 * the title from the post's kind (letter, name theme, initials). Never throws and never fails a post. Nothing is added
 * on a pack without front-card wording ("none"), before 023 ("needs023": no settings column, or the database refuses
 * kind 'cover'), with the switch off ("off"), or when the post already has one ("exists").
 */
export async function addCoverCard(sb: SB, o: {
  post: FrontCardPost; theme: ThemeRow; settings: Partial<SettingsRow>; title: Omit<CoverTitleInput, "gender">;
}): Promise<FrontCardResult> {
  try {
    const cover = activePack().cards.cover;
    if (!cover) return { status: "none" };
    if (!has023(o.settings)) return { status: "needs023" };
    if (!o.settings.cover_enabled) return { status: "off" };
    const [{ data: own, error: ownErr }, { data: recent, error: recentErr }] = await Promise.all([
      sb.from("cards").select("id, kind").eq("post_id", o.post.id),
      sb.from("cards").select("shot, title_pos").eq("kind", "cover").order("created_at", { ascending: false }).limit(RECENT),
    ]);
    if (ownErr) return { status: "error", message: ownErr.message };
    if (recentErr) console.error("addCoverCard: could not read the recent front cards", recentErr.message);
    if (((own ?? []) as { kind: string }[]).some((c) => c.kind === "cover")) return { status: "exists" };
    const rows = (recent ?? []) as { shot: string | null; title_pos: string | null }[];
    const plan = planCoverCard({
      theme: o.theme, gender: o.post.gender, subjectKey: subjectKey(o.post.post_date, o.post.gender, o.post.style),
      age: storedAge(o.post.subject_age), salt: o.post.id,
      pose: pickCoverPose(cover.poses, rows.map((r) => coverPoseId(r.shot))),
      place: nextTitlePlace(rows[0]?.title_pos),
      title: cover.title({ ...o.title, gender: o.post.gender }),
    });
    const { data, error } = await sb.from("cards").insert({
      post_id: o.post.id, theme_id: o.post.theme_id, kind: "cover", position: plan.position, name: plan.name, meaning: plan.meaning,
      shot: plan.shot, prompt: plan.prompt, seed: plan.seed, order_index: 0, title_pos: plan.title_pos,
    }).select("id");
    if (error) {
      if (error.code === "23505") return { status: "exists" };
      if (isMissing023(error)) return { status: "needs023" };
      return { status: "error", message: error.message };
    }
    const id = (data as { id: string }[] | null)?.[0]?.id;
    return id ? { status: "added", cardId: id } : { status: "error", message: "The front card was not saved." };
  } catch (e) {
    return { status: "error", message: (e as Error).message || "unknown error" };
  }
}
