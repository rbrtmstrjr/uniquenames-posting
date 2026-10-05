"use client";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";
import type { Gender, NameStyle } from "@/lib/db/types";
import { stockLevel, type StockLevel } from "@/lib/today/summary";
import { useTodaySelection } from "@/components/today/selection";

const GENDERS: { value: Gender; label: string }[] = [{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }];
const STYLES: { value: NameStyle; label: string }[] = [{ value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }];
const LEVEL_TEXT: Record<StockLevel, string> = { ok: "text-ink", low: "text-warn-text", out: "text-bad" };
const LEVEL_NOTE: Record<StockLevel, string | null> = { ok: null, low: "Low", out: "Out" };

/**
 * Names left as a Boy | Girl × Two-word | Single table; the cell matching the New post choice is
 * highlighted, low cells turn amber and empty ones red. Then themes left and links to manage both.
 */
export function Stock({ stock, themes, max, className }: {
  stock: { gender: Gender; style: NameStyle; count: number }[]; themes: { boy: number; girl: number }; max: number; className?: string;
}) {
  const [sel] = useTodaySelection();
  const countOf = (g: Gender, s: NameStyle) => stock.find((x) => x.gender === g && x.style === s)?.count ?? 0;
  return (
    <Panel title="Stock left" className={className}>
      <table className="-mx-1 w-[calc(100%+0.5rem)] table-fixed border-separate border-spacing-1 text-left">
        <caption className="sr-only">Names left by gender and style</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[5.25rem]" />
            {GENDERS.map((g) => <th key={g.value} scope="col" className="px-3 pb-0.5 text-xs font-semibold text-muted">{g.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {STYLES.map((s) => (
            <tr key={s.value}>
              <th scope="row" className="pl-1 text-sm font-semibold text-ink">{s.label}</th>
              {GENDERS.map((g) => {
                const n = countOf(g.value, s.value);
                const level = stockLevel(n, max);
                const on = sel.gender === g.value && sel.style === s.value;
                return (
                  <td key={g.value} data-level={level} aria-current={on || undefined}
                    className={cn("h-16 rounded-xl px-3 align-middle transition-colors", on ? "bg-accent-soft ring-2 ring-accent/60 ring-inset" : "bg-surface-2")}>
                    <span className={cn("block text-2xl font-bold leading-none tabular-nums", LEVEL_TEXT[level])}>{n}</span>
                    {LEVEL_NOTE[level] && <span className={cn("mt-1 block text-[11px] font-bold uppercase leading-none tracking-wide", LEVEL_TEXT[level])}>{LEVEL_NOTE[level]}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 border-t border-line pt-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[.08em] text-muted">Themes left</h3>
        <div className="grid grid-cols-2 gap-2">
          {GENDERS.map((g) => (
            <div key={g.value} className="flex items-baseline justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
              <span className="text-sm text-muted">{g.label}<span className="sr-only"> themes</span></span>
              <span className={cn("text-lg font-bold leading-none tabular-nums", themes[g.value] < 3 ? "text-warn-text" : "text-ink")}>{themes[g.value]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="-mb-2 mt-1 flex justify-between gap-2">
        <Link href="/names" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">Manage names</Link>
        <Link href="/themes" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">Manage themes</Link>
      </div>
    </Panel>
  );
}
