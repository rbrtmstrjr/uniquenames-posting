import "server-only";
import { randomBytes } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import type { NichePack, PdfGender } from "@/packs/types";
import { categorizeNames } from "@/lib/ai/categorize";
import { chunks } from "@/lib/actions/helpers";
import { fail, type ActionResult } from "@/lib/actions/result";
import { isMeaningCategory, type MeaningCategory } from "@/lib/names/categories";
import { PDF_STATUSES, pdfFileName, pdfGenders, planSections, type PdfSourceName } from "./plan";
import { newOwnerPassword, newPassword } from "./password";
import { renderNamesPdf } from "./render";
import { NEEDS_018, missing018 } from "./migration";

export { NEEDS_018, missing018 };

// Names > Export PDF: load every approved name, make sure each has its meaning group (sorted once by the AI and
// stored; before migration 018 sorted in memory for this PDF only), build the encrypted PDF with a NEW password and
// log it (buyer, pick, count, password, file name, pack) so the owner can see it and send the password again.

type Sb = Awaited<ReturnType<typeof createClient>>;
export type ExportRow = PdfSourceName & { id: string };

export const BUYER_MAX = 120;

/** The export form's fields, checked: a buyer (name or email, shown on every page) and the girl / boy pick. */
export function validateExport(raw: unknown): { ok: true; buyer: string; gender: PdfGender } | { ok: false; error: string } {
  const r = (raw ?? {}) as { buyer?: unknown; gender?: unknown };
  const buyer = typeof r.buyer === "string" ? r.buyer.replace(/\s+/g, " ").trim() : "";
  if (buyer.length < 2) return { ok: false, error: "Type the buyer's name or email." };
  if (buyer.length > BUYER_MAX) return { ok: false, error: `Keep the buyer's name under ${BUYER_MAX} characters.` };
  if (/[\u0000-\u001f\u007f]/.test(buyer)) return { ok: false, error: "The buyer's name has characters a PDF can't show." };
  if (r.gender !== "girl" && r.gender !== "boy" && r.gender !== "both") return { ok: false, error: "Pick Girl, Boy or Both." };
  return { ok: true, buyer, gender: r.gender };
}

/** Every approved name (all pages of the table), and whether the meaning_category column exists. */
export async function loadSellableNames(sb: Sb): Promise<{ ok: true; rows: ExportRow[]; hasColumn: boolean } | { ok: false; error: string }> {
  const rows: ExportRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("names").select("*").in("status", [...PDF_STATUSES]).order("name").order("id").range(from, from + 999);
    if (error) return { ok: false, error: error.message };
    rows.push(...((data ?? []) as ExportRow[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  // A select("*") row carries the column (null when not sorted) once 018 ran; an empty table cannot tell, and needs no sorting.
  return { ok: true, rows, hasColumn: rows.length === 0 || rows.some((r) => "meaning_category" in r) };
}

/** Store sorted groups, one update per group; a name the owner sorted meanwhile keeps the owner's choice. */
export async function storeGroups(sb: Sb, groups: Map<string, MeaningCategory>): Promise<string | null> {
  const byGroup = new Map<MeaningCategory, string[]>();
  for (const [id, g] of groups) byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  for (const [g, ids] of byGroup) {
    for (const part of chunks(ids, 100)) {
      const { error } = await sb.from("names").update({ meaning_category: g }).in("id", part).is("meaning_category", null);
      if (error) return error.message;
    }
  }
  return null;
}

export interface ExportResult { pdf: Buffer; password: string; fileName: string; count: number; pages: number; logged: boolean; warning: string | null }

export async function buildExport(i: { sb: Sb; pack: NichePack; buyer: string; gender: PdfGender; now: Date }): Promise<ActionResult<ExportResult>> {
  const loaded = await loadSellableNames(i.sb);
  if (!loaded.ok) return fail(loaded.error);
  const genders = pdfGenders(i.gender);
  const rows = loaded.rows.filter((r) => genders.includes(r.gender));
  if (!rows.length) return fail(i.gender === "both" ? "There are no approved names yet." : `There are no approved ${i.gender} names yet.`);

  // Names without a group: sorted now (stored when the column exists; in memory only before 018).
  const unsorted = rows.filter((r) => !isMeaningCategory(r.meaning_category));
  let groups = new Map<string, MeaningCategory>();
  if (unsorted.length) {
    const r = await categorizeNames(unsorted.map((n) => ({ id: n.id, name: n.name, meaning: n.meaning })));
    groups = r.groups;
    if (loaded.hasColumn && groups.size) {
      const err = await storeGroups(i.sb, groups);
      if (err) console.warn("names PDF: could not store the meaning groups:", err);
    }
    if (r.error) return fail(`Couldn't sort the names by meaning: ${r.error} Try again.`);
  }

  const sections = planSections(rows, i.gender, i.pack.pdf, i.pack.nameCategories, (n) => groups.get((n as ExportRow).id) ?? null);
  const count = sections.reduce((s, x) => s + x.count, 0);
  const password = newPassword();
  const rendered = await renderNamesPdf({
    sections, gender: i.gender, buyer: i.buyer, edition: i.now,
    pack: { pdf: i.pack.pdf, name: i.pack.brand.name, handle: i.pack.brand.handle },
    passwords: { user: password, owner: newOwnerPassword() },
  });
  const fileName = pdfFileName(i.pack.brand.zipPrefix, i.gender, i.now.toISOString().slice(0, 10), randomBytes(3).toString("hex"));

  const { error } = await i.sb.from("exports").insert({ buyer: i.buyer, gender: i.gender, name_count: count, password, file_name: fileName, pack: i.pack.id });
  let warning: string | null = loaded.hasColumn ? null : NEEDS_018;
  if (error) warning = missing018(error) ? NEEDS_018 : `This PDF was not saved in Past exports (${error.message}). Copy its password now.`;
  return { ok: true, pdf: rendered.pdf, password, fileName, count, pages: rendered.pages, logged: !error, warning };
}
