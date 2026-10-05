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
 * Compact stock strip under the post card: names left as a Boy | Girl × Two-word | Single table
 * (the cell matching the New post choice is highlighted, low cells amber, empty ones red) beside
 * themes left per gender. Side by side when the card is wide, stacked when it is narrow.
 */
export function Stock({ stock, themes, max, className }: {
  stock: { gender: Gender; style: NameStyle; count: number }[]; themes: { boy: number; girl: number }; max: number; className?: string;
}) {
  const [sel] = useTodaySelection();
  const countOf = (g: Gender, s: NameStyle) => stock.find((x) => x.gender === g && x.style === s)?.count ?? 0;
  return (
    <Panel title="Stock left" className={className}
      action={
        <div className="-my-2 flex gap-4">
          <Link href="/names" className="inline-flex min-h-11 items-center text-xs font-bold text-accent hover:underline">Manage names</Link>
          <Link href="/themes" className="inline-flex min-h-11 items-center text-xs font-bold text-accent hover:underline">Manage themes</Link>
        </div>
      }>
      <div className="@container">
        <div className="grid gap-3 @lg:grid-cols-[3fr_2fr] @lg:gap-5">
          <table className="-mx-1 w-[calc(100%+0.5rem)] table-fixed border-separate border-spacing-1 text-left">
            <caption className="sr-only">Names left by gender and style</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[4.75rem]" />
                {GENDERS.map((g) => <th key={g.value} scope="col" className="px-3 text-xs font-semibold text-muted">{g.label}</th>)}
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
                        className={cn("h-11 rounded-xl px-3 align-middle transition-colors", on ? "bg-accent-soft ring-2 ring-accent/60 ring-inset" : "bg-surface-2")}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("text-lg font-bold leading-none tabular-nums", LEVEL_TEXT[level])}>{n}</span>
                          {LEVEL_NOTE[level] && <span className={cn("text-[11px] font-bold uppercase leading-none tracking-wide", LEVEL_TEXT[level])}>{LEVEL_NOTE[level]}</span>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <h3 className="mb-1 text-xs font-semibold text-muted">Themes left</h3>
            <div className="grid grid-cols-2 gap-1 @lg:grid-cols-1">
              {GENDERS.map((g) => (
                <div key={g.value} className="flex h-11 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3">
                  <span className="text-sm text-muted">{g.label}<span className="sr-only"> themes</span></span>
                  <span className={cn("text-lg font-bold leading-none tabular-nums", themes[g.value] < 3 ? "text-warn-text" : "text-ink")}>{themes[g.value]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
