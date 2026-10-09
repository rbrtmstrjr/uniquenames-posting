"use client";
import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fillMissingLettersAction } from "@/lib/actions/suggest";
import { callAction } from "@/lib/actions/call";
import type { Gender } from "@/lib/db/types";
import { AZ_PARTS, missingLetters, type LetterCount } from "@/lib/series/az";
import { cn } from "@/lib/utils/cn";

/** The Names page, filtered to the single names of this gender waiting for approval (one letter, optionally). */
export const pendingHref = (gender: Gender, letter?: string) =>
  `/names?status=pending&gender=${gender}&style=single${letter ? `&letter=${letter}` : ""}`;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The 26 letters for this gender in two rows (Part 1 A–M, Part 2 N–Z): green = an available single
 * name exists, amber = none yet (a small number = ideas waiting for approval). Below: Fill missing
 * letters (Gemini, saved as pending) and a link to approve them on the Names page.
 */
export function AzLetters({ gender, coverage }: { gender: Gender; coverage: LetterCount[] }) {
  const [pending, start] = useTransition();
  const missing = missingLetters(coverage);
  const waiting = coverage.reduce((t, c) => t + (c.available === 0 ? c.pending : 0), 0);
  const by = new Map(coverage.map((c) => [c.letter, c]));

  const fill = () => {
    if (pending) return;
    start(async () => {
      const r = await callAction(() => fillMissingLettersAction({ gender }));
      if (!r.ok) { toast.error(r.error); return; }
      const got = r.letters.filter((l) => l.added > 0).map((l) => l.letter);
      if (!r.added) { toast.error(`Gemini had no new real names for ${r.short.join(", ")}. Try again, or add names by hand.`); return; }
      toast.success(`${plural(r.added, "name idea")} for ${got.join(", ")}. Approve the ones you like on the Names page.`,
        r.short.length ? { description: `Fewer than 3 new names for ${r.short.join(", ")}.` } : undefined);
    });
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label={`A to Z letters for ${gender} single names`} className="space-y-1.5">
        {AZ_PARTS.map(({ part, letters }) => (
          <ol key={part} aria-label={`Part ${part}: ${letters[0]} to ${letters[letters.length - 1]}`} className="grid grid-cols-13 gap-1">
            {letters.map((l) => {
              const c = by.get(l)!;
              const ok = c.available > 0;
              return (
                <li key={l} data-state={ok ? "ok" : "missing"}
                  aria-label={ok ? `${l}: ${c.available} available` : `${l}: none available${c.pending ? `, ${c.pending} waiting for approval` : ""}`}
                  className={cn("relative flex aspect-square min-w-0 items-center justify-center rounded-md text-xs font-bold",
                    ok ? "bg-ok/12 text-ok" : "bg-warn/15 text-warn-text ring-1 ring-warn/40")}>
                  {l}
                  {!ok && c.pending > 0 && (
                    <span aria-hidden className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-accent text-[9px] leading-none text-accent-ink">{c.pending}</span>
                  )}
                </li>
              );
            })}
          </ol>
        ))}
      </div>
      <p className="text-xs text-muted">
        {missing.length
          ? <>No available single {gender} name for <span className="font-semibold text-warn-text">{missing.join(", ")}</span>.</>
          : <>Every letter has a name. Part 1 is A–M, Part 2 is N–Z.</>}
      </p>
      {(missing.length > 0 || waiting > 0) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {missing.length > 0 && (
            <Button variant="subtle" onClick={fill} loading={pending} className="w-full sm:w-auto">
              {!pending && <Sparkles className="size-4" aria-hidden />} {pending ? "Asking Gemini…" : "Fill missing letters"}
            </Button>
          )}
          {waiting > 0 && (
            <Link href={pendingHref(gender)} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-accent hover:bg-accent-soft">
              Review {plural(waiting, "name")} waiting
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
