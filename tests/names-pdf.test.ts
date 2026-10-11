import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packById, PACK_IDS } from "@/packs";
import { MEANING_CATEGORIES, categoryRank, isMeaningCategory } from "@/lib/names/categories";
import { fillCopy, pdfFileName, planSections, previewCounts, type PdfSourceName } from "@/lib/pdf/plan";
import { PASSWORD_ALPHABET, PASSWORD_RE, newOwnerPassword, newPassword } from "@/lib/pdf/password";
import {
  PDF_PERMISSIONS, balanceColumns, fit, footerText, layoutContents, pdfDocOptions, renderNamesPdf, watermarkText, type RenderResult,
} from "@/lib/pdf/render";
import { pdfFontPath, PDF_FONT_DIR } from "@/lib/pdf/fonts";
import { plainWordsProblem } from "@/lib/ai/plain-words";

// The sellable names PDF (brief 2026-10-11-names-pdf): what goes in and in which order, the passwords, and the PDF's
// structure (read from the renderer's trace: the PDF's own text is encrypted).

const UN = packById("unique-names");
const NN = packById("name-nest");
const N = (name: string, o: Partial<PdfSourceName> = {}): PdfSourceName =>
  ({ name, meaning: `meaning of ${name.toLowerCase()}`, gender: "girl", style: name.includes(" ") ? "two-word" : "single", status: "available", ...o });

const NAMES: PdfSourceName[] = [
  N("Wren", { meaning_category: "nature" }), N("Aster", { meaning_category: "nature", status: "used" }),
  N("Lucia", { meaning_category: "light", status: "reserved" }), N("Marina", { meaning_category: "water" }),
  N("Zuri", { meaning_category: null }), N("Pending", { status: "pending", meaning_category: "love" }),
  N("Skipped", { status: "skip", meaning_category: "love" }), N("Isla Fern", { meaning_category: "nature" }),
  N("Ada Rose", { meaning_category: "royal" }), N("Arlo", { gender: "boy", meaning_category: "strength" }),
  N("Ezra", { gender: "boy", meaning_category: "strength" }), N("Asher Reed", { gender: "boy", meaning_category: "love" }),
  N("Bram", { gender: "boy", meaning_category: "bogus" as never }),
];

describe("planSections: what goes in, in which order", () => {
  it("Both = Girl then Boy; single then combo; meaning groups in their fixed order; names A to Z; approved only", () => {
    const s = planSections(NAMES, "both", UN.pdf, UN.nameCategories);
    expect(s.map((x) => [x.gender, x.label, x.count])).toEqual([["girl", "Girl Names", 7], ["boy", "Boy Names", 4]]);
    expect(s[0].styles.map((x) => [x.style, x.title, x.count])).toEqual([["single", "Single Names", 5], ["two-word", "Combo Names", 2]]);
    expect(s[0].styles[0].categories.map((c) => [c.category, c.label, c.names.map((n) => n.name)])).toEqual([
      ["nature", "Nature & Flowers", ["Aster", "Wren"]], ["light", "Light, Sun & Stars", ["Lucia"]], ["water", "Water & Sea", ["Marina"]],
      ["more", "More Beautiful Names", ["Zuri"]],
    ]);
    expect(s[0].styles[1].categories.map((c) => c.category)).toEqual(["nature", "royal"]);
    // an unknown stored group goes to the fallback group too
    expect(s[1].styles[0].categories.map((c) => [c.category, c.names.map((n) => n.name)])).toEqual([["strength", ["Arlo", "Ezra"]], ["more", ["Bram"]]]);
    const all = JSON.stringify(s);
    expect(all).not.toMatch(/Pending|Skipped/);
  });

  it("one gender only; empty parts are left out; groups from memory when the column is missing (pre-018)", () => {
    const pre018 = NAMES.map(({ meaning_category: _m, ...n }) => n);
    const s = planSections(pre018, "boy", NN.pdf, NN.nameCategories, (n) => (n.name === "Arlo" ? "peace" : null));
    expect(s).toHaveLength(1);
    expect(s[0].styles.map((x) => x.title)).toEqual(["Single Names", "First & Middle Combos"]);
    expect(s[0].styles[0].categories.map((c) => [c.label, c.names.map((n) => n.name)])).toEqual([["Peace & Calm", ["Arlo"]], ["More Names We Love", ["Bram", "Ezra"]]]);
    expect(planSections(NAMES.filter((n) => n.style === "single"), "girl", UN.pdf, UN.nameCategories)[0].styles.map((x) => x.style)).toEqual(["single"]);
    expect(planSections([], "both", UN.pdf, UN.nameCategories)).toEqual([]);
  });

  it("keeps a name's origin (Name Nest chips) and trims texts", () => {
    const s = planSections([N(" Ada ", { style: "single", meaning: " noble one ", origin: "Germanic", meaning_category: "royal" }), N("Mia", { origin: " " })], "girl", NN.pdf, NN.nameCategories);
    expect(s[0].styles[0].categories.flatMap((c) => c.names)).toEqual([
      { name: "Ada", meaning: "noble one", origin: "Germanic" }, { name: "Mia", meaning: "meaning of mia", origin: null },
    ]);
  });

  it("previewCounts counts approved names per gender and style", () => {
    expect(previewCounts(NAMES as never)).toEqual({ girl: { single: 5, "two-word": 2 }, boy: { single: 3, "two-word": 1 } });
  });
});

