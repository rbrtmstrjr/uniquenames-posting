import "server-only";
import PDFDocument from "pdfkit";
import type { PackPdf, PdfGender } from "@/packs/types";
import { fillCopy, type PdfName, type PdfSection } from "./plan";
import { pdfFontPath } from "./fonts";
import { divider, heart, logo, ornament, sparkle, sprig } from "./ornaments";

// The names PDF itself (brief 2026-10-11-names-pdf): cover, welcome, contents with page numbers, the names (per gender
// -> single, then combo -> meaning groups -> A to Z) in two columns, a thank-you back page; "Prepared for <buyer> · page
// n of N" and a soft diagonal "Prepared for <buyer>" on every page. Encrypted with AES-256 (PDF 1.7 extension level 3):
// the buyer's open password, a different random owner password, printing allowed, copying and changing not.
// Every text drawn is also recorded in `trace` (page + kind + text), which the tests read: the PDF's own text is
// encrypted and font-encoded.

export const PAGE_SIZES: Readonly<Record<PackPdf["pageSize"], readonly [number, number]>> = { A4: [595.28, 841.89], LETTER: [612, 792] };

/** What the buyer may do once the PDF is open: print it (full quality); not copy, change, annotate or reassemble it. */
export const PDF_PERMISSIONS: PDFKit.DocumentPermissions = {
  printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false,
  contentAccessibility: false, documentAssembly: false,
};

export interface PdfPasswords { user: string; owner: string }

/** The pdfkit document options: page size, AES-256 (pdfVersion "1.7ext3" = /V 5 /R 5 AESV3), both passwords, the rights. */
export function pdfDocOptions(pageSize: PackPdf["pageSize"], pw: PdfPasswords, info: PDFKit.DocumentInfo, font: string): PDFKit.PDFDocumentOptions {
  if (!pw.user || !pw.owner || pw.user === pw.owner) throw new Error("The PDF needs an open password and a different owner password.");
  return {
    size: [...PAGE_SIZES[pageSize]], margin: 0, bufferPages: true, autoFirstPage: false, font,
    pdfVersion: "1.7ext3", userPassword: pw.user, ownerPassword: pw.owner, permissions: PDF_PERMISSIONS,
    info, displayTitle: true, lang: "en",
  };
}

export type TraceKind =
  | "cover" | "welcome" | "contents" | "contents-row" | "running" | "gender" | "style" | "style-intro" | "category" | "name" | "meaning" | "origin"
  | "thanks" | "footer" | "watermark";
export interface TraceItem { page: number; kind: TraceKind; text: string }
export interface ContentsRow { level: 0 | 1 | 2; label: string; count?: number; page: number }

export interface RenderInput {
  sections: PdfSection[];
  gender: PdfGender;
  buyer: string;
  /** The edition's month and year (the day the PDF is made). */
  edition: Date;
  pack: { pdf: PackPdf; name: string; handle: string };
  passwords: PdfPasswords;
}
export interface RenderResult { pdf: Buffer; pages: number; trace: TraceItem[]; contents: ContentsRow[] }

/** "Prepared for Jane · page 3 of 24" (every page's footer). */
export const footerText = (buyer: string, page: number, pages: number) => `Prepared for ${buyer} · page ${page} of ${pages}`;
export const watermarkText = (buyer: string) => `Prepared for ${buyer}`;
export const editionText = (d: Date) => `${d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()} edition`;

const ROW_H: Record<ContentsRow["level"], number> = { 0: 34, 1: 26, 2: 19 };

/** Where each contents row goes: its page (0 = the first contents page) and y. Pure; the same layout counts and draws. */
export function layoutContents(rows: readonly ContentsRow[], firstTop: number, nextTop: number, bottom: number): { page: number; y: number }[] {
  const out: { page: number; y: number }[] = [];
  let page = 0;
  let y = firstTop;
  rows.forEach((r, i) => {
    // a gender or style row never sits alone at the bottom of a page
    const need = ROW_H[r.level] + (r.level < 2 && i + 1 < rows.length ? ROW_H[rows[i + 1].level] : 0);
    if (y + need > bottom) { page += 1; y = nextTop; }
    out.push({ page, y });
    y += ROW_H[r.level];
  });
  return out;
}

