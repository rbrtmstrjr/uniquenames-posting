"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/shadcn/checkbox";
import { letterNameIdeasAction } from "@/lib/actions/suggest";
import { addNamesAction } from "@/lib/actions/names";
import { callAction } from "@/lib/actions/call";
import { nameKey } from "@/lib/actions/helpers";
import type { Gender, NameStyle } from "@/lib/db/types";
import { ideasWanted } from "@/lib/series/letter";
import { cn } from "@/lib/utils/cn";

type Idea = { name: string; meaning: string };

/**
 * "Suggest with AI" for a short letter: Gemini's real, uncommon names starting with the letter (a few more
 * than needed), each with a checkbox. The owner ticks the keepers and adds them as available names right
 * here (reviewed on the spot, as in the card dialog), so the post can be made straight away.
 */
export function LetterIdeasDialog({ open, onOpenChange, gender, style, letter, need }: {
  open: boolean; onOpenChange: (o: boolean) => void; gender: Gender; style: NameStyle; letter: string; need: number;
}) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef("");
  const key = `${gender}|${style}|${letter}`;

  const ask = async () => {
    setLoading(true);
    setError(null);
    const r = await callAction(() => letterNameIdeasAction({ gender, style, letter, count: ideasWanted(need) }));
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    // "More ideas" adds to the list (never the same name twice); ticks stay.
    setIdeas((have) => [...have, ...r.ideas.filter((i) => !have.some((h) => nameKey(h.name) === nameKey(i.name)))]);
  };

  // Ask once per letter / gender / style when the dialog opens; a new letter starts a fresh list.
  useEffect(() => {
    if (!open || asked.current === key) return;
    asked.current = key;
    setIdeas([]);
    setPicked(new Set());
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask() reads the same props as `key`
  }, [open, key]);

  const toggle = (name: string, on: boolean) => setPicked((s) => {
    const next = new Set(s);
    if (on) next.add(name); else next.delete(name);
    return next;
  });

  const add = async () => {
    const rows = ideas.filter((i) => picked.has(i.name)).map((i) => ({ ...i, gender, style }));
    if (!rows.length || saving) return;
    setSaving(true);
    const r = await callAction(() => addNamesAction(rows));
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    toast.success(`Added ${r.added} ${letter} name${r.added === 1 ? "" : "s"}.`, r.skipped.length ? { description: `Already in your list: ${r.skipped.join(", ")}.` } : undefined);
    // The added names are gone from the list; the rest stay for another look.
    setIdeas((have) => have.filter((i) => !picked.has(i.name)));
    setPicked(new Set());
    onOpenChange(false);
  };

  const kind = style === "two-word" ? "two-word" : "single";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${letter} names with AI`}
      description={`Real, uncommon ${gender} ${kind} names starting with ${letter}${style === "two-word" ? " (the first name)" : ""}. Tick the ones you like: they are added to your names, ready to use.`}>
      <div className="space-y-4" aria-busy={loading}>
        {loading && !ideas.length && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-3 text-sm text-ink">
            <Loader2 className="mt-px size-4 shrink-0 animate-spin text-accent" aria-hidden />
            <span>The AI is finding {letter} names and checking them against your list… this can take up to a minute.</span>
          </p>
        )}
        {ideas.length > 0 && (
          <ul aria-label={`${letter} name ideas`} className={cn("grid gap-1.5", loading && "opacity-60")}>
            {ideas.map((idea) => {
              const on = picked.has(idea.name);
              const id = `idea-${nameKey(idea.name).replace(/[^a-z0-9]+/g, "-")}`;
              return (
                <li key={idea.name}>
                  <label htmlFor={id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                    on ? "bg-accent-soft ring-1 ring-accent/50" : "bg-surface-2 hover:bg-accent-soft")}>
                    <Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(idea.name, v === true)} className="size-5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{idea.name}</span>
                      <span className="block text-xs text-muted">{idea.meaning}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted">{picked.size} ticked · {need} needed</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => void ask()} loading={loading} disabled={saving} className="flex-1 sm:flex-none">
              {!loading && <Sparkles className="size-4" aria-hidden />} {ideas.length ? "More ideas" : "Try again"}
            </Button>
            <Button onClick={() => void add()} loading={saving} disabled={!picked.size || loading} className="flex-1 sm:flex-none">
              {picked.size ? `Add ${picked.size} name${picked.size === 1 ? "" : "s"}` : "Add names"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
