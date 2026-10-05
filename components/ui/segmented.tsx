"use client";
import { cn } from "@/lib/utils/cn";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/shadcn/toggle-group";

// Our Segmented API on the shadcn ToggleGroup (type "single": Radix renders role=radio items with
// roving arrow-key focus). Clicking the selected option again would clear a ToggleGroup; a
// segmented control always has one value, so empty values are ignored.
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string;
}) {
  return (
    <ToggleGroup type="single" spacing={1} value={value} onValueChange={(v) => { if (v) onChange(v as T); }} aria-label={label}
      className={cn("inline-flex w-auto flex-wrap rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}
          className="h-auto min-h-11 rounded-lg px-3.5 text-sm font-semibold transition hover:bg-transparent data-[state=off]:text-muted data-[state=off]:hover:text-ink data-[state=on]:bg-accent data-[state=on]:text-accent-ink data-[state=on]:shadow-soft">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