/** Split entries (heights) into two columns, the first never shorter: the smallest page height that holds them all. */
export function balanceColumns(h: readonly number[]): { split: number; height: number } {
  const total = h.reduce((a, b) => a + b, 0);
  let best = { split: h.length, height: total };
  let left = 0;
  for (let k = 0; k <= h.length; k++) {
    const height = Math.max(left, total - left);
    if (left >= total - left && height < best.height) best = { split: k, height };
    if (k < h.length) left += h[k];
  }
  return best;
}

class Book {
  readonly doc: PDFKit.PDFDocument;
  readonly W: number;
  readonly H: number;
  readonly M = 58;
  readonly top = 66;
  readonly bottom: number;
  readonly gutter = 26;
  readonly trace: TraceItem[] = [];
  page = 0;
  private chunks: Buffer[] = [];
  private done: Promise<Buffer>;

  constructor(readonly i: RenderInput) {
    const p = i.pack.pdf;
    [this.W, this.H] = PAGE_SIZES[p.pageSize];
    this.bottom = this.H - 64;
    const title = `${p.collection} — ${p.titles[i.gender]}`;
    this.doc = new PDFDocument(pdfDocOptions(p.pageSize, i.passwords,
      { Title: title, Author: i.pack.name, Subject: `Prepared for ${i.buyer}`, Creator: i.pack.name, Producer: i.pack.name, Keywords: "baby names, name meanings" },
      pdfFontPath(p.fonts.body)));
    this.doc.registerFont("display", pdfFontPath(p.fonts.display));
    this.doc.registerFont("body", pdfFontPath(p.fonts.body));
    this.doc.registerFont("bold", pdfFontPath(p.fonts.bodyBold));
    if (p.fonts.script) this.doc.registerFont("script", pdfFontPath(p.fonts.script));
    this.done = new Promise((resolve, reject) => {
      this.doc.on("data", (b: Buffer) => this.chunks.push(b));
      this.doc.on("end", () => resolve(Buffer.concat(this.chunks)));
      this.doc.on("error", reject);
    });
  }

  get c() { return this.i.pack.pdf.colors; }
  get p() { return this.i.pack.pdf; }
  get cw() { return this.W - 2 * this.M; }
  get colW() { return (this.cw - this.gutter) / 2; }

  newPage(paper = false) {
    this.doc.addPage({ size: [this.W, this.H], margin: 0 });
    this.page = this.doc.bufferedPageRange().count;
    if (paper) this.doc.rect(0, 0, this.W, this.H).fill(this.c.paper);
  }

  goto(page: number) {
    this.doc.switchToPage(page - 1);
    this.page = page;
  }

  font(f: "display" | "body" | "bold" | "script", size: number) {
    this.doc.font(f).fontSize(size);
    return this;
  }

  /** Measure a text's height in a font at a width. */
  h(s: string, f: "display" | "body" | "bold" | "script", size: number, width: number, lineGap = 0) {
    return this.font(f, size).doc.heightOfString(s, { width, lineGap });
  }

  /** Draw a text (and trace it); returns its height. */
  text(kind: TraceKind, s: string, x: number, y: number, o: {
    f: "display" | "body" | "bold" | "script"; size: number; color: string; width?: number; align?: "left" | "center" | "right";
    spacing?: number; lineGap?: number; opacity?: number;
  }) {
    const { doc } = this.font(o.f, o.size);
    doc.save();
    doc.fillColor(o.color);
    if (o.opacity !== undefined) doc.fillOpacity(o.opacity);
    const opts = { width: o.width, align: o.align ?? "left", characterSpacing: o.spacing ?? 0, lineGap: o.lineGap ?? 0, lineBreak: o.width !== undefined };
    const height = o.width !== undefined ? doc.heightOfString(s, opts) : doc.currentLineHeight(true);
    doc.text(s, x, y, opts);
    doc.restore();
    this.trace.push({ page: this.page, kind, text: s });
    return height;
  }

