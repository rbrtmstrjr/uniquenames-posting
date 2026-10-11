import "server-only";
import type { PackPdf } from "@/packs/types";

// The names PDF's little vector drawings (no image files): the two logos, the leaf sprig, the strawberry, the divider,
// a heart and a sparkle. Each one draws centred on (cx, cy) at a given size, and leaves the graphics state as it was.

type Doc = PDFKit.PDFDocument;
type Colors = PackPdf["colors"];

/** Draw `fn` in a box whose own units are `unit` points, with its origin moved to (x, y). */
function inBox(doc: Doc, x: number, y: number, unit: number, fn: () => void) {
  doc.save();
  doc.translate(x, y).scale(unit);
  fn();
  doc.restore();
}

/** One leaf from (0, 0) pointing along the x axis, `len` long. */
function leaf(doc: Doc, x: number, y: number, len: number, angle: number, color: string) {
  doc.save();
  doc.translate(x, y).rotate(angle);
  doc.path(`M0 0 C${len * 0.3} ${-len * 0.36} ${len * 0.72} ${-len * 0.34} ${len} 0 C${len * 0.72} ${len * 0.34} ${len * 0.3} ${len * 0.36} 0 0 Z`).fill(color);
  doc.restore();
}

/** A five-petal flower (the Unique Names ✿), petals in `petal`, a small heart in `heart`. */
export function flower(doc: Doc, cx: number, cy: number, r: number, petal: string, heart: string) {
  for (let i = 0; i < 5; i++) {
    doc.save();
    doc.rotate(i * 72, { origin: [cx, cy] });
    doc.ellipse(cx, cy - r * 0.55, r * 0.33, r * 0.5).fill(petal);
    doc.restore();
  }
  doc.circle(cx, cy, r * 0.2).fill(heart);
}

/** A small strawberry (the Name Nest berry): red body, cream seeds, two green leaves. `size` = its height. */
export function berry(doc: Doc, cx: number, cy: number, size: number, c: Colors) {
  const u = size / 56; // drawn in the mark's units: the berry spans y 16..72
  inBox(doc, cx - 48 * u, cy - 44 * u, u, () => {
    doc.path("M48 72 C33 63 25 50 27 39 C29 30 38 26 48 32 C58 26 67 30 69 39 C71 50 63 63 48 72 Z").fill(c.accent);
    for (const [x, y, a] of [[39, 44, -20], [48, 43, 0], [57, 44, 20], [43, 52, -12], [53, 52, 12]] as const) {
      doc.save();
      doc.rotate(a, { origin: [x, y] });
      doc.ellipse(x, y, 1.5, 2.3).fill(c.paper);
      doc.restore();
    }
    doc.path("M48 32 C44 23 36 22 31 25 C36 26 41 29 44 32 Z").fill(c.leaf);
    doc.path("M48 32 C52 23 60 22 65 25 C60 26 55 29 52 32 Z").fill(c.leaf);
    doc.lineWidth(3).lineCap("round").path("M48 33 C46 26 47 20 51 16").stroke(c.leaf);
  });
}

/** A leaf sprig: a curved stem with leaves on both sides. `w` = its width. */
export function sprig(doc: Doc, cx: number, cy: number, w: number, c: Colors) {
  const half = w / 2;
  doc.save();
  doc.lineWidth(Math.max(0.6, w / 70)).lineCap("round").strokeColor(c.leaf)
    .moveTo(cx - half, cy + w * 0.04).quadraticCurveTo(cx, cy - w * 0.08, cx + half, cy + w * 0.04).stroke();
  doc.restore();
  const len = w * 0.17;
  for (const t of [-0.32, 0, 0.32]) {
    const x = cx + t * w;
    const y = cy - w * 0.04 * (1 - Math.abs(t) * 2);
    leaf(doc, x, y, len, -50 + t * 30, c.leaf);
    leaf(doc, x, y, len * 0.9, 50 + t * 30, c.leaf);
  }
  leaf(doc, cx + half - 1, cy + w * 0.04, len * 0.8, -10, c.leaf);
  leaf(doc, cx - half + 1, cy + w * 0.04, len * 0.8, 190, c.leaf);
}

/** A four-point sparkle. */
export function sparkle(doc: Doc, cx: number, cy: number, r: number, color: string) {
  const k = r * 0.28;
  doc.path(`M${cx} ${cy - r} Q${cx + k} ${cy - k} ${cx + r} ${cy} Q${cx + k} ${cy + k} ${cx} ${cy + r} Q${cx - k} ${cy + k} ${cx - r} ${cy} Q${cx - k} ${cy - k} ${cx} ${cy - r} Z`).fill(color);
}

/** A small heart. `s` = its width. */
export function heart(doc: Doc, cx: number, cy: number, s: number, color: string) {
  const h = s / 2;
  doc.path(`M${cx} ${cy + h * 0.9} C${cx - h * 1.6} ${cy - h * 0.1} ${cx - h * 0.8} ${cy - h * 1.3} ${cx} ${cy - h * 0.45} ` +
    `C${cx + h * 0.8} ${cy - h * 1.3} ${cx + h * 1.6} ${cy - h * 0.1} ${cx} ${cy + h * 0.9} Z`).fill(color);
}

