import type { Gender, SettingsRow } from "@/lib/db/types";

export function buildCaption(gender: Gender, s: Pick<SettingsRow, "caption_template" | "hashtags">): string {
  const lines = [s.caption_template.replace(/\{gender\}/g, gender)];
  if (s.hashtags.trim()) lines.push("", s.hashtags.trim());
  return lines.join("\n");
}
