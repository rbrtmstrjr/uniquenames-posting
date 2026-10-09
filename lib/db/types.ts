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
/** "cta" (migration 010) = the closing "follow" card of a post: name = the message ("/" = a line break), meaning = "". */
export type CardKind = "post" | "preview" | "cta";

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
  /** Migration 009 (absent before it runs): the caption style used (story, spotlight, question, choice, fact, compliment, template) and the hashtag set. */
  caption_style?: string | null; hashtag_set?: string | null;
  /** Migration 011 (absent before it runs): an A–Z series part ('az', the shared series id, part 1 = A–M / 2 = N–Z); null on an ordinary post. */
  series?: string | null; series_id?: string | null; series_part?: number | null;
  /** Migration 013 (absent before it runs): a post by letter's capital letter (every name starts with it); null otherwise. */
  letter?: string | null;
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
  /** Reels (migration 006; absent before it runs): the default narrator, a reel_voices id (default 'gacrux'). */
  reel_voice_id?: string;
  /** Narration speed (ffmpeg atempo) 1.00–1.25, default 1.12. numeric(3,2) in Postgres. */
  reel_speed?: number;
  /** Background music under the voice (default on) and its volume in % (5–40, default 18). */
  reel_music?: boolean;
  reel_music_volume?: number;
  /** Reels (migration 007; absent before it runs): the default visual theme, a reel_themes id (default 'crayon' from 012). */
  reel_theme_id?: ReelThemeId;
  /** Captions (migration 009; absent before it runs): the tags on every post (≤ 2) and the pool one tag per post is rotated from. */
  hashtags_always?: string; hashtag_pool?: string;
  /** Closing card (migration 010; absent before it runs): on/off and its messages, one per line ("/" = a line break, {gender}). */
  cta_enabled?: boolean; cta_messages?: string;
  updated_at: string;
}
export type VoiceSampleStatus = "missing" | "queued" | "making" | "ready" | "failed";
/** A narrator voice (migration 006): 30 Gemini voices cloned by Chatterbox from a reference clip + 'builtin'. */
export interface ReelVoiceRow {
  /** The Gemini voice name in lower case, or 'builtin'. */
  id: string;
  label: string;
  /** Gemini's descriptor ("Warm", "Firm", ...). */
  tone: string;
  gender: "female" | "male" | null;
  /** `voices/<id>/ref.wav` in the reels bucket (null for builtin, or until Set up voices made it). */
  ref_path: string | null;
  /** `voices/<id>/sample-v<version>.wav`. */
  sample_path: string | null;
  sample_status: VoiceSampleStatus;
  /** The calm/speed settings the sample was made with; differs from the current ones = stale. */
  sample_key: string | null;
  error: string | null;
  version: number; claimed_at: string | null; created_at: string; updated_at: string;
}
/** What claim_next_voice_sample() returns to the PC (null = nothing to do). */
export interface VoiceSampleClaim { voice: ReelVoiceRow }
/** The 8 visual themes of migration 007 (hidden from 012 on: kept so old reels can still re-render / redo images). */
export const LEGACY_THEME_IDS = ["knitted", "animated3d", "watercolor", "clay", "papercraft", "anime", "sketch", "cinematic"] as const;
export type LegacyThemeId = (typeof LEGACY_THEME_IDS)[number];
/** The 2 styles of migration 012, built from the owner's prompt guides (docs/reference/*-parenting-prompt.md). */
export const GUIDE_THEME_IDS = ["crayon", "redthread"] as const;
export type GuideThemeId = (typeof GUIDE_THEME_IDS)[number];
/** Every theme id the database can hold, the 2 guide styles first. */
export const REEL_THEME_IDS = [...GUIDE_THEME_IDS, ...LEGACY_THEME_IDS] as const;
export type ReelThemeId = (typeof REEL_THEME_IDS)[number];
/** Red Thread: how the thread looks in a line's picture (migration 012, reel_scenes_thread_check). */
export const REEL_THREADS = ["plain", "tight", "stretched", "tangled", "loose"] as const;
export type ReelThread = (typeof REEL_THREADS)[number];
export type ThemePreviewStatus = "missing" | "queued" | "making" | "ready" | "failed";
/** A visual theme (migration 007): a fixed positive-only style block + one preview picture made by the PC. */
export interface ReelThemeRow {
  id: ReelThemeId;
  label: string;
  emoji: string;
  blurb: string;
  /** The positive-only style block put in front of every image prompt. */
  style: string;
  /** Expressive faces; false = feelings show through pose only (knitted, papercraft). */
  faces: boolean;
  /** The worker turns the picture grey after Z-Image (sketch). */
  grayscale: boolean;
  sort: number;
  /** Migration 012 (absent before it runs): shown in the pickers (false = an old theme kept for old reels only). */
  active?: boolean;
  /** Migration 012: the worker keeps only strong reds and turns the rest grey (Red Thread). */
  keep_red?: boolean;
  /** Migration 012: the whole preview prompt, verbatim (null = the worker builds the old fixed moment). */
  preview_prompt?: string | null;
  /** `themes/<id>/preview-v<version>.jpg` in the reels bucket. */
  preview_path: string | null;
  preview_status: ThemePreviewStatus;
  error: string | null;
  version: number; claimed_at: string | null; created_at: string; updated_at: string;
}
/** What claim_next_theme_preview() returns to the PC (null = nothing to do). */
export interface ThemePreviewClaim { theme: ReelThemeRow }
/**
 * The camera move per line (reel_scenes_motion_check). New scripts only use push_in / pull_out / hold (008); the pans,
 * tilts and punch stay valid for rows written before 008 (the render plays them as push_in / pull_out).
 */
