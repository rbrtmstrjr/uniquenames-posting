import type { Gender } from "@/lib/db/types";
import { NAME_RE, normalizeQuotes } from "@/lib/names/bulk-paste";

export interface ThemeInput { title: string; gender: Gender; backdrop: string; outfit: string; props: string; lighting: string; palette: string }
export interface SettingsInput { caption_template: string; hashtags: string; handle: string; min_images: number; max_images: number; sound_on: boolean }

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
  return null;
}
