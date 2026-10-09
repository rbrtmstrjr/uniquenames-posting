import type { Gender, NameRow, NameStyle, SettingsRow, ThemeRow } from "@/lib/db/types";
import { buildCaption } from "./caption";
import { buildCtaPrompt, buildPrompt, ctaShot, pickSubject, randomSubject, type Subject } from "./prompt";
import { hashSeed, seededRandom, shuffle } from "./random";
import { buildMixedShotSpecs, buildShots, dealAges, sessionShots, shotSpec, type ShotSpec } from "./shots";
import { SUBJECT_AGES, type AgeChoice } from "./age";

/** One key per post for its child (look, and session for older posts): add-a-card reuses it so extra cards match. */
export const subjectKey = (postDate: string, gender: Gender, style: NameStyle) => `${postDate}|${gender}|${style}`;

export interface PlannedCard { position: number; name_id: string; name: string; meaning: string; shot: string; prompt: string; seed: number }
export interface PlanInput {
  request: {
    gender: Gender; style: NameStyle; count: number | null; postDate: string;
    /** The child's age from Today. "random" = its own child per card; undefined/null = the original one-baby plan. */
    age?: AgeChoice | null;
  };
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
  const key = subjectKey(r.postDate, r.gender, r.style);
  const shotRng = seededRandom(hashSeed(`${key}|shots`));
  let frames: { shot: string; subject?: Subject }[];
  if (r.age === "random") {
    // Its own child per baby card, the ages dealt so the post shows a real spread.
    const ageRng = seededRandom(hashSeed(`${key}|ages`));
    const ages = dealAges(chosen.length, ageRng);
    frames = buildMixedShotSpecs(chosen.length, ages, shotRng).map((f) =>
      ({ shot: f.spec.text, subject: f.age ? randomSubject(f.age, ageRng) : undefined }));
  } else {
    const subject = pickSubject(key, r.age ?? undefined);
    frames = buildShots(chosen.length, shotRng, subject.session).map((shot) => ({ shot, subject }));
  }
  const cards = chosen.map((n, k) => ({
    position: k + 1, name_id: n.id, name: n.name.trim(), meaning: n.meaning.trim(), shot: frames[k].shot,
    prompt: buildPrompt(theme!, frames[k].shot, r.gender, frames[k].subject), seed: cardSeed(r.postDate, n.name, k),
  }));
  return { ok: true, theme_id: theme.id, caption: buildCaption(r.gender, s), cards };
}

export interface ExtraCardInput {
  theme: ThemeRow; gender: Gender; style: NameStyle; names: NameRow[]; usedNameIds: string[]; nextPosition: number; salt: string;
  /** subjectKey(post_date, gender, style) of the post, so the extra card shows the same baby. */
  subjectKey?: string;
  /** The post's subject_age: random = a new child of a random age; a fixed age = the post's child; null = the original baby. */
  age?: AgeChoice | null;
  /** The shot text of every card already in the post, so the new card never repeats one. */
  usedShots?: string[];
}
export type ExtraCardResult = { ok: true; card: PlannedCard } | { ok: false; reason: string };

/**
 * The shot for an added card. Same set + same child + same shot makes a near-copy of an
 * existing card (seeds alone barely change Z-Image's framing), so: never the cover, never a
 * shot the post already has, and an angle the post hasn't used yet when one is left. Once the
 * library runs out, the least-used shot.
 */
export function pickExtraShot(lib: ShotSpec[], usedShots: string[], rng: () => number): ShotSpec {
  const pool = lib.slice(1);
  const usedAngles = new Set(usedShots.map((s) => shotSpec(s)).filter((s) => s && s.kind === "baby").map((s) => s!.angle));
  const fresh = pool.filter((s) => !usedShots.includes(s.text));
  const freshAngle = fresh.filter((s) => !usedAngles.has(s.angle));
  const pick = (from: ShotSpec[]) => from[Math.floor(rng() * from.length)];
  if (freshAngle.length) return pick(freshAngle);
  if (fresh.length) return pick(fresh);
  const uses = (s: ShotSpec) => usedShots.filter((u) => u === s.text).length;
  const least = Math.min(...pool.map(uses));
  return pick(pool.filter((s) => uses(s) === least));
}

export function planExtraCard(i: ExtraCardInput): ExtraCardResult {
  const pool = availablePool(i.names, i.gender, i.style).filter((n) => !i.usedNameIds.includes(n.id));
  if (!pool.length) return { ok: false, reason: `No unused ${i.gender} ${i.style} names left. Add names on the Names page.` };
  const rng = seededRandom(hashSeed(i.salt));
  const pick = pool[Math.floor(rng() * pool.length)];
  const subject = i.age === "random"
    ? randomSubject(SUBJECT_AGES[Math.floor(rng() * SUBJECT_AGES.length)], rng)
    : pickSubject(i.subjectKey ?? i.salt, i.age ?? undefined);
  const shot = pickExtraShot(sessionShots(subject.session), i.usedShots ?? [], rng).text;
  return {
    ok: true,
    card: { position: i.nextPosition, name_id: pick.id, name: pick.name.trim(), meaning: pick.meaning.trim(), shot,
      prompt: buildPrompt(i.theme, shot, i.gender, subject), seed: cardSeed(i.salt, pick.name, i.nextPosition) },
  };
}

export interface CtaCardInput {
  theme: ThemeRow; gender: Gender;
  /** subjectKey(post_date, gender, style) of the post, so a fixed-age post shows its own child. */
  subjectKey: string;
  /** The post's subject_age: random = a child of a random age; a fixed age = the post's child; null = the original baby. */
  age?: AgeChoice | null;
  /** The post id: one stable seed per post. */
  salt: string;
  position: number;
  /** The message stamped on the card (resolved, "/" = line break). */
  text: string;
}
export interface PlannedCtaCard { kind: "cta"; position: number; name: string; meaning: ""; shot: string; prompt: string; seed: number }

/** The closing "follow" card (migration 010): the post's set and child, the message as its text, no meaning. */
export function planCtaCard(i: CtaCardInput): PlannedCtaCard {
  const rng = seededRandom(hashSeed(`${i.salt}|cta`));
  const subject = i.age === "random"
    ? randomSubject(SUBJECT_AGES[Math.floor(rng() * SUBJECT_AGES.length)], rng)
    : pickSubject(i.subjectKey, i.age ?? undefined);
  return {
    kind: "cta", position: i.position, name: i.text, meaning: "", shot: ctaShot(subject.session),
    prompt: buildCtaPrompt(i.theme, i.gender, subject), seed: cardSeed(i.salt, "cta", 0) + 1,
  };
}
