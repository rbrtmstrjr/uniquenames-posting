// Autopilot's name themes (migration 022, settings.autopilot_name_themes): after Z the name flow goes through them, one
// per day, then back to A. One per line, in order: "Title" or "Title (a hint for the AI)". Pure: used by the website,
// the actions and the Autopilot page.

export const NAME_THEME_MAX = 60;
export const NAME_THEMES_MAX = 30;
export const NAME_THEMES_TEXT_MAX = 2000;

export const DEFAULT_NAME_THEMES = [
  "Unique and modern", "Biblical", "Soft and cool", "Short and sweet", "Classic and timeless",
  "Nature-inspired", "Royal and elegant", "Strong and brave", "Heavenly (stars, sky, light)",
] as const;

export interface NameTheme { title: string; hint: string | null }

/** "Heavenly (stars, sky, light)" -> { title: "Heavenly", hint: "stars, sky, light" }; null for a blank or too-long line. */
export function parseNameTheme(line: string): NameTheme | null {
  const clean = line.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(clean);
  const title = (m ? m[1] : clean).trim();
  const hint = m ? m[2].trim() || null : null;
  if (!title || title.length > NAME_THEME_MAX) return null;
  return { title, hint };
}

/** The settings text as a list: blank and too-long lines dropped, a repeated title (any case) kept once. */
export function parseNameThemes(text: string | null | undefined): NameTheme[] {
  const out: NameTheme[] = [];
  for (const raw of (text ?? DEFAULT_NAME_THEMES.join("\n")).split(/\r?\n/)) {
    const t = parseNameTheme(raw);
    if (t && !out.some((o) => o.title.toLowerCase() === t.title.toLowerCase())) out.push(t);
  }
  return out.slice(0, NAME_THEMES_MAX);
}

/** Why the owner's list can't be saved, or null. */
export function nameThemesProblem(text: string): string | null {
  if (text.length > NAME_THEMES_TEXT_MAX) return `Keep the list under ${NAME_THEMES_TEXT_MAX} characters.`;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "Add at least one name theme.";
  if (lines.length > NAME_THEMES_MAX) return `Keep it to ${NAME_THEMES_MAX} name themes.`;
  const bad = lines.find((l) => !parseNameTheme(l));
  if (bad) return `"${bad.slice(0, 30)}…" is too long: keep each name theme under ${NAME_THEME_MAX} characters (the part before the brackets).`;
  return null;
}

/** "Biblical" -> "#biblicalnames"; "Strong names" -> "#strongnames". */
export function nameThemeTag(title: string): string {
  const core = title.toLowerCase().replace(/[^a-z]/g, "");
  return `#${core.endsWith("names") ? core : `${core}names`}`;
}

/** The label a name-theme post shows ("Biblical names"); null on any other post. */
export function nameThemeLabel(p: { name_theme?: string | null }): string | null {
  const t = p.name_theme?.trim();
  if (!t) return null;
  return /names$/i.test(t) ? t : `${t} names`;
}
