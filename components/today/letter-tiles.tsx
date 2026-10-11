"use client";
import { LETTERS } from "@/lib/series/letter";
import { cn } from "@/lib/utils/cn";

/**
 * The 26 letter tiles of Today (By letter, Initials): each shows how many names start with it; green = at least `need`,
 * amber = fewer. `describe` gives each tile's spoken label (default "K: 12 available" / "Q: 7 available, 3 short").
 */
export function LetterTiles({ label, counts, need, value, onChange, describe }: {
  label: string; counts: Record<string, number>; need: number; value: string | null; onChange: (letter: string) => void;
  describe?: (letter: string, n: number, ok: boolean) => string;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1.5 @lg:grid-cols-13 @lg:gap-1">
      {LETTERS.map((l) => {
        const n = counts[l] ?? 0;
        const on = value === l;
        const ok = n >= need;
        return (
          <button key={l} type="button" aria-pressed={on} onClick={() => onChange(l)} data-state={ok ? "ok" : "short"}
            aria-label={describe ? describe(l, n, ok) : `${l}: ${n} available${ok ? "" : `, ${need - n} short`}`}
            className={cn("flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center rounded-lg leading-none transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              on ? "bg-accent text-accent-ink shadow-soft"
                : ok ? "bg-ok/12 text-ok hover:bg-ok/20" : "bg-warn/15 text-warn-text ring-1 ring-warn/40 hover:bg-warn/25")}>
            <span className="text-sm font-bold">{l}</span>
            <span aria-hidden className={cn("mt-0.5 text-[10px] font-semibold tabular-nums", on ? "opacity-90" : "opacity-75")}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}
