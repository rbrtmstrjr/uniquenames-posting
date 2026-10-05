"use client";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";
import type { Gender, NameStyle } from "@/lib/db/types";
import { postsLeft, stockLevel, type StockLevel } from "@/lib/today/summary";
import { useTodaySelection } from "@/components/today/selection";

const GENDERS: { value: Gender; label: string }[] = [{ value: "boy", label: "Boy" }, { value: "girl", label: "Girl" }];
const STYLES: { value: NameStyle; label: string }[] = [{ value: "two-word", label: "Two-word" }, { value: "single", label: "Single" }];
const LEVEL_TEXT: Record<StockLevel, string> = { ok: "text-ink", low: "text-warn-text", out: "text-bad" };
const LEVEL_NOTE: Record<StockLevel, string | null> = { ok: null, low: "Low", out: "Out" };
const LOW_THEMES = 3;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One stat tile: small label row, a big number, and a muted line under it. */
function Tile({ label, tag, n, sub, level, current, aria }: {
  label: string; tag?: string; n: number; sub: string; level: StockLevel; current?: boolean; aria: string;
}) {
  return (
    <li aria-label={aria} aria-current={current || undefined} data-level={level}
      className={cn("rounded-xl border px-3.5 py-3 transition-colors",
        current ? "border-accent/60 bg-accent-soft ring-1 ring-accent/40" : "border-transparent bg-surface-2")}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        <span className="truncate">{label}{tag && <span className="font-normal"> · {tag}</span>}</span>
        {LEVEL_NOTE[level] && <span className={cn("text-[11px] font-bold uppercase tracking-wide", LEVEL_TEXT[level])}>{LEVEL_NOTE[level]}</span>}
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold leading-none tabular-nums", LEVEL_TEXT[level])}>{n}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </li>
  );
}

/**
 * Stock strip under the post card: four name tiles (gender × style; the New post choice is
 * highlighted, low ones amber, empty ones red, each with about how many posts it covers), then
 * two theme tiles. One row when the card is wide; two neat groups when it is narrow.
 */
export function Stock({ stock, themes, min, max, className }: {
  stock: { gender: Gender; style: NameStyle; count: number }[]; themes: { boy: number; girl: number }; min: number; max: number; className?: string;
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
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @3xl:gap-6">
          <section>
            <h3 className="mb-2 text-xs font-semibold text-muted">Names</h3>
            <ul aria-label="Names left" className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              {GENDERS.flatMap((g) => STYLES.map((s) => {
                const n = countOf(g.value, s.value);
                const posts = postsLeft(n, min, max);
                return (
                  <Tile key={`${g.value}-${s.value}`} label={g.label} tag={s.label} n={n} level={stockLevel(n, max)}
                    current={sel.gender === g.value && sel.style === s.value}
                    sub={n <= 0 ? "None left" : posts < 1 ? "Less than a post" : `≈ ${plural(posts, "post")}`}
                    aria={`${g.label} ${s.label.toLowerCase()}: ${n} names left`} />
                );
              }))}
            </ul>
          </section>
          <section className="@3xl:border-l @3xl:border-line @3xl:pl-6">
            <h3 className="mb-2 text-xs font-semibold text-muted">Themes</h3>
            <ul aria-label="Themes left" className="grid grid-cols-2 gap-2">
              {GENDERS.map((g) => {
                const n = themes[g.value];
                return (
                  <Tile key={g.value} label={g.label} n={n} level={n <= 0 ? "out" : n < LOW_THEMES ? "low" : "ok"}
                    sub={n <= 0 ? "None left" : plural(n, "post")} aria={`${g.label}: ${n} themes left`} />
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </Panel>
  );
}