  end() {
    this.doc.end();
    return this.done;
  }
}

/** The names PDF as bytes, its page count, the trace of every text drawn and the contents rows (with their pages). */
export async function renderNamesPdf(input: RenderInput): Promise<RenderResult> {
  const b = new Book(input);
  const { p, c } = b;
  const total = input.sections.reduce((s, x) => s + x.count, 0);
  const year = input.edition.getUTCFullYear();
  const vars = { count: total.toLocaleString("en-US"), buyer: input.buyer, year, page: input.pack.name, handle: input.pack.handle };

  cover(b, total);
  welcome(b, vars);

  // Contents: its rows first (pages filled in after the names are laid out), so its page count is known now.
  const rows: ContentsRow[] = [];
  for (const s of input.sections) {
    rows.push({ level: 0, label: s.label, count: s.count, page: 0 });
    for (const st of s.styles) {
      rows.push({ level: 1, label: st.title, count: st.count, page: 0 });
      for (const cat of st.categories) rows.push({ level: 2, label: cat.label, count: cat.names.length, page: 0 });
    }
  }
  const contentsTop = b.top + 92;
  const placed = layoutContents(rows, contentsTop, b.top + 10, b.bottom);
  const contentsPages = (placed.at(-1)?.page ?? 0) + 1;
  const firstContents = b.page + 1;
  for (let k = 0; k < contentsPages; k++) b.newPage();

  let r = 0;
  for (const s of input.sections) {
    rows[r++].page = b.page + 1;
    for (const st of s.styles) {
      rows[r++].page = b.page + 1;
      namesBlock(b, s, st, rows, r);
      r += st.categories.length;
    }
  }
  thanks(b, vars);

  contents(b, rows, placed, firstContents);
  const pages = b.doc.bufferedPageRange().count;
  for (let n = 1; n <= pages; n++) {
    b.goto(n);
    watermark(b);
    footer(b, n, pages);
  }
  const pdf = await b.end();
  return { pdf, pages, trace: b.trace, contents: rows };
}

function frame(b: Book) {
  const { doc } = b;
  doc.save();
  doc.lineWidth(0.9).strokeColor(b.c.accent).strokeOpacity(0.7).roundedRect(22, 22, b.W - 44, b.H - 44, 14).stroke();
  doc.lineWidth(0.4).strokeColor(b.c.accent).strokeOpacity(0.45).roundedRect(29, 29, b.W - 58, b.H - 58, 10).stroke();
  doc.restore();
  for (const [x, y] of [[48, 48], [b.W - 48, 48], [48, b.H - 48], [b.W - 48, b.H - 48]]) sparkle(doc, x, y, 5, b.c.accent);
}

