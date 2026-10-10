"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/shadcn/input";
import { Slider } from "@/components/ui/shadcn/slider";
import { callAction } from "@/lib/actions/call";
import type { ActionResult } from "@/lib/actions/result";
import { VIBE_MAX } from "@/lib/ai/suggest-filter";

export type SuggestOutcome = ActionResult<{ added: number; duplicates: number; invalid: number }>;

/** "Added 8 suggestions (3 duplicates skipped)" — what the owner sees when Gemini is done. */
export function outcomeText(r: { added: number; duplicates: number; invalid: number }, noun: string): string {
  const skipped = r.duplicates + r.invalid;
  const tail = skipped ? ` (${r.duplicates} duplicate${r.duplicates === 1 ? "" : "s"}${r.invalid ? `, ${r.invalid} unusable` : ""} skipped)` : "";
  if (!r.added) return `No new ${noun}s this time${tail}. Try again, or add an idea.`;
  return `Added ${r.added} suggestion${r.added === 1 ? "" : "s"}${tail}.`;
}

/**
 * "Suggest with AI": a count slider, an optional idea, and caller-specific fields. While Gemini
 * works the dialog stays open with a progress state; then it shows the outcome and offers to
 * review the new pending rows. Closing mid-way is fine: the result then arrives as a toast.
 */
export function SuggestDialog({ open, onOpenChange, noun, title, description, range, defaultCount, fields, ideaPlaceholder, run, onReview }: {
  open: boolean; onOpenChange: (o: boolean) => void; noun: string; title: string; description: string;
  range: { min: number; max: number }; defaultCount: number; fields?: React.ReactNode; ideaPlaceholder: string;
  run: (count: number, vibe: string | undefined) => Promise<SuggestOutcome>; onReview: () => void;
}) {
  const [count, setCount] = useState(defaultCount);
  const [vibe, setVibe] = useState("");
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  // A fresh form each time the dialog opens, unless Gemini is still working.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open && phase !== "running") { setPhase("form"); setError(null); }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase === "running") return;
    setPhase("running");
    setError(null);
    const r = await callAction(() => run(count, vibe.trim() || undefined));
    if (!r.ok) {
      setPhase("form");
      setError(r.error);
      if (!openRef.current) toast.error(r.error);
      return;
    }
    const text = outcomeText(r, noun);
    setMessage(text);
    setPhase("done");
    if (!openRef.current) toast.success(text);
  };

  const running = phase === "running";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {phase === "done" ? (
        <div className="space-y-4">
          <p role="status" className="flex items-start gap-2 rounded-xl bg-ok/12 px-3 py-3 text-sm font-semibold text-ok">
            <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden /> <span>{message}</span>
          </p>
          <p className="text-sm text-muted">New suggestions wait under Pending until you approve them. Nothing is used in a post before that.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPhase("form")}>Suggest more</Button>
            <Button onClick={() => { onOpenChange(false); onReview(); }}>Review them</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" aria-busy={running}>
          <fieldset disabled={running} className="space-y-4">
            {fields}
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-muted">How many</span>
                <span className="text-sm font-semibold tabular-nums text-ink">{count}</span>
              </div>
              <Slider aria-label="How many" min={range.min} max={range.max} step={1} value={[count]} onValueChange={([v]) => setCount(v)} disabled={running} className="mt-1" />
            </div>
            <label className="block"><span className="text-xs font-semibold text-muted">Idea (optional)</span>
              <Input value={vibe} maxLength={VIBE_MAX} onChange={(e) => setVibe(e.target.value)} placeholder={ideaPlaceholder} className="mt-1" /></label>
          </fieldset>
          {running && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-3 text-sm text-ink">
              <Loader2 className="mt-px size-4 shrink-0 animate-spin text-accent" aria-hidden />
              <span>The AI is thinking up {count} {noun}s and checking them against your list… this can take up to a minute.</span>
            </p>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{running ? "Hide" : "Cancel"}</Button>
            <Button type="submit" loading={running}>{!running && <Sparkles className="size-4" aria-hidden />} {running ? "Suggesting…" : `Suggest ${count} ${noun}s`}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