export const REEL_MOTIONS = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "punch", "hold"] as const;
export type ReelMotion = (typeof REEL_MOTIONS)[number];
/** The moves the script engine assigns from migration 008 on. */
export const REEL_MOTIONS_V2 = ["push_in", "pull_out", "hold"] as const;
/** A line's shot size (migration 008, reel_scenes_shot_size_check). */
export const REEL_SHOT_SIZES = ["wide", "medium", "close", "detail", "pov", "broll"] as const;
export type ReelShotSize = (typeof REEL_SHOT_SIZES)[number];
/** Who is in a line's picture (migration 008, reel_scenes_subject_check): mom = the parent, baby = the child. */
export const REEL_SUBJECTS = ["mom", "baby", "both", "object", "none"] as const;
export type ReelSubject = (typeof REEL_SUBJECTS)[number];
/** Reel lifecycle (migration 005). script = waiting for review; queued..rendering = the PC is working on it. */
export type ReelStatus = "script" | "queued" | "voicing" | "imaging" | "rendering" | "ready" | "needs_attention" | "failed";
export type ReelSceneStatus = "pending" | "queued" | "generating" | "done" | "failed" | "skipped";
/** The script's two characters (reels.doll_cast); the short tags (playbook v2) are absent on older reels. */
export interface ReelCast {
  adult: string; child: string; adult_tag?: string; child_tag?: string;
  /** The child's age phrase put first in every picture of the child ("a 10-month-old baby boy"); absent on older reels. */
  child_age?: string;
}
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
  /** Migration 006 (absent before it runs): the narrator (null = settings.reel_voice_id). */
  voice_id?: string | null;
  /** Migration 006: null = music not made yet; '' = the music step failed (voice only); else `<id>/music-v<n>.flac`. */
  music_path?: string | null;
  /** Migration 007 (absent before it runs): the visual theme (null = settings.reel_theme_id). */
  theme_id?: ReelThemeId | null;
  /** Migration 008 (absent before it runs): the hook card shown over the first 3.5 s (null = none). */
  hook_text?: string | null;
  /** Migration 009 (absent before it runs): the post caption written after the script and its hashtags (null = none yet). */
  caption?: string | null; hashtags?: string | null;
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
  /** Migration 007 (absent before it runs): the line's feeling, body language + hands, framing (all null until the script sets them). */
  emotion?: string | null; action?: string | null; shot?: string | null;
  /** Migration 007: a key line (gets the 'punch' emphasis); default false. */
  key_moment?: boolean;
  /** Migration 007: the camera move the render uses; null = the render picks one. */
  motion?: ReelMotion | null;
  /** Migration 008 (absent before it runs): the shot size and who is in the picture (null on older lines). */
  shot_size?: ReelShotSize | null; subject?: ReelSubject | null;
  /** Migration 008: a stressed word / short phrase of the narration (verbatim) that gets an instant punch-in; null = none. */
  punch?: string | null;
  /** Migration 008: a time jump before this line (the render dissolves into it); default false. */
  time_jump?: boolean;
  /** Migration 012 (absent before it runs): the guide styles' "The feeling is …" phrase (null = from the emotion). */
  feeling?: string | null;
  /** Migration 012: Red Thread's thread state for this line (null = from the emotion). */
  thread?: ReelThread | null;
  created_at: string; updated_at: string;
}
/** What claim_next_reel_step(p_no_comfy) returns to the PC (null = nothing to do). */
export interface ReelStepClaim {
  /** music (006) runs under the reel status 'voicing'. */
  step: "voice" | "timing" | "music" | "image" | "render";
  reel: ReelRow;
  scene: ReelSceneRow | null;
}
export interface WorkerStatusRow {
  id: 1; last_seen: string | null; comfyui_ok: boolean; gpu: string | null; current_card_id: string | null;
  worker_version: string | null; message: string | null; updated_at: string;
}
