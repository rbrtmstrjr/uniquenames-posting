import type { Gender, NameRow, NameStyle } from "@/lib/db/types";
import { FALLBACK_CATEGORY, MEANING_CATEGORIES, isMeaningCategory, type MeaningCategory } from "@/lib/names/categories";
import type { PackPdf, PdfGender } from "@/packs/types";

// What goes into the names PDF, in order (owner, 2026-10-11): per gender section (Girl, then Boy for "Both") ->
// Single names, then Combo (two-word) names -> the meaning groups in their fixed order -> names A to Z. Pure.

/** Only names the owner approved: never pending (AI ideas waiting for approval) or skipped. */
export const PDF_STATUSES = ["available", "reserved", "used"] as const;

export interface PdfName { name: string; meaning: string; origin: string | null }
export interface PdfCategory { category: MeaningCategory; label: string; names: PdfName[] }
export interface PdfStyle { style: NameStyle; title: string; intro: string; categories: PdfCategory[]; count: number }
export interface PdfSection { gender: Gender; label: string; styles: PdfStyle[]; count: number }

export type PdfSourceName = Pick<NameRow, "name" | "meaning" | "gender" | "style" | "status"> &
  Partial<Pick<NameRow, "origin" | "meaning_category">>;

export const pdfGenders = (g: PdfGender): Gender[] => (g === "both" ? ["girl", "boy"] : [g]);
const STYLES: NameStyle[] = ["single", "two-word"];
const byName = (a: PdfName, b: PdfName) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name);

/** Is this name in the PDF at all (approved)? */
export const sellable = (n: Pick<NameRow, "status">) => (PDF_STATUSES as readonly string[]).includes(n.status);

/**
 * The PDF's sections. `categoryOf` gives a name's group when the row has none (sorted in memory before migration
 * 018); a name without one goes to the fallback group. Empty styles and groups are left out.
 */
export function planSections(
  names: readonly PdfSourceName[], gender: PdfGender, copy: Pick<PackPdf, "genderLabels" | "styles">,
  labels: Readonly<Record<MeaningCategory, string>>, categoryOf: (n: PdfSourceName) => MeaningCategory | null = () => null,
): PdfSection[] {
  const sections: PdfSection[] = [];
  for (const g of pdfGenders(gender)) {
    const styles: PdfStyle[] = [];
    for (const style of STYLES) {
      const groups = new Map<MeaningCategory, PdfName[]>();
      for (const n of names) {
        if (n.gender !== g || n.style !== style || !sellable(n)) continue;
        const c = isMeaningCategory(n.meaning_category) ? n.meaning_category : (categoryOf(n) ?? FALLBACK_CATEGORY);
        const origin = (n.origin ?? "").trim();
        const list = groups.get(c) ?? [];
        list.push({ name: n.name.trim(), meaning: n.meaning.trim(), origin: origin || null });
        groups.set(c, list);
      }
      const categories = MEANING_CATEGORIES.filter((c) => groups.has(c))
        .map((c) => ({ category: c, label: labels[c], names: groups.get(c)!.sort(byName) }));
      const count = categories.reduce((s, c) => s + c.names.length, 0);
      if (count) styles.push({ style, ...copy.styles[style], categories, count });
    }
    const count = styles.reduce((s, x) => s + x.count, 0);
    if (count) sections.push({ gender: g, label: copy.genderLabels[g], styles, count });
  }
  return sections;
}

/** How many names each part of a pick would have (the export dialog's preview). */
export function previewCounts(names: readonly Pick<NameRow, "gender" | "style" | "status">[]): Record<Gender, Record<NameStyle, number>> {
  const out: Record<Gender, Record<NameStyle, number>> = { girl: { single: 0, "two-word": 0 }, boy: { single: 0, "two-word": 0 } };
  for (const n of names) if (sellable(n)) out[n.gender][n.style] += 1;
  return out;
}

/** Fill {count}, {buyer}, {year}, {page} and {handle} in a pack text. */
export function fillCopy(text: string, v: Partial<Record<"count" | "buyer" | "year" | "page" | "handle", string | number>>): string {
  return text.replace(/\{(count|buyer|year|page|handle)\}/g, (m, k: keyof typeof v) => (v[k] === undefined ? m : String(v[k])));
}

/** "unique-names-girl-names-2026-10-11-k7p2.pdf": the page, the pick, the day and a short random tag (never from the password). */
export function pdfFileName(prefix: string, gender: PdfGender, day: string, tag: string): string {
  const what = gender === "both" ? "girl-and-boy-names" : `${gender}-names`;
  return `${prefix}-${what}-${day}-${tag.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}.pdf`;
}
