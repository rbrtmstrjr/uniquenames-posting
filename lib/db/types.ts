export type Gender = "boy" | "girl";
export type NameStyle = "two-word" | "single";
// "pending" = suggested by AI, waiting for the owner's approval. Never planned or counted as stock.
export type NameStatus = "available" | "reserved" | "used" | "skip" | "pending";
export type ThemeStatus = "available" | "used" | "archived" | "pending";
/** Where the card text sits; "auto" keeps v1's per-shot placement. Matches settings_text_position_check. */
export const TEXT_POSITIONS = [
  "auto", "top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right",
] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];
/** The column defaults of the v2 settings fields (supabase/migrations/002_v2.sql). */
export const TEXT_SETTINGS_DEFAULTS = {
  title_font: "poppins", meaning_font: "poppins", mark_font: "poppins",
  title_size: 95, meaning_size: 37, mark_size: 21, text_position: "auto", caption_ai: true,
} as const satisfies Pick<SettingsRow, "title_font" | "meaning_font" | "mark_font" | "title_size" | "meaning_size" | "mark_size" | "text_position" | "caption_ai">;
export type PostStatus = "generating" | "ready" | "posted";
export type CardStatus = "queued" | "generating" | "restamp" | "done" | "failed";
export type CardKind = "post" | "preview";

export interface NameRow {
  id: string; name: string; meaning: string; gender: Gender; style: NameStyle; status: NameStatus;
  post_id: string | null; position: number | null; created_at: string; updated_at: string;
}
export interface ThemeRow {
  id: string; title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string;
  status: ThemeStatus; sort_order: number; used_on: string | null; preview_card_id: string | null; created_at: string; updated_at: string;
}
export interface PostRow {
  id: string; request_id: string | null; post_date: string; gender: Gender; style: NameStyle; theme_id: string; caption: string;
  status: PostStatus; posted_at: string | null; created_at: string; updated_at: string;
  /** The post's fonts (migration 003; absent before it runs). null = the fonts in settings. */
  title_font?: string | null; meaning_font?: string | null; mark_font?: string | null;
  /** The child's age chosen on Today (migration 004; absent before it runs): 'random' | 'newborn' | '1'..'7'; null = a post made before ages. */
  subject_age?: string | null;
}
export interface CardRow {
  id: string; post_id: string | null; theme_id: string; kind: CardKind; position: number; name_id: string | null;
  name: string; meaning: string; shot: string; prompt: string; seed: number; status: CardStatus; error: string | null;
  photo_path: string | null; card_path: string | null; version: number; selected: boolean; order_index: number;
  queued_at: string; claimed_at: string | null; started_at: string | null; finished_at: string | null; attempts: number;
  created_at: string; updated_at: string;
}
export interface SettingsRow {
  id: 1; caption_template: string; hashtags: string; handle: string; min_images: number; max_images: number;
  width: number; height: number; sound_on: boolean;
  /** v2 card text: font ids from the font catalog; sizes in px on a 1080 px card (title 40–180, meaning 16–90, mark 12–48). */
  title_font: string; meaning_font: string; mark_font: string;
  title_size: number; meaning_size: number; mark_size: number;
  text_position: TextPosition; caption_ai: boolean;
  /** Reels (migration 005; absent before it runs): max images per reel (10–40, default 40). */
  reel_max_images?: number;
  /** Reels (migration 005): a reference voice clip in the `reels` bucket; null = Chatterbox's built-in voice. */
  reel_voice_path?: string | null;
  updated_at: string;
}
/** Reel lifecycle (migration 005). script = waiting for review; queued..rendering = the PC is working on it. */
export type ReelStatus = "script" | "queued" | "voicing" | "imaging" | "rendering" | "ready" | "needs_attention" | "failed";
export type ReelSceneStatus = "pending" | "queued" | "generating" | "done" | "failed" | "skipped";
export interface ReelCast { adult: string; child: string }
/** One Whisper word with its times in seconds. */
export interface ReelWord { word: string; start: number; end: number }
export interface ReelRow {
  id: string; title: string; topic: string | null;
  /** The early-childhood stage the script targets (newborn | baby | toddler | preschooler). */
  stage: string | null;
  doll_cast: ReelCast; status: ReelStatus; error: string | null;
  voice_path: string | null; words: ReelWord[] | null; preview_path: string | null; pc_path: string | null;
  /** numeric in Postgres; PostgREST returns it as a number. */
  duration_s: number | null;
  version: number; claimed_at: string | null; started_at: string | null; finished_at: string | null;
  created_at: string; updated_at: string;
}
export interface ReelSceneRow {
  id: string; reel_id: string; position: number; beat: string;
  /** The script's plain picture idea (the review page edits it; image_prompt is built from it). */
  idea: string;
  narration: string; image_prompt: string; seed: number;
  status: ReelSceneStatus; photo_path: string | null; attempts: number; error: string | null;
  start_s: number | null; end_s: number | null; version: number; claimed_at: string | null;
  created_at: string; updated_at: string;
}
/** What claim_next_reel_step(p_no_comfy) returns to the PC (null = nothing to do). */
export interface ReelStepClaim {
  step: "voice" | "timing" | "image" | "render";
  reel: ReelRow;
  scene: ReelSceneRow | null;
}
export interface WorkerStatusRow {
  id: 1; last_seen: string | null; comfyui_ok: boolean; gpu: string | null; current_card_id: string | null;
  worker_version: string | null; message: string | null; updated_at: string;
}
