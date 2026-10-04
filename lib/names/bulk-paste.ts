import type { Gender, NameStyle } from "@/lib/db/types";

export const NAME_RE = /^\p{L}+(?:[ '\-.]\p{L}+)*$/u;

/** iPhone "smart punctuation": curly/modifier apostrophes become ', curly double quotes are dropped. */
export const normalizeQuotes = (s: string): string =>
  s.replace(/[‘’‛ʼ]/g, "'").replace(/[“”„]/g, "");

export interface BulkRow { name: string; meaning: string; gender: Gender; style: NameStyle }
export interface BulkIssue { line: number; text: string; reason: string }

export function parseBulkNames(text: string, defaults: { gender: Gender }) {
  const rows: BulkRow[] = [];
  const issues: BulkIssue[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t) return;
    const m = t.match(/^(.+?)\s*(?:\s[-–—]\s|:|\|)\s*(.+)$/);
    if (!m) { issues.push({ line, text: t, reason: "Missing meaning. Use: Name - meaning" }); return; }
    const name = normalizeQuotes(m[1]).replace(/\s+/g, " ").trim();
    const meaning = m[2].replace(/\s+/g, " ").trim().toLowerCase();
    if (name.length > 40) { issues.push({ line, text: t, reason: "Name is longer than 40 characters." }); return; }
    if (!NAME_RE.test(name)) { issues.push({ line, text: t, reason: "Name can only have letters, spaces, hyphens and apostrophes." }); return; }
    if (!meaning) { issues.push({ line, text: t, reason: "Missing meaning. Use: Name - meaning" }); return; }
    if (meaning.length > 80) { issues.push({ line, text: t, reason: "Meaning is longer than 80 characters." }); return; }
    const key = name.toLowerCase();
    if (seen.has(key)) { issues.push({ line, text: t, reason: "Duplicate of another line in this paste." }); return; }
    seen.add(key);
    rows.push({ name, meaning, gender: defaults.gender, style: name.split(" ").length > 1 ? "two-word" : "single" });
  });
  return { rows, issues };
}