function cover(b: Book, total: number) {
  const { doc, p, c, W, H } = b;
  b.newPage(true);
  frame(b);
  doc.save();
  doc.fillOpacity(0.7).circle(W / 2, 205, 96).fill(c.accentSoft);
  doc.restore();
  sprig(doc, W / 2 - 104, 268, 84, c);
  sprig(doc, W / 2 + 104, 268, 84, c);
  logo(doc, p.logo, W / 2, 200, 104, c);
  let y = 330;
  y += b.text("cover", p.collection.toUpperCase(), 60, y, { f: "bold", size: 10, color: c.accent, width: W - 120, align: "center", spacing: 2.4 }) + 12;
  y += b.text("cover", p.titles[b.i.gender], 70, y, { f: "display", size: 40, color: c.ink, width: W - 140, align: "center" });
  if (p.scriptLine && p.fonts.script) y += b.text("cover", p.scriptLine, 70, y - 6, { f: "script", size: 30, color: c.accent, width: W - 140, align: "center" }) - 4;
  y += 16;
  divider(doc, p.ornament, W / 2, y, 170, c, 15);
  y += 26;
  y += b.text("cover", p.subtitle, 110, y, { f: "body", size: 12, color: c.muted, width: W - 220, align: "center", lineGap: 4 }) + 20;
  const stats = `${total.toLocaleString("en-US")} names · grouped by meaning`;
  y += b.text("cover", stats.toUpperCase(), 60, y, { f: "bold", size: 9.5, color: c.accent, width: W - 120, align: "center", spacing: 1.6 }) + 6;
  b.text("cover", editionText(b.i.edition), 60, y, { f: "body", size: 10, color: c.muted, width: W - 120, align: "center" });
  const by = H - 168;
  heart(doc, W / 2, by - 14, 9, c.accent);
  b.text("cover", "PREPARED FOR", 60, by, { f: "bold", size: 8, color: c.muted, width: W - 120, align: "center", spacing: 2.2 });
  b.text("cover", b.i.buyer, 70, by + 16, { f: "display", size: 19, color: c.ink, width: W - 140, align: "center" });
}

function welcome(b: Book, vars: Record<string, string | number>) {
  const { doc, p, c, M, cw } = b;
  const w = p.welcome;
  b.newPage();
  let y = b.top - 6;
  ornament(doc, p.ornament, M + 9, y + 18, 16, c);
  b.text("welcome", w.heading, M + 28, y, { f: "display", size: 30, color: c.ink });
  y += 52;
  y += b.text("welcome", fillCopy(w.intro, vars), M, y, { f: "body", size: 11, color: c.ink, width: cw, lineGap: 3.5 }) + 18;

  y += b.text("welcome", w.insideHeading.toUpperCase(), M, y, { f: "bold", size: 9, color: c.accent, spacing: 2 }) + 6;
  for (const line of w.inside) {
    doc.circle(M + 4, y + 7.5, 2.2).fill(c.accent);
    y += b.text("welcome", fillCopy(line, vars), M + 16, y, { f: "body", size: 10.5, color: c.ink, width: cw - 16, lineGap: 2 }) + 5;
  }
  y += 16;

  y += b.text("welcome", w.tipsHeading, M, y, { f: "display", size: 20, color: c.ink }) + 8;
  w.tips.forEach((t, k) => {
    doc.circle(M + 11, y + 10, 11).fill(c.accentSoft);
    b.text("welcome", String(k + 1), M, y + 3, { f: "bold", size: 10.5, color: c.accent, width: 22, align: "center" });
    const th = b.text("welcome", t.title, M + 32, y, { f: "bold", size: 10.5, color: c.ink, width: cw - 32 });
    y += th + b.text("welcome", fillCopy(t.text, vars), M + 32, y + th, { f: "body", size: 10, color: c.muted, width: cw - 32, lineGap: 2 }) + 9;
  });
  y += 10;

  const body = fillCopy(w.trust, vars);
  const boxH = 30 + b.h(body, "body", 9.8, cw - 40, 2.5) + 12;
  doc.roundedRect(M, y, cw, boxH, 10).fill(c.accentSoft);
  sparkle(doc, M + cw - 20, y + 18, 5, c.accent);
  b.text("welcome", w.trustHeading.toUpperCase(), M + 20, y + 14, { f: "bold", size: 8.5, color: c.accent, spacing: 1.8 });
  b.text("welcome", body, M + 20, y + 30, { f: "body", size: 9.8, color: c.ink, width: cw - 40, lineGap: 2.5 });
  y += boxH + 14;
  b.text("welcome", fillCopy(p.copyright, vars), M, Math.max(y, b.bottom - 22), { f: "body", size: 8.5, color: c.muted, width: cw, align: "center" });
}

