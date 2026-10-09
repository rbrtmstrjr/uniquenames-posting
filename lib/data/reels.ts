import { createClient } from "@/lib/supabase/server";
import type { ReelRow, ReelSceneRow } from "@/lib/db/types";
import { UUID_RE } from "@/lib/actions/helpers";

export type ReelListScene = Pick<ReelSceneRow, "id" | "position" | "status" | "photo_path">;
export type ReelListItem = ReelRow & { scenes: ReelListScene[] };

type DbError = { message: string; code?: string } | null;

/** The reels tables are not on this database yet (migration 005 not run). */
export const needs005 = (e: DbError) => !!e && (
  e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "PGRST200" || e.code === "42703" ||
  /relation .* does not exist|schema cache/i.test(e.message));

/** Every reel, newest first, with each one's images (for the thumbnail and the Images n/m badge). */
export async function getReelList(): Promise<{ setup: true } | { setup: false; reels: ReelListItem[] }> {
  const sb = await createClient();
  const { data, error } = await sb.from("reels").select("*, reel_scenes(id, position, status, photo_path)")
    .order("created_at", { ascending: false }).limit(60);
  if (needs005(error)) return { setup: true };
  if (error) throw new Error(error.message);
  return {
    setup: false,
    reels: (data ?? []).map((r) => {
      const { reel_scenes, ...rest } = r as ReelRow & { reel_scenes: ReelListScene[] | null };
      return { ...rest, scenes: [...(reel_scenes ?? [])].sort((a, b) => a.position - b.position) };
    }),
  };
}

/** Whether Reels can be used on this database (the New reel page checks this before showing the form). */
export async function reelsReady(): Promise<boolean> {
  const sb = await createClient();
  const { error } = await sb.from("reels").select("id").limit(1);
  if (needs005(error)) return false;
  if (error) throw new Error(error.message);
  return true;
}

/** One reel with its scenes; null when it doesn't exist (or the id isn't a reel id). */
export async function getReel(id: string): Promise<{ setup: true } | { setup: false; reel: ReelRow; scenes: ReelSceneRow[] } | null> {
  const sb = await createClient();
  if (!UUID_RE.test(id)) {
    // Still tell a not-yet-migrated database apart from a bad link.
    return (await reelsReady()) ? null : { setup: true };
  }
  const [{ data: reel, error }, { data: scenes, error: se }] = await Promise.all([
    sb.from("reels").select("*").eq("id", id).maybeSingle(),
    sb.from("reel_scenes").select("*").eq("reel_id", id).order("position"),
  ]);
  if (needs005(error) || needs005(se)) return { setup: true };
  if (error) throw new Error(error.message);
  if (!reel) return null;
  if (se) throw new Error(se.message);
  return { setup: false, reel: reel as ReelRow, scenes: (scenes ?? []) as ReelSceneRow[] };
}
