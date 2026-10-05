"use client";
import { cn } from "@/lib/utils/cn";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/shadcn/toggle-group";

// Our Segmented API on the shadcn ToggleGroup (type "single": Radix renders role=radio items with
// roving arrow-key focus). Clicking the selected option again would clear a ToggleGroup; a
// segmented control always has one value, so empty values are ignored.
// `fill`: a 44px-tall track whose options share its full width (a form field next to Selects);
// each option keeps a 44px tap area through an invisible strip above and below its pill.
export function Segmented<T extends string>({ value, onChange, options, label, className, fill }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; className?: string }[]; label: string; className?: string; fill?: boolean;
}) {
  return (
    <ToggleGroup type="single" spacing={1} value={value} onValueChange={(v) => { if (v) onChange(v as T); }} role="radiogroup" aria-label={label}
      className={cn("rounded-xl bg-surface-2 p-1", fill ? "flex h-11 w-full flex-nowrap" : "inline-flex w-auto flex-wrap", className)}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}
          className={cn("rounded-lg text-sm font-semibold transition hover:bg-transparent data-[state=off]:text-muted data-[state=off]:hover:text-ink data-[state=on]:bg-accent data-[state=on]:text-accent-ink data-[state=on]:shadow-soft",
            fill ? "relative h-9 min-h-0 flex-1 px-2 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']" : "h-auto min-h-11 px-3.5", o.className)}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
