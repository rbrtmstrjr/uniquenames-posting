"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { TEXT_POSITIONS, type TextPosition } from "@/lib/db/types";
import type { TextSettings } from "@/lib/actions/validate";
import { cssFamily, fontById, fontWeight } from "@/lib/fonts/catalog";
import { LAYOUT, SIZE_RANGES, fitMeaning, fitTitle, markSide, maxWidthFor, pxAt, spot, titleText, type Measure, type SizeKey } from "@/lib/text/layout";
import { CatalogFontsLink } from "@/components/fonts/font-select";
import { Slider } from "@/components/ui/shadcn/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/shadcn/toggle-group";
import { cn } from "@/lib/utils/cn";

export const FALLBACK_PREVIEW = "/login/light-wide.webp";
export interface PreviewSample { photoUrl: string | null; name: string; meaning: string }

const FONT_FIELDS = [
  { key: "title_font", label: "Name font", weight: LAYOUT.titleWeight },
  { key: "meaning_font", label: "Meaning font", weight: LAYOUT.bodyWeight },
  { key: "mark_font", label: "Watermark font", weight: LAYOUT.bodyWeight },
] as const;
const SIZE_FIELDS = [
  { key: "title", field: "title_size", label: "Name size" },
  { key: "meaning", field: "meaning_size", label: "Meaning size" },
  { key: "mark", field: "mark_size", label: "Watermark size" },
] as const satisfies readonly { key: SizeKey; field: keyof TextSettings; label: string }[];
const POSITION_LABEL = (p: TextPosition) => (p === "auto" ? "Auto (calmest part of each photo)" : p.replace("-", " ").replace(/^./, (c) => c.toUpperCase()));

/** Sizes, position and a live preview of the card text (fonts are picked per post on Today). */
export function CardTextSettings({ value, onChange, sample, aspect, handle }: {
  value: TextSettings; onChange: (v: TextSettings) => void; sample: PreviewSample; aspect: number; handle: string;
}) {
  const set = <K extends keyof TextSettings>(k: K, v: TextSettings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Google Fonts for the preview (React hoists it into <head>). */}
      <CatalogFontsLink />
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-1">
          {SIZE_FIELDS.map((s) => (
            <SizeSlider key={s.key} label={s.label} range={SIZE_RANGES[s.key]} value={value[s.field]} onChange={(v) => set(s.field, v)} />
          ))}
        </div>
        <PositionPicker value={value.text_position} onChange={(p) => set("text_position", p)} />
      </div>
      <div className="order-first md:order-none">
        <TextPreview t={value} sample={sample} aspect={aspect} handle={handle} />
        <p className="mt-2 text-xs text-muted"><strong className="font-semibold text-ink">Fonts are chosen per post on Today</strong>; the preview uses the fonts of your last post ({FONT_FIELDS.map((f) => fontById(value[f.key]).label).join(" · ")}).</p>
        <p className="mt-1 text-xs text-muted">Sizes and position apply to new cards. To update a post you already made, open it and use <strong className="font-semibold text-ink">Re-stamp with current text settings</strong>.</p>
      </div>
    </div>
  );
}

function SizeSlider({ label, range, value, onChange }: { label: string; range: { min: number; max: number }; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <span className="text-sm font-bold tabular-nums text-ink" aria-hidden>{value} px</span>
      </div>
      <Slider aria-label={label} aria-valuetext={`${value} px`} min={range.min} max={range.max} step={1} value={[value]} onValueChange={([v]) => onChange(v)} className="mt-1 py-2" />
    </div>
  );
}

const ITEM = "h-auto min-h-11 rounded-lg border border-line px-2 text-xs font-semibold transition data-[state=off]:text-muted data-[state=off]:hover:text-ink data-[state=on]:border-accent data-[state=on]:bg-accent data-[state=on]:text-accent-ink";

