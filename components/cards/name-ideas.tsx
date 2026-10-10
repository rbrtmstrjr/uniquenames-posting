"use client";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardNameIdeasAction } from "@/lib/actions/suggest";
import { callAction } from "@/lib/actions/call";
import { nameKey } from "@/lib/actions/helpers";
import { cn } from "@/lib/utils/cn";

type Idea = { name: string; meaning: string };

/**
 * "Suggest names" in the card dialog: Gemini offers 5 new names for this post (none of them
 * already in the list). Tapping one fills the Name and Meaning fields; the owner then saves the
 * text or makes a new picture with it. Nothing is stored until then.
 */
export function NameIdeas({ cardId, current, onPick }: { cardId: string; current: string; onPick: (idea: Idea) => void }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setLoading(true);
    setError(null);
    const r = await callAction(() => cardNameIdeasAction(cardId));
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    setIdeas(r.ideas);
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-xs font-semibold text-muted">{ideas.length ? "Tap one, then save or make a new picture" : "Want a different name?"}</span>
        <Button size="sm" variant="ghost" onClick={ask} loading={loading} className="-my-1 shrink-0 whitespace-nowrap">
          <Sparkles className="size-4" /> {ideas.length ? "More ideas" : "Suggest names"}
        </Button>
      </div>
      {loading && !ideas.length && <p className="mt-2 text-xs text-muted" aria-live="polite">Asking the AI for 5 new names…</p>}
      {error && <p role="alert" className="mt-2 text-xs font-medium text-bad">{error}</p>}
      {ideas.length > 0 && (
        <ul aria-label="Name ideas" className={cn("mt-2 grid gap-1.5", loading && "opacity-60")}>
          {ideas.map((idea) => {
            const on = nameKey(idea.name) === nameKey(current);
            return (
              <li key={idea.name}>
                <button type="button" onClick={() => onPick(idea)} aria-pressed={on}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    on ? "bg-accent-soft ring-1 ring-accent/50" : "bg-surface-2 hover:bg-accent-soft")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{idea.name}</span>
                    <span className="block text-xs text-muted">{idea.meaning}</span>
                  </span>
                  {on && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