describe("categories", () => {
  it("twelve groups, the fallback last; every pack words every group", () => {
    expect(MEANING_CATEGORIES).toHaveLength(12);
    expect(MEANING_CATEGORIES.at(-1)).toBe("more");
    expect(isMeaningCategory("nature")).toBe(true);
    expect(isMeaningCategory("Nature")).toBe(false);
    expect(categoryRank("bogus")).toBe(11);
    for (const id of PACK_IDS) {
      const labels = packById(id).nameCategories;
      expect(Object.keys(labels).sort()).toEqual([...MEANING_CATEGORIES].sort());
      expect(new Set(Object.values(labels)).size).toBe(12);
    }
  });
});

describe("copy helpers", () => {
  it("fills {count} {buyer} {year} {page} {handle}, leaves unknown ones", () => {
    expect(fillCopy("© {year} {page} for {buyer}: {count} names, {handle} {other}", { year: 2026, page: "Name Nest", buyer: "Jo", count: "1,204", handle: "@namenest" }))
      .toBe("© 2026 Name Nest for Jo: 1,204 names, @namenest {other}");
  });
  it("file names say the page, the pick and the day, never the password", () => {
    expect(pdfFileName("unique-names", "girl", "2026-10-11", "K7p2")).toBe("unique-names-girl-names-2026-10-11-k7p2.pdf");
    expect(pdfFileName("name-nest", "both", "2026-10-11", "ab-9")).toBe("name-nest-girl-and-boy-names-2026-10-11-ab9.pdf");
  });
});