/** Auto + a 3x3 grid of spots. One radio group, so arrow keys move between all ten. */
function PositionPicker({ value, onChange }: { value: TextPosition; onChange: (p: TextPosition) => void }) {
  return (
    <div>
      <span id="text-position-label" className="mb-1.5 block text-xs font-semibold text-muted">Text position</span>
      <ToggleGroup type="single" spacing={1} value={value} onValueChange={(v) => { if (v) onChange(v as TextPosition); }}
        aria-labelledby="text-position-label" className="grid w-full max-w-xs grid-cols-3 gap-1.5 rounded-xl bg-surface-2 p-1.5">
        {TEXT_POSITIONS.map((p) => p === "auto" ? (
          <ToggleGroupItem key={p} value={p} aria-label={POSITION_LABEL(p)} className={cn(ITEM, "col-span-3 w-full")}>Auto · calmest band</ToggleGroupItem>
        ) : (
          <ToggleGroupItem key={p} value={p} aria-label={POSITION_LABEL(p)} className={cn(ITEM, "h-14 w-full p-1.5")}>
            <SpotGlyph position={p} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function SpotGlyph({ position }: { position: TextPosition }) {
  const { vert, horiz } = spot(position);
  return (
    <span aria-hidden className={cn("flex size-full flex-col gap-0.5 rounded-md border border-current/30 p-1.5",
      vert === "top" ? "justify-start" : vert === "middle" ? "justify-center" : "justify-end",
      horiz === "left" ? "items-start" : horiz === "center" ? "items-center" : "items-end")}>
      <span className="h-1 w-1/2 rounded-full bg-current" />
      <span className="h-0.5 w-1/3 rounded-full bg-current opacity-70" />
    </span>
  );
}

// ---------------------------------------------------------------- live preview

let canvas: HTMLCanvasElement | null = null;
/** Ink width like the worker's Pillow getbbox (not the advance width). */
function canvasMeasure(fontId: string, weight: number): Measure {
  const f = fontById(fontId);
  const w = fontWeight(f, weight);
  return (text, px) => {
    canvas ??= document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return text.length * px * 0.6;
    ctx.font = `${w} ${px}px ${cssFamily(f)}`;
    const m = ctx.measureText(text);
    return (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width);
  };
}

/** Mean luminance (0-255) of a box (fractions of the card) of an object-cover image, or null if unreadable. */
function boxLuminance(img: HTMLImageElement, aspect: number, box: [number, number, number, number]): number | null {
  try {
    const cw = 96, ch = Math.max(1, Math.round(96 * aspect));
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx || !img.naturalWidth) return null;
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    const x0 = Math.max(0, Math.floor(box[0] * cw)), y0 = Math.max(0, Math.floor(box[1] * ch));
    const x1 = Math.min(cw, Math.ceil(box[2] * cw)), y1 = Math.min(ch, Math.ceil(box[3] * ch));
    if (x1 <= x0 || y1 <= y0) return null;
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  } catch {
    return null; // a cross-origin image without CORS taints the canvas
  }
}

type Ink = { color: string; halo: string };
const WHITE: Ink = { color: "rgb(255,255,255)", halo: "rgba(0,0,0,.47)" };
const DARK: Ink = { color: `rgb(${LAYOUT.darkInk.join(",")})`, halo: "rgba(255,255,255,.43)" };
const inkFor = (lum: number | null): Ink => (lum !== null && lum > LAYOUT.lightBackdrop ? DARK : WHITE);

/**
 * The card as the PC will stamp it, laid out by the same rules (lib/text/layout.ts mirrors
 * worker/render.py): same padding %, sizes scaled to the preview width, same alignment,
 * shrinking and wrapping, same light/dark ink choice. Auto shows the top band; the PC picks
 * the calmest band of each real photo.
 */
export function TextPreview({ t, sample, aspect, handle }: { t: TextSettings; sample: PreviewSample; aspect: number; handle: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [W, setW] = useState(0);
  const [fontsTick, bumpFonts] = useReducer((x: number) => x + 1, 0);
  const [src, setSrc] = useState(sample.photoUrl ?? FALLBACK_PREVIEW);
  const [inks, setInks] = useState<{ text: Ink; mark: Ink }>({ text: WHITE, mark: WHITE });
  const [imgTick, bumpImg] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure once the chosen web fonts have loaded (canvas measures the fallback before).
  const fontKey = FONT_FIELDS.map((f) => t[f.key]).join("|");
  useEffect(() => {
    const fs = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fs) return;
    const on = () => bumpFonts();
    fs.addEventListener?.("loadingdone", on);
    const ids = fontKey.split("|");
    void Promise.all(FONT_FIELDS.map((f, i) => {
      const font = fontById(ids[i]);
      return fs.load(`${fontWeight(font, f.weight)} 40px ${cssFamily(font)}`);
    })).then(on, () => {});
    return () => fs.removeEventListener?.("loadingdone", on);
  }, [fontKey]);

  const H = W * aspect;
  const { vert, horiz } = spot(t.text_position);
  const lay = useMemo(() => {
    if (!W) return null;
    void fontsTick;
    const maxW = maxWidthFor(horiz, W);
    const title = titleText(sample.name, t.title_font);
    const titlePx = fitTitle(canvasMeasure(t.title_font, LAYOUT.titleWeight), title, pxAt(t.title_size, W), maxW);
    const meaning = fitMeaning(canvasMeasure(t.meaning_font, LAYOUT.bodyWeight), sample.meaning, pxAt(t.meaning_size, W), maxW);
    return { title, titlePx, meaning, markPx: Math.max(1, pxAt(t.mark_size, W)) };
  }, [W, horiz, sample.name, sample.meaning, t.title_font, t.meaning_font, t.title_size, t.meaning_size, t.mark_size, fontsTick]);

  // Light/dark ink from the photo under the text, like the worker's text_colors().
  useEffect(() => {
    const f = frame.current, b = block.current, m = mark.current, i = img.current;
    if (!f || !b || !m || !i || !i.complete) return;
    const fr = f.getBoundingClientRect();
    const pad = W * LAYOUT.gap;
    const frac = (r: DOMRect, p: number): [number, number, number, number] =>
      [(r.left - p - fr.left) / fr.width, (r.top - p - fr.top) / fr.height, (r.right + p - fr.left) / fr.width, (r.bottom + p - fr.top) / fr.height];
    setInks({ text: inkFor(boxLuminance(i, aspect, frac(b.getBoundingClientRect(), pad))), mark: inkFor(boxLuminance(i, aspect, frac(m.getBoundingClientRect(), 4 * W / 1080))) });
  }, [lay, t.text_position, t.mark_font, aspect, W, imgTick]);

  const off = Math.max(1, W / 400);
  const blur = Math.max(2, W / 220);
  const shadow = (ink: Ink) => `0 ${off}px ${blur}px ${ink.halo}, 0 0 ${blur}px ${ink.halo}`;
  const titleFont = fontById(t.title_font), meaningFont = fontById(t.meaning_font), markFont = fontById(t.mark_font);
  const band = LAYOUT.autoBands.top;
  const align = horiz === "left" ? "items-start text-left" : horiz === "right" ? "items-end text-right" : "items-center text-center";

  return (
    <figure className="m-0">
      <div ref={frame} className="relative w-full overflow-hidden rounded-xl bg-surface-2 shadow-soft" style={{ aspectRatio: `1 / ${aspect}` }}
        role="img" aria-label={`Preview: ${sample.name}, ${sample.meaning}, ${POSITION_LABEL(t.text_position).toLowerCase()}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL or a local fallback, sampled on a canvas */}
        <img ref={img} src={src} alt="" crossOrigin={src.startsWith("http") ? "anonymous" : undefined}
          onLoad={bumpImg} onError={() => setSrc(FALLBACK_PREVIEW)} className="absolute inset-0 size-full object-cover" />
        {lay && (
          <div className="absolute flex flex-col" style={{
            left: `${LAYOUT.padX * 100}%`, right: `${LAYOUT.padX * 100}%`,
            // Middle centres on the full height, like the worker (y = (H - h) / 2).
            top: vert === "auto" ? band[0] * H : vert === "middle" ? 0 : LAYOUT.padTop * H,
            bottom: vert === "auto" ? H - band[1] * H : vert === "middle" ? 0 : LAYOUT.padBottom * H,
            justifyContent: vert === "top" ? "flex-start" : vert === "bottom" ? "flex-end" : "center",
          }}>
            <div ref={block} className={cn("flex flex-col", align)} style={{ color: inks.text.color, textShadow: shadow(inks.text) }}>
              <div style={{ fontFamily: cssFamily(titleFont), fontWeight: fontWeight(titleFont, LAYOUT.titleWeight), fontSize: lay.titlePx, lineHeight: 1, whiteSpace: "nowrap" }}>{lay.title}</div>
              <div style={{ marginTop: W * LAYOUT.gap, fontFamily: cssFamily(meaningFont), fontWeight: fontWeight(meaningFont, LAYOUT.bodyWeight), fontSize: lay.meaning.px, lineHeight: 1 + LAYOUT.lineGap, opacity: 240 / 255 }}>
                {lay.meaning.lines.map((ln, i) => <div key={i} style={{ whiteSpace: "nowrap" }}>{ln}</div>)}
              </div>
            </div>
          </div>
        )}
        {lay && (
          <div ref={mark} className="absolute whitespace-nowrap" style={{
            bottom: LAYOUT.markInsetBottom * H, [markSide(t.text_position)]: LAYOUT.markInsetX * W, lineHeight: 1,
            fontFamily: cssFamily(markFont), fontWeight: fontWeight(markFont, LAYOUT.bodyWeight), fontSize: lay.markPx,
            color: inks.mark.color, opacity: 200 / 255, textShadow: shadow(inks.mark),
          }}>{handle}</div>
        )}
      </div>
      <figcaption className="mt-1.5 text-xs text-muted">
        {t.text_position === "auto" ? "Auto: your PC puts the text in the calmest band of each photo (shown here at the top)." : `Text ${POSITION_LABEL(t.text_position).toLowerCase()}.`}
        {!sample.photoUrl && " Sample photo; your latest card's photo shows here once one is made."}
      </figcaption>
    </figure>
  );
}
