import "server-only";
import { randomBytes } from "node:crypto";
import type { NichePack, ShopProduct } from "@/packs/types";
import { isMeaningCategory } from "@/lib/names/categories";
import { pdfFileName, planSections, type PdfSourceName } from "@/lib/pdf/plan";
import { newOwnerPassword } from "@/lib/pdf/password";
import { renderNamesPdf } from "@/lib/pdf/render";

// A buyer's PDF: the same builder as Names > Export PDF, stamped "Prepared for <name> (<email>)" on every page and
// encrypted with the order's own password. Names the owner has not sorted yet go to the last meaning group ("More
// Beautiful Names"); the public route never calls the AI (the Orders page reminds the owner to sort them).

export interface ShopPdfName { name: string; meaning: string; gender: string; style: string; status: string; origin: string | null; meaning_category: string | null }

/** "Maria Santos (maria@example.com)", cut to the PDF's 120 characters. */
export function buyerStamp(name: string, email: string): string {
  const full = `${name} (${email})`;
  return full.length <= 120 ? full : name.slice(0, 120);
}

export async function buildShopPdf(i: { pack: NichePack; product: ShopProduct; buyerName: string; email: string; password: string; names: ShopPdfName[]; now: Date }) {
  const rows: PdfSourceName[] = i.names
    .filter((n) => (n.gender === "girl" || n.gender === "boy") && (n.style === "single" || n.style === "two-word"))
    .map((n) => ({
      name: n.name, meaning: n.meaning, gender: n.gender as "girl" | "boy", style: n.style as "single" | "two-word",
      status: n.status as PdfSourceName["status"], origin: n.origin, meaning_category: isMeaningCategory(n.meaning_category) ? n.meaning_category : null,
    }));
  const sections = planSections(rows, i.product, i.pack.pdf, i.pack.nameCategories);
  const count = sections.reduce((s, x) => s + x.count, 0);
  if (!count) return { ok: false as const, error: "There are no names in this edition yet." };
  const rendered = await renderNamesPdf({
    sections, gender: i.product, buyer: buyerStamp(i.buyerName, i.email), edition: i.now,
    pack: { pdf: i.pack.pdf, name: i.pack.brand.name, handle: i.pack.brand.handle },
    passwords: { user: i.password, owner: newOwnerPassword() },
  });
  const fileName = pdfFileName(i.pack.brand.zipPrefix, i.product, i.now.toISOString().slice(0, 10), randomBytes(3).toString("hex"));
  return { ok: true as const, pdf: rendered.pdf, fileName, count, pages: rendered.pages };
}
