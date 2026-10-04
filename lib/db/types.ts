export type Gender = "boy" | "girl";
export type NameStyle = "two-word" | "single";
export type NameStatus = "available" | "reserved" | "used" | "skip";
export type ThemeStatus = "available" | "used" | "archived";
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
  width: number; height: number; sound_on: boolean; updated_at: string;
}
export interface WorkerStatusRow {
  id: 1; last_seen: string | null; comfyui_ok: boolean; gpu: string | null; current_card_id: string | null;
  worker_version: string | null; message: string | null; updated_at: string;
}
