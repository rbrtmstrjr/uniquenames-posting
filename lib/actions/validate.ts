import { TEXT_POSITIONS, type Gender, type SettingsRow } from "@/lib/db/types";
import { NAME_RE, normalizeQuotes } from "@/lib/names/bulk-paste";
import { isFontId } from "@/lib/fonts/catalog";
import { SIZE_RANGES } from "@/lib/text/layout";
import { fontsOf } from "@/lib/fonts/post-fonts";
import { SPEED_MAX, SPEED_MIN, VOICE_ID_RE, VOLUME_MAX, VOLUME_MIN, roundSpeed } from "@/lib/reels/voices";

export interface ThemeInput { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string }
/** The card text settings (columns added by migration 002). */
export type TextSettings = Pick<SettingsRow, "title_font" | "meaning_font" | "mark_font" | "title_size" | "meaning_size" | "mark_size" | "text_position">;
export const TEXT_SETTING_KEYS = ["title_font", "meaning_font", "mark_font", "title_size", "meaning_size", "mark_size", "text_position"] as const satisfies readonly (keyof TextSettings)[];
export interface SettingsInput extends TextSettings { caption_template: string; hashtags: string; handle: string; min_images: number; max_images: number; sound_on: boolean; caption_ai: boolean;
  /** Reels (migration 005): most images per reel, 10–40. Optional so older callers still validate. */
  reel_max_images?: number;
  /** Reels narrator + music (migration 006). Optional: only sent once the database has them. */
  reel_voice_id?: string; reel_speed?: number; reel_music?: boolean; reel_music_volume?: number }
export const REEL_IMAGES_MIN = 10;
export const REEL_IMAGES_MAX = 40;
export const REEL_IMAGES_DEFAULT = 40;

const SIZE_LABEL = { title: "Name", meaning: "Meaning", mark: "Watermark" } as const;

/** Card text settings: catalog fonts, whole-number sizes in their ranges, a known position. */
export function validateTextSettings(t: TextSettings): string | null {
  for (const k of ["title_font", "meaning_font", "mark_font"] as const) {
    if (!isFontId(t[k])) return "Pick a font from the list.";
  }
  for (const key of ["title", "meaning", "mark"] as const) {
    const v = t[`${key}_size`];
    const r = SIZE_RANGES[key];
    if (!Number.isInteger(v) || v < r.min || v > r.max) return `${SIZE_LABEL[key]} size must be ${r.min} to ${r.max} px.`;
  }
  if (!(TEXT_POSITIONS as readonly string[]).includes(t.text_position)) return "Pick a text position.";
  return null;
}

export function validateName(name: string, meaning: string): string | null {
  const n = normalizeQuotes(name).replace(/\s+/g, " ").trim();
  if (!n) return "Type a name.";
  if (n.length > 40) return "Names can be at most 40 characters.";
  if (!NAME_RE.test(n)) return "Names can only have letters, spaces, hyphens and apostrophes.";
  const m = meaning.trim();
  if (!m) return "Type the meaning.";
  if (m.length > 80) return "Meanings can be at most 80 characters.";
  return null;
}

export function validateTheme(t: ThemeInput): string | null {
  for (const k of ["title", "backdrop", "outfit", "props", "lighting", "palette"] as const) {
    if (!t[k] || !t[k].trim()) return `Fill in ${k}.`;
  }
  if (t.title.trim().length > 60) return "Theme titles can be at most 60 characters.";
  if (t.gender !== "boy" && t.gender !== "girl") return "Pick Boy or Girl.";
  return null;
}

export function validateSettings(s: SettingsInput): string | null {
  if (!s.caption_template.trim()) return "The caption template cannot be empty.";
  if (!s.handle.trim()) return "The handle cannot be empty.";
  if (s.handle.length > 40) return "The handle can be at most 40 characters.";
  if (!Number.isInteger(s.min_images) || !Number.isInteger(s.max_images) || s.min_images < 1 || s.max_images > 30) return "Card counts must be 1 to 30.";
  if (s.min_images > s.max_images) return "The min card count cannot be above the max.";
  if (s.reel_max_images !== undefined && (!Number.isInteger(s.reel_max_images) || s.reel_max_images < REEL_IMAGES_MIN || s.reel_max_images > REEL_IMAGES_MAX))
    return `Images per reel must be ${REEL_IMAGES_MIN} to ${REEL_IMAGES_MAX}.`;
  if (s.reel_voice_id !== undefined && (typeof s.reel_voice_id !== "string" || !VOICE_ID_RE.test(s.reel_voice_id))) return "Pick a narrator voice from the list.";
  if (s.reel_speed !== undefined && (typeof s.reel_speed !== "number" || !Number.isFinite(s.reel_speed) || roundSpeed(s.reel_speed) < SPEED_MIN || roundSpeed(s.reel_speed) > SPEED_MAX))
    return `Narration speed must be ${SPEED_MIN.toFixed(2)}× to ${SPEED_MAX.toFixed(2)}×.`;
  if (s.reel_music !== undefined && typeof s.reel_music !== "boolean") return "Turn music on or off.";
  if (s.reel_music_volume !== undefined && (!Number.isInteger(s.reel_music_volume) || s.reel_music_volume < VOLUME_MIN || s.reel_music_volume > VOLUME_MAX))
    return `Music volume must be ${VOLUME_MIN} to ${VOLUME_MAX} %.`;
  // Fonts are not edited in Settings any more (picked per post on Today, never written by a
  // Settings save), so a stale/unknown font id must not block Save: normalise, don't reject.
  return validateTextSettings({ ...s, ...fontsOf(s) });
}