describe("passwords", () => {
  it("12 easy-to-read characters in three groups, a new one every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const pw = newPassword();
      expect(pw).toMatch(PASSWORD_RE);
      expect(pw).not.toMatch(/[0O1lIio]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[2-9]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(500);
    expect(PASSWORD_ALPHABET).toHaveLength(55);
  });
  it("uses the given picker (deterministic in tests) and gives up instead of looping forever", () => {
    let i = 0;
    const seq = [0, 30, 50, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(newPassword(() => seq[i++ % seq.length])).toBe("Ag5B-CDEF-GHJK");
    expect(() => newPassword(() => 0)).toThrow(/Could not make a password/);
  });
  it("owner passwords are long, random and different", () => {
    const a = newOwnerPassword();
    expect(a).toMatch(/^[\w-]{32}$/);
    expect(newOwnerPassword()).not.toBe(a);
  });
});

describe("layout helpers", () => {
  it("balanceColumns: two columns, the first never shorter, as short as possible", () => {
    expect(balanceColumns([10, 10, 10, 10])).toEqual({ split: 2, height: 20 });
    expect(balanceColumns([10, 10, 10])).toEqual({ split: 2, height: 20 });
    expect(balanceColumns([30])).toEqual({ split: 1, height: 30 });
    expect(balanceColumns([])).toEqual({ split: 0, height: 0 });
  });
  it("fit: entries that fit a column; a fresh column always takes one", () => {
    expect(fit([10, 10, 10], 25, false)).toBe(2);
    expect(fit([40], 25, false)).toBe(0);
    expect(fit([40], 25, true)).toBe(1);
  });
  it("layoutContents: rows flow over pages; a gender / style row never ends a page", () => {
    const rows = [{ level: 0 as const, label: "Girl", page: 0 }, ...Array.from({ length: 6 }, () => ({ level: 2 as const, label: "x", page: 0 })),
      { level: 1 as const, label: "Combo", page: 0 }, { level: 2 as const, label: "y", page: 0 }];
    const placed = layoutContents(rows, 100, 50, 260);
    expect(placed.map((p) => p.page)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(placed[7]).toEqual({ page: 1, y: 50 });
  });
});

describe("pdfDocOptions: AES-256 with two different passwords, printing only", () => {
  it("asks pdfkit for PDF 1.7 extension level 3 (AESV3), the open + owner passwords and the rights", () => {
    const o = pdfDocOptions("LETTER", { user: "Kp7m-Xr4d-Tq9w", owner: "o".repeat(32) }, { Title: "t" }, "/f.ttf");
    expect(o).toMatchObject({ pdfVersion: "1.7ext3", userPassword: "Kp7m-Xr4d-Tq9w", ownerPassword: "o".repeat(32), size: [612, 792], bufferPages: true, font: "/f.ttf" });
    expect(o.permissions).toEqual({ printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: false, documentAssembly: false });
    expect(PDF_PERMISSIONS.copying).toBe(false);
    expect(pdfDocOptions("A4", { user: "a".repeat(12), owner: "b".repeat(32) }, {}, "/f.ttf").size).toEqual([595.28, 841.89]);
    expect(() => pdfDocOptions("A4", { user: "same-pass", owner: "same-pass" }, {}, "/f.ttf")).toThrow();
    expect(() => pdfDocOptions("A4", { user: "", owner: "x".repeat(32) }, {}, "/f.ttf")).toThrow();
  });
});

describe("fonts and licences", () => {
  it("every pack font is committed with its OFL licence", () => {
    const families: Record<string, string> = {
      Poppins: "Poppins", PlayfairDisplay: "PlayfairDisplay", DMSerifDisplay: "DMSerifDisplay", Nunito: "Nunito", GreatVibes: "GreatVibes",
    };
    for (const id of PACK_IDS) {
      for (const file of Object.values(packById(id).pdf.fonts).filter(Boolean) as string[]) {
        expect(existsSync(pdfFontPath(file))).toBe(true);
        const family = file.split("-")[0];
        const licence = join(PDF_FONT_DIR, `OFL-${families[family]}.txt`);
        expect(readFileSync(licence, "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
      }
    }
    expect(() => pdfFontPath("../secret.ttf")).toThrow();
    expect(() => pdfFontPath("Missing-Font.ttf")).toThrow(/missing/);
  });
});

describe("pack copy", () => {
  const texts = (id: (typeof PACK_IDS)[number]) => {
    const p = packById(id).pdf;
    return [p.collection, ...Object.values(p.titles), p.subtitle, p.scriptLine ?? "", ...Object.values(p.genderLabels),
      ...Object.values(p.styles).flatMap((s) => [s.title, s.intro]), p.welcome.heading, p.welcome.intro, p.welcome.insideHeading,
      ...p.welcome.inside, p.welcome.tipsHeading, ...p.welcome.tips.flatMap((t) => [t.title, t.text]), p.welcome.trustHeading,
      p.welcome.trust, p.contentsHeading, p.copyright, p.thanks.heading, ...p.thanks.lines, p.thanks.follow, ...Object.values(packById(id).nameCategories)];
  };
  it("page sizes: A4 for Unique Names, US Letter for Name Nest", () => {
    expect(UN.pdf.pageSize).toBe("A4");
    expect(NN.pdf.pageSize).toBe("LETTER");
  });
  it("placeholders are only the known ones; the copyright names the buyer and says personal use", () => {
    for (const id of PACK_IDS) {
      for (const t of texts(id)) expect(t.replace(/\{(count|buyer|year|page|handle)\}/g, "")).not.toMatch(/[{}]/);
      expect(packById(id).pdf.copyright).toMatch(/\{year\}.*\{page\}.*personal use by \{buyer\} only.*share or resell/);
      expect(packById(id).pdf.thanks.follow).toContain("{handle}");
    }
  });
  it("Unique Names speaks plain global English; Name Nest US English; never each other's names", () => {
    for (const t of texts("unique-names")) expect(plainWordsProblem(t)).toBeNull();
    for (const t of texts("name-nest")) expect(t).not.toMatch(/colour|favourite|mum\b|Unique Names|unique_names/i);
    for (const t of texts("unique-names")) expect(t).not.toMatch(/Name Nest|namenest/i);
  });
});

// ---------------------------------------------------------------- the PDF itself
const BUYER = "Jane Doe <jane@example.com>";
const many = (g: "girl" | "boy", n: number, style: "single" | "two-word"): PdfSourceName[] => Array.from({ length: n }, (_, i) => {
  const base = `${g === "girl" ? "Ari" : "Bo"}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
  return N(style === "two-word" ? `${base} Mae` : base, {
    gender: g, style, meaning_category: MEANING_CATEGORIES[i % 12], origin: i % 3 ? "Latin" : null,
    meaning: i % 5 ? "a short and kind meaning" : "a much longer meaning that wraps onto a second line in its narrow column",
  });
});
const FIX = [...many("girl", 90, "single"), ...many("girl", 40, "two-word"), ...many("boy", 70, "single"), ...many("boy", 25, "two-word")];

async function render(id: "unique-names" | "name-nest", gender: "girl" | "boy" | "both") {
  const pack = packById(id);
  return renderNamesPdf({
    sections: planSections(FIX, gender, pack.pdf, pack.nameCategories), gender, buyer: BUYER, edition: new Date("2026-10-11T00:00:00Z"),
    pack: { pdf: pack.pdf, name: pack.brand.name, handle: pack.brand.handle }, passwords: { user: "Kp7m-Xr4d-Tq9w", owner: "owner-password-xxxxxxxxxxxxxxxxxx" },
  });
}
const onPage = (r: RenderResult, page: number, kind?: string) => r.trace.filter((t) => t.page === page && (!kind || t.kind === kind)).map((t) => t.text);

describe("renderNamesPdf (Name Nest, Both)", async () => {
  const r = await render("name-nest", "both");
  const text = r.pdf.toString("latin1");

  it("is an encrypted PDF 1.7: AES-256 (V5 R5 AESV3), printing allowed, copying and changing not", () => {
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toMatch(/\/Encrypt \d+ 0 R/);
    expect(text).toMatch(/\/V 5/);
    expect(text).toMatch(/\/R 5/);
    expect(text).toMatch(/\/CFM \/AESV3/);
    const p = Number(text.match(/\/P (-?\d+)/)![1]);
    expect(p & 0b100).toBeTruthy(); // print
    expect(p & 0b100000000000).toBeTruthy(); // high-quality print
    expect(p & 0b1000).toBe(0); // modify
    expect(p & 0b10000).toBe(0); // copy
    expect(text).not.toContain("Jane Doe"); // strings are encrypted
    expect(text).toMatch(/\/MediaBox \[0 0 612 792\]/);
  });

  it("cover, welcome, contents, then the names, then the thank-you page", () => {
    expect(onPage(r, 1, "cover")).toEqual(expect.arrayContaining(["THE NAME NEST COLLECTION", "Baby Girl & Boy Names", "PREPARED FOR", BUYER, "October 2026 edition"]));
    expect(onPage(r, 1, "cover").join(" ")).toContain("225 NAMES");
    expect(onPage(r, 2, "welcome")).toEqual(expect.arrayContaining(["Welcome to the nest", "© 2026 Name Nest. For personal use by Jane Doe <jane@example.com> only. Please don't share or resell this list."]));
    expect(onPage(r, 2, "welcome").join(" ")).toContain("you'll find 225 names");
    expect(onPage(r, 3, "contents")).toEqual(["Contents"]);
    expect(onPage(r, r.pages, "thanks")).toEqual(expect.arrayContaining(["Thank you!", "Follow @namenest on Facebook for fresh name ideas every day."]));
  });

  it("names in order: Girl (single, combo) then Boy (single, combo); groups in order; A to Z inside", () => {
    const styles = r.trace.filter((t) => t.kind === "gender" || t.kind === "style").map((t) => t.text);
    expect(styles).toEqual(["GIRL NAMES", "Single Names", "GIRL NAMES", "First & Middle Combos", "BOY NAMES", "Single Names", "BOY NAMES", "First & Middle Combos"]);
    const names = r.trace.filter((t) => t.kind === "name").map((t) => t.text);
    const want = planSections(FIX, "both", NN.pdf, NN.nameCategories).flatMap((s) => s.styles.flatMap((st) => st.categories.flatMap((c) => c.names.map((n) => n.name))));
    expect(names).toHaveLength(225);
    expect(names).toEqual(want);
    expect(r.trace.filter((t) => t.kind === "origin").length).toBe(FIX.filter((n) => n.origin).length);
  });

  it("the contents lists every part with the page it starts on", () => {
    expect(r.contents.filter((c) => c.level === 0).map((c) => c.label)).toEqual(["Girl Names", "Boy Names"]);
    for (const row of r.contents.filter((c) => c.level === 2)) {
      expect(onPage(r, row.page, "category")).toContain(row.label);
    }
    for (const row of r.contents.filter((c) => c.level === 1)) expect(onPage(r, row.page, "style")).toContain(row.label);
    expect(r.trace.filter((t) => t.kind === "contents-row").map((t) => t.text)).toEqual(expect.arrayContaining(r.contents.map((c) => String(c.page))));
  });

  it("every page has the buyer's footer (page n of N) and the soft diagonal watermark", () => {
    for (let n = 1; n <= r.pages; n++) {
      expect(onPage(r, n, "footer")).toEqual([footerText(BUYER, n, r.pages)]);
      expect(onPage(r, n, "watermark")).toEqual([watermarkText(BUYER)]);
    }
    expect(footerText("Jo", 3, 24)).toBe("Prepared for Jo · page 3 of 24");
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(r.pages);
  });
});

describe("renderNamesPdf (Unique Names, Girl)", async () => {
  const r = await render("unique-names", "girl");
  it("A4, only the girl names, the Unique Names copy", () => {
    const text = r.pdf.toString("latin1");
    expect(text).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    expect(r.trace.filter((t) => t.kind === "name")).toHaveLength(130);
    expect(r.trace.filter((t) => t.kind === "gender").map((t) => t.text)).toEqual(["GIRL NAMES", "GIRL NAMES"]);
    expect(onPage(r, 1, "cover")).toEqual(expect.arrayContaining(["THE UNIQUE NAMES COLLECTION", "Baby Girl Names", "with love"]));
    expect(r.trace.filter((t) => t.kind === "style").map((t) => t.text)).toEqual(["Single Names", "Combo Names"]);
    expect(onPage(r, r.pages, "thanks")).toContain("Follow @unique_names on Facebook for new names every day.");
  });
});