function contents(b: Book, rows: ContentsRow[], placed: { page: number; y: number }[], first: number) {
  const { doc, p, c, M, cw } = b;
  b.goto(first);
  ornament(doc, p.ornament, M + 9, b.top + 12, 16, c);
  b.text("contents", p.contentsHeading, M + 28, b.top - 6, { f: "display", size: 30, color: c.ink });
  doc.save();
  doc.lineWidth(0.6).strokeColor(c.line).moveTo(M, b.top + 50).lineTo(M + cw, b.top + 50).stroke();
  doc.restore();
  rows.forEach((r, k) => {
    const at = placed[k];
    if (b.page !== first + at.page) {
      b.goto(first + at.page);
      b.text("contents", `${p.contentsHeading} (continued)`.toUpperCase(), M, 36, { f: "bold", size: 7.5, color: c.muted, spacing: 1.6 });
    }
    const y = at.y;
    const num = String(r.page);
    if (r.level === 0) {
      b.text("contents-row", r.label, M, y, { f: "display", size: 17, color: c.accent });
      b.text("contents-row", num, M + cw - 60, y + 3, { f: "bold", size: 11, color: c.accent, width: 60, align: "right" });
      return;
    }
    const indent = r.level === 1 ? 10 : 26;
    const label = r.level === 1 ? r.label.toUpperCase() : r.label;
    const f = r.level === 1 ? "bold" : "body";
    const size = r.level === 1 ? 9.5 : 10.5;
    b.text("contents-row", label, M + indent, y, { f, size, color: c.ink, spacing: r.level === 1 ? 1.4 : 0 });
    const lw = b.font(f, size).doc.widthOfString(label, { characterSpacing: r.level === 1 ? 1.4 : 0 });
    const countText = r.count !== undefined ? `${r.count}` : "";
    if (countText) b.text("contents-row", countText, M + indent + lw + 6, y + 1.5, { f: "body", size: 8, color: c.muted });
    const cwid = countText ? b.font("body", 8).doc.widthOfString(countText) + 6 : 0;
    const numW = b.font("bold", 10).doc.widthOfString(num);
    // dotted leader
    doc.save();
    doc.lineWidth(0.8).strokeColor(c.line).dash(0.8, { space: 3 })
      .moveTo(M + indent + lw + cwid + 8, y + size * 0.95).lineTo(M + cw - numW - 8, y + size * 0.95).stroke();
    doc.undash();
    doc.restore();
    b.text("contents-row", num, M + cw - 60, y, { f: "bold", size: 10, color: r.level === 1 ? c.accent : c.ink, width: 60, align: "right" });
  });
}

function runningHead(b: Book, s: PdfSection, title: string) {
  const { doc, c, M, cw } = b;
  b.text("running", `${s.label}  ·  ${title}`.toUpperCase(), M, 36, { f: "bold", size: 7.5, color: c.muted, spacing: 1.6 });
  b.text("running", b.i.pack.name, M, 36, { f: "body", size: 7.5, color: c.muted, width: cw, align: "right" });
  doc.save();
  doc.lineWidth(0.5).strokeColor(c.line).moveTo(M, 50).lineTo(M + cw, 50).stroke();
  doc.restore();
}

const NAME_SIZE = 14;
const MEANING_SIZE = 9.3;
/** Poppins and Nunito have tall lines: a wrapped meaning sits a little tighter. */
const MEANING_GAP = -1.5;
const ENTRY_GAP = 10;
const CHIP_SIZE = 6.4;

function chipWidth(b: Book, origin: string) {
  return b.font("bold", CHIP_SIZE).doc.widthOfString(origin.toUpperCase(), { characterSpacing: 0.6 }) + 10;
}

/** An entry's layout: its height, and whether the origin chip fits on the name's line. */
function measure(b: Book, n: PdfName) {
  const nameH = b.font("display", NAME_SIZE).doc.currentLineHeight(true);
  const meaningH = b.h(n.meaning, "body", MEANING_SIZE, b.colW, MEANING_GAP);
  let chipInline = true;
  if (n.origin) {
    const nameW = b.font("display", NAME_SIZE).doc.widthOfString(n.name);
    chipInline = nameW + 8 + chipWidth(b, n.origin) <= b.colW;
  }
  return { nameH, meaningH, chipInline, h: nameH + meaningH + (n.origin && !chipInline ? 14 : 0) + ENTRY_GAP };
}

