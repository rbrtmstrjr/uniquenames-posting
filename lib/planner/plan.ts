import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { buildCaption } from "./caption";
import { buildPrompt } from "./prompt";
import { hashSeed, seededRandom, shuffle } from "./random";
import { BABY_SHOTS, buildShots } from "./shots";

export interface PlannedCard { position: number; name_id: string; name: string; meaning: string; shot: string; prompt: string; seed: number }
export interface PlanInput {
  request: { gender: Gender; style: NameStyle; count: number | null; postDate: string };
  names: NameRow[]; themes: ThemeRow[];
  settings: Pick<SettingsRow, "caption_template" | "hashtags" | "min_images" | "max_images">;
  themeId?: string;
}
export type PlanResult = { ok: true; theme_id: string; caption: string; cards: PlannedCard[] } | { ok: false; reason: string };

const lower = (s: string) => s.trim().toLowerCase();
const themeComplete = (t: ThemeRow) => [t.title, t.backdrop, t.outfit, t.props, t.lighting, t.palette].every((x) => x && x.trim());
const cardSeed = (date: string, name: string, k: number) => hashSeed(`${date}|${name}`) * 4096 + k;

export function availablePool(names: NameRow[], gender: Gender, style: NameStyle): NameRow[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = lower(n.name);
    const ok = key && n.meaning.trim() && n.gender === gender && n.style === style && n.status === "available" && !seen.has(key);
    if (ok) seen.add(key);
    return ok;
  });
}

export function nextTheme(themes: ThemeRow[], gender: Gender): ThemeRow | undefined {
  return themes
    .filter((t) => t.gender === gender && t.status === "available" && themeComplete(t))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))[0];
}

export function planPost(input: PlanInput): PlanResult {
  const { request: r, settings: s } = input;
  const label = r.gender;
  const pool = availablePool(input.names, r.gender, r.style);
  if (pool.length < s.min_images) {
    return { ok: false, reason: `Only ${pool.length} unused ${label} ${r.style} names are left; a post needs at least ${s.min_images}. Add names on the Names page.` };
  }
  let theme: ThemeRow | undefined;
  if (input.themeId) {
    theme = input.themeId ? input.themes.find((t) => t.id === input.themeId) : undefined;
    if (!theme || theme.gender !== r.gender || theme.status !== "available" || !themeComplete(theme)) {
      return { ok: false, reason: "That theme is not available for a " + label + " post. Pick another theme." };
    }
  } else {
    theme = nextTheme(input.themes, r.gender);
    if (!theme) return { ok: false, reason: `No unused ${label} theme is left. Add a theme on the Themes page.` };
  }
  const rng = seededRandom(hashSeed(`${r.postDate}|${r.gender}|${r.style}`));
  const want = r.count ?? s.min_images + Math.floor(rng() * (s.max_images - s.min_images + 1));
  if (r.count !== null && (r.count < s.min_images || r.count > s.max_images)) {
    return { ok: false, reason: `Number of cards must be ${s.min_images} to ${s.max_images}.` };
  }
  const chosen = shuffle(pool, rng).slice(0, Math.min(want, pool.length));
  const shots = buildShots(chosen.length, seededRandom(hashSeed(`${r.postDate}|${r.gender}|${r.style}|shots`)));
  const cards = chosen.map((n, k) => ({
    position: k + 1, name_id: n.id, name: n.name.trim(), meaning: n.meaning.trim(), shot: shots[k],
    prompt: buildPrompt(theme!, shots[k], r.gender), seed: cardSeed(r.postDate, n.name, k),
  }));
  return { ok: true, theme_id: theme.id, caption: buildCaption(r.gender, s), cards };
}

export interface ExtraCardInput {
  theme: ThemeRow; gender: Gender; style: NameStyle; names: NameRow[]; usedNameIds: string[]; nextPosition: number; salt: string;
}
export type ExtraCardResult = { ok: true; card: PlannedCard } | { ok: false; reason: string };

export function planExtraCard(i: ExtraCardInput): ExtraCardResult {
  const pool = availablePool(i.names, i.gender, i.style).filter((n) => !i.usedNameIds.includes(n.id));
  if (!pool.length) return { ok: false, reason: `No unused ${i.gender} ${i.style} names left. Add names on the Names page.` };
  const rng = seededRandom(hashSeed(i.salt));
  const pick = pool[Math.floor(rng() * pool.length)];
  const shot = BABY_SHOTS[1 + Math.floor(rng() * (BABY_SHOTS.length - 1))];
  return {
    ok: true,
    card: { position: i.nextPosition, name_id: pick.id, name: pick.name.trim(), meaning: pick.meaning.trim(), shot,
      prompt: buildPrompt(i.theme, shot, i.gender), seed: cardSeed(i.salt, pick.name, i.nextPosition) },
  };
}
