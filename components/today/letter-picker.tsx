"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Gender, NameStyle } from "@/lib/db/types";
import { LETTERS } from "@/lib/series/letter";
import { cn } from "@/lib/utils/cn";
import { LetterIdeasDialog } from "./letter-ideas";

/**
 * By letter on Today: the 26 letters as buttons, each with how many available names of this gender +
 * style start with it (green = enough for this post, amber = short). Tap one to make a post of names
 * starting with it; when it is short, "Suggest with AI" asks Gemini for more and the owner ticks the
 * ones to add.
 */
export function LetterPicker({ gender, style, counts, need, value, onChange }: {
  gender: Gender; style: NameStyle;
  /** Available names per letter for this gender + style. */
  counts: Record<string, number>;
  /** Names this post needs (the chosen card count, or the minimum for Auto). */
  need: number;
  value: string | null; onChange: (letter: string) => void;
}) {
  const [ideas, setIdeas] = useState(false);
  const have = value ? counts[value] ?? 0 : 0;
  const short = value ? Math.max(0, need - have) : 0;
  const kind = style === "two-word" ? "two-word" : "single";

  return (
    <div className="space-y-3">
      <div role="group" aria-label={`Letters for ${gender} ${kind} names`} className="grid grid-cols-7 gap-1.5 @lg:grid-cols-13 @lg:gap-1">
        {LETTERS.map((l) => {
          const n = counts[l] ?? 0;
          const on = value === l;
          const ok = n >= need;
          return (
            <button key={l} type="button" aria-pressed={on} onClick={() => onChange(l)} data-state={ok ? "ok" : "short"}
              aria-label={`${l}: ${n} available${ok ? "" : `, ${need - n} short`}`}
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
      {!value ? (
        <p className="text-xs text-muted">Pick a letter: every name in the post starts with it{style === "two-word" ? " (the first name)" : ""}. Green letters have enough names.</p>
      ) : short > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl bg-warn/10 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-warn-text">Need {short} more {value} name{short === 1 ? "" : "s"}</p>
          <Button variant="subtle" size="sm" onClick={() => setIdeas(true)} className="w-full sm:w-auto">
            <Sparkles className="size-4" aria-hidden /> Suggest with AI
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">{have} {gender} {kind} names start with {value}.</p>
      )}
      {value && (
        <LetterIdeasDialog open={ideas} onOpenChange={setIdeas} gender={gender} style={style} letter={value} need={Math.max(1, short)} />
      )}
    </div>
  );
}