function entry(b: Book, n: PdfName, x: number, y: number) {
  const { doc, c } = b;
  const m = measure(b, n);
  b.text("name", n.name, x, y, { f: "display", size: NAME_SIZE, color: c.ink });
  const drawChip = (cx: number, cy: number, origin: string) => {
    const w = chipWidth(b, origin);
    doc.roundedRect(cx, cy, w, 11, 5.5).fill(c.accentSoft);
    b.text("origin", origin.toUpperCase(), cx + 5, cy + 2.4, { f: "bold", size: CHIP_SIZE, color: c.accent, spacing: 0.6 });
  };
  if (n.origin && m.chipInline) drawChip(x + b.font("display", NAME_SIZE).doc.widthOfString(n.name) + 8, y + m.nameH / 2 - 6.5, n.origin);
  b.text("meaning", n.meaning, x, y + m.nameH - 1, { f: "body", size: MEANING_SIZE, color: c.muted, width: b.colW, lineGap: MEANING_GAP });
  if (n.origin && !m.chipInline) drawChip(x, y + m.nameH + m.meaningH + 1, n.origin);
}

function categoryHeader(b: Book, label: string, count: number, y: number, continued = false) {
  const { doc, p, c, M, cw } = b;
  if (continued) {
    b.text("category", `${label} (continued)`, M, y, { f: "bold", size: 8.5, color: c.accent, spacing: 0.6 });
    return 22;
  }
  ornament(doc, p.ornament, M + 8, y + 11, 14, c);
  b.text("category", label, M + 24, y, { f: "display", size: 17, color: c.accent });
  const lw = b.font("display", 17).doc.widthOfString(label);
  b.text("category", `${count} ${count === 1 ? "name" : "names"}`, M + 24 + lw + 10, y + 6, { f: "body", size: 8.5, color: c.muted });
  doc.save();
  doc.lineWidth(0.5).strokeColor(c.line).moveTo(M, y + 27).lineTo(M + cw, y + 27).stroke();
  doc.restore();
  return 38;
}

const sum = (l: { h: number }[]) => l.reduce((a, e) => a + e.h, 0);

/** How many entries (heights) fit one column of `avail` points; `force` = at least one (a fresh column must move on). */
export function fit(h: readonly number[], avail: number, force: boolean): number {
  let k = 0;
  let used = 0;
  while (k < h.length && used + h[k] <= avail) used += h[k++];
  return force && k === 0 && h.length ? 1 : k;
}