/** The pack's small ornament (the dividers and the group headers). */
export function ornament(doc: Doc, kind: PackPdf["ornament"], cx: number, cy: number, size: number, c: Colors) {
  if (kind === "berry") berry(doc, cx, cy, size, c);
  else {
    leaf(doc, cx - size * 0.18, cy, size * 0.5, 160, c.leaf);
    leaf(doc, cx + size * 0.18, cy, size * 0.5, 20, c.leaf);
    flower(doc, cx, cy, size * 0.36, c.accent, c.paper);
  }
}

/** A divider: a thin line, the ornament, a thin line. */
export function divider(doc: Doc, kind: PackPdf["ornament"], cx: number, cy: number, width: number, c: Colors, size = 14) {
  const gap = size * 0.95;
  doc.save();
  doc.lineWidth(0.6).strokeColor(c.accent).strokeOpacity(0.55);
  doc.moveTo(cx - width / 2, cy).lineTo(cx - gap, cy).stroke();
  doc.moveTo(cx + gap, cy).lineTo(cx + width / 2, cy).stroke();
  doc.restore();
  for (const s of [-1, 1]) doc.circle(cx + s * (width / 2 + 3), cy, 1.1).fill(c.accent);
  ornament(doc, kind, cx, cy, size, c);
}

/** The Unique Names logo: the brown rounded square with a cream flower (public/icon.svg). */
function flowerLogo(doc: Doc, cx: number, cy: number, size: number, c: Colors) {
  doc.roundedRect(cx - size / 2, cy - size / 2, size, size, size * 0.25).fill(c.accent);
  flower(doc, cx, cy, size * 0.3, c.paper, c.accent);
}

/** The Name Nest mark: the strawberry in its woven nest (public/packs/name-nest/mark.svg, drawn in its own units). */
function nestLogo(doc: Doc, cx: number, cy: number, size: number, c: Colors) {
  const deep = "#8E272F";
  const u = size / 104; // viewBox -4 6 104 88
  inBox(doc, cx - 52 * u + 4 * u, cy - 44 * u - 6 * u, u, () => {
    const bowl = "M5 57 C7 80 26 89 48 89 C70 89 89 80 91 57 C77 64 19 64 5 57 Z";
    doc.lineCap("round");
    doc.lineWidth(4).path("M9 57 C20 47 76 47 87 57").stroke(deep);
    doc.path("M48 72 C33 63 25 50 27 39 C29 30 38 26 48 32 C58 26 67 30 69 39 C71 50 63 63 48 72 Z").fill(c.accent);
    doc.save();
    doc.strokeOpacity(0.6).lineWidth(2.2).path("M37 37 C40 34 43 34 45 36").stroke(c.paper);
    doc.restore();
    for (const [x, y, a] of [[39, 44, -20], [48, 43, 0], [57, 44, 20], [43, 52, -12], [53, 52, 12]] as const) {
      doc.save();
      doc.rotate(a, { origin: [x, y] });
      doc.ellipse(x, y, 1.5, 2.3).fill(c.paper);
      doc.restore();
    }
    doc.path("M48 32 C44 23 36 22 31 25 C36 26 41 29 44 32 Z").fill(c.leaf);
    doc.path("M48 32 C52 23 60 22 65 25 C60 26 55 29 52 32 Z").fill(c.leaf);
    doc.lineWidth(3).path("M48 33 C46 26 47 20 51 16").stroke(c.leaf);
    doc.path(bowl).fill("#F6EEE4");
    doc.save();
    doc.path(bowl).clip();
    doc.lineWidth(2.4).strokeColor(deep);
    for (let x = -6; x <= 94; x += 10) {
      doc.path(`M${x} 58 C${x + 5} 68 ${x + 9} 78 ${x + 12} 92`).stroke();
      doc.path(`M${x + 12} 58 C${x + 7} 68 ${x + 3} 78 ${x} 92`).stroke();
    }
    doc.strokeOpacity(0.85).lineWidth(2.2).strokeColor(c.accent);
    doc.path("M4 68 C30 76 66 76 92 67").stroke();
    doc.path("M10 78 C34 85 62 85 86 77").stroke();
    doc.restore();
    doc.lineWidth(3.6).lineJoin("round").path(bowl).stroke(deep);
    doc.lineWidth(3).strokeColor(deep);
    for (const d of ["M6 58 L-1 53", "M8 63 L0 65", "M90 58 L97 52", "M88 64 L96 66"]) doc.path(d).stroke();
  });
}

export function logo(doc: Doc, kind: PackPdf["logo"], cx: number, cy: number, size: number, c: Colors) {
  if (kind === "nest") nestLogo(doc, cx, cy, size, c);
  else flowerLogo(doc, cx, cy, size, c);
}
