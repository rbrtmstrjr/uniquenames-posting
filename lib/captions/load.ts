import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { ReelSceneRow, SettingsRow } from "@/lib/db/types";
import { writeReelCaption } from "@/lib/ai/reel-caption";
import { keyPhrase } from "@/lib/reels/formats";
import { pickReelTags, tagSettings } from "./hashtags";
import { EMPTY_HISTORY, HISTORY_CAPTIONS, postHistory, recentTags, reelHistory, withoutId, type CaptionHistory } from "./history";

type SB = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string };

/** A read or write naming a column the database does not have yet (migration 009 not run). */
export const missingColumn = (e: DbError | null | undefined) =>
  !!e && (e.code === "PGRST204" || e.code === "42703" || /schema cache|column .* does not exist/i.test(e.message));

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/** The latest post captions, newest first. Before 009 the styles are unknown and the tags come from the caption text. */
export async function loadPostHistory(sb: SB): Promise<CaptionHistory> {
  const q = (cols: string) => sb.from("posts").select(cols).order("created_at", { ascending: false }).limit(HISTORY_CAPTIONS);
  let { data, error } = await q("id, caption, caption_style, hashtag_set");
  if (missingColumn(error)) ({ data, error } = await q("id, caption"));
  if (error) {
    console.warn("caption history: could not read the latest posts:", error.message);
    return EMPTY_HISTORY;
  }
  return postHistory(rows(data));
}

/** The latest reel captions, newest first (without `exceptId`). Empty before 009. */
export async function loadReelHistory(sb: SB, exceptId?: string): Promise<CaptionHistory> {
  const { data, error } = await sb.from("reels").select("id, caption, hashtags").not("caption", "is", null)
    .order("created_at", { ascending: false }).limit(HISTORY_CAPTIONS + 1);
  if (error) {
    if (!missingColumn(error)) console.warn("caption history: could not read the latest reels:", error.message);
    return EMPTY_HISTORY;
  }
  const h = reelHistory(rows(data));
  return exceptId ? withoutId(h, exceptId) : h;
}

export interface ReelCaptionSource {
  id: string; title: string; topic?: string | null; stage?: string | null; hook_text?: string | null;
  /** 014: the reel's format (absent / null before it). */
  format?: string | null;
  lines: Pick<ReelSceneRow, "narration">[] | string[];
}

/**
 * A reel's caption + hashtags: Gemini writes it from the title / topic / hook / script against the
 * latest reel captions; the tags are the always-tags + 2–3 of its topic tags, never a set of the
 * last 10 reels. Null on any failure (the caption stays as it was).
 */
export async function makeReelCaption(sb: SB, reel: ReelCaptionSource, timeoutMs?: number, knownSettings?: Partial<SettingsRow>): Promise<{ caption: string; hashtags: string } | null> {
  const [settings, history] = await Promise.all([
    knownSettings ?? sb.from("settings").select("*").eq("id", 1).maybeSingle().then((r) => r.data as Partial<SettingsRow> | null),
    loadReelHistory(sb, reel.id),
  ]);
  const lines = reel.lines.map((l) => (typeof l === "string" ? l : l.narration));
  const ai = await writeReelCaption({
    title: reel.title, topic: reel.topic, stage: reel.stage, hook: reel.hook_text, lines,
    format: reel.format ?? null, keyPhrase: keyPhrase(lines),
    recent: history.texts, recentTags: recentTags(history),
  }, timeoutMs);
  if (!ai) return null;
  const { always, pool } = tagSettings(settings ?? {});
  const tags = pickReelTags({ always, topicTags: ai.tags, pool, history: history.sets });
  return { caption: ai.line, hashtags: tags.join(" ") };
}
