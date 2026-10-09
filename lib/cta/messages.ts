import type { Gender } from "@/lib/db/types";

// The closing "follow" card at the end of every post (migration 010). Its message rotates
// (Meta penalises repetitive content): one per line in Settings, "/" = a line break on the
// card, {gender} = boy or girl. The chosen text is stored on the card (cards.name).

/** The column default of settings.cta_messages (supabase/migrations/010_cta_card.sql). Keep the two in sync. */
export const CTA_MESSAGES_DEFAULT = [
  "Follow for more / baby name ideas.",
  "Follow us for a new / name list every day.",
  "Still searching? Follow for / more unique names.",
  "Save this post and follow / for more name ideas.",
  "More {gender} names tomorrow. / Follow so you don't miss them.",
  "Found a favorite? / Follow for more like it.",
  "Follow for a fresh list / of unique {gender} names.",
  "New names every day. / Follow along!",
].join("\n");

export const CTA_MAX_LINES = 3;
export const CTA_MESSAGE_MAX = 90;
export const CTA_MESSAGES_MAX = 30;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The lines of a message, split at "/" (empty pieces dropped). */
export const ctaLines = (text: string): string[] => text.split("/").map(squash).filter(Boolean);

/** {gender} -> boy / girl, and the line breaks tidied to " / ". */
export const resolveCta = (template: string, gender: Gender): string => ctaLines(template.replace(/\{gender\}/gi, gender)).join(" / ");

/** One message per line: trimmed, single spaces, blank lines and repeats (any case) dropped. */
export function parseCtaMessages(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const m = squash(raw);
    if (!m || seen.has(m.toLowerCase())) continue;
    seen.add(m.toLowerCase());
    out.push(m);
  }
  return out;
}

/** Why a message can't go on the card, or null. */
export function validateCtaMessage(message: string): string | null {
  const m = squash(message ?? "");
  const lines = ctaLines(m);
  if (!lines.length) return "Type a message.";
  if (m.length > CTA_MESSAGE_MAX) return `A message can be at most ${CTA_MESSAGE_MAX} characters.`;
  if (lines.length > CTA_MAX_LINES) return `A message can have at most ${CTA_MAX_LINES} lines (use / for a line break).`;
  if (/\{(?!gender\})[^}]*\}/i.test(m)) return "Only {gender} can be used in a message.";
  return null;
}

/** The Settings list: at least one message, at most CTA_MESSAGES_MAX, each one valid. */
export function validateCtaMessages(text: string): string | null {
  const list = parseCtaMessages(text);
  if (!list.length) return "Add at least one closing card message.";
  if (list.length > CTA_MESSAGES_MAX) return `Keep at most ${CTA_MESSAGES_MAX} closing card messages.`;
  for (const m of list) {
    const bad = validateCtaMessage(m);
    if (bad) return `"${m}": ${bad}`;
  }
  return null;
}

/** The messages in settings (migration 010), or the defaults when missing or empty. */
export function ctaMessagesOf(s: { cta_messages?: string | null }): string[] {
  const list = parseCtaMessages(s.cta_messages ?? "");
  return list.length ? list : parseCtaMessages(CTA_MESSAGES_DEFAULT);
}

const key = (s: string) => squash(s).toLowerCase();

/**
 * The next closing message: the least recently used of `templates` against `recent` (the texts
 * of the latest closing cards, newest first), never-used first in list order, and never the
 * previous post's while another one exists. Returns the text for `gender`.
 */
export function pickCtaMessage(templates: string[], recent: string[], gender: Gender): string {
  const list = templates.length ? templates : parseCtaMessages(CTA_MESSAGES_DEFAULT);
  const used = recent.map(key);
  const lastUse = (t: string) => {
    const forms = new Set([key(resolveCta(t, "boy")), key(resolveCta(t, "girl"))]);
    const i = used.findIndex((u) => forms.has(u));
    return i < 0 ? Infinity : i;
  };
  const ranked = list.map((t, i) => ({ t, i, last: lastUse(t) }));
  const pool = ranked.length > 1 ? ranked.filter((r) => r.last !== 0) : ranked;
  const best = (pool.length ? pool : ranked).reduce((a, b) => (b.last > a.last ? b : a));
  return resolveCta(best.t, gender);
}