function namesBlock(b: Book, s: PdfSection, st: PdfSection["styles"][number], rows: ContentsRow[], firstCatRow: number) {
  const { doc, p, c, M, cw, W } = b;
  b.newPage();
  // Style header: the gender eyebrow, the style's title, its intro and a divider.
  let y = b.top - 8;
  b.text("gender", s.label.toUpperCase(), M, y, { f: "bold", size: 9, color: c.accent, width: cw, align: "center", spacing: 2.6 });
  y += 18;
  y += b.text("style", st.title, M, y, { f: "display", size: 30, color: c.ink, width: cw, align: "center" }) + 2;
  y += b.text("style-intro", st.intro, M + 40, y, { f: "body", size: 10, color: c.muted, width: cw - 80, align: "center", lineGap: 2 }) + 12;
  divider(doc, p.ornament, W / 2, y + 4, 150, c, 13);
  y += 28;

  const continuePage = (label: string) => {
    b.newPage();
    runningHead(b, s, st.title);
    return b.top + categoryHeader(b, label, 0, b.top, true);
  };

  st.categories.forEach((cat, k) => {
    const items = cat.names.map((n) => ({ n, h: measure(b, n).h }));
    if (y + 38 + items[0].h > b.bottom) {
      b.newPage();
      runningHead(b, s, st.title);
      y = b.top;
    }
    rows[firstCatRow + k].page = b.page;
    y += categoryHeader(b, cat.label, cat.names.length, y);
    let rest = items;
    while (rest.length) {
      const avail = b.bottom - y;
      const bal = balanceColumns(rest.map((e) => e.h));
      if (bal.height <= avail) {
        place(b, rest.slice(0, bal.split), M, y);
        place(b, rest.slice(bal.split), M + b.colW + b.gutter, y);
        y += bal.height + 8;
        break;
      }
      // Fill both columns of this page, then go on on the next one.
      const a = fit(rest.map((e) => e.h), avail, true);
      const after = rest.slice(a);
      const bn = fit(after.map((e) => e.h), avail, false);
      place(b, rest.slice(0, a), M, y);
      place(b, after.slice(0, bn), M + b.colW + b.gutter, y);
      const usedH = Math.max(sum(rest.slice(0, a)), sum(after.slice(0, bn)));
      rest = after.slice(bn);
      y = rest.length ? continuePage(cat.label) : y + usedH + 8;
    }
  });

  function place(bk: Book, list: { n: PdfName; h: number }[], x: number, y0: number) {
    let yy = y0;
    for (const e of list) {
      entry(bk, e.n, x, yy);
      yy += e.h;
    }
  }
}

function thanks(b: Book, vars: Record<string, string | number>) {
  const { doc, p, c, W, H } = b;
  b.newPage(true);
  frame(b);
  doc.save();
  doc.fillOpacity(0.7).circle(W / 2, H * 0.3, 80).fill(c.accentSoft);
  doc.restore();
  logo(doc, p.logo, W / 2, H * 0.3, 92, c);
  let y = H * 0.3 + 98;
  y += b.text("thanks", p.thanks.heading, 70, y, { f: "display", size: 38, color: c.ink, width: W - 140, align: "center" }) + 4;
  if (p.scriptLine && p.fonts.script) y += b.text("thanks", p.scriptLine, 70, y - 8, { f: "script", size: 28, color: c.accent, width: W - 140, align: "center" });
  y += 10;
  for (const line of p.thanks.lines) y += b.text("thanks", fillCopy(line, vars), 100, y, { f: "body", size: 12, color: c.muted, width: W - 200, align: "center", lineGap: 3 }) + 4;
  y += 18;
  divider(doc, p.ornament, W / 2, y, 170, c, 15);
  y += 26;
  b.text("thanks", fillCopy(p.thanks.follow, vars), 90, y, { f: "bold", size: 11.5, color: c.accent, width: W - 180, align: "center" });
  b.text("thanks", fillCopy(p.copyright, vars), 90, H - 112, { f: "body", size: 8.5, color: c.muted, width: W - 180, align: "center", lineGap: 2 });
}

function watermark(b: Book) {
  const { doc, W, H, c } = b;
  const text = watermarkText(b.i.buyer);
  const diag = Math.hypot(W, H) * 0.62;
  const size = Math.max(14, Math.min(44, diag / Math.max(1, b.font("bold", 1).doc.widthOfString(text))));
  const width = b.font("bold", size).doc.widthOfString(text);
  doc.save();
  doc.rotate(-Math.atan2(H, W) * (180 / Math.PI), { origin: [W / 2, H / 2] });
  b.text("watermark", text, W / 2 - width / 2, H / 2 - size / 2, { f: "bold", size, color: c.accent, opacity: 0.06 });
  doc.restore();
}

function footer(b: Book, page: number, pages: number) {
  const { doc, c, M, cw, H } = b;
  doc.save();
  doc.lineWidth(0.5).strokeColor(c.line).moveTo(M + cw / 2 - 40, H - 50).lineTo(M + cw / 2 + 40, H - 50).stroke();
  doc.restore();
  b.text("footer", footerText(b.i.buyer, page, pages), M, H - 42, { f: "body", size: 8, color: c.muted, width: cw, align: "center" });
}
