"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Gender, NameStyle } from "@/lib/db/types";
import { LetterIdeasDialog } from "./letter-ideas";
import { LetterTiles } from "./letter-tiles";

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
      <LetterTiles label={`Letters for ${gender} ${kind} names`} counts={counts} need={need} value={value} onChange={onChange} />
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
