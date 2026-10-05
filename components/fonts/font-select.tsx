"use client";
import { FONTS, cssFamily, fontById, fontWeight, googleFontsHref } from "@/lib/fonts/catalog";
import { FONT_KEYS, FONT_LABELS, type FontKey, type PostFonts } from "@/lib/fonts/post-fonts";
import { LAYOUT } from "@/lib/text/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";
import { cn } from "@/lib/utils/cn";

/**
 * The Google Fonts CSS for the card font catalog only (display=swap), so every font can be
 * shown in its own face. React hoists it into <head> and dedupes it by href, so any page that
 * shows fonts (Today, Settings, a post) can render it.
 */
export function CatalogFontsLink() {
  return <link rel="stylesheet" href={googleFontsHref()} precedence="default" />;
}

/** The weight a field is stamped at: the name is bold-ish, meaning and watermark regular. */
export const FONT_WEIGHT: Record<FontKey, number> = { title_font: LAYOUT.titleWeight, meaning_font: LAYOUT.bodyWeight, mark_font: LAYOUT.bodyWeight };

/** CSS for a font shown as the PC will stamp it (single-weight fonts never faux bold). */
export const fontStyle = (id: string, key: FontKey) => {
  const f = fontById(id);
  return { fontFamily: cssFamily(f), fontWeight: fontWeight(f, FONT_WEIGHT[key]) };
};

/** A shadcn Select of the catalog; the trigger and every item are drawn in their own font. */
export function FontSelect({ id, label, fontKey, value, onChange, className }: {
  id: string; label: string; fontKey: FontKey; value: string; onChange: (v: string) => void; className?: string;
}) {
  const current = fontById(value);
  return (
    <div className={className}>
      <span id={`${id}-label`} className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <Select value={current.id} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={`${id}-label`} className="w-full text-base" style={fontStyle(current.id, fontKey)}>
          <SelectValue />
        </SelectTrigger>
        {/* Bottom padding keeps the list clear of the phone tab bar. */}
        <SelectContent position="popper" collisionPadding={{ top: 8, bottom: 80 }} className="max-h-[min(22rem,var(--radix-select-content-available-height))]">
          {FONTS.map((f) => (
            <SelectItem key={f.id} value={f.id} className="text-base" style={fontStyle(f.id, fontKey)}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Name / Meaning / Watermark font Selects. */
export function FontFields({ idPrefix, value, onChange, className }: {
  idPrefix: string; value: PostFonts; onChange: (v: PostFonts) => void; className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {FONT_KEYS.map((k) => (
        <FontSelect key={k} id={`${idPrefix}-${k}`} label={`${FONT_LABELS[k]} font`} fontKey={k} value={value[k]}
          onChange={(v) => onChange({ ...value, [k]: v })} />
      ))}
    </div>
  );
}

/** "Quicksand · Comfortaa · Poppins", each label in its own font. */
export function FontSummary({ value, className }: { value: PostFonts; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate", className)}>
      {FONT_KEYS.map((k, i) => (
        <span key={k}>{i > 0 && <span className="text-muted" aria-hidden> · </span>}<span style={fontStyle(value[k], k)}>{fontById(value[k]).label}</span></span>
      ))}
    </span>
  );
}
